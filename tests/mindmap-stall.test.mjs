// 2026-09-28: a map asked for as its note finished sat "queued" for minutes on production. Inngest
// ran it three minutes late and the run never drew; the screen polls a queued map forever and only
// starts one that has no row, so nothing ever picked it up again. Five maps were queued that day,
// the oldest since 6 September. A poll now takes over a map whose runner is gone.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/lib/mindmap.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

/** The real claimStalledMindmap against a one-row table that honours the update's conditions. */
function harness(row) {
  const updates = [];
  const client = { from() {
    let patch = null;
    const filters = [];
    const query = {
      update(value) { patch = value; return query; },
      eq(column, value) { filters.push([column, value]); return query; },
      async select() {
        const matches = filters.every(([column, value]) => row[column] === value);
        if (!matches) return { data: [], error: null };
        updates.push(patch);
        Object.assign(row, patch);
        return { data: [{ lecture_id: row.lecture_id }], error: null };
      },
    };
    return query;
  } };
  const modules = { "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => client } };
  const exports = {};
  new Function("require", "exports", outputText)((name) => modules[name] ?? {}, exports);
  const claim = (now) => exports.claimStalledMindmap("lecture", { status: row.status, generatedAt: row.generated_at }, now);
  return { claim, updates, exports };
}

const queuedAt = "2026-09-28T04:42:22.421+00:00";
const at = (seconds) => Date.parse(queuedAt) + seconds * 1000;

test("a queued map is left to its runner for the first half minute", async () => {
  const { claim, updates } = harness({ lecture_id: "lecture", status: "queued", generated_at: queuedAt });
  assert.equal(await claim(at(29)), null);
  assert.deepEqual(updates, []);
});

test("a queued map nobody picked up is restarted, by exactly one poll", async () => {
  const row = { lecture_id: "lecture", status: "queued", generated_at: queuedAt };
  const { exports, updates } = harness(row);
  const seen = { status: "queued", generatedAt: queuedAt };
  // Two polls that read the same row race; the conditional update lets only one through.
  const outcomes = await Promise.all([
    exports.claimStalledMindmap("lecture", seen, at(31)),
    exports.claimStalledMindmap("lecture", seen, at(31)),
  ]);
  assert.deepEqual(outcomes.sort(), ["restart", null].sort());
  assert.equal(updates.length, 1);
  assert.equal(row.status, "queued", "a restart leaves it queued for the runner to take");
  assert.notEqual(row.generated_at, queuedAt, "and restarts the clock, so the next poll waits again");
});

test("a runner that wrote in the meantime is left alone", async () => {
  const row = { lecture_id: "lecture", status: "generating", generated_at: "2026-09-28T04:42:40.000+00:00" };
  const { exports, updates } = harness(row);
  assert.equal(await exports.claimStalledMindmap("lecture", { status: "queued", generatedAt: queuedAt }, at(60)), null);
  assert.deepEqual(updates, []);
});

test("a draw that died is marked failed rather than restarted, without a message", async () => {
  const row = { lecture_id: "lecture", status: "generating", generated_at: queuedAt };
  const { claim, updates } = harness(row);
  assert.equal(await claim(at(5 * 60)), null, "a live run may take up to 300 s");
  assert.equal(await claim(at(10 * 60)), "failed");
  assert.equal(row.status, "failed");
  assert.equal(updates[0].error_message, null, "the screen shows its own translated copy");
});

test("ready, failed and missing maps are never touched", async () => {
  for (const status of ["ready", "failed", null]) {
    const { claim, updates } = harness({ lecture_id: "lecture", status, generated_at: queuedAt });
    assert.equal(await claim(at(3600)), null, String(status));
    assert.deepEqual(updates, []);
  }
});

test("the mindmap poll starts a restarted map directly and reports a dead one as failed", () => {
  const route = readFileSync(new URL("../src/app/api/lectures/[id]/mindmap/route.ts", import.meta.url), "utf8");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.match(get, /claimStalledMindmap\(id, mindmap\)/);
  assert.match(get, /stalled === "restart"[\s\S]*after\([\s\S]*startLectureMindmapDirectly\(id\)/);
  assert.match(get, /stalled === "failed" \? \{ status: "failed"/);
});
