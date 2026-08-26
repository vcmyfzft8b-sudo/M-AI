# Lecture pipeline and Inngest steps

The lecture pipeline runs as Inngest functions in production. This document covers the two
things about that boundary that are easy to get wrong and expensive to get wrong: what a step
is allowed to return, and where a failure has to be classified.

Read this before changing anything in `src/inngest/functions.ts` or the stage helpers in
`src/lib/pipeline.ts`.

## Where the pipeline actually runs

`shouldUseHostedInngestJobs` in [src/lib/jobs.ts](/src/lib/jobs.ts) gates on
`VERCEL_ENV === "production"` (or an explicit `USE_INNGEST_JOBS=true`):

- **Production** runs the five Inngest functions in `src/inngest/functions.ts`, each stage in
  its own step, each step in its own Vercel invocation.
- **Previews and local** run the internal HTTP routes under `/api/internal/lectures/*`, which
  call `runLecturePipeline` straight through. **No step boundary exists on that path.**

> **A Vercel preview cannot verify an Inngest change.** The repo's general rule is to check a
> branch on its preview before merging, and for this area that check is close to meaningless —
> the preview exercises a different code path. A change to step structure, step return values
> or failure classification is only exercised in production. Say so plainly in the PR rather
> than implying preview coverage the deployment did not provide, and plan a production check
> immediately after merge.

To genuinely exercise Inngest before merge, set `USE_INNGEST_JOBS=true` as a Preview
environment variable in Vercel and redeploy. This affects every preview, so treat it as a
deliberate, temporary change.

## Changing what a step returns breaks runs already in flight

This one nearly shipped a regression in #235 and is the reason this document exists.

Inngest hashes a step's id from **its name alone** — `sha1("transcribe-lecture")`, see
`hashId` in `inngest/components/execution/v1.js`. It does not incorporate the step's position,
its arguments, or the deployed code. So when a deploy lands mid-run, Inngest replays the steps
that already completed **from state recorded by the previous version of the code**, matched
purely by name.

A step that returned nothing under the old code does not replay as `undefined`. The SDK's
`undefinedToNull` (`inngest/helpers/functions.js`) converts it before the executor stores it,
and the memoized value comes back as **`null`**.

`#235` gave `transcribe-lecture` a return value and read a property off it:

```ts
// Throws TypeError on any run that passed this step before the deploy.
const transcription = await step.run("transcribe-lecture", () => /* ... */);
if (!transcription.completed) return;
```

In this pipeline that `TypeError` lands in `processLectureFunction`'s catch, which marks the
lecture **failed and reports it to Sentry as a defect** — for a lecture whose transcript was
written correctly and whose notes were merely never generated. The user sees a broken lecture;
the on-call sees a defect that does not exist.

The shipped form tolerates the old shape:

```ts
// An older run has no `completed` to read, and its notes still need generating,
// so it falls through to the notes step exactly as it used to.
if (transcription?.completed === false) return;
```

**The rule.** When you give an existing step a return value, or change the shape of one, ask
what the *previous* version of that step returned and make the consumer handle it. Falling
through to the old behaviour is almost always the right answer, because an in-flight run was
started under the old contract and should finish under it.

Returning an object from a step is otherwise completely fine and already the norm here —
`processLectureStudyFunction`, `processLectureQuizFunction` and
`processLecturePracticeTestFunction` all do it. It is only the *transition* that is dangerous.

Renaming a step is the other half of the same trap: a renamed step has a different hash, so an
in-flight run treats it as new work and **re-runs it**. For `transcribe-lecture` that means
paying for the transcription twice.

## Classify an expected input failure on the throwing side of the step

Some failures are the user's file, not our bug: no speech in the recording, no readable text in
a photo, a container we cannot decode, a link we cannot fetch. Those must reach the learner as
a message and must never reach Sentry. `isExpectedLectureInputFailure` in
[src/lib/lecture-processing-errors.ts](/src/lib/lecture-processing-errors.ts) is the single
predicate for that question.

