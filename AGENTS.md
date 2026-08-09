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

## Automated Sentry Triage

- The local Sentry automation is scheduled every two hours, but its query window must start at the last successful Sentry scan cursor, not at a fixed two-hour offset.
- If the Mac missed scheduled runs, the next run must cover the full elapsed interval since that cursor, with a small overlap and event/issue deduplication.
- Advance the cursor only after the complete authenticated Sentry query and triage succeed. Keep actionable issues without a dedicated fix PR in the durable backlog and revisit them on every run regardless of age.
- A staging, Preview, CI, or implementation failure must not create a gap in Sentry coverage or cause a completed Sentry interval to be scanned as if it failed.

## iOS

- Memo ships one iOS app: the `WKWebView` wrapper in `ios-web-wrapper/`. The native SwiftUI app is retired; do not reintroduce a second iOS app.
- The wrapper bundles no web assets — it loads `https://memoai.eu`, so every production deploy reaches iOS users immediately, with no App Store release and no App Review.
- Recording is the one native part, because `MediaRecorder` in `WKWebView` cannot survive the screen locking.
- Before changing the web recorder, TTS playback, brand markup, or auth domains, read [docs/ios-wrapper.md](docs/ios-wrapper.md): each has an injected native script that depends on it and fails silently.

## Documentation

- Follow the workflow in [docs/development-workflow.md](/Users/nacevalencic/Desktop/note_taking_app_slo/docs/development-workflow.md) for branching, GitHub pushes, Vercel previews, and merging to production.
