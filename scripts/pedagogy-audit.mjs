/**
 * Adversarial audit of generated study material: every card, quiz question and practice prompt
 * must earn its place. A judge model reviews items in batches against three failure modes the
 * mechanical validators cannot see: trivia (not worth a learner's attention), meta/source junk
 * (about the lecture rather than the subject), and concept-level duplication (same knowledge as
 * another item, beyond wording). Also verdicts on groundedness against the stored source.
 *
 *   node --experimental-strip-types scripts/pedagogy-audit.mjs <cookieFile> <lectureId> [...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { generate, GRADER_MODEL, ledger, loadEnv } from "./lib/eval-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);
const cookie = fs.readFileSync(process.argv[2], "utf8").trim();
const BASE = "http://localhost:3000";
const get = async (p) => (await fetch(`${BASE}${p}`, { headers: { Cookie: cookie } })).json();

const auditSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      // worth: would a good teacher keep this item in the deck for this subject?
      worthKeeping: z.boolean(),
      grounded: z.boolean(),
      // duplicateOf: index of an EARLIER item in this batch teaching the same concept, else null
      duplicateOf: z.number().int().nullable(),
      reason: z.string().max(160),
    }),
  ),
});

async function auditBatch(items, subject, source) {
  return generate({
    schema: auditSchema,
    model: GRADER_MODEL,
    thinkingLevel: "medium",
    maxOutputTokens: 9000,
    instructions: `You are a demanding subject teacher reviewing a study deck about: ${subject}.
Judge every item. worthKeeping is false for trivia a learner gains nothing from memorising, for
meta items about the lecture/course itself (deadlines, chapter goals, "the author says"), and for
items so vague they cannot be answered precisely. grounded is false when the item contradicts the
source or asserts something the source does not support. duplicateOf points at the EARLIEST item
in this list that teaches the same concept — different question forms about the same single fact
count as duplicates; different facts about the same topic do not. Be strict but fair: a good
specific item is worth keeping even if simple.`,
    input: `SOURCE (for grounding):\n${source.slice(0, 45000)}\n\nITEMS:\n${items
      .map((item, index) => `${index}. ${item}`)
      .join("\n")}`,
  });
}

for (const lectureId of process.argv.slice(3)) {
  const detail = await get(`/api/lectures/${lectureId}`);
  const lecture = detail.lecture ?? {};
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

  const sets = {
    cards: (study.flashcards ?? []).map((c) => `[card] Q: ${c.front} | A: ${c.back}`),
    quiz: (quiz.quizQuestions ?? []).map(
      (q) => `[quiz] ${q.prompt} | correct: ${(q.options ?? [])[q.correct_option_idx]}`,
    ),
    practice: (practice.practiceTestQuestions ?? []).map((q) => `[practice] ${q.prompt}`),
  };

  console.log(`\n=== ${lecture.title ?? lectureId} ===`);

  for (const [kind, items] of Object.entries(sets)) {
    if (items.length === 0) {
      console.log(`${kind}: none`);
      continue;
    }

    const BATCH = 40;
    let keep = 0, junk = 0, ungrounded = 0, dupes = 0;
    const examples = { junk: [], ungrounded: [], dupes: [] };

    for (let start = 0; start < items.length; start += BATCH) {
      const batch = items.slice(start, start + BATCH);
      const { verdicts } = await auditBatch(batch, lecture.title ?? "the subject", source);

      for (const v of verdicts) {
        const text = batch[v.index] ?? "";

        if (v.duplicateOf != null) {
          dupes += 1;
          if (examples.dupes.length < 3) examples.dupes.push(`${text.slice(7, 80)} (≈ #${v.duplicateOf}: ${v.reason})`);
        } else if (!v.worthKeeping) {
          junk += 1;
          if (examples.junk.length < 3) examples.junk.push(`${text.slice(7, 90)} — ${v.reason}`);
        } else if (!v.grounded) {
          ungrounded += 1;
          if (examples.ungrounded.length < 3) examples.ungrounded.push(`${text.slice(7, 90)} — ${v.reason}`);
        } else {
          keep += 1;
        }
      }
    }

    const total = items.length;
    console.log(
      `${kind}: ${total} items | earn their place: ${keep} (${((keep / total) * 100).toFixed(0)}%) | trivia/meta: ${junk} | ungrounded: ${ungrounded} | concept dupes: ${dupes}`,
    );

    for (const [label, list] of Object.entries(examples)) {
      for (const example of list) {
        console.log(`   ${label}: ${example}`);
      }
    }
  }
}
console.log(`\naudit spend: $${ledger.costUsd.toFixed(4)}`);
