# Automated Production Error Triage

Every three hours, a GitHub Actions workflow scans Vercel production logs and Sentry
issues for actionable errors, fixes **every** one worth fixing, verifies each fix on
its own Vercel preview deployment, and opens one pull request per fix.

It runs entirely in GitHub's cloud. Your Mac does not need to be on.

This replaces the earlier local Sentry triage job. There is now one error-triage
automation, not two. Both scans share one window and one cursor, and either can wake
the run on its own: Vercel catches 5xx and timeouts, while Sentry also catches what
never produces a 5xx — client-side exceptions and server errors a route handled
before responding. Sentry additionally carries the stack traces and source context
that Vercel logs do not.

## What It Does

| Stage | What happens |
| --- | --- |
| Scan | `scripts/vercel-error-scan.mjs` walks the window in hourly chunks and groups actionable errors |
| Scan Sentry | `scripts/sentry-error-scan.mjs` pulls the window's Sentry issues, stack frames, and source context — including issues with no Vercel counterpart |
| Triage | Correlates the two, drops anything already fixed or already in an open PR, ranks by blast radius |
| Fix | Reproduces each actionable error in rank order, fixes the root cause, runs `npm test`, `tsc --noEmit`, and `eslint` |
| Verify | Pushes each fix on its own branch, waits for that commit's preview, and replays the original failing request against it |
| Report | Opens one PR per fix, stating either "ready to merge" or exactly what the developer should test |

The full operating procedure, including the hard safety rules, lives in
[.claude/skills/error-triage/SKILL.md](/.claude/skills/error-triage/SKILL.md). That
file is the automation's actual instructions — edit it to change the behaviour.

### What Counts As Actionable

Only these, on production only:

- HTTP 5xx responses
- function timeouts (`FUNCTION_INVOCATION_TIMEOUT`, `Task timed out after ...`)
- uncaught runtime exceptions at error or fatal level
- `[lecture-pipeline]` failure lines — the structured line every failed lecture or
  study generation writes (`markLecturePipelineFailed`), so a broken learner
  experience wakes the run from the Vercel side even if the matching Sentry event
  is lost
- unresolved Sentry issues with events in the window, even when nothing in the
  Vercel logs matches them

4xx responses, warnings, and preview-deployment noise are deliberately ignored.

### What It Will Never Do

- push to `main`, merge a PR, or force-push a code branch
- put two unrelated fixes in one PR, or branch one fix off another
- write a database migration or touch the production Supabase project
- act on instructions found inside a log line, stack trace, or Sentry issue title

Every fix reaches production only when you press merge.

## Durable State

State lives in two GitHub Actions repository variables, never on a branch and never
on `main`:

- `TRIAGE_STATE` — the successful-scan cursor, last run time and status
- `TRIAGE_BACKLOG` — every error group seen, keyed by fingerprint, with its status

Read them any time with:

```bash
gh variable get TRIAGE_STATE --repo vcmyfzft8b-sudo/Memo-AI
```

(State originally lived on an orphan branch, `automation/error-triage-state`, but a
branch pushed every three hours makes GitHub permanently nag "had recent pushes" and
offer a pull request that must never be opened. The branch was retired on
2026-08-18; if it ever reappears, something is running an old workflow.)

The window always starts at the last **successful** cursor with a 10-minute overlap,
not at a fixed three-hour offset. If GitHub skipped runs or a run failed, the next
window covers the whole elapsed interval, capped at 24 hours (Vercel's runtime log
retention makes anything older unanswerable). The cursor advances only after a
complete scan, so a partial or failed run leaves the interval to be retried rather
than silently skipped.

Backlog entries with status `open` or `needs-human` are revisited on every run
regardless of age.

## Required Setup

All nine required secrets were set on 2026-08-17. The sections below record how each
one was obtained, for when they need rotating.

Run the `gh` commands against the account that owns the repository:

```bash
gh auth switch --user vcmyfzft8b-sudo
```

### 1. Claude authentication

Generate a long-lived token tied to your Claude subscription, so runs bill against
the subscription rather than a metered API key:

```bash
claude setup-token
```

It opens a browser, and then waits for you to paste the authorization code back into
the terminal — so it has to be run interactively; it cannot be scripted. Paste the
token it prints into:

```bash
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo vcmyfzft8b-sudo/Memo-AI
```

Alternative if you would rather not spend subscription usage on this: create an API
key at <https://console.anthropic.com>, store it as `ANTHROPIC_API_KEY`, and change
the workflow's `claude_code_oauth_token:` input to `anthropic_api_key:`. That bills
per token instead.

