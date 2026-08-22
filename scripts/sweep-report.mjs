/** Aggregates evals/sweep into one table: mean quality and cost per config. */
import fs from "node:fs";

const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length;
const files = fs.readdirSync("evals/sweep").filter((file) => file.startsWith("notes.") && file.endsWith(".json"));

console.log(
  ["config", "recall", "extract", "words", "cost/run", "min recall"].map((h, i) => h.padEnd([12, 9, 9, 7, 10, 10][i])).join(""),
);

const rows = [];

for (const file of files.sort()) {
  const results = JSON.parse(fs.readFileSync(`evals/sweep/${file}`, "utf8")).filter((row) => !row.error);
  const name = file.replace(/^notes\./, "").replace(/\.json$/, "");

  if (results.length === 0) {
    console.log(`${name.padEnd(12)}ALL RUNS FAILED`);
    continue;
  }

  const recalls = results.map((row) => row.recall);
  const extracts = results.map((row) => row.extractionRecall).filter((value) => value != null);

  rows.push({
    name,
    recall: mean(recalls),
    minRecall: Math.min(...recalls),
    extract: extracts.length ? mean(extracts) : null,
    words: mean(results.map((row) => row.noteWords)),
    cost: mean(results.map((row) => row.costUsd)),
  });
}

for (const row of rows.sort((a, b) => a.cost - b.cost)) {
  console.log(
    [
      row.name.padEnd(12),
      `${(row.recall * 100).toFixed(0)}%`.padEnd(9),
      (row.extract == null ? "-" : `${(row.extract * 100).toFixed(0)}%`).padEnd(9),
      String(Math.round(row.words)).padEnd(7),
      `$${row.cost.toFixed(4)}`.padEnd(10),
      `${(row.minRecall * 100).toFixed(0)}%`.padEnd(10),
    ].join(""),
  );
}
