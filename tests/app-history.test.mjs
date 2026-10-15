import assert from "node:assert/strict";
import test from "node:test";

import { cameFromAppPath, noteAppPath } from "../src/lib/app-history.ts";

test("a paywall steps back only to the page it was opened from", () => {
  assert.equal(cameFromAppPath("/app"), false, "a full load has no page before it");
  noteAppPath("/app/lectures/abc");
  noteAppPath("/app/lectures/abc");
  noteAppPath("/app/start");
  assert.equal(cameFromAppPath("/app/lectures/abc"), true);
  assert.equal(cameFromAppPath("/app/lectures/abc?tab=quiz"), true, "the query does not matter");
  assert.equal(cameFromAppPath("/app"), false, "a different page navigates instead");
});

test("a paywall that replaced the page under it never steps back past it", async () => {
  const { cameFromAppPath: came, noteAppPath: note, replacingNextPage } = await import("../src/lib/app-history.ts?replaced");
  note("/app");
  replacingNextPage();
  note("/app/start");
  assert.equal(came("/app"), false, "the paywall took /app's place, so closing navigates instead");
});
