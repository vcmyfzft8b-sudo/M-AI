/**
 * Offline note-quality bake-off.
 *
 * Runs one or more note-generation variants over fixed fixtures and scores each result against a
 * hand-written answer key, so a prompt or model change can be judged on recall, filler leakage and
 * density instead of on how the output feels. No production data is involved.
 *
 *   node scripts/note-eval.mjs                       # every variant, every fixture
 *   node scripts/note-eval.mjs --variant=v2 --fixture=omrezja-sl
 *   node scripts/note-eval.mjs --save                # also write the notes to evals/output/
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import {
  buildKnowledgeExtractionInstructions,
  buildLegacyAudioNoteTargets,
  buildLegacyNoteTargets,
  buildLegacyStructuredPlusInstructions,
  buildNoteOutlineInstructions,
  buildNoteWritingInstructions,
  dedupeKnowledgeItems,
  formatOutlineForWriting,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  knowledgeExtractionSchema,
  legacyChunkSummarySchema,
  noteOutlineSchema,
  normalizeGeneratedNoteMarkdown,
  noteWriteSchema,
} from "../src/lib/notes/note-prompts.ts";
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";
import { buildGeneratedContentLanguageInstruction } from "../src/lib/languages.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");
const OUTPUT_DIR = path.join(ROOT, "evals", "output");

const PRICES = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3-flash-preview": { input: 0.5, output: 3 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
};

const GRADER_MODEL = "gemini-3.5-flash-lite";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    const filePath = path.join(ROOT, file);

    if (!fs.existsSync(filePath)) {
      continue;
    }

    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      const separator = line.indexOf("=");

      if (line.startsWith("#") || separator < 0) {
        continue;
      }

      const key = line.slice(0, separator).trim();

      if (!process.env[key]) {
        process.env[key] = line
          .slice(separator + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  }
}

loadEnv();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const ledger = { calls: 0, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, costUsd: 0 };

function countWords(value) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function recordUsage(model, usage) {
  const price = PRICES[model] ?? { input: 0, output: 0 };
  const inputTokens = usage?.promptTokenCount ?? 0;
  const thoughtTokens = usage?.thoughtsTokenCount ?? 0;
  const outputTokens = (usage?.candidatesTokenCount ?? 0) + thoughtTokens;

  ledger.calls += 1;
  ledger.inputTokens += inputTokens;
  ledger.outputTokens += outputTokens;
  ledger.thoughtTokens += thoughtTokens;

  const costUsd = (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
  ledger.costUsd += costUsd;

  return { inputTokens, outputTokens, thoughtTokens, costUsd };
}

async function generate({ schema, instructions, input, model, maxOutputTokens, thinkingLevel }) {
  const responseSchema = z.toJSONSchema(schema);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await ai.models.generateContent({
      model,
      contents: `${input}\n\nReturn exactly one JSON object matching this schema:\n${JSON.stringify(responseSchema)}`,
      config: {
        systemInstruction: instructions,
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      },
    });

    const usage = recordUsage(model, response.usageMetadata);
    const text = (response.text ?? "").trim();
    const finishReason = response.candidates?.[0]?.finishReason;

    if (!text || finishReason === "MAX_TOKENS") {
      if (attempt === 2) {
        throw new Error(`${model} truncated at ${maxOutputTokens} tokens (finish=${finishReason})`);
      }

      maxOutputTokens = Math.round(maxOutputTokens * 1.8);
      continue;
    }

    try {
      return { value: schema.parse(JSON.parse(text)), usage };
    } catch (error) {
      if (attempt === 2) {
        throw error;
      }
    }
  }

  throw new Error("unreachable");
}

/** Splits a source into windows the way buildTranscriptWindows does, but from plain text. */
function buildWindows(source, wordsPerWindow) {
  const paragraphs = source.split(/\n\n+/).filter((paragraph) => paragraph.trim());
  const windows = [];
  let current = [];
  let currentWords = 0;

  for (const paragraph of paragraphs) {
    const words = countWords(paragraph);

    if (currentWords + words > wordsPerWindow && current.length > 0) {
      windows.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }

    current.push(paragraph);
    currentWords += words;
  }

  if (current.length > 0) {
    windows.push(current.join("\n\n"));
  }

  return windows;
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                    */
/* -------------------------------------------------------------------------- */

async function runLegacyVariant(fixture, model) {
  const windows = buildWindows(fixture.source, fixture.sourceType === "audio" ? 2200 : 3200);
  const sourceWordCount = countWords(fixture.source);
  const targets =
    fixture.sourceType === "audio"
      ? buildLegacyAudioNoteTargets(sourceWordCount, windows.length)
      : buildLegacyNoteTargets(sourceWordCount, windows.length);
  const languageInstruction = buildGeneratedContentLanguageInstruction(fixture.language);

  const chunkSummaries = [];

  for (const [index, window] of windows.entries()) {
    const { value } = await generate({
      schema: legacyChunkSummarySchema,
      model,
      maxOutputTokens: fixture.sourceType === "audio" ? 1900 : 1400,
      instructions: `${languageInstruction} You create source cards from lecture-style source material. Identify the study-worthy material in this chunk: definitions, mechanisms, sequences, comparisons, formulas, caveats, examples already present in the source, and exam-relevant details. Skip filler, repeated wording, low-value details, and examples that add no new understanding. Never invent facts. Bullet points must be complete study points, not fragments.`,
      input: `Source chunk ${index + 1} of ${windows.length}.\nText:\n${window}`,
    });

    chunkSummaries.push(value);
  }

  const structuredPlus = buildLegacyStructuredPlusInstructions({
    outputLanguage: fixture.language,
    recommendedTopicCount: targets.recommendedTopicCount,
  });

  const { value } = await generate({
    schema: z.object({
      title: z.string().min(3),
      summary: z.string().min(40),
      keyTopics: z.array(z.string().min(2)).min(6),
      structuredNotesMd: z.string().min(300),
    }),
    model,
    maxOutputTokens: Math.min(12000, Math.max(7000, Math.round(targets.maxNoteWordCount * 2.4))),
    instructions: `${languageInstruction} You are preparing final study notes from this source. Produce a title, summary, key topics, and student-ready notes that cover the important material without unnecessary text. ${structuredPlus}`,
    input: JSON.stringify(
      { sourceType: fixture.sourceType, sourceWordCount, chunkCount: chunkSummaries.length, targets, chunkSummaries },
      null,
      2,
    ),
  });

  return {
    notesMd: normalizeGeneratedNoteMarkdown(value.structuredNotesMd),
    stages: { chunks: windows.length },
  };
}

async function runContentDrivenVariant(fixture, fallbackModel) {
  const stage = (name) =>
    resolveStageModelConfig({ stage: name, env: process.env, fallbackModel });
  const extractConfig = stage("note_extract");
  const passes = KNOWLEDGE_EXTRACTION_PASS_WINDOWS.flatMap((windowWords, passIndex) =>
    buildWindows(fixture.source, windowWords).map((window, index, all) => ({
      window,
      passIndex,
      label: `Chunk ${index + 1} of ${all.length}`,
    })),
  );
  const windows = buildWindows(fixture.source, KNOWLEDGE_EXTRACTION_PASS_WINDOWS[0]);
  const extractions = [];

  for (const { window, label } of passes) {
    const { value } = await generate({
      schema: knowledgeExtractionSchema,
      model: extractConfig.model,
      thinkingLevel: extractConfig.thinkingLevel,
      maxOutputTokens: Math.round(1800 * extractConfig.outputHeadroom),
      instructions: buildKnowledgeExtractionInstructions({
        outputLanguage: fixture.language,
        sourceType: fixture.sourceType,
      }),
      input: `${label}.\n\n${window}`,
    });

    extractions.push(value);
  }

  const rawItems = extractions.flatMap((extraction) =>
    extraction.items.map((item) => ({ ...item, sectionTitle: extraction.sectionTitle })),
  );
  const items = dedupeKnowledgeItems(rawItems.map((item, id) => ({ ...item, id }))).map(
    (item, id) => ({ ...item, id }),
  );

  const outlineConfig = stage("note_outline");
  const { value: outline } = await generate({
    schema: noteOutlineSchema,
    model: outlineConfig.model,
    thinkingLevel: outlineConfig.thinkingLevel,
    maxOutputTokens: Math.round(2600 * outlineConfig.outputHeadroom),
    instructions: buildNoteOutlineInstructions({ outputLanguage: fixture.language }),
    input: JSON.stringify(
      {
        sourceType: fixture.sourceType,
        items: items.map(({ id, claim, kind, importance, sectionTitle }) => ({
          id,
          claim,
          kind,
          importance,
          sectionTitle,
        })),
      },
      null,
      2,
    ),
  });

  const writeConfig = stage("note_write");
  const retainedItemCount = outline.topics.reduce((total, topic) => total + topic.itemIds.length, 0);
  const { value: written } = await generate({
    schema: noteWriteSchema,
    model: writeConfig.model,
    thinkingLevel: writeConfig.thinkingLevel,
    // Sized from the retained items, not from a word target: ~110 output tokens per item plus
    // thinking headroom. Length follows the content, and so does the budget for it.
    maxOutputTokens: Math.round(Math.max(4000, retainedItemCount * 170) * writeConfig.outputHeadroom),
    instructions: buildNoteWritingInstructions({ outputLanguage: fixture.language }),
    input: `Outline to teach:\n${JSON.stringify(
      { title: outline.title, summary: outline.summary, topics: formatOutlineForWriting({ outline, items }) },
      null,
      2,
    )}\n\nFull source text:\n${fixture.source}`,
  });

  return {
    notesMd: normalizeGeneratedNoteMarkdown(written.structuredNotesMd),
    claims: items.map((item) => `[${item.importance}] ${item.claim}`),
    stages: {
      chunks: windows.length,
      extracted: rawItems.length,
      afterDedupe: items.length,
      retained: retainedItemCount,
      dropped: outline.droppedItemIds.length,
      topics: outline.topics.length,
    },
  };
}

const VARIANTS = {
  "v1-2.5-lite": {
    label: "current pipeline, gemini-2.5-flash-lite",
    run: (fixture) => runLegacyVariant(fixture, "gemini-2.5-flash-lite"),
  },
  "v1-3.5-lite": {
    label: "current pipeline, gemini-3.5-flash-lite (isolates the model)",
    run: (fixture) => runLegacyVariant(fixture, "gemini-3.5-flash-lite"),
  },
  v2: {
    label: "content-driven pipeline, gemini-3.5-flash-lite (isolates the prompts)",
    run: (fixture) => runContentDrivenVariant(fixture, "gemini-3.5-flash-lite"),
  },
};

/* -------------------------------------------------------------------------- */
/* Grading                                                                     */
/* -------------------------------------------------------------------------- */

const gradeSchema = z.object({
  covered: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      present: z.boolean(),
      evidence: z.string(),
    }),
  ),
  leakedFiller: z.array(z.number().int().nonnegative()),
});

