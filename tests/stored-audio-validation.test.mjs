import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

/*
 * Finalize reads the first bytes of the stored recording with a Range request. A recording that
 * reached storage empty answers that with 416, which used to throw: finalize returned 500, the
 * client retried it twice more, and the learner waited on a note that could never come instead
 * of being told to record again.
 */

const compiled = ts.transpileModule(readFileSync(new URL("../src/lib/file-validation.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function validation(respond) {
  const context = {
    exports: {},
    Buffer,
    TextDecoder,
    Uint8Array,
    Number,
    require(name) {
      if (name === "server-only") return {};
      if (name === "@/lib/constants") return { MAX_AUDIO_BYTES: 300 * 1024 * 1024, MAX_DOCUMENT_BYTES: 1, STORAGE_BUCKET: "lecture-audio" };
      if (name === "@/lib/document-files") return { getLowercaseExtension: (path) => path.split(".").pop().toLowerCase() };
      if (name === "@/lib/supabase/server") return {
        createSupabaseServiceRoleClient: () => ({
          storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://storage.test/object" }, error: null }) }) },
        }),
      };
      if (name === "@/lib/i18n/server") return { tr: async (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key) };
      throw Error(name);
    },
    fetch: async (_url, init) => {
      assert.equal(init.headers.Range, "bytes=0-65535");
      return respond();
    },
  };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const path = "user/lecture.m4a";

test("a recording that reached storage empty is refused with a message, not thrown as a 500", async () => {
  const api = validation(() => new Response("", { status: 416 }));

  assert.deepEqual({ ...(await api.validateStoredAudioFile({ path })) }, { ok: false, error: "file.audioEmpty" });
});

test("an empty object served without honouring the range is refused the same way", async () => {
  const api = validation(() => new Response(new Uint8Array(), { status: 200, headers: { "content-length": "0" } }));

  assert.deepEqual({ ...(await api.validateStoredAudioFile({ path })) }, { ok: false, error: "file.audioEmpty" });
});

test("a storage failure still throws, so finalize answers 5xx and the client tries again", async () => {
  const api = validation(() => new Response("", { status: 503 }));

  await assert.rejects(api.validateStoredAudioFile({ path }), /file\.audioCheckFailedStatus \{"status":503\}/);
});

test("a real recording still passes", async () => {
  const head = new Uint8Array(64);
  head.set([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
  const api = validation(() => new Response(head, {
    status: 206,
    headers: { "content-range": "bytes 0-63/48213", "content-length": "64" },
  }));

  assert.deepEqual({ ...(await api.validateStoredAudioFile({ path })) }, { ok: true, sizeBytes: 48213 });
});