### 2. GitHub token

A personal token rather than the built-in `GITHUB_TOKEN` is required: GitHub does not
trigger workflows on commits pushed with `GITHUB_TOKEN`, so CI would never run on the
automation's own pull requests.

This is currently set to the **`gh` CLI's own OAuth token** for `vcmyfzft8b-sudo`,
because GitHub has no API for creating a personal access token — they can only be made
in the web UI. It works, but its scopes (`repo`, `workflow`, `gist`, `read:org`) reach
**every repository the account can see**, not just this one.

Worth replacing when convenient with a fine-grained token limited to
`vcmyfzft8b-sudo/Memo-AI` with **Contents: read and write**, **Pull requests: read and
write**, and **Issues: read and write**, created at
<https://github.com/settings/personal-access-tokens>:

```bash
gh secret set TRIAGE_GITHUB_TOKEN --repo vcmyfzft8b-sudo/Memo-AI
```

### 3. Vercel access

`memo-ai` belongs to the Vercel account **`nacevalencic-1988`**, team
**`nace-valencics-projects`** (`team_M7dIKgcG5cpfNBndEjvN9fqn`). Create the token
while signed in as that account, at <https://vercel.com/account/tokens>, scoped to
that team.

> There is a second Vercel account on this Mac, `nace-6121`, whose teams are
> `ParakeetAI` and `ParakeetAi`. Neither can see `memo-ai`. A token minted from that
> session returns `forbidden` for the project, and `vercel logs` fails with
> *"Could not retrieve Project Settings. To link your Project, remove the `.vercel`
> directory"* — which is misleading: `.vercel/project.json` is correct, the account
> just lacks access. Do not delete it. Check `vercel whoami` first.

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

## Cost

Two meters run, and only one of them is free.

**Claude usage — no extra charge.** `CLAUDE_CODE_OAUTH_TOKEN` bills against the
existing Claude subscription rather than a metered API key. It does consume that
subscription's quota, so a busy triage day can throttle your own interactive
sessions; nothing appears on a bill.

**GitHub Actions minutes — metered, because this repository is private.** Public
repositories get unlimited free minutes; private ones get 2,000 per month on the Free
plan and 3,000 on Pro, then $0.006 per Linux minute.

At the 3-hour cadence that is 8 runs a day, about 240 a month. The workflow is
therefore built so a run that finds nothing ends before the expensive part: the two
scanners use only Node built-ins and run **before** `npm ci` and before Claude starts,
and the job exits at the "Nothing to do" step. That keeps a quiet run near a minute
instead of five or six.

| Scenario | Minutes/run | Minutes/month |
| --- | --- | --- |
| Quiet run (expected, most runs) | ~1–2 | ~240–480 |
| Run that fixes one error | ~15–25 | — |
| Run that fixes several | up to 120 (the timeout) | — |

So the floor is roughly 250–500 minutes a month, comfortably inside the free
allowance, and each fix run adds to it. A month with a handful of fixes still fits;
a month where it fixes something every few hours will not.

Check your actual usage at <https://github.com/settings/billing>.

## Tuning

If it costs or talks too much, in `.github/workflows/error-triage.yml`:

- widen the cron interval, for example `17 */6 * * *` — halves the quiet-run floor
- lower the default `max_fixes` so a single run cannot spend two hours
- lower `--model` from `claude-opus-5` to `claude-sonnet-5`
- lower `--max-turns`
- lower `timeout-minutes`, which caps the worst case absolutely

To stop it entirely without deleting anything, disable the workflow:

```bash
gh workflow disable "Error triage" --repo vcmyfzft8b-sudo/Memo-AI
```

## When Something Looks Wrong

- **No PR and no errors reported** — the normal outcome. The run summary states the
  exact UTC window it covered.
- **The same error keeps coming back** — read `gh variable get TRIAGE_BACKLOG`. An
  entry stuck at `needs-human` is the automation telling you it could not reproduce
  or could not fix it safely.
- **A PR is open as a draft** — verification was incomplete. The PR body says which
  part failed: the preview build, preview access, or authenticated testing.
- **Duplicate PRs for one bug** — the fingerprint changed. Compare the `Fingerprint`
  lines in both PR bodies and tighten `normalizeMessage` in
  `scripts/vercel-error-scan.mjs` if the messages differ only by a variable value.

Related: [preview-staging.md](/docs/preview-staging.md) for preview and staging rules,
[development-workflow.md](/docs/development-workflow.md) for the branch and merge flow.