async function grade(fixture, notesMd) {
  const { value } = await generate({
    schema: gradeSchema,
    model: GRADER_MODEL,
    thinkingLevel: "low",
    maxOutputTokens: 8000,
    instructions:
      "You are grading study notes against an answer key. For each key fact, decide whether a learner reading only these notes would come away knowing it. Judge meaning, not wording: a fact stated in different words, or shown in a table, still counts. A fact only hinted at, or named without its content, does not count. Then list the indices of any filler entries that leaked into the notes. Be strict and literal.",
    input: `NOTES:\n${notesMd}\n\nKEY FACTS:\n${fixture.keyFacts
      .map((fact, index) => `${index}. ${fact}`)
      .join("\n")}\n\nFILLER THAT SHOULD NOT APPEAR:\n${fixture.filler
      .map((entry, index) => `${index}. ${entry}`)
      .join("\n")}`,
  });

  const present = value.covered.filter((entry) => entry.present).length;
  const missed = fixture.keyFacts
    .map((fact, index) => ({ fact, index }))
    .filter(({ index }) => !value.covered.find((entry) => entry.index === index)?.present);

  return {
    recall: present / fixture.keyFacts.length,
    missed,
    leaked: value.leakedFiller.map((index) => fixture.filler[index]).filter(Boolean),
  };
}

