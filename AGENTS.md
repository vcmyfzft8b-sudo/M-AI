# Project Instructions

- Production domain: `https://memoai.eu` is the canonical live app domain.
- When adding or updating hardcoded production URLs, use `https://memoai.eu`, not legacy Vercel domains.
- Prefer `NEXT_PUBLIC_SITE_URL` or another central config for app URLs when the target supports configuration.
- Treat `notetakingappslo.vercel.app` as deprecated unless a task explicitly requires it.

## Git And Deployment Workflow

- Use a single GitHub repository for this project. Do not create a second repo for testing work.
- Treat `main` as the production branch. Only production-ready code should be merged into `main`.
- For every new feature, bug fix, refactor, or experiment, create a separate branch before making code changes.
- Branch names should be descriptive, for example: `fix/login-redirect`, `feature/flashcards-export`, `chore/update-copy`.
- Agents should make changes on the current non-`main` branch when one already exists for the task. If work starts on `main`, create a new branch first unless the user explicitly asks otherwise.
- Test changes locally first with the normal local development workflow.
- After local testing, agents may prepare commits on the branch, but they must not push to GitHub unless the user explicitly asks for that push.
- The user is the default person responsible for pushing branches to GitHub and opening or merging pull requests.
- Use Vercel Preview Deployments to test branch work on the web before merging to `main`.
- Do not treat a Vercel preview URL as the production URL. Production remains `https://memoai.eu`.
- Merge to `main` only after the branch has been checked locally and in its Vercel preview deployment.

## Vercel Preview Rule

- Every pushed branch should be expected to get its own Vercel preview deployment when the GitHub repo is connected to Vercel.
- The preview deployment URL is where branch work should be reviewed on the web.
- The custom production domain `https://memoai.eu` should point only to the production deployment from `main`, unless the user explicitly requests a temporary branch domain strategy.

## Preview And Database Environments

- All Vercel Preview deployments must inherit the global Preview Supabase configuration for the shared, data-empty staging branch `yviipoccwsndxyrhtcjm`.
- Production uses Supabase project `zrcwmhuwwvguiekzmcdj`. Never point a Preview deployment or Preview test at that project.
- Do not create branch-specific overrides for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, or `SUPABASE_SERVICE_ROLE_KEY`. A branch override would bypass the shared staging policy.
- Preview testing must use synthetic accounts and data. Never clone production data into staging or use customer data in a Preview.
- Database schema changes must be committed as ordered SQL files in `supabase/migrations`. Do not make an uncaptured schema change in the staging or production dashboard.
- A database-changing PR must replay its migration locally before merge. Shared staging may test an unmerged migration only as a serialized, coordinated exception because it otherwise must match `main`.
- After a migration PR is merged, `.github/workflows/supabase-migrations.yml` applies the migration files from `main` to production. Do not run a production migration from an unmerged PR or a Preview deployment.
- Follow [docs/preview-staging.md](/Users/nacevalencic/Desktop/note_taking_app_slo/docs/preview-staging.md) for safe verification, staging synchronization, migration testing, and production release rules.

## Automated Production Error Triage

- One automation covers production errors: the `Error triage` GitHub Actions workflow, scheduled every three hours. It runs in GitHub's cloud and does not depend on the Mac being on. The earlier local two-hourly Sentry job is retired; do not recreate it.
- Vercel production logs define the scan window and what counts as actionable: 5xx responses, function timeouts, and uncaught runtime exceptions. Sentry is read on every run to enrich those findings with stack traces and source context, and to catch client-side exceptions that never produce a 5xx.
- The query window must start at the last successful scan cursor, not at a fixed three-hour offset. If runs were skipped, the next window covers the full elapsed interval, with a 10-minute overlap and record deduplication, capped at 24 hours.
- Advance the cursor only after a complete scan and triage succeed. Keep actionable errors without a dedicated fix PR in the durable backlog and revisit them on every run regardless of age.
- A staging, Preview, CI, or implementation failure must not create a gap in error coverage or cause a completed interval to be scanned as if it failed.
- The automation fixes every actionable error in the window, giving each its own branch and its own pull request so they can be reviewed and reverted independently. A run is bounded by `TRIAGE_MAX_FIXES` (default 5) and the job timeout; anything not reached is deferred to the backlog and named explicitly in the run summary.
- The automation opens pull requests and never merges them. It must not push to `main`, stack one fix branch on another, or write a database migration.
- The operating procedure is [.claude/skills/error-triage/SKILL.md](/.claude/skills/error-triage/SKILL.md); setup and troubleshooting are in [docs/error-triage-automation.md](/docs/error-triage-automation.md).

## Documentation

- Follow the workflow in [docs/development-workflow.md](/Users/nacevalencic/Desktop/note_taking_app_slo/docs/development-workflow.md) for branching, GitHub pushes, Vercel previews, and merging to production.
