import assert from "node:assert/strict";
import test from "node:test";

import { looksLikeBotChallenge } from "../src/lib/link-bot-challenge.ts";

// What Scribd served our fetch on 2026-09-19, reduced to its markers. We read it as the learner's
// material and told them it had nothing to learn from.
const SCRIBD_CHALLENGE = `<!DOCTYPE html><html><head><title>Client Challenge</title>
<link href="/_fs-ch-1T1wmsGaOgGaSxcX/assets/styles.css" rel="stylesheet" /></head>
<body>A required part of this site couldn’t load. This may be due to a browser extension.</body></html>`;

test("a bot screen is recognised by its title", () => {
  assert.equal(looksLikeBotChallenge({ html: SCRIBD_CHALLENGE, title: "Client Challenge" }), true);
  assert.equal(looksLikeBotChallenge({ html: "<html></html>", title: "Just a moment..." }), true);
});

test("a bot screen is recognised by its markup when the title says nothing", () => {
  assert.equal(looksLikeBotChallenge({ html: SCRIBD_CHALLENGE, title: "" }), true);
  assert.equal(
    looksLikeBotChallenge({ html: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate"></script>' }),
    true,
  );
});

test("Cloudflare's own header is enough", () => {
  const headers = new Headers({ "cf-mitigated": "challenge" });

  assert.equal(looksLikeBotChallenge({ html: "", headers }), true);
});

test("a real article that merely loads a Cloudflare script is still read", () => {
  const article = `<html><head><title>Fotosinteza – Wikipedija</title></head><body>${"<p>Fotosinteza je proces.</p>".repeat(3000)}<script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`;

  assert.equal(looksLikeBotChallenge({ html: article, title: "Fotosinteza – Wikipedija" }), false);
});
