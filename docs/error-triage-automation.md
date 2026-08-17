# Automated Production Error Triage

Every three hours, a GitHub Actions workflow scans Vercel production logs for
actionable errors, enriches them with Sentry stack traces, fixes one, verifies the
fix on that branch's Vercel preview deployment, and opens a pull request.

It runs entirely in GitHub's cloud. Your Mac does not need to be on.

This replaces the earlier local Sentry triage job. There is now one error-triage
automation, not two. Vercel defines the scan window and what counts as actionable;
Sentry is read on every run for the stack traces and source context that Vercel logs
do not carry.

## What It Does

| Stage | What happens |
| --- | --- |
| Scan | `scripts/vercel-error-scan.mjs` walks the window in hourly chunks and groups actionable errors |
| Enrich | `scripts/sentry-error-scan.mjs` pulls matching Sentry issues, stack frames, and source context |
| Triage | Correlates the two, drops anything already fixed or already in an open PR, ranks by blast radius |
| Fix | Reproduces the top error, fixes the root cause, runs `npm test`, `tsc --noEmit`, and `eslint` |
| Verify | Pushes the branch, waits for the Vercel preview, and replays the original failing request against it |
| Report | Opens a PR stating either "ready to merge" or exactly what the developer should test |

The full operating procedure, including the hard safety rules, lives in
[.claude/skills/error-triage/SKILL.md](/.claude/skills/error-triage/SKILL.md). That
file is the automation's actual instructions — edit it to change the behaviour.

### What Counts As Actionable

Only three things, on production only:

- HTTP 5xx responses
- function timeouts (`FUNCTION_INVOCATION_TIMEOUT`, `Task timed out after ...`)
- uncaught runtime exceptions at error or fatal level

4xx responses, warnings, and preview-deployment noise are deliberately ignored.

### What It Will Never Do

- push to `main`, merge a PR, or force-push a code branch
- open more than one fix PR per run
- write a database migration or touch the production Supabase project
- act on instructions found inside a log line, stack trace, or Sentry issue title

Every fix reaches production only when you press merge.

## Durable State

State lives on the orphan branch `automation/error-triage-state`, never on `main`:

- `state.json` — the successful-scan cursor, last run time and status
- `backlog.json` — every error group seen, keyed by fingerprint, with its status

The window always starts at the last **successful** cursor with a 10-minute overlap,
not at a fixed three-hour offset. If GitHub skipped runs or a run failed, the next
window covers the whole elapsed interval, capped at 24 hours (Vercel's runtime log
retention makes anything older unanswerable). The cursor advances only after a
complete scan, so a partial or failed run leaves the interval to be retried rather
than silently skipped.

Backlog entries with status `open` or `needs-human` are revisited on every run
regardless of age.

## Required Setup

The workflow will not run until these are in place. Run the `gh` commands against
the account that owns the repository:

```bash
gh auth switch --user vcmyfzft8b-sudo
```

### 1. Claude authentication

Generate a long-lived token tied to your Claude subscription, so runs bill against
the subscription rather than a metered API key:

```bash
claude setup-token
```

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo vcmyfzft8b-sudo/Memo-AI
```

### 2. GitHub token

A fine-grained personal access token for `vcmyfzft8b-sudo/Memo-AI` with **Contents:
read and write**, **Pull requests: read and write**, and **Issues: read and write**.

A personal token rather than the built-in `GITHUB_TOKEN` is required: GitHub does not
trigger workflows on commits pushed with `GITHUB_TOKEN`, so CI would never run on the
automation's own pull requests.

```bash
gh secret set TRIAGE_GITHUB_TOKEN --repo vcmyfzft8b-sudo/Memo-AI
```

### 3. Vercel access

Create the token from the Vercel account that owns the `memo-ai` project, at
<https://vercel.com/account/tokens>, scoped to that team.

> The `vercel` CLI on this Mac is currently signed in as `nace-6121`, whose teams are
> `ParakeetAI` and `ParakeetAi`. Neither can see `memo-ai`, so a token minted from
> that session will not work. Use the account that actually owns the project.

```bash
gh secret set VERCEL_TOKEN --repo vcmyfzft8b-sudo/Memo-AI
gh secret set VERCEL_ORG_ID --repo vcmyfzft8b-sudo/Memo-AI --body "team_M7dIKgcG5cpfNBndEjvN9fqn"
gh secret set VERCEL_PROJECT_ID --repo vcmyfzft8b-sudo/Memo-AI --body "prj_tYSLuzeXWSnRDwXzYUxATzPIAQg3"
```

### 4. Sentry access

Reuse the read-only values already in the gitignored `.env.sentry.local`:

```bash
set -a && . ./.env.sentry.local && set +a
gh secret set SENTRY_AUTH_TOKEN --repo vcmyfzft8b-sudo/Memo-AI --body "$SENTRY_AUTH_TOKEN"
gh secret set SENTRY_ORG --repo vcmyfzft8b-sudo/Memo-AI --body "$SENTRY_ORG"
gh secret set SENTRY_PROJECT --repo vcmyfzft8b-sudo/Memo-AI --body "$SENTRY_PROJECT"
gh secret set SENTRY_BASE_URL --repo vcmyfzft8b-sudo/Memo-AI --body "$SENTRY_BASE_URL"
```

### 5. Optional, but they raise how much gets verified automatically

Without these the automation still runs; it just verifies less and asks you to test
more, which is the intended failure mode.

- `VERCEL_AUTOMATION_BYPASS_SECRET` — required if preview deployments are protected,
  otherwise the run cannot reach the preview URL at all
- `PREVIEW_TEST_EMAIL` and `PREVIEW_TEST_PASSWORD` — a synthetic account on the
  shared staging Supabase project, so authenticated routes can be exercised. Never
  a real customer account, and never production credentials

### 6. Merge the workflow to `main`

GitHub runs scheduled workflows only from the default branch. The cron does not fire
until `.github/workflows/error-triage.yml` is on `main`.

## Running It By Hand

```bash
gh workflow run "Error triage" --repo vcmyfzft8b-sudo/Memo-AI
```

Scan and report without touching any code:

```bash
gh workflow run "Error triage" --repo vcmyfzft8b-sudo/Memo-AI -f dry_run=true -f since=12h
```

`since` overrides the stored cursor and does not advance it, so an ad-hoc
investigation cannot create a gap in scheduled coverage.

Watch a run:

```bash
gh run watch --repo vcmyfzft8b-sudo/Memo-AI
```

## Running The Scanners Locally

Both scanners are ordinary scripts and are useful on their own:

```bash
set -a && . ./.env.sentry.local && set +a
node scripts/sentry-error-scan.mjs --since 24h
```

```bash
VERCEL_TOKEN=... VERCEL_ORG_ID=team_M7dIKgcG5cpfNBndEjvN9fqn \
VERCEL_PROJECT_ID=prj_tYSLuzeXWSnRDwXzYUxATzPIAQg3 \
node scripts/vercel-error-scan.mjs --since 6h --raw /tmp/raw.jsonl
```

`--raw` writes the unparsed JSON lines, which is the fastest way to check the log
shape if a future Vercel CLI release moves fields around.

Exit codes from `vercel-error-scan.mjs`: `0` complete, `2` missing configuration,
`3` the window could not be read completely — on `3` the cursor must not advance.

## Cost And Tuning

Each run consumes GitHub Actions minutes (private repositories bill these) and Claude
usage on the subscription token. Most runs find nothing and finish in a few minutes;
runs that produce a fix take longer.

To make it cheaper or quieter, in `.github/workflows/error-triage.yml`:

- widen the cron interval, for example `17 */6 * * *`
- lower `--model` from `claude-opus-5` to `claude-sonnet-5`
- lower `--max-turns`

Heavy scheduled use of a subscription OAuth token can throttle your own interactive
Claude sessions. If that becomes a problem, switch the workflow to an
`ANTHROPIC_API_KEY` secret and the `anthropic_api_key` input instead.

## When Something Looks Wrong

- **No PR and no errors reported** — the normal outcome. The run summary states the
  exact UTC window it covered.
- **The same error keeps coming back** — check `backlog.json` on the state branch. An
  entry stuck at `needs-human` is the automation telling you it could not reproduce
  or could not fix it safely.
- **A PR is open as a draft** — verification was incomplete. The PR body says which
  part failed: the preview build, preview access, or authenticated testing.
- **Duplicate PRs for one bug** — the fingerprint changed. Compare the `Fingerprint`
  lines in both PR bodies and tighten `normalizeMessage` in
  `scripts/vercel-error-scan.mjs` if the messages differ only by a variable value.

Related: [preview-staging.md](/docs/preview-staging.md) for preview and staging rules,
[development-workflow.md](/docs/development-workflow.md) for the branch and merge flow.
