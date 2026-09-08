import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { parseMindmapDoc } from "../src/lib/mindmap-doc.ts";

const source = readFileSync(new URL("../src/lib/mindmap.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const doc = { version: 1, title: "Economics", language: "en", branches: [
  { id: "n1", label: "Demand", children: [{ id: "n1.1", label: "Price", children: [] }] },
] };

function harness({ status = "ready", notes = "source", notesHash = "hash:source", map = doc } = {}) {
  const writes = [];
  const row = { status, notes_hash: notesHash, map_json: map, model_metadata: { generationVersion: "old" } };
  const client = { from(table) {
    return { select() { return this; }, eq() { return this; },
      async maybeSingle() {
        return { data: table === "lecture_mindmap_assets" ? row
          : table === "lecture_artifacts" ? { structured_notes_md: notes } : { title: "Economics" } };
      }, async upsert(value) { writes.push(value); return { error: null }; },
    };
  } };
  const modules = {
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => client },
    "@/lib/mindmap-doc": { parseMindmapDoc },
    "@/lib/tutor/plan-cache": { hashNotesContent: (text) => `hash:${text}` },
    "@/lib/note-tts-text": { stripLeadingRedundantHeading: (text) => text },
  };
  const exports = {};
  new Function("require", "exports", outputText)((name) => modules[name] ?? {}, exports);
  return { queue: exports.queueLectureMindmapGeneration, writes };
}

test("reopening an unchanged old map preserves its document, metadata and ready status", async () => {
  const { queue, writes } = harness();
  assert.equal(await queue("lecture"), false);
  assert.equal(await queue("lecture"), false);
  assert.deepEqual(writes, []);
});

test("Draw again always queues an unchanged saved map", async () => {
  const { queue, writes } = harness();
  assert.equal(await queue("lecture", true), true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].status, "queued");
  assert.equal("map_json" in writes[0], false, "keep the old map while drawing");
});

for (const [name, options] of [
  ["changed source", { notes: "changed source" }],
  ["missing source fingerprint", { notesHash: null }],
  ["unreadable source", { notes: null }],
  ["failed generation", { status: "failed" }],
  ["invalid saved document", { map: {} }],
]) {
  test(`${name} cannot incorrectly reuse the ready cache`, async () => {
    const { queue, writes } = harness(options);
    assert.equal(await queue("lecture"), true);
    assert.equal(writes[0].status, "queued");
  });
}