It only works on the object that was actually thrown. Inngest serialises a failed step's error
to `{ name: "Error", message, stack }` and rebuilds it as a `StepError` before the function body
sees it, so across a step boundary:

- the class is gone, so every `instanceof` is false;
- `name` reads `"Error"`, so a name check is false too;
- any `diagnostics` the constructor carried are dropped.

So a failure caught in the function body's `catch` **cannot be classified**. That was the
MEMOAI-WEB-2R defect: a silent recording was reported to Sentry, and the rethrow that followed
failed the run with a 400 on `POST /api/inngest`, after Inngest had already retried the
transcription four more times against audio that had no speech in it.

`runLectureStage` in [src/lib/pipeline.ts](/src/lib/pipeline.ts) is the fix and the pattern:
run the stage inside its step, and on an expected input failure mark the lecture failed *there*
and return `{ completed: false }`. Anything else — a retryable AI error, a broken query, a
budget deadline — still throws, still fails the step, and is still retried and reported.

New stages should run through `runLectureStage`. Only the transcription step does today; the
notes step and `processLectureNotesFunction` still classify after the boundary and have the same
latent gap.

## The invocation budget

`INNGEST_MAX_DURATION_SECONDS` in `src/inngest/functions.ts` must match `maxDuration` in
[src/app/api/inngest/route.ts](/src/app/api/inngest/route.ts) (both `300`).
`tests/inngest-step-budget.test.mjs` fails if the two drift apart.

`withStepBudget` wraps a step so the work rejects shortly before Vercel would kill the
invocation outright. A budget rejection is *not* an expected input failure — it wraps
`runLectureStage` from the outside, so it propagates to the step and fails it, which is what we
want.

Since the 2026-08-25 cost incident the budget also **cancels** the losing work: rejecting the
race is not enough, because the losing pipeline keeps executing on the warm instance —
completing, saving notes, and buying model calls next to the retry that replaced it. Five
lectures did exactly that for hours and multiplied the day's Gemini bill by ten.
`runWithinInvocationBudget` installs an `AbortSignal` through
[src/lib/abort-context.ts](/src/lib/abort-context.ts) (AsyncLocalStorage, so it needs no
parameter threading); every Gemini/OpenRouter call reads it, hands it to the SDK, and refuses to
retry once it fires. If you add a new AI call site, read the signal the same way — a call that
ignores it re-opens the zombie-spend hole.

Two more consequences of that incident:

- **Retries must resume, not re-buy.** The note pipeline checkpoints extraction windows, judge
  verdicts, the outline and the write per lecture in `note_generation_cache`
  ([src/lib/notes/generation-cache.ts](/src/lib/notes/generation-cache.ts)), keyed by a hash of
  each call's exact input, so a budget-failed step's retry replays them in seconds. The cache is
  fail-open in both directions and rows die with the lecture.
- **A lecture's day has a spend ceiling.** `assertLectureGenerationWithinBudget`
  ([src/lib/notes/generation-guard.ts](/src/lib/notes/generation-guard.ts)) refuses another run
  once the lecture's last 24h of `ai_usage_events` shows a loop. The refusal is classified on
  the throwing side of the step (marked failed there, `{ completed: false }` returned), exactly
  like an expected input failure — it must not cross the step boundary as an error.

## Checking a pipeline change after it ships

Because previews do not cover this, verify on production right after the merge:

1. Upload an ordinary recording. It must transcribe **and** generate notes. This is the
   regression test that matters most.
2. Upload a few seconds of silence. The lecture should fail with the "no clear speech" message
   **in one attempt** — seconds, not minutes. The speed is the tell: retry backoff means the
   failure is still crossing the step boundary unclassified.
3. Confirm no new Sentry issue. An absent event is also proof the run completed: had the step
   failed, the function body's catch would have reported the unclassifiable `StepError`.
4. `GET https://www.memoai.eu/api/inngest` should report `mode: "cloud"` with all five
   functions and both keys present.
