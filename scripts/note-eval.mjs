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
  enforceOutlineRetentionBounds,
  formatOutlineForWriting,
  resolveNoteWordBudget,
  KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  knowledgeExtractionSchema,
  resolveExtractionMaxOutputTokens,
  legacyChunkSummarySchema,
  noteOutlineSchema,
  normalizeGeneratedNoteMarkdown,
  noteWriteSchema,
} from "../src/lib/notes/note-prompts.ts";
import {
  generateOpenAi,
  generateOpenRouter,
  isOpenAiModel,
  isOpenRouterModel,
} from "./lib/openai-backend.mjs";
import { resolveStageModelConfig } from "../src/lib/ai/model-config.ts";
import { buildGeneratedContentLanguageInstruction } from "../src/lib/languages.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_DIR = path.join(ROOT, "evals", "fixtures");
/**
 * Out-of-sample fixtures built from real uploads. Kept out of git because they are other people's
 * study material, and kept separate because the committed fixtures are the ones these prompts were
 * developed against — scoring well on those proves much less than scoring well on these.
 */
const PRIVATE_FIXTURE_DIR = path.join(ROOT, "evals", "fixtures-private");
const OUTPUT_DIR = path.join(ROOT, "evals", "output");

const PRICES = {
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  "gemini-3-flash-preview": { input: 0.5, output: 3 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "gemini-3.7-flash": { input: 0.75, output: 3.75 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5": { input: 1.25, output: 10 },
  // OpenRouter list rates read live from its models API on 2026-08-23. 3.7-flash is on a limited
  // time promotion there: half Google's own list price, and cheaper per output token than the
  // 3.5-flash-lite this pipeline currently pays for the writing.
  "or/google/gemini-3.7-flash": { input: 0.375, output: 1.875 },
  "or/google/gemini-3.6-flash": { input: 0.75, output: 3.75 },
  "or/google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "or/openai/gpt-5-nano": { input: 0.05, output: 0.4 },
  // Z.ai GLM 5.3 Flash, read live from OpenRouter's models API on 2026-08-28. Reasoning is
  // mandatory on this endpoint and its reasoning tokens are billed as completion tokens, so the
  // output rate is what the thinking costs.
  "or/z-ai/glm-5.3-flash": { input: 0.075, output: 0.25 },
};

const GRADER_MODEL = "gemini-3.5-flash-lite";

/** The candidate under test, named once so a variant row cannot drift from a price row. */
const GLM = "or/z-ai/glm-5.3-flash";

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

// A bake-off that hangs is worse than one that fails: a single stalled request with no deadline
// held a five-variant run for forty minutes at three seconds of CPU. Every call gets a deadline.
const CALL_TIMEOUT_MS = Number.parseInt(process.env.EVAL_CALL_TIMEOUT_MS ?? "", 10) || 180_000;

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { timeout: CALL_TIMEOUT_MS },
});

function withDeadline(promise, label) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} exceeded ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS),
    ),
  ]);
}
const ledger = { calls: 0, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, costUsd: 0, clamped: 0 };

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
  if (isOpenRouterModel(model)) {
    return generateOpenRouter({
      schema,
      instructions,
      input,
      model,
      maxOutputTokens,
      thinkingLevel,
      ledger,
      prices: PRICES,
      timeoutMs: CALL_TIMEOUT_MS,
    });
  }

  if (isOpenAiModel(model)) {
    return generateOpenAi({
      schema,
      instructions,
      input,
      model,
      maxOutputTokens,
      thinkingLevel,
      ledger,
      prices: PRICES,
      timeoutMs: CALL_TIMEOUT_MS,
    });
  }

  const responseSchema = z.toJSONSchema(schema);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await withDeadline(
      ai.models.generateContent({
      model,
      contents: `${input}\n\nReturn exactly one JSON object matching this schema:\n${JSON.stringify(responseSchema)}`,
      config: {
        systemInstruction: instructions,
        responseMimeType: "application/json",
        responseSchema,
        maxOutputTokens,
        ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
        },
      }),
      model,
    );

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

