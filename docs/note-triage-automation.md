# Unfinished-note triage

The product promise is that a note always comes out when a learner gives us anything they could
reasonably study from. This automation watches that promise in production.

## What it does

`.github/workflows/note-triage.yml` runs every six hours (and on demand):

1. **Scan** (`scripts/note-failure-scan.mjs`): every note that failed since the last complete scan,
   including the ones the learner has since deleted (their material survives in
   `generation_failure_captures` for 30 days), and every note stuck mid-pipeline for over two hours.
   The scan reads production with the service-role key, pulled from Vercel at run time; no database
   secret is stored in GitHub.
2. **Download and replay** (no AI agent involved): each new finding's captured material is downloaded
   and replayed against current `main` with `scripts/replay-failed-note.mjs <lectureId>`. Then the
   production key is deleted from the runner.
3. **Reproduce and fix** (`.claude/skills/note-triage/SKILL.md`): Claude, holding only the model
   keys (it reads learners' material, which is untrusted input, so it never has database access),
   reads the replays, looks at the material, and decides:
   - `correct`: there was truly nothing learnable (a blank form, silence, a login wall);
   - `fixed-on-main`: current code already turns it into a note;
   - `open-pr`: our bug, fixed on its own branch with a PR (one per root cause), proven by replaying
     the same lecture on the branch;
   - `needs-human`: not reproducible, or the fix needs a migration.
4. **State**: `NOTE_TRIAGE_STATE` (cursor) and `NOTE_TRIAGE_BACKLOG` (lecture ids, verdicts, PR links)
   are repository Actions variables. The cursor only advances after a complete scan whose findings were
   triaged (a disabled or failed fixer holds it; the lookback is capped at a week). The backlog is
   trimmed to stay under the 48 KB variable limit.

It never merges, never pushes to `main`, never writes to production and never re-runs a learner's
note. Learner material never enters git or a PR: replays write to `/tmp`, PRs refer to lecture ids.

## Replaying a failure by hand

```bash
node --experimental-strip-types scripts/replay-failed-note.mjs <lectureId>
```

Needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` and
`OPENROUTER_API_KEY` (the main checkout's `.env.local` has all four; it points at production, and the
script only reads). It prints the reading attempts (with Gemini's finish reasons: `RECITATION` means a
verbatim copy was withheld), the verdict, and where it wrote the material and the note.

For thin material without a lecture, `scripts/topic-notes-eval.mjs <cases.json>` runs the same note
pipeline over hand-written cases.

## Switches

- `NOTE_TRIAGE_FIXER_ENABLED=false` (repository variable): scan and summarise only, no Claude run.
- `workflow_dispatch` inputs: `since` (re-read a window without moving the cursor), `dry_run`,
  `max_fixes` (default 3).

## Background

Built after the review of the week to 26 Sep 2026: 47 of 437 notes failed, and most were ours —
textbook photos withheld as RECITATION, uploads whose files had arrived, exercise sheets and spoken
questions refused as "no study content", PDF and ChatGPT links we could have read. See the PR that
added topic notes, the restate readers and upload salvage.
