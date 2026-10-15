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
