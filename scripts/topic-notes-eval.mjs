/**
 * Replays thin material through the production note prompts, topic notes included.
 *
 * Built for the 2026-09 failed-notes review: exercise sheets, spoken questions, a map legend and
 * other material that names a topic without explaining it used to fail as
 * `source_no_study_content`. This runs each case the way note-generation.ts now does -- extract,
 * and when the material is too thin (shouldWriteTopicNotes) write the topic study text and extract
 * again -- then writes the note, so the result can be read rather than assumed.
 *
 *   node --experimental-strip-types scripts/topic-notes-eval.mjs <cases.json> [--out=<dir>] [--only=id,id]
 *
 * <cases.json> is an array of { id, language, sourceType: "audio"|"document", title?, source,
 * expect?: "note"|"fail" }. Keep real learners' material out of git: pass a file from outside
 * the repo. Costs about a cent per case.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runCase } from "./lib/note-replay.mjs";
import { countWords, ledger, loadEnv } from "./lib/eval-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);

const args = process.argv.slice(2);
const casesPath = args.find((arg) => !arg.startsWith("--"));
const argValue = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const outDir = argValue("out");
const only = argValue("only")?.split(",");

if (!casesPath) {
  console.error("usage: topic-notes-eval.mjs <cases.json> [--out=<dir>] [--only=id,id]");
  process.exit(1);
}

const cases = JSON.parse(fs.readFileSync(casesPath, "utf8")).filter(
  (testCase) => !only || only.includes(testCase.id),
);

if (outDir) {
  fs.mkdirSync(outDir, { recursive: true });
}

let mismatches = 0;

for (const testCase of cases) {
  const startedAt = Date.now();

  try {
    const result = await runCase(testCase);
    const words = result.note ? countWords(result.note) : 0;
    const matches = !testCase.expect || testCase.expect === result.outcome;
    mismatches += matches ? 0 : 1;
    console.log(
      [
        matches ? "ok  " : "MISS",
        testCase.id.padEnd(28),
        result.outcome.padEnd(5),
        `items ${result.firstItemCount}->${result.itemCount ?? 0}`.padEnd(14),
        result.topic ? `topic(${result.topic.materialKind}): ${result.topic.topicTitle}` : "from material",
        `${words}w`,
        `${Math.round((Date.now() - startedAt) / 1000)}s`,
      ].join("  "),
    );

    if (outDir && result.note) {
      fs.writeFileSync(path.join(outDir, `${testCase.id}.md`), result.note);
    }
  } catch (error) {
    mismatches += 1;
    console.log(`ERR   ${testCase.id}: ${error.message}`);
  }
}

console.log(`\n${cases.length - mismatches}/${cases.length} as expected, $${ledger.costUsd.toFixed(3)}`);
process.exitCode = mismatches ? 1 : 0;
