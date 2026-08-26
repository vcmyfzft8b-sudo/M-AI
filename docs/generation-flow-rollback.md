# Rolling back the note & study generation flow

This documents exactly what the app ran **before** the content-driven generation flow and the
gemini-3.7-flash note writer went live, and how to get back to that behaviour if the current flow
ever proves too expensive for the quality it buys. The legacy code paths are still in the tree as
rollback switches, so the preferred rollback is **environment variables only** — no revert, no
redeploy of old code, everything else (compression, cost fixes, alerting) keeps working.

## Timeline

| Period (UTC) | Flow in production |
|---|---|
| … → **2026-08-24 ~23:00** | **Old flow.** Chunk-summary map-reduce notes + coverage-planner study decks. Every AI call on `GEMINI_TEXT_MODEL` = `gemini-2.5-flash-lite` (usage metered under stage `gemini_structured_text`). No gemini-3.7-flash, no OpenRouter, no per-stage model config (`src/lib/ai/model-config.ts` did not exist). |
| **2026-08-24 22:50** | PR #239 (branch `claude/gemini-model-selection-study-367faf`, merge commit `8375997`) merges and deploys: content-driven flow (extract → outline → write), item-driven study generation, per-stage models, note writing on `or/google/gemini-3.7-flash` (OpenRouter, Google-direct fallback). |
| 2026-08-26 | PR #244: cost/orchestration fixes (abort, checkpoints, guard, alerting) — flow unchanged. |

- **Last old-flow commit on main:** `0ed8738` ("Treat a PDF with no readable text as the learner's
  file, not a defect", 2026-08-22).
- **First new-flow commit on main:** merge `8375997` (2026-08-24 22:50).

## Why the switch was made (so a rollback is an informed trade)

Measured in `evals/` + `scripts/note-eval.mjs` / `scripts/study-eval.mjs` (2026-08-23):

- Note fact recall in the writing step: 3.7-flash held 100% on every fixture; 3.5-flash-lite
  dropped to 92–94%; 2.5-flash-lite collapsed to 43% on a bad run.
- Study decks: fact recall 87–89% → 97–100% with ~3× the material, and decks/quiz/practice are
  generated from the same knowledge items the note teaches (no note/deck divergence).

Steady-state cost of the current flow (post-PR #244, per large ~30k-word lecture, one clean run):
roughly $0.25–0.35, of which the 3.7-flash write is ~$0.05–0.07. The old flow was roughly
$0.05–0.10 for the same source, with measurably weaker notes and decks.

## Rollback option A — full old behaviour (env vars only, recommended)

Set in Vercel → memo-ai → Settings → Environment Variables (Production), then redeploy:

```
NOTES_PIPELINE=legacy
STUDY_PIPELINE=legacy
```

- `NOTES_PIPELINE=legacy` (read in `src/lib/note-generation.ts`, `resolveNotesPipelineMode`)
  restores the chunk-summary map-reduce note generator (`generateNotesLegacy`). It uses
  `GEMINI_TEXT_MODEL` for everything — **no 3.7-flash, no OpenRouter, no outline/write stages**.
- `STUDY_PIPELINE=legacy` (read in `src/lib/study-items.ts`, `resolveStudyPipelineMode`) restores
  the coverage-planner study generator.

Everything else stays: source compression, the abort/checkpoint/guard cost fixes (the checkpoint
cache and generation guard are keyed by stage names the legacy path simply doesn't emit — they
become inert, not broken), failure alerting, OCR models.

Caveats:

- Notes written by the legacy flow carry no `knowledgeItems` in `model_metadata`, so deck
  generation for those lectures falls back to its own extraction (that was always the legacy
  behaviour; it is metered and, for content-mode lectures generated earlier, unaffected).
- The legacy prompts predate the 2026-08 learning-science prompt work; expect the pre-switch
  note style back, verbatim.

## Rollback option B — keep the new flow, drop only the expensive writer

If the complaint is specifically the 3.7-flash write cost, keep the content flow and pin the
writer to a cheaper model:

```
GEMINI_NOTE_WRITE_MODEL=gemini-3.5-flash-lite
```

(Stage env keys live in `src/lib/ai/model-config.ts`; any stage can be pinned the same way —
`GEMINI_NOTE_EXTRACT_MODEL`, `GEMINI_NOTE_OUTLINE_MODEL`, `GEMINI_COVERAGE_MODEL`,
`GEMINI_STUDY_ITEMS_MODEL`, `GEMINI_CHAT_MODEL`.) Expect the measured 92–94% recall of
3.5-flash-lite instead of 3.7's 100%; do not pin the writer to 2.5-flash-lite (43% collapse).

Unsetting `OPENROUTER_API_KEY` is **not** a rollback lever — it only forfeits the ~50% gateway
discount and moves the same 3.7 calls to Google at double the price.

## Rollback option C — git revert (last resort)

Reverting main to `0ed8738` would also discard the compression layer, the cost fixes, and the
failure alerting. Don't. If code-level rollback is ever truly needed, revert the specific merge
(`git revert -m 1 8375997`) and resolve forward — but option A achieves the same generation
behaviour with none of the collateral.

## How to compare cost/quality before deciding

- Cost: aggregate `ai_usage_events` by day × `stage` × `model` (estimated_cost_usd is per call).
  The old flow shows up as `gemini_structured_text`; the new one as
  `note_extract` / `note_outline` / `note_write` / `study_items`.
- Quality: `scripts/note-eval.mjs` and `scripts/study-eval.mjs` run both modes against the same
  fixtures — re-run them rather than re-arguing from memory.
