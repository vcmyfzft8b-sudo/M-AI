import assert from "node:assert/strict";
import { test } from "node:test";
import { removeStoragePrefix } from "../src/lib/mobile/storage-cleanup.ts";

test("deletion paginates nested user files without touching another user's prefix", async () => {
  const objects = new Set(["another-user/keep.pdf", ...Array.from({ length: 253 }, (_, i) => `user/nested/${i}.pdf`), "user/source.wav"]);
  const storage = {
    async list(prefix, { limit }) {
      const names = [...new Set([...objects].filter(p => p.startsWith(`${prefix}/`)).map(p => p.slice(prefix.length + 1).split("/")[0]))].sort().slice(0, limit);
      return { data: names.map(name => ({ name, id: objects.has(`${prefix}/${name}`) ? name : null })), error: null };
    },
    async remove(paths) { paths.forEach(p => objects.delete(p)); return { error: null }; },
  };
  await removeStoragePrefix(storage, "user");
  assert.deepEqual([...objects], ["another-user/keep.pdf"]);
});

test("storage errors stop deletion and malformed paths never reach remove", async () => {
  let removed = false;
  const storage = { list: async () => ({ data: [{ id: "id", name: "../other.pdf" }], error: null }), remove: async () => { removed = true; return { error: null }; } };
  await assert.rejects(removeStoragePrefix(storage, "user"));
  assert.equal(removed, false);
  await assert.rejects(removeStoragePrefix(storage, ""));
  await assert.rejects(removeStoragePrefix({ ...storage, list: async () => ({ data: null, error: new Error("offline") }) }, "user"), /offline/);
});
