/**
 * How well does what we generate read to somebody who speaks the language?
 *
 * The model that writes for this product is strong at knowing what to say and weaker at
 * saying it correctly in a language that is not English — it occasionally produces a word
 * that does not exist, or the wrong case ending, in the kind of prose a native speaker
 * notices instantly. This marks any generated text for that, and — with `--repair` — marks
 * it again after the language-repair pass, so the pass can be judged on what it actually
 * fixes and, more importantly, on what it breaks.
 *
 *   node --experimental-strip-types scripts/language-audit.mjs evals/output/omrezja-sl.prod.md
 *   node --experimental-strip-types scripts/language-audit.mjs --repair --language=sl notes.md
 *   node --experimental-strip-types scripts/language-audit.mjs --repair evals/sweep/tutor.language.omrezja-sl.json
 *
 * The judge reports the offending words themselves rather than a score, because a score
 * cannot be checked and a list can.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  buildLanguageRepairInput,
  buildLanguageRepairInstructions,
  acceptCorrection,
  languageRepairSchema,
  reattachPadding,
  splitForRepair,
} from "../src/lib/ai/language-repair.ts";
import { detectSourceLanguage } from "../src/lib/languages.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const files = args.filter((entry) => !entry.startsWith("--"));
const shouldRepair = args.includes("--repair");
const REPAIR_MODEL = flag("repairer", "or/google/gemini-2.5-flash-lite");
const JUDGE_MODEL = flag("judge", "or/google/gemini-3.7-flash");
const languageOverride = flag("language", null);

if (!files.length) {
  throw new Error("give it at least one file to audit");
}

async function generate({ model, schema, instructions, input, maxOutputTokens }) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        signal: AbortSignal.timeout(120_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        },
        body: JSON.stringify({
          model: model.replace(/^or\//, ""),
          messages: [
            { role: "system", content: instructions },
            {
              role: "user",
              content: `Return exactly one JSON object that matches this JSON schema:\n${JSON.stringify(
                z.toJSONSchema(schema),
              )}\n\nSource input:\n${input}`,
            },
          ],
          max_tokens: maxOutputTokens,
          response_format: {
            type: "json_schema",
            json_schema: { name: "structured_output", strict: true, schema: z.toJSONSchema(schema) },
          },
          provider: { sort: "latency", require_parameters: true },
        }),
      });

      if (!response.ok) {
        throw new Error(`${model}: ${response.status} ${(await response.text()).slice(0, 200)}`);
      }

      const payload = await response.json();
      const raw = payload.choices?.[0]?.message?.content ?? "";

      return schema.parse(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
    } catch (error) {
      if (attempt >= 2) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

const auditSchema = z.object({
  errors: z
    .array(
      z.object({
        text: z.string().describe("The exact wrong word or phrase, copied from the passage."),
        kind: z.enum(["nonexistent-word", "wrong-form", "agreement", "spelling", "other"]),
        correction: z.string().describe("What it should have been."),
      }),
    )
    .describe("Every genuine language error. Empty when the passage is correct."),
});

function auditInstructions(language) {
  return [
    `You are a strict native speaker of the language coded "${language}", marking generated study material.`,
    "",
    "Report EVERY genuine language error: words that do not exist in the language, wrong inflections, wrong agreement, misspellings, missing or wrong diacritics.",
    "Copy each offending word exactly as it appears so it can be found in the text.",
    "",
    "Do NOT report: informal register, short sentences, markdown formatting, headings without full stops, foreign technical terms, acronyms and proper nouns left in their own language, or stylistic choices you would have made differently. Those are all intentional.",
    "Report only what is actually WRONG in the language.",
  ].join("\n");
}

/** Only the prose is judged. A markdown table row is not a sentence and marking it as one is noise. */
function readablePassages(file) {
  const raw = fs.readFileSync(file, "utf8");

  if (file.endsWith(".json")) {
    // A sweep transcript: every spoken turn it recorded.
    const rows = JSON.parse(raw);

    return rows.map((row) => row.spoken ?? row.written).filter(Boolean);
  }

  return splitForRepair(raw, { maxChars: 2_000 });
}

const summary = [];

