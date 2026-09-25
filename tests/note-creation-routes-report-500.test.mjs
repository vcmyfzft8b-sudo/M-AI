import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// A note-creation route that answers 500 from its own catch is a handled response:
// Sentry's request hook never sees it and Vercel logs a line with no message. On
// 2026-08-16 POST /api/lectures/pdf did exactly that and left nothing to diagnose.
// Every 500 these routes return must report first.
const ROUTES = ["pdf", "text", "link", "scan", "manual", ""].map((name) =>
  `../src/app/api/lectures/${name ? `${name}/` : ""}route.ts`);

for (const path of ROUTES) {
  test(`${path} reports before every 500 it returns`, () => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    const handlers = source.split(/^export async function /m).slice(1)
      .filter((body) => body.startsWith("POST"));
    assert.equal(handlers.length, 1, "one POST handler");
    const body = handlers[0];
    const fiveHundreds = [...body.matchAll(/status: 500/g)];
    assert.ok(fiveHundreds.length > 0, "the route has a 500 path");
    for (const match of fiveHundreds) {
      const before = body.slice(Math.max(0, match.index - 900), match.index);
      assert.match(before, /captureRouteError\(/, `500 at offset ${match.index} is not reported`);
    }
  });
}
