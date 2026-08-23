# AI pipeline rework — agent handoff

State of the `claude/gemini-model-selection-study-367faf` branch as of 2026-08-23, written for
the next agent continuing this work. Everything below is measured, not assumed; re-measure before
overturning any of it.

## What this branch does

1. **Notes** are generated content-first: extract every testable claim (two passes, 400/260-word
   windows, oversized transcript segments split at sentence boundaries), judge-dedupe the claims,
   outline what the note keeps, write exactly that. No word targets anywhere — length follows the
   material. `NOTES_PIPELINE=legacy` restores the old chunk-summary pipeline.
2. **Flashcards, quiz, practice tests** generate from the same knowledge items the notes were
   written from (stored on the artifact as `model_metadata.knowledgeItems`, reused on load), so
   deck coverage ≡ note coverage. One card/question per item, batch size 6, content-level dedupe,
   plus a judge pass that collapses cross-spelling/cross-angle concept duplicates.
   `STUDY_PIPELINE=legacy` restores the concept planner. The 70-card cap is plan-aware (legacy
   unchanged, item decks size themselves).
3. **Models per stage** (`src/lib/ai/model-config.ts`): everything on `GEMINI_TEXT_MODEL`
   (2.5-flash-lite) except `note_write` → gemini-3.5-flash-lite. OCR primary is 3.5-flash-lite;
   rescue stays gemini-3-flash-preview. Thinking is off for OCR (version-aware —
   `resolveMinimalThinkingConfig`; 3.5+ rejects `thinkingBudget` with a bare 400). 3.1-flash-lite
   is **disqualified** everywhere (worst at every stage in the sweep).
4. **Ingestion**: YouTube links via innertube ANDROID/IOS captions (timedtext **XML**, not json3 —
   the URL pins its own fmt); WAV/AIFF/FLAC transcode client-side above 25 MB via mounted
   WORKERFS (ceiling 2 GB); office decks strip media as a last resort before rejection.
5. **Rendering**: single-dollar math off (prices), `\(...\)` → inline `$$` (remark-math never
   parsed `\(...\)`), write-time normalizer never touches table rows or currency spans, workspace
   shows `\$` as `$` (display-layer only — annotation word indices are an iOS contract, do not
   change tokenization).
6. **Navigation skeletons**: `NavigationFeedbackProvider` in the persistent `/app` and `/creator`
   layouts owns the overlay; it portals into `.app-shell-content` (geometry inherited), holds
   until the route skeleton (`data-route-skeleton`) unmounts, releases immediately on redirects.

Every model in the stack was chosen by measurement, and those measurements — what was tested,
what it cost, which dates change the answer, and the bugs the real material exposed — are written
up in [ai-model-selection.md](./ai-model-selection.md). Read that before changing a model.

## How to verify changes (the actual gates)

```bash
npm test                                    # 289 unit tests
node --experimental-strip-types scripts/note-eval.mjs --repeat=2      # note recall vs answer keys
node --experimental-strip-types scripts/study-eval.mjs                # deck coverage + distractors
node scripts/ocr-eval.mjs --images=handwritten-ugly,slide-annotated-ugly
node --experimental-strip-types scripts/pedagogy-audit.mjs <cookieFile> <lectureId>  # judge audit
./scripts/model-sweep.sh                    # before changing any stage model
```

Client compression (wasm ffmpeg/canvas) cannot be unit-tested: use `/dev/compression-test` in a
browser with fixtures in `public/test-fixtures/` (gitignored). `/dev/note-compare` renders eval
outputs through the real markdown renderer; `/dev/skeletons` renders route skeletons directly.
All `/dev` pages are no-ops in production builds.

## Local staging test recipe (never point local at prod)

1. `cd` main checkout, `vercel env pull .env.preview --environment=preview --yes`
   (account **nacevalencic-1988**).
2. Copy over the worktree's `.env.local`, append `PREVIEW_AUTH_BYPASS=true`, **comment out
   `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN`** (a local run otherwise reports to Sentry as
   environment=preview and pages the user).
3. Synthetic user `preview@memo.app` (`00000000-0000-4000-8000-000000000001`) exists in staging
   auth with a fake active subscription. API routes need a real session: mint via
   `POST /auth/v1/admin/generate_link` (service key) → `POST /auth/v1/verify` → send as a single
   cookie `sb-yviipoccwsndxyrhtcjm-auth-token=base64-<b64url(session json)>`. Tokens last 1 h.
4. The preview auth bypass covers pages only — RLS-scoped lecture pages 404 without a real
   session (pre-existing gap, see open items).

## Open items, in priority order

1. **Real-user validation on the Vercel preview**, then merge. Previews do not exercise Inngest
   steps — verify note generation on production right after merge (AGENTS.md rule). Watch
   `ai_usage_events` cost per lecture: expect ~5–15× the old spend (~$0.10–0.30/lecture).
2. **Importance calibration**: the extractor rates ~⅔ of items 4–5, so importance cannot gate
   deck size yet. Fixing the rating rubric (or ranking relatively per lecture) would enable
   "quiz/practice only for important items" cost cuts.
3. **Batch API**: all study generation is background Inngest work — the 50% batch discount is
   free money once wired.
4. **PDF text-layer + handwriting gap**: a PDF with ≥40 words of text layer never gets a vision
   pass (`extractTextFromPdf`), so hand-drawn annotations in exported PDFs are dropped. Needs
   page rendering server-side (heavy) or an embedded-image OCR extension.
5. **Repair the user's production note** (`Pregled in primerjava sodobnih modelov umetne
   inteligence` on prod) after merge — its table was corrupted by the old normalizer. The staging
   copy repair procedure is in the session history; a regenerate also works once new code ships.
6. **Chat + practice-photo grading models** were never swept — chat runs on the 2.5 fallback,
   grading on the OCR model; both defensible, neither measured.
7. **Preview-bypass RLS gap** (pre-existing): bypass users 404 on lecture detail everywhere. Fix
   only if preview testing needs it; the magic-link session recipe above is the workaround.
8. Sentry issue `142288144` is my local test machine (server `Naces-MacBook-Air.local`), safe to
   resolve.

## Traps that already bit once — do not rediscover them

- Thinking tokens come out of `maxOutputTokens`; a thinking model under a tight cap reads as
  truncation and burns the whole retry ladder (`applyOutputHeadroom` exists for this).
- `thinkingBudget: 0` is a 400 on 3.5+; `mediaResolution` (bare enum) is a 400 — the part shape
  is `{ level: ... }`; both fail with messages that name no field.
- Extraction quality **drops** with thinking enabled, and single-pass extraction is unstable —
  keep two passes + judge dedupe. Token-overlap thresholds cannot replace the judge (lowering
  them merges EPSP with IPSF-class opposites).
- `buildTranscriptWindows` sizes by characters; the measured window constants are words (×6.5).
- Never let the write-time math normalizer touch `|`-prefixed lines, and never re-enable
  single-dollar math in a renderer: prices pair up and swallow tables.
- The Inngest step contract (docs/lecture-pipeline-inngest.md) still applies to everything here.