async function runContentDrivenVariant(fixture, fallbackModel, forceModel, options = {}) {
  /**
   * A variant may name a model for one stage without disturbing the rest. It does so through the
   * same GEMINI_*_MODEL keys production reads, so the override travels through the real resolver
   * and picks up that stage's real thinking level and output headroom — which is the whole point
   * when the candidate is a model that reasons on every call.
   */
  const env = { ...process.env, ...(options.stageEnv ?? {}) };
  const stage = (name) => {
    const config = resolveStageModelConfig({ stage: name, env, fallbackModel });

    if (!forceModel) {
      // supportsThinkingLevel only recognises Gemini, so an OpenAI model resolves to no level and
      // the Responses API quietly applies its own default effort. Borrow the stage's intended
      // level so effort is controlled on both sides of the comparison.
      if ((isOpenAiModel(config.model) || isOpenRouterModel(config.model)) && !config.thinkingLevel) {
        const intended = resolveStageModelConfig({
          stage: name,
          env: process.env,
          fallbackModel: "gemini-3.5-flash-lite",
        });

        return { ...config, thinkingLevel: intended.thinkingLevel, outputHeadroom: intended.outputHeadroom };
      }

      return config;
    }

    // A whole-pipeline variant has to override note_write too, which names its own model. The
    // stage's intended reasoning level and headroom come along, so the comparison is the model
    // doing the same job with the same effort, not a different job.
    const intended = resolveStageModelConfig({
      stage: name,
      env: process.env,
      fallbackModel: "gemini-3.5-flash-lite",
    });

    return {
      ...config,
      model: forceModel,
      thinkingLevel: intended.thinkingLevel,
      outputHeadroom: intended.outputHeadroom,
    };
  };
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
      maxOutputTokens: Math.round(resolveExtractionMaxOutputTokens(countWords(window)) * extractConfig.outputHeadroom),
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
  const { value: rawOutline } = await generate({
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
  const outline = enforceOutlineRetentionBounds(rawOutline, items);

  const writeConfig = stage("note_write");
  const retainedItemCount = outline.topics.reduce((total, topic) => total + topic.itemIds.length, 0);
  const { value: written } = await generate({
    schema: noteWriteSchema,
    model: writeConfig.model,
    thinkingLevel: writeConfig.thinkingLevel,
    // Sized from the retained items, not from a word target: ~110 output tokens per item plus
    // thinking headroom. Length follows the content, and so does the budget for it.
    maxOutputTokens: Math.round(Math.max(4000, retainedItemCount * 170) * writeConfig.outputHeadroom),
    instructions: buildNoteWritingInstructions({
      outputLanguage: fixture.language,
      ...(options.coverage ? { coverageObjective: true } : {}),
      ...(options.pedagogy ? { pedagogy: true } : {}),
      ...(options.dense
        ? {
            wordBudget: resolveNoteWordBudget({
              sourceWordCount: countWords(fixture.source),
              retainedItemCount,
            }),
          }
        : {}),
    }),
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
  "v2-2.5-lite": {
    label: "content-driven pipeline, gemini-2.5-flash-lite everywhere",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-2.5-flash-lite", "gemini-2.5-flash-lite"),
  },
  "v2-gpt5-nano": {
    label: "content-driven pipeline, gpt-5-nano everywhere (the cheapest card on the market)",
    run: (fixture) => runContentDrivenVariant(fixture, "gpt-5-nano", "gpt-5-nano"),
  },
  "v2-pedagogy": {
    label: "coverage objective plus the learning-science rules: inline retrieval, why, worked examples",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-3.5-flash-lite", null, {
        coverage: true,
        pedagogy: true,
      }),
  },
  "v2-coverage": {
    label: "current models, writer told to cover what matters with no mention of length",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-3.5-flash-lite", null, { coverage: true }),
  },
  "v2-coverage-3.7": {
    label: "gemini-3.7-flash writing to a coverage objective, no length language",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-2.5-flash-lite", null, { coverage: true }),
  },
  "v2-dense": {
    label: "current models, writer given a Chain-of-Density word budget",
    run: (fixture) => runContentDrivenVariant(fixture, "gemini-3.5-flash-lite", null, { dense: true }),
  },
  "v2-dense-3.7": {
    label: "gemini-3.7-flash writing under a density budget",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-2.5-flash-lite", null, { dense: true }),
  },
  "v2-dense-nano": {
    label: "gpt-5-nano everywhere, writer under a density budget",
    run: (fixture) => runContentDrivenVariant(fixture, "gpt-5-nano", "gpt-5-nano", { dense: true }),
  },
  "v2-3.7-flash": {
    label: "content-driven pipeline, gemini-3.7-flash via OpenRouter's promotional rate",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "or/google/gemini-3.7-flash", "or/google/gemini-3.7-flash"),
  },
  "v2-hybrid-nano": {
    label: "nano for extraction and outlining, gemini-3.5-flash-lite still writing the note",
    run: (fixture) => runContentDrivenVariant(fixture, "gpt-5-nano"),
  },
  "v2-gpt5-mini": {
    label: "content-driven pipeline, gpt-5-mini everywhere",
    run: (fixture) => runContentDrivenVariant(fixture, "gpt-5-mini", "gpt-5-mini"),
  },
  /* ---------------------------------------------------------------------- */
  /* GLM 5.3 Flash bake-off, 2026-08-28                                      */
  /*                                                                         */
  /* "prod" is the control: the exact stage models, thinking levels and      */
  /* writing prompt note-generation.ts ships, so the two GLM rows are read   */
  /* against what a learner gets today rather than against an older variant. */
  /* ---------------------------------------------------------------------- */
  prod: {
    label: "production as shipped: 2.5-lite everywhere, 3.7-flash writing, coverage + pedagogy",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-2.5-flash-lite", null, {
        coverage: true,
        pedagogy: true,
      }),
  },
  "glm-all": {
    label: "GLM 5.3 Flash on every stage, production prompts",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "or/z-ai/glm-5.3-flash", null, {
        coverage: true,
        pedagogy: true,
        stageEnv: {
          GEMINI_NOTE_EXTRACT_MODEL: GLM,
          GEMINI_NOTE_OUTLINE_MODEL: GLM,
          GEMINI_NOTE_WRITE_MODEL: GLM,
        },
      }),
  },
  "glm-write": {
    label: "GLM 5.3 Flash writing the note, 2.5-lite still extracting and outlining",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-2.5-flash-lite", null, {
        coverage: true,
        pedagogy: true,
        stageEnv: { GEMINI_NOTE_WRITE_MODEL: GLM },
      }),
  },
  "glm-cheap": {
    label: "GLM 5.3 Flash extracting and outlining, 3.7-flash still writing",
    run: (fixture) =>
      runContentDrivenVariant(fixture, "gemini-2.5-flash-lite", null, {
        coverage: true,
        pedagogy: true,
        stageEnv: { GEMINI_NOTE_EXTRACT_MODEL: GLM, GEMINI_NOTE_OUTLINE_MODEL: GLM },
      }),
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
/**
 * A fixture shipped without a hand-written answer key gets one derived from its source, once, and
 * written back into the fixture file. Every variant is then graded against that identical key.
 *
 * This is what makes an out-of-sample test possible at all: the four original fixtures are the
 * ones these prompts were developed against, so their scores are optimistic by construction. Real
 * uploads have no key and nobody is going to hand-write one for a 5,000-word paper.
 */
async function ensureKeyFacts(fixture) {
  if (fixture.keyFacts?.length) {
    return fixture;
  }

  const { value } = await generate({
    schema: z.object({ facts: z.array(z.string().min(8)).min(10).max(60) }),
    model: GRADER_MODEL,
    thinkingLevel: "low",
    maxOutputTokens: 8000,
    instructions:
      "List the distinct testable facts a learner must know from this source, as standalone claims in the source's own language. Cover the whole source evenly, including its later sections. Skip administrative chatter, learning objectives and repetition. At most 60.",
    input: fixture.source.slice(0, 60000),
  });

  const updated = { ...fixture, keyFacts: value.facts };

  fs.writeFileSync(
    path.join(fixture.directory ?? FIXTURE_DIR, `${fixture.id}.json`),
    `${JSON.stringify(updated, null, 2)}\n`,
  );
  process.stdout.write(`derived ${value.facts.length} key facts for ${fixture.id}\n`);

  return updated;
}

const wantedVariants = argValue("variant")?.split(",") ?? Object.keys(VARIANTS);
const wantedFixtures = argValue("fixture")?.split(",");
const shouldSave = args.includes("--save");
const shouldGrade = !args.includes("--no-grade");
// Recall on one sample swings by 10+ points between identical runs, so a single pass cannot
// justify a prompt or model decision. Every reported figure is a mean over --repeat runs.
const repeats = Number.parseInt(argValue("repeat") ?? "1", 10);

function loadFixturesFrom(directory) {
  if (!fs.existsSync(directory)) {
    return [];
  }

  return fs
    .readdirSync(directory)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      ...JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")),
      directory,
    }));
}

const fixtures = [...loadFixturesFrom(FIXTURE_DIR), ...loadFixturesFrom(PRIVATE_FIXTURE_DIR)].filter(
  (fixture) => !wantedFixtures || wantedFixtures.includes(fixture.id),
);

if (shouldSave) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const results = [];

for (const rawFixture of fixtures) {
  // A keyless fixture is graded against a key derived from its own source, once, before any
  // variant runs — so every candidate answers to the identical standard.
  const fixture = shouldGrade ? await ensureKeyFacts(rawFixture) : rawFixture;
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
