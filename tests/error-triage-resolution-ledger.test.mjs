import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SKILL = readFileSync(
  new URL("../.claude/skills/error-triage/SKILL.md", import.meta.url),
  "utf8",
);
const LEDGER = readFileSync(
  new URL("../docs/error-triage-resolutions.md", import.meta.url),
  "utf8",
);

test("automated triage consults the durable resolution ledger before branching", () => {
  const ledgerInstruction = SKILL.indexOf("docs/error-triage-resolutions.md");
  const correlationStep = SKILL.indexOf("**Correlate Vercel with Sentry.**");

  assert.ok(ledgerInstruction > 0, "the triage skill must name the resolution ledger");
  assert.ok(
    ledgerInstruction < correlationStep,
    "the ledger must be checked before a candidate is correlated and assigned a branch",
  );
  assert.match(SKILL, /update or wait for that PR instead of opening a duplicate/);
});

test("both 2026-09-01 resolutions have durable fingerprints and PRs", () => {
  for (const required of [
    "MEMOAI-WEB-37",
    "POST /api/inngest",
    "PR #304",
    "dpl_DdXSoArqCz1HHtL3prHXqPRAwjoY",
    "MEMOAI-WEB-33",
    "POST /api/internal/lectures/document",
    "document_image_description",
    "PR #305",
    "dpl_J6yR5NASC2GFsTHseuQifNAwTTvK",
  ]) {
    assert.ok(LEDGER.includes(required), `resolution ledger is missing ${required}`);
  }
});

/*
 * The hydration catch-all (MEMOAI-WEB-7) has no stack trace and never will, so every triage run
 * that meets it pays the same investigation over again unless the ledger keeps the findings. These
 * are the two that decide whether a post-cutoff event is worth a branch at all.
 */
test("the hydration catch-all records why it cannot be localised from Sentry alone", () => {
  for (const required of [
    "MEMOAI-WEB-7",
    "replay.hydrate-error",
    "translated-ltr",
    "recording-segments",
  ]) {
    assert.ok(LEDGER.includes(required), `resolution ledger is missing ${required}`);
  }
});
