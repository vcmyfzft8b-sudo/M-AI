import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

/*
 * 2026-10-08 (Sentry 152399859): Supabase answered a read with 400 "Project not specified." and
 * the tutor told a learner in the middle of a walkthrough that their finished note was still being
 * processed — the failed read was taken for a missing note.
 */
function loadTutorVoice(answer) {
  const query = { select: () => query, eq: () => query, maybeSingle: async () => answer };
  const modules = {
    "@/lib/supabase/server": { createSupabaseServiceRoleClient: () => ({ from: () => query }) },
    "@/lib/source-language": { resolveSourceLanguage: async () => "sl" },
    "@/lib/note-tts-text": { stripLeadingRedundantHeading: (notes) => notes },
  };
  const context = { exports: {}, require: (name) => modules[name] ?? {}, console };
  const source = fs.readFileSync(new URL("../src/lib/tutor-voice.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports.loadTutorGrounding;
}

const owned = { title: "Synthetic note", language_hint: "sl" };

test("a failed note read is an error, not a note that is still processing", async () => {
  const cause = { message: "Project not specified." };
  const load = loadTutorVoice({ data: null, error: cause });
  await assert.rejects(load("synthetic-lecture", owned), (error) => error.cause === cause);
});

test("a note with no artifact yet is still answered as not ready", async () => {
  const load = loadTutorVoice({ data: null, error: null });
  assert.equal(await load("synthetic-lecture", owned), null);
});

test("a stored note grounds the tutor", async () => {
  const load = loadTutorVoice({
    data: { summary: "Summary", key_topics: ["Topic"], structured_notes_md: "Synthetic notes", model_metadata: null },
    error: null,
  });
  const grounding = await load("synthetic-lecture", owned);
  assert.equal(grounding.notes, "Synthetic notes");
  assert.equal(grounding.title, "Synthetic note");
});
