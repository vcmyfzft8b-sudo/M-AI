import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const JOBS_SOURCE = readSource("src/lib/jobs.ts");

// The same defect PR #241 fixed for the document route, on the two routes it left behind. Both
// awaited their processing inline before answering, so enqueueInternalLectureJob -- which awaits
// this response -- kept the *caller's* invocation alive for the whole run and died with it at
// maxDuration: the "200 plus Vercel Runtime Timeout Error" pair in the platform log. And an
// unbudgeted run is killed before any catch, so markLecturePipelineFailed never runs and the
// lecture keeps an in-progress status forever with nothing in Sentry.
const ROUTES = [
  {
    label: "scan",
    path: "src/app/api/internal/lectures/scan/route.ts",
    processor: "processStoredScanLecture",
  },
  {
    label: "link",
    path: "src/app/api/internal/lectures/link/route.ts",
    processor: "processStoredLinkLecture",
  },
];

for (const route of ROUTES) {
  const source = readSource(route.path);

  test(`the ${route.label} route answers before it starts processing`, () => {
    assert.ok(
      source.includes("after(async () => {"),
      `the route awaits ${route.processor} inline, so it holds its caller's invocation open for the whole run`,
    );

    const afterBody = source.split("after(async () => {")[1];

    assert.ok(
      afterBody.includes(route.processor),
      `${route.processor} no longer runs inside after(), so the response still waits on it`,
    );
  });

  test(`the ${route.label} processing runs inside the invocation budget`, () => {
    const afterBody = source.split("after(async () => {")[1] ?? "";

    assert.ok(
      afterBody.includes("runWithinInvocationBudget"),
      "an unbudgeted run is killed silently by the platform, discarding its failure",
    );
    assert.ok(
      afterBody.includes("markLecturePipelineFailed"),
      "nothing records the overrun on the lecture row, so it keeps its in-progress status forever",
    );
  });

  test(`the ${route.label} budget is measured against the route's own maxDuration`, () => {
    assert.ok(
      /export const maxDuration = \d+/.test(source),
      `the ${route.label} route no longer exports maxDuration`,
    );
    // Next.js only accepts a literal for maxDuration, so the budget reads the exported binding
    // rather than repeating the number -- a budget measured against a stale limit would either fire
    // early on healthy work or leave no margin at all.
    assert.ok(
      /maxDurationSeconds:\s*maxDuration/.test(source),
      "the budget hardcodes a duration instead of reading the route's own maxDuration",
    );
  });

  test(`the ${route.label} deadline message is the one the user can act on`, () => {
    assert.ok(
      source.includes("Obdelava je trajala predolgo in se je ustavila. Poskusi znova."),
      "the deadline message lands verbatim in the lecture's error_message, so it has to match the one the document and process routes use",
    );
  });
}

// What makes these two the production path rather than a fallback: unlike transcription, study and
// quiz, neither has a hosted Inngest branch, so every scan and link upload goes through the HTTP
// route above.
test("scan and link enqueue straight through the internal HTTP job", () => {
  for (const enqueue of ["enqueueLectureScanProcessing", "enqueueLectureLinkProcessing"]) {
    const body = JOBS_SOURCE.split(`export async function ${enqueue}(`)[1].split(
      "\nexport async function",
    )[0];

    assert.ok(
      body.includes("tryEnqueueInternalLectureJob"),
      `${enqueue} no longer reaches the internal route this guard covers`,
    );
    assert.ok(
      !body.includes("inngest.send"),
      `${enqueue} gained an Inngest path -- the step budget in inngest-step-budget.test.mjs has to cover it too`,
    );
  }
});
