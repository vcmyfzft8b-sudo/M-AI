/**
 * Derives one shared answer key per keyless out-of-sample fixture.
 *
 * The committed fixtures carry hand-written keys, but the fixtures built from real uploads cannot:
 * nobody is going to hand-write an answer key for a 4,000-word paper. Deriving one from the source
 * — once, cached into the fixture — lets every candidate be graded against the identical standard,
 * which is the only thing that makes a cross-model comparison mean anything.
 *
 *   node --experimental-strip-types scripts/derive-fixture-keys.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { generate, GRADER_MODEL, loadEnv } from "./lib/eval-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);

const dir = path.join(ROOT, "evals", "fixtures-private");

if (!fs.existsSync(dir)) {
  console.log("no private fixtures to derive keys for");
  process.exit(0);
}

for (const file of fs.readdirSync(dir).filter((entry) => entry.endsWith(".json"))) {
  const full = path.join(dir, file);
  const fixture = JSON.parse(fs.readFileSync(full, "utf8"));

  if (fixture.keyFacts?.length) {
    console.log(`${fixture.id.padEnd(24)} already has ${fixture.keyFacts.length}`);
    continue;
  }

  const value = await generate({
    schema: z.object({ facts: z.array(z.string().min(8)).min(10).max(60) }),
    model: GRADER_MODEL,
    thinkingLevel: "low",
    maxOutputTokens: 8000,
    instructions:
      "You are setting the exam. List the facts from this source a student would actually be tested on, as standalone claims in the source's own language: the definitions the subject is built on, the distinctions, mechanisms, formulas and values that decide whether an answer is right. Leave out what an examiner would not ask — asides, examples that only illustrate, administrative chatter, repetition, background. Cover the whole source's important material, including its later sections. At most 40.",
    input: fixture.source.slice(0, 60000),
  });

  fixture.keyFacts = value.facts;
  fs.writeFileSync(full, `${JSON.stringify(fixture, null, 2)}\n`);
  console.log(`${fixture.id.padEnd(24)} derived ${value.facts.length} key facts`);
}