/**
 * Grades the extracted claim list rather than the finished note, so a missing fact can be blamed
 * on the stage that actually lost it. A fact absent here can never be written, no matter how good
 * the outline and writing prompts get.
 */
async function gradeExtraction(fixture, claims) {
  const { value } = await generate({
    schema: gradeSchema,
    model: GRADER_MODEL,
    thinkingLevel: "low",
    maxOutputTokens: 8000,
    instructions:
      "You are checking whether a list of extracted claims contains each fact from an answer key. Judge meaning, not wording. A fact counts only if some claim states it; a claim that names the topic without the fact does not count. Leave leakedFiller empty.",
    input: `EXTRACTED CLAIMS:\n${claims.join("\n")}\n\nKEY FACTS:\n${fixture.keyFacts
      .map((fact, index) => `${index}. ${fact}`)
      .join("\n")}\n\nFILLER:\n(none)`,
  });

  const present = value.covered.filter((entry) => entry.present).length;

  return {
    recall: present / fixture.keyFacts.length,
    missed: fixture.keyFacts.filter(
      (_fact, index) => !value.covered.find((entry) => entry.index === index)?.present,
    ),
  };
}

function scoreStructure(notesMd, language) {
  const wrongBullets = (notesMd.match(/^\s*[*+]\s+/gm) ?? []).length;
  const callouts = (notesMd.match(/^>\s+\*\*/gm) ?? []).length;
  const tables = (notesMd.match(/^\|.+\|\s*$/gm) ?? []).length > 0
    ? (notesMd.match(/\n\|[-: |]+\|\n/g) ?? []).length
    : 0;
  const overview = language === "sl" ? "Hiter pregled" : "Quick Overview";
  const review = language === "sl" ? "Končni pregled" : "Final Review";
  const check = language === "sl" ? "Preveri svoje znanje" : "Check Yourself";
  // Headings are allowed an emoji, so match the label anywhere in the heading line rather than
  // demanding it sit flush against the hashes.
  const hasHeading = (label) =>
    new RegExp(`^#{2,3}\\s+.*${label.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}`, "m").test(notesMd);

  return {
    hasOverview: hasHeading(overview),
    hasFinalReview: hasHeading(review),
    hasCheckYourself: hasHeading(check),
    topics: (notesMd.match(/^##\s+(?:\p{Extended_Pictographic}\uFE0F?\s*)?\d+\./gmu) ?? []).length,
    tables,
    callouts,
    wrongBullets,
    html: /<\/?(p|div|h[1-6]|ul|li|strong)\b/i.test(notesMd),
  };
}

/* -------------------------------------------------------------------------- */
/* Runner                                                                      */
/* -------------------------------------------------------------------------- */

const args = process.argv.slice(2);
const argValue = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const wantedVariants = argValue("variant")?.split(",") ?? Object.keys(VARIANTS);
const wantedFixtures = argValue("fixture")?.split(",");
const shouldSave = args.includes("--save");
const shouldGrade = !args.includes("--no-grade");
// Recall on one sample swings by 10+ points between identical runs, so a single pass cannot
// justify a prompt or model decision. Every reported figure is a mean over --repeat runs.
const repeats = Number.parseInt(argValue("repeat") ?? "1", 10);

const fixtures = fs
  .readdirSync(FIXTURE_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")))
  .filter((fixture) => !wantedFixtures || wantedFixtures.includes(fixture.id));

if (shouldSave) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const results = [];

for (const fixture of fixtures) {
  const sourceWords = countWords(fixture.source);

  for (const variantKey of wantedVariants) {
    const variant = VARIANTS[variantKey];

    if (!variant) {
      throw new Error(`Unknown variant "${variantKey}". Known: ${Object.keys(VARIANTS).join(", ")}`);
    }

    for (let run = 0; run < repeats; run += 1) {
    const before = { ...ledger };
    const startedAt = Date.now();
    process.stdout.write(
      `running ${fixture.id} / ${variantKey}${repeats > 1 ? ` (${run + 1}/${repeats})` : ""} ... `,
    );

    let outcome;

    try {
      outcome = await variant.run(fixture);
    } catch (error) {
      console.log(`FAILED: ${error.message}`);
      results.push({ fixture: fixture.id, variant: variantKey, error: error.message });
      continue;
    }

    const elapsedMs = Date.now() - startedAt;
    // Grading is measurement, not product cost, so it is billed separately from the variant.
    const afterRun = { ...ledger };
    const noteWords = countWords(outcome.notesMd);
    const scored = shouldGrade
      ? await grade(fixture, outcome.notesMd)
      : { recall: 0, missed: [], leaked: [] };
    const extraction =
      shouldGrade && outcome.claims ? await gradeExtraction(fixture, outcome.claims) : null;

    console.log(`${noteWords} words, recall ${(scored.recall * 100).toFixed(0)}%`);

    if (shouldSave) {
      fs.writeFileSync(
        path.join(OUTPUT_DIR, `${fixture.id}.${variantKey}${repeats > 1 ? `.${run}` : ""}.md`),
        outcome.notesMd,
      );
    }

    results.push({
      fixture: fixture.id,
      variant: variantKey,
      sourceWords,
      noteWords,
      compression: noteWords / sourceWords,
      recall: scored.recall,
      factsPer100Words: (scored.recall * fixture.keyFacts.length) / (noteWords / 100),
      leaked: scored.leaked,
      missed: scored.missed.map(({ fact }) => fact),
      structure: scoreStructure(outcome.notesMd, fixture.language),
      extractionRecall: extraction?.recall ?? null,
      extractionMissed: extraction?.missed ?? [],
      stages: outcome.stages,
      costUsd: afterRun.costUsd - before.costUsd,
      calls: afterRun.calls - before.calls,
      gradingCostUsd: ledger.costUsd - afterRun.costUsd,
      elapsedMs,
      run,
    });
    }
  }
}

console.log("\n");
console.log(
  ["fixture", "variant", "words", "vs src", "recall", "extract", "facts/100w", "leak", "cost", "sec"]
    .map((header, index) => header.padEnd([16, 12, 7, 7, 10, 10, 11, 5, 8, 5][index]))
    .join(""),
);

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const spread = (values) =>
  values.length > 1 ? `\u00b1${Math.round((Math.max(...values) - Math.min(...values)) * 50)}` : "";

const groups = new Map();

for (const row of results) {
  const key = `${row.fixture}::${row.variant}`;
  groups.set(key, [...(groups.get(key) ?? []), row]);
}

for (const [key, rows] of groups) {
  const [fixture, variant] = key.split("::");
  const ok = rows.filter((row) => !row.error);

  if (ok.length === 0) {
    console.log(`${fixture.padEnd(16)}${variant.padEnd(12)}ERROR ${rows[0].error}`);
    continue;
  }

  const recalls = ok.map((row) => row.recall);
  const extractions = ok.map((row) => row.extractionRecall).filter((value) => value != null);

  console.log(
    [
      fixture.padEnd(16),
      variant.padEnd(12),
      String(Math.round(mean(ok.map((row) => row.noteWords)))).padEnd(7),
      `${(mean(ok.map((row) => row.compression)) * 100).toFixed(0)}%`.padEnd(7),
      `${(mean(recalls) * 100).toFixed(0)}%${spread(recalls)}`.padEnd(10),
      (extractions.length > 0 ? `${(mean(extractions) * 100).toFixed(0)}%${spread(extractions)}` : "-").padEnd(10),
      mean(ok.map((row) => row.factsPer100Words)).toFixed(2).padEnd(11),
      mean(ok.map((row) => row.leaked.length)).toFixed(1).padEnd(5),
      `$${mean(ok.map((row) => row.costUsd)).toFixed(4)}`.padEnd(8),
      (mean(ok.map((row) => row.elapsedMs)) / 1000).toFixed(0).padEnd(5),
    ].join(""),
  );
}

console.log("\nDetail:");

for (const row of results) {
  if (row.error) {
    continue;
  }

  console.log(`\n  ${row.fixture} / ${row.variant}`);
  console.log(`    stages: ${JSON.stringify(row.stages)}`);
  console.log(`    structure: ${JSON.stringify(row.structure)}`);

  if (row.extractionRecall != null) {
    console.log(
      `    extraction recall ${(row.extractionRecall * 100).toFixed(0)}% -> note recall ${(
        row.recall * 100
      ).toFixed(0)}% (writing lost ${((row.extractionRecall - row.recall) * 100).toFixed(0)} pts)`,
    );

    for (const fact of row.extractionMissed) {
      console.log(`      never extracted: ${fact}`);
    }
  }

  if (row.missed.length > 0) {
    console.log(`    missed (${row.missed.length}):`);

    for (const fact of row.missed) {
      console.log(`      - ${fact}`);
    }
  }

  if (row.leaked.length > 0) {
    console.log(`    filler that leaked: ${row.leaked.join(" | ")}`);
  }
}

console.log(
  `\ntotal: ${ledger.calls} calls, ${ledger.inputTokens} in, ${ledger.outputTokens} out (${ledger.thoughtTokens} thinking), $${ledger.costUsd.toFixed(4)} (grading included)`,
);

if (shouldSave) {
  fs.writeFileSync(path.join(OUTPUT_DIR, "results.json"), JSON.stringify(results, null, 2));
  console.log(`notes and results written to evals/output/`);
}
