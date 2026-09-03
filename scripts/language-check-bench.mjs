/**
 * How fast is the language checker, and does the prompt's length cost anything?
 *
 * The checker sits between the learner and the first sound the tutor makes, so its latency is
 * the whole question of whether the repair is affordable. A full tutor sweep answers it only
 * indirectly — the writer's own spread through the gateway is an order of magnitude wide and
 * swamps everything else — so this calls the checker on its own, on real units taken from turns
 * GLM has already written, and reports the distribution.
 *
 *   node --experimental-strip-types scripts/language-check-bench.mjs
 *   node --experimental-strip-types scripts/language-check-bench.mjs --models=or/google/gemini-2.5-flash-lite --runs=3
 *
 * Units come from evals/sweep/tutor.language.*.json, which the tutor sweep writes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  acceptCorrection,
  buildLanguageRepairInput,
  buildLanguageRepairInstructions,
  languageRepairSchema,
  takeSpeakableUnit,
} from "../src/lib/ai/language-repair.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const models = flag(
  "models",
  "or/google/gemini-2.5-flash-lite,or/google/gemini-3.5-flash-lite,or/google/gemini-2.5-flash",
).split(",");
const runs = Number(flag("runs", "2"));
const language = flag("language", "sl");
const source = flag("source", "evals/sweep/tutor.language.omrezja-sl.json");

/** The units a real turn is cut into, taken from turns the writer actually produced. */
function harvestUnits() {
  const rows = JSON.parse(fs.readFileSync(path.join(ROOT, source), "utf8"));
  const units = [];

  for (const row of rows) {
    let buffer = row.written ?? "";
    let first = true;

    for (;;) {
      const taken = takeSpeakableUnit(buffer, { first, final: false });

      if (!taken) {
        break;
      }

      units.push({ text: taken.unit, first });
      buffer = taken.rest;
      first = false;
    }
  }

  return units;
}

async function repairOnce({ model, instructions, text, preceding }) {
  const started = Date.now();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
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
            z.toJSONSchema(languageRepairSchema),
          )}\n\nSource input:\n${buildLanguageRepairInput({ text, preceding })}`,
        },
      ],
      max_tokens: Math.max(512, Math.ceil(text.length / 2) + 256),
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_output",
          strict: true,
          schema: z.toJSONSchema(languageRepairSchema),
        },
      },
      provider: { sort: "latency", require_parameters: true },
    }),
  });

  if (!response.ok) {
    throw new Error(`${model}: ${response.status}`);
  }

  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content ?? "";
  const { corrected } = languageRepairSchema.parse(
    JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)),
  );

  return {
    ms: Date.now() - started,
    corrected,
    outputTokens: payload.usage?.completion_tokens ?? null,
    accepted: acceptCorrection(text, corrected),
    changed: acceptCorrection(text, corrected) && corrected.trim() !== text.trim(),
    promptTokens: payload.usage?.prompt_tokens ?? null,
  };
}

const percentile = (values, p) => {
  if (!values.length) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
};

const units = harvestUnits();

/*
 * The prompt was the first thing suspected when the repair looked slow, so it was measured
 * against a stripped-down version on 2026-09-04: the lean block ran 390ms faster at p50 and found
 * 17 errors where the full one found 27, and one of the ten it lost it got actively wrong
 * ("kuovero" repaired to "kuoverto", which is also not a word). The full block earns its tokens.
 * `--lean` keeps that comparison runnable rather than a claim in a comment.
 */
const LEAN = [
  `You are proofreading a fragment of spoken ${language} while it is still being written.`,
  "Fix only genuine language errors: words that do not exist, wrong inflections, wrong diacritics, and words borrowed from a neighbouring language.",
  "Change nothing else — no rephrasing, no re-ordering, no added or removed facts, no terminology swaps, no punctuation changes, and no changes to square-bracket tags.",
  "The fragment may begin or end mid-sentence; leave that exactly as it is and never complete or extend it.",
  "If nothing is wrong, return it unchanged.",
].join("\n");

const PROMPTS = [["full", buildLanguageRepairInstructions(language, { spoken: true })]];

if (args.includes("--lean")) {
  PROMPTS.push(["lean", LEAN]);
}

console.log(`${units.length} units from ${source}, ${runs} run(s) each, language ${language}`);
PROMPTS.forEach(([label, text]) => console.log(`  prompt ${label}: ${text.length} chars`));
console.log();
console.log(
  `${"model".padEnd(34)}${"prompt".padEnd(7)}${"n".padEnd(4)}` +
    `${"first p50".padEnd(11)}${"first p90".padEnd(11)}${"later p50".padEnd(11)}${"later p90".padEnd(11)}` +
    `${"changed".padEnd(9)}refused`,
);

const changesByModel = new Map();

for (const model of models) {
 for (const [promptLabel, instructions] of PROMPTS) {
  const timings = [];
  const firstTimings = [];
  const laterTimings = [];
  let changed = 0;
  let refused = 0;
  let promptTokens = null;
  const changes = [];

  for (let run = 0; run < runs; run += 1) {
    const outcomes = await Promise.all(
      units.map(async (unit) => {
        try {
          return await repairOnce({ model, instructions, text: unit.text, preceding: "" });
        } catch {
          return null;
        }
      }),
    );

    outcomes.forEach((outcome, index) => {
      if (!outcome) {
        return;
      }

      timings.push(outcome.ms);
      (units[index].first ? firstTimings : laterTimings).push(outcome.ms);
      promptTokens = outcome.promptTokens ?? promptTokens;

      if (!outcome.accepted) {
        refused += 1;
      } else if (outcome.changed) {
        changed += 1;
        changes.push([units[index].text, outcome.corrected]);
      }
    });
  }

  changesByModel.set(`${model} (${promptLabel})`, changes);
  console.log(
    model.padEnd(34) +
      promptLabel.padEnd(7) +
      String(timings.length).padEnd(4) +
      `${percentile(firstTimings, 0.5)}ms`.padEnd(11) +
      `${percentile(firstTimings, 0.9)}ms`.padEnd(11) +
      `${percentile(laterTimings, 0.5)}ms`.padEnd(11) +
      `${percentile(laterTimings, 0.9)}ms`.padEnd(11) +
      String(changed).padEnd(9) +
      String(refused),
  );
 }
}

console.log("\nis each change actually a repair?");

for (const [label, changes] of changesByModel) {
  if (!changes.length) {
    console.log(`\n  ${label}: nothing changed`);
    continue;
  }

  const verdicts = await Promise.all(
    changes.map(async ([before, after]) => {
      try {
        return { ...(await judgeChange({ before, after })), before, after };
      } catch {
        return null;
      }
    }),
  );

  const kept = verdicts.filter(Boolean);
  const tally = kept.reduce((counts, entry) => {
    counts[entry.verdict] = (counts[entry.verdict] ?? 0) + 1;

    return counts;
  }, {});

  console.log(
    `\n  ${label}: ${tally.repair ?? 0} repairs, ${tally.harmless ?? 0} harmless, ${tally.damage ?? 0} DAMAGE`,
  );

  kept
    .filter((entry) => entry.verdict === "damage")
    .forEach((entry) => {
      const beforeWords = entry.before.trim().split(/\s+/u);
      const afterWords = entry.after.trim().split(/\s+/u);
      const diffs = beforeWords
        .map((word, index) => (word === afterWords[index] ? null : `${word} → ${afterWords[index]}`))
        .filter(Boolean);

      console.log(`    ${diffs.slice(0, 4).join(" | ") || "(reflowed)"}  — ${entry.why}`);
    });
}
