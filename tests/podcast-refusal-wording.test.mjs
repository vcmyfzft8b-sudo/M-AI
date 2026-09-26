import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the podcast refuses in its own words, not the tutor's", () => {
  for (const route of ["podcast/route.ts", "podcast/segments/route.ts"]) {
    const source = readFileSync(new URL(`../src/app/api/lectures/[id]/${route}`, import.meta.url), "utf8");
    assert.match(source, /"api\.podcastCreditsNeeded" : "api\.podcastTrialUsed"/, route);
    assert.doesNotMatch(source, /api\.tutorTrialUsed|api\.tutorCreditsNeeded/, route);
  }
});