for (const file of files) {
  const passages = readablePassages(file);
  const joined = passages.join("\n");
  const language = languageOverride ?? detectSourceLanguage(joined) ?? "en";
  const words = joined.trim().split(/\s+/u).length;

  console.log(`\n${path.relative(ROOT, file)} — ${language}, ${words} words in ${passages.length} passages`);

  const marked = await Promise.all(
    passages.map((passage) =>
      generate({
        model: JUDGE_MODEL,
        schema: auditSchema,
        instructions: auditInstructions(language),
        input: passage,
        maxOutputTokens: 3_000,
      }),
    ),
  );

  const before = marked.flatMap((entry) => entry.errors);
  console.log(`  before: ${before.length} errors (${((before.length / words) * 100).toFixed(2)}/100w)`);
  before.forEach((error) => console.log(`    ${error.kind}: ${error.text} → ${error.correction}`));

  if (!shouldRepair) {
    summary.push({ file, language, words, before: before.length });
    continue;
  }

  const startedAt = Date.now();
  const repaired = await Promise.all(
    passages.map(async (passage) => {
      const { corrected } = await generate({
        model: REPAIR_MODEL,
        schema: languageRepairSchema,
        instructions: buildLanguageRepairInstructions(language, { spoken: file.endsWith(".json") }),
        input: buildLanguageRepairInput({ text: passage, preceding: "" }),
        maxOutputTokens: 4_000,
      });

      const markdown = !file.endsWith(".json");

      // The whitespace around a passage is structure, not padding: trimming it welds the end of
      // one block onto the start of the next, which is a "spelling error" the audit invented.
      return acceptCorrection(passage, corrected, { markdown })
        ? reattachPadding(passage, corrected)
        : passage;
    }),
  );
  const repairMs = Date.now() - startedAt;

  const remarked = await Promise.all(
    repaired.map((passage) =>
      generate({
        model: JUDGE_MODEL,
        schema: auditSchema,
        instructions: auditInstructions(language),
        input: passage,
        maxOutputTokens: 3_000,
      }),
    ),
  );

  const after = remarked.flatMap((entry) => entry.errors);
  const rejected = repaired.filter((text, index) => text === passages[index]).length;

  console.log(`  after:  ${after.length} errors (${((after.length / words) * 100).toFixed(2)}/100w) — ${repairMs}ms, ${rejected}/${passages.length} passages left untouched`);
  after.forEach((error) => console.log(`    still: ${error.kind}: ${error.text} → ${error.correction}`));

  const meaning = await Promise.all(
    repaired.map((passage, index) =>
      passage === passages[index]
        ? { changed: [] }
        : generate({
            model: JUDGE_MODEL,
            schema: z.object({
              changed: z
                .array(z.string())
                .describe("Each fact, number, name or clause that differs between the two versions."),
            }),
            instructions:
              "Two versions of the same passage. The second was meant to be the first with only its language errors repaired. List everything the second says that the first does not, or the first says that the second does not — facts, numbers, names, whole clauses. Ignore pure wording, spelling and inflection changes. Return an empty list when they say the same things.",
            input: JSON.stringify({ first: passages[index], second: passage }, null, 2),
            maxOutputTokens: 2_000,
          }),
    ),
  );

  const drift = meaning.flatMap((entry) => entry.changed);

  if (drift.length) {
    console.log(`  MEANING DRIFT (${drift.length}):`);
    drift.forEach((entry) => console.log(`    ${entry}`));
  } else {
    console.log("  meaning: unchanged");
  }

  summary.push({ file, language, words, before: before.length, after: after.length, drift: drift.length });

  if (args.includes("--save")) {
    const out = `${file}.repaired`;
    fs.writeFileSync(out, repaired.join(""));
    console.log(`  wrote ${path.relative(ROOT, out)}`);
  }
}

console.log("\nsummary");
summary.forEach((row) =>
  console.log(
    `  ${path.basename(row.file).padEnd(34)} ${row.language.padEnd(4)} ${String(row.words).padStart(5)}w  ` +
      `before ${String(row.before).padStart(3)}` +
      (row.after === undefined ? "" : `  after ${String(row.after).padStart(3)}  drift ${row.drift}`),
  ),
);
