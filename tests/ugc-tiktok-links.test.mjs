import assert from "node:assert/strict";
import test from "node:test";

import {
  isTikTokShortLink,
  normalizeHandle,
  parseTikTokProfile,
  tiktokProfileUrl,
} from "../src/lib/ugc/tiktok.ts";

// The links exactly as they arrive from the TikTok share sheet.
const SHARED_LINKS = [
  ["https://www.tiktok.com/@mavija94?_r=1&_t=ZN-98oXZVfw5WY", "mavija94"],
  ["https://www.tiktok.com/@mt_memoai?_r=1&_t=ZN-98oXcZuqzVD", "mt_memoai"],
  ["https://www.tiktok.com/@mm.memoai?_r=1&_t=ZN-98oXgsq4hfS", "mm.memoai"],
  ["https://www.tiktok.com/@memo_ai_sii?_r=1&_t=ZN-98oXrIjAAas", "memo_ai_sii"],
  ["https://www.tiktok.com/@limkaema?_r=1&_t=ZN-98oXtDGOyso", "limkaema"],
  ["https://www.tiktok.com/@dejnehino?_r=1&_t=ZN-98oXukXwdhG", "dejnehino"],
  ["https://www.tiktok.com/@eemadilema?_r=1&_t=ZN-98quJG2diZn", "eemadilema"],
  ["https://www.tiktok.com/@ma_anamana?_r=1&_t=ZN-98y0uyQMHUU", "ma_anamana"],
  ["https://www.tiktok.com/@studywithpija?_r=1&_t=ZN-98y0rapLTgR", "studywithpija"],
  ["https://www.tiktok.com/@jz.daily?_r=1&_t=ZN-98yqCt8Cibm", "jz.daily"],
  ["https://www.tiktok.com/@lara_memoai?_r=1&_t=ZN-98zYQGkUZ8g", "lara_memoai"],
  ["https://www.tiktok.com/@rubissiti?_r=1&_t=ZN-98zklA4uVlu", "rubissiti"],
  ["https://www.tiktok.com/@studiesbytara?_r=1&_t=ZN-98zko1R5MBi", "studiesbytara"],
  ["https://www.tiktok.com/@zoja.vajda?_r=1&_t=ZN-98zjt9EDDgU", "zoja.vajda"],
];

test("reads every campaign link as pasted from the share sheet", () => {
  for (const [link, expected] of SHARED_LINKS) {
    const parsed = parseTikTokProfile(link);

    assert.ok(parsed, `failed to parse ${link}`);
    assert.equal(parsed.handle, expected);
    // Tracking parameters must not survive into the stored URL.
    assert.equal(parsed.profileUrl, `https://www.tiktok.com/@${expected}`);
  }
});

test("accepts a bare handle, an @handle and a video URL", () => {
  assert.equal(parseTikTokProfile("eemadilema").handle, "eemadilema");
  assert.equal(parseTikTokProfile("@eemadilema").handle, "eemadilema");
  assert.equal(
    parseTikTokProfile("https://www.tiktok.com/@studywithpija/video/7675418441926380822")
      .handle,
    "studywithpija",
  );
});

test("tolerates whitespace, trailing slashes and the mobile host", () => {
  assert.equal(parseTikTokProfile("  https://www.tiktok.com/@zoja.vajda/  ").handle, "zoja.vajda");
  assert.equal(parseTikTokProfile("https://m.tiktok.com/@jz.daily").handle, "jz.daily");
  assert.equal(parseTikTokProfile("https://tiktok.com/@jz.daily").handle, "jz.daily");
});

test("rejects anything that is not a TikTok profile", () => {
  // A look-alike domain must not be accepted as TikTok.
  assert.equal(parseTikTokProfile("https://nottiktok.com/@someone"), null);
  assert.equal(parseTikTokProfile("https://www.instagram.com/someone"), null);
  assert.equal(parseTikTokProfile("https://www.tiktok.com/foryou"), null);
  assert.equal(parseTikTokProfile("https://www.tiktok.com/"), null);
  assert.equal(parseTikTokProfile(""), null);
  assert.equal(parseTikTokProfile("not a link at all"), null);
});

test("rejects handles with characters TikTok does not allow", () => {
  assert.equal(normalizeHandle("has space"), null);
  assert.equal(normalizeHandle("has/slash"), null);
  assert.equal(normalizeHandle(""), null);
  assert.equal(normalizeHandle("@@"), null);
  assert.equal(normalizeHandle("ok.handle_1"), "ok.handle_1");
});

test("recognises share short links, which need a network round trip", () => {
  assert.equal(isTikTokShortLink("https://vm.tiktok.com/ZNdabc123/"), true);
  assert.equal(isTikTokShortLink("https://vt.tiktok.com/ZSabc/"), true);
  assert.equal(isTikTokShortLink("https://www.tiktok.com/@zoja.vajda"), false);
  // A short link is not parseable without following it.
  assert.equal(parseTikTokProfile("https://vm.tiktok.com/ZNdabc123/"), null);
});

test("builds the canonical profile URL", () => {
  assert.equal(tiktokProfileUrl("eemadilema"), "https://www.tiktok.com/@eemadilema");
});
