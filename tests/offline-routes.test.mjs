import assert from "node:assert/strict";
import test from "node:test";

import { canRenderOffline, resolveOfflineRoute } from "../src/lib/offline/paths.ts";

/**
 * Which screen the offline document draws.
 *
 * The service worker answers *every* failed navigation with the one cached
 * `/offline` document, served under whatever address was asked for. So the
 * address is the only thing that says which screen was wanted, and these rules
 * are the whole of that decision — get them wrong and a reader who tapped a
 * note gets the library, or the "not available offline" screen for a note that
 * is sitting in the cache.
 */

test("the library is what the app's own entry points resolve to", () => {
  for (const path of ["/app", "/app/", "/", "/auth/continue", "/offline", "/app/start"]) {
    assert.deepEqual(resolveOfflineRoute(path), { kind: "home" }, path);
  }
});

test("a note route carries its id through, decoded", () => {
  assert.deepEqual(resolveOfflineRoute("/app/lectures/abc-123"), {
    kind: "lecture",
    lectureId: "abc-123",
  });
  assert.deepEqual(resolveOfflineRoute("/app/lectures/a%20b"), {
    kind: "lecture",
    lectureId: "a b",
  });
});

test("a query or a hash is not part of the decision", () => {
  assert.deepEqual(resolveOfflineRoute("/app?mode=x"), { kind: "home" });
  assert.deepEqual(resolveOfflineRoute("/app/lectures/x?tab=cards#top"), {
    kind: "lecture",
    lectureId: "x",
  });
});

test("screens with no offline form say so, and say whether home is a way out", () => {
  assert.deepEqual(resolveOfflineRoute("/app/settings"), {
    kind: "unavailable",
    backToHome: true,
  });
  assert.deepEqual(resolveOfflineRoute("/legal/terms-of-use"), {
    kind: "unavailable",
    backToHome: false,
  });
});

/*
 * A note's sub-paths are not note routes. `/app/lectures/x/anything` has no
 * server route either, and treating it as a note would open the wrong note —
 * the id would come out as the first segment and the rest would be dropped.
 */
test("only an exact note path is a note", () => {
  assert.equal(resolveOfflineRoute("/app/lectures").kind, "unavailable");
  assert.equal(resolveOfflineRoute("/app/lectures/x/y").kind, "unavailable");
});

test("canRenderOffline agrees with the resolver", () => {
  assert.equal(canRenderOffline("/app"), true);
  assert.equal(canRenderOffline("/app/lectures/x"), true);
  assert.equal(canRenderOffline("/app/settings"), false);
});
