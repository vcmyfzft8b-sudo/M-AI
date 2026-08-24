/**
 * Grades the study material a running app instance actually produced, against its own stored
 * source. For each lecture: derive the key facts from the source with a grader model, then score
 * note coverage, deck coverage, distractor quality, and the repo's own mechanical validators.
 *
 *   node --experimental-strip-types scripts/live-eval.mjs <cookieFile> <lectureId> [...]
 *
 * Grades whichever instance LIVE_EVAL_BASE_URL points at, so the same run that grades a local
 * dev server also grades a Vercel preview deployment (the only place the production build,
 * serverless timeouts and deployed env vars are actually exercised).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { generate, GRADER_MODEL, ledger, loadEnv } from "./lib/eval-runtime.mjs";
import {
  areHighQualityQuizOptions, isHighQualityFlashcard, isHighQualityStudyPrompt,
} from "../src/lib/study-quality.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);
const cookie = fs.readFileSync(process.argv[2], "utf8").trim();
const BASE = (process.env.LIVE_EVAL_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const get = async (p) => (await fetch(`${BASE}${p}`, { headers: { Cookie: cookie } })).json();

const keyFactsSchema = z.object({ facts: z.array(z.string().min(8)).min(5).max(60) });
const coverageSchema = z.object({
  covered: z.array(z.object({ index: z.number().int().nonnegative(), present: z.boolean() })),
});
const distractorSchema = z.object({
  verdicts: z.array(z.object({
    index: z.number().int().nonnegative(),
    plausibleDistractors: z.boolean(),
    exactlyOneCorrect: z.boolean(),
  })),
});

async function coverage(facts, corpus, label) {
  const value = await generate({
    schema: coverageSchema, model: GRADER_MODEL, thinkingLevel: "low", maxOutputTokens: 8000,
    instructions:
      "Check whether each key fact is taught or tested by the material. Judge meaning, not wording. A fact counts only when the material states or tests its actual content.",
    input: `MATERIAL (${label}):\n${corpus.slice(0, 60000)}\n\nKEY FACTS:\n${facts.map((f, i) => `${i}. ${f}`).join("\n")}`,
  });
  const present = value.covered.filter((entry) => entry.present).length;
  return {
    recall: present / facts.length,
    missed: facts.filter((_f, i) => !value.covered.find((entry) => entry.index === i)?.present),
  };
}

for (const lectureId of process.argv.slice(3)) {
  const detail = await get(`/api/lectures/${lectureId}`);
  const lecture = detail.lecture ?? {};
  const artifact = detail.artifact ?? {};
  // Transcript straight from the DB: audio lectures have no manualImport text and no public
  // transcript API.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const segmentRows = await (
    await fetch(
      `${supabaseUrl}/rest/v1/transcript_segments?lecture_id=eq.${lectureId}&select=text&order=idx`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
    )
  ).json();
  const source =
    (Array.isArray(segmentRows) ? segmentRows : []).map((row) => row.text).join("\n") ||
    lecture.processing_metadata?.manualImport?.text || "";
  const study = await get(`/api/lectures/${lectureId}/study`);
  const quiz = await get(`/api/lectures/${lectureId}/quiz`);
  const practice = await get(`/api/lectures/${lectureId}/practice-test`);
  const cards = study.flashcards ?? [];
  const questions = quiz.quizQuestions ?? [];
  const practiceQuestions = practice.practiceTestQuestions ?? [];
  const notes = artifact.structured_notes_md ?? "";

  console.log(`\n=== ${lecture.title ?? lectureId} ===`);
  console.log(`source words: ${source.split(/\s+/).filter(Boolean).length} | note words: ${notes.split(/\s+/).filter(Boolean).length} | cards: ${cards.length} | quiz: ${questions.length} | practice: ${practiceQuestions.length}`);

  if (!source.trim()) { console.log("no source text available, skipping grading"); continue; }

  const { facts } = await generate({
    schema: keyFactsSchema, model: GRADER_MODEL, thinkingLevel: "low", maxOutputTokens: 6000,
    instructions:
      "List the distinct testable facts a learner must know from this source, as standalone claims in the source's own language. Cover the whole source evenly; skip administrative chatter and repetition. At most 60.",
    input: source.slice(0, 60000),
  });
  console.log(`key facts derived: ${facts.length}`);

  const noteCov = await coverage(facts, notes, "study notes");
  const deckCorpus = [
    ...cards.map((c) => `Q: ${c.front}\nA: ${c.back}`),
    ...questions.map((q) => `Q: ${q.prompt}\nA: ${(q.options ?? [])[q.correct_option_idx]}`),
    ...practiceQuestions.map((q) => `Q: ${q.prompt}\nA: ${q.answer_guide ?? ""}`),
  ].join("\n");
  const deckCov = deckCorpus.trim() ? await coverage(facts, deckCorpus, "flashcards, quiz and practice questions") : null;

  const badCards = cards.filter((c) => !isHighQualityFlashcard(c.front, c.back));
  const badPrompts = questions.filter((q) => !isHighQualityStudyPrompt(q.prompt));
  const badOptions = questions.filter((q) => !areHighQualityQuizOptions(q.options ?? []));

  let distract = null;
  if (questions.length > 0) {
    const sample = questions.slice(0, 25);
    const v = await generate({
      schema: distractorSchema, model: GRADER_MODEL, thinkingLevel: "low", maxOutputTokens: 6000,
      instructions:
        "Judge each multiple-choice question. plausibleDistractors: would a learner who half-knows the topic seriously consider the wrong options? exactlyOneCorrect: is the marked answer the only defensible one?",
      input: sample.map((q, i) => `${i}. ${q.prompt}\n${(q.options ?? []).map((o, j) => `   ${j === q.correct_option_idx ? "*" : "-"} ${o}`).join("\n")}`).join("\n\n"),
    });
    distract = {
      plausible: v.verdicts.filter((x) => x.plausibleDistractors).length / sample.length,
      single: v.verdicts.filter((x) => x.exactlyOneCorrect).length / sample.length,
    };
  }

  console.log(`NOTE fact coverage:  ${(noteCov.recall * 100).toFixed(0)}%`);
  if (deckCov) console.log(`DECK fact coverage:  ${(deckCov.recall * 100).toFixed(0)}%`);
  if (distract) console.log(`quiz distractors plausible: ${(distract.plausible * 100).toFixed(0)}% | single-answer: ${(distract.single * 100).toFixed(0)}%`);
  console.log(`mechanical rejects: cards ${badCards.length}/${cards.length}, quiz prompts ${badPrompts.length}/${questions.length}, quiz options ${badOptions.length}/${questions.length}`);
  if (noteCov.missed.length) console.log(`notes missed (${noteCov.missed.length}): ${noteCov.missed.slice(0, 5).map((m) => m.slice(0, 70)).join(" | ")}`);
  if (deckCov?.missed.length) console.log(`deck missed (${deckCov.missed.length}): ${deckCov.missed.slice(0, 5).map((m) => m.slice(0, 70)).join(" | ")}`);
}
console.log(`\ngrading spend: $${ledger.costUsd.toFixed(4)}`);
