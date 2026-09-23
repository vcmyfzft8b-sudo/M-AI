import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// These two real Supabase reads must agree after the model-history read is
// reversed. Postgres gives both rows of an inserted turn the same timestamp;
// primary timestamp order alone cannot preserve question/answer order.
function readOrders(file) {
  const source = readFileSync(new URL(`../src/lib/${file}`, import.meta.url), "utf8");
  const read = source.slice(source.indexOf('.from("chat_messages")'));
  const query = read.slice(0, read.search(/\.limit\(|\n\s*\}\),/));
  return [...query.matchAll(/\.order\("(\w+)", \{ ascending: (true|false) \}\)/g)]
    .map(([, field, ascending]) => ({ field, ascending: ascending === "true" }));
}
const rows = [
  { id: "reply-2", created_at: "2026-09-23T01:55:25Z", role: "assistant" },
  { id: "question-1", created_at: "2026-09-23T01:54:10Z", role: "user" },
  { id: "reply-1", created_at: "2026-09-23T01:54:10Z", role: "assistant" },
  { id: "question-2", created_at: "2026-09-23T01:55:25Z", role: "user" },
];
const chronological = ["question-1", "reply-1", "question-2", "reply-2"];
function ordered(orders) {
  return rows.slice().sort((left, right) => {
    for (const { field, ascending } of orders) {
      const difference = left[field].localeCompare(right[field]);
      if (difference) return ascending ? difference : -difference;
    }
    return 0;
  });
}

test("reopened chat places each question before its same-timestamp answer", () => {
  assert.deepEqual(ordered(readOrders("lectures.ts")).map(row => row.id), chronological);
});

test("the tutor receives question/answer pairs in the same chronological order", () => {
  assert.deepEqual(ordered(readOrders("pipeline.ts")).reverse().map(row => row.id), chronological);
});

test("limiting the newest model history retains the newest complete pair", () => {
  assert.deepEqual(ordered(readOrders("pipeline.ts")).slice(0, 2).reverse().map(row => row.id), chronological.slice(-2));
});
