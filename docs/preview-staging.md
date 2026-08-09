# Preview, Staging, And Database Migrations

This document is the source of truth for how Memo AI pull requests use Vercel Preview Deployments and the shared Supabase staging database.

## Environment Map

| Environment | Application | Supabase | Data policy |
| --- | --- | --- | --- |
| Production | `main` at `https://memoai.eu` | Project `zrcwmhuwwvguiekzmcdj` | Real production data |
| Preview | One unique Vercel URL per PR | Persistent branch `staging`, project ref `yviipoccwsndxyrhtcjm` | Synthetic test data only |
| Local | Local branch on the developer machine | Local Supabase stack | Local seed or synthetic data only |

The staging branch is a separate Supabase environment. It has its own Auth, REST, Storage, database, and API credentials. It must never be created with `--with-data` or populated from production customer data.

## Rules For Every PR Preview

1. Push the PR branch and wait for its own Vercel Preview Deployment.
2. Use that PR's Preview URL; never substitute `https://memoai.eu` or another PR's deployment.
3. The deployment must inherit the global Vercel Preview values for:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Do not create branch-specific overrides for those three variables.
5. Keep production credentials, real payment methods, production webhooks, customer messages, and customer data out of Preview.
6. Use a synthetic test account and identify test records with the PR or Sentry issue number when practical.
7. Test the public page, `/api/health`, and the complete user flow affected by the PR.
8. If safe test credentials for an affected integration are unavailable, keep the PR draft and state exactly which integration cannot be tested.

Vercel environment changes affect new deployments only. Redeploy the PR after correcting Preview configuration.

## Sentry Automation And Missed Runs

The local Sentry automation is scheduled every two hours, but it uses a durable successful-scan cursor rather than assuming every scheduled run happened.

- normally the next window is approximately two hours
- if the Mac was off for one run, the next window is approximately four hours
- longer outages produce a correspondingly longer catch-up window
- the query includes a 10-minute overlap and deduplicates Sentry event and issue IDs
- unresolved actionable issues without a fix PR remain in the backlog and are revisited even when their latest event is older than the current window

The cursor advances only after all required Sentry pages for the interval were retrieved and triaged. A failed or partial Sentry query leaves the cursor unchanged so the next run retries the interval. Staging or Preview failures are tracked separately and do not erase successful Sentry coverage.

Reports state the exact UTC start and end plus the human-readable covered duration. A normal no-bug report says no new or regressed production bugs were found in the last two hours; after missed runs it states the actual four-hour, six-hour, or longer interval.

## Safe Staging Verification

Staging is a branch under the production Supabase project, not a top-level project. Discover it with:

```bash
supabase branches list \
  --project-ref zrcwmhuwwvguiekzmcdj \
  --output json
```

Select the branch named `staging` and confirm its project reference is `yviipoccwsndxyrhtcjm`. `FUNCTIONS_DEPLOYED`, `HEALTHY`, and `ACTIVE` are accepted healthy states.

Do not decide that staging is missing because it does not appear in `supabase projects list`.

For Vercel, inspect environment-variable names, targets, branch scopes, and types. It is acceptable to retrieve only the public `NEXT_PUBLIC_SUPABASE_URL` by its exact environment-variable ID and compare it in memory with:

```text
https://yviipoccwsndxyrhtcjm.supabase.co
```

Output only the comparison result. Never retrieve or print the Preview anon key, service-role key, database connection string, or a broad environment dump.

## Auth Email Configuration For Preview Sign-In

The app signs users in with an email code: `/auth/email` requests a one-time
password and `/auth/email/verify` exchanges the typed code for a session. That
flow only works when the Supabase project sends an email containing the
`{{ .Token }}` placeholder.

Supabase stores email templates per project, and the staging branch does not
inherit them from production. A branch that was never configured falls back to
Supabase's default magic-link email ("Your sign-in link"), which contains a
link and no code, so Preview sign-in cannot complete.

The repository is the source of truth:

- subjects and OTP length and expiry live in `supabase/config.toml`
- bodies live in `supabase/templates/magic-link.html` and
  `supabase/templates/confirmation.html`

`supabase/config.toml` only configures the local stack, so hosted projects are
updated with the Management API sync script:

```bash
SUPABASE_ACCESS_TOKEN=... npm run supabase:auth-emails -- \
  --project-ref yviipoccwsndxyrhtcjm
```

Add `--dry-run` to print the pending changes without writing them. The script
reads the project's current auth config, sends only the keys that differ, then
reads the config back and fails if a required template did not apply. It
refuses to write to the production project unless `--allow-production` is
passed, and it only sends email-related keys, so `site_url`, the redirect
allow list, and provider settings are left untouched.

### Token Handling

A Supabase personal access token can administer every project on the account,
so it is never stored as a repository-wide secret that any branch push could
read. There are two supported ways to run the sync:

- locally, with a token created for the task and revoked afterwards at
  https://supabase.com/dashboard/account/tokens
- from `main`, through
  `.github/workflows/supabase-staging-auth-config.yml`, which reads
  `SUPABASE_ACCESS_TOKEN` from the branch-protected `Production` GitHub
  environment

The workflow runs on a push to `main` that touches the templates, the config,
or the script, and can also be dispatched manually from `main` with a different
project ref. Because the token lives in a protected environment, the workflow
cannot run from an unmerged branch; configure a project before merge with the
local command above.

Staging has no custom SMTP, so it uses Supabase's built-in sender. That sender
only delivers to project team member addresses and is rate limited to a couple
of messages per hour, which is enough for manual Preview testing. To point
staging at a real provider, export `SUPABASE_SMTP_HOST`, `SUPABASE_SMTP_PORT`,
`SUPABASE_SMTP_USER`, `SUPABASE_SMTP_PASS`, `SUPABASE_SMTP_ADMIN_EMAIL`, and
`SUPABASE_SMTP_SENDER_NAME` before running the script. Never commit those
values.

## Keeping Staging Aligned With Production

The scheduled Sentry workflow synchronizes staging from a clean `origin/main` worktree before each two-hour triage run:

1. fetch `origin/main`
2. obtain the staging branch connection without printing it
3. run `supabase db push` against staging from the clean `main` worktree
4. do not include seed data
5. verify Auth, REST, and Storage health
6. confirm that no branch-specific Vercel Supabase override exists

This keeps staging aligned with the migration files already released on `main`, without copying production records. Because the scheduler runs locally, synchronization resumes on the next run if the Mac was off.

## Creating A Database Migration

Never make a schema change only in staging or production. The reviewed migration file is the deployable artifact.

```bash
supabase migration new short_description
```

Add the SQL to the new file under `supabase/migrations`, then replay the complete local chain:

```bash
supabase start
supabase db reset --no-seed
```

Commit the migration with the application code that requires it. Prefer backward-compatible changes so the old production application and the new Preview code can both operate safely during deployment.

## Testing A Migration On Shared Staging

Shared staging normally matches `main`. Applying an unmerged PR migration makes it temporarily differ from production and can affect other PR tests. Therefore:

- serialize database-changing PR tests; only one may use shared staging at a time
- apply only the reviewed migration file from that PR
- never author the final change directly in the staging dashboard
- never run `db reset` against a remote staging or production URL
- if the PR is abandoned or its migration changes incompatibly, recreate or restore staging from the `main` migration baseline before other PR testing continues

Code-only PRs continue to use staging normally. If concurrent remote testing of incompatible migrations is required, use a temporary isolated Supabase branch after explicit cost approval.

## Applying Migrations To Production

Merging a migration file by itself is not enough; the production database must apply it. The repository workflow `.github/workflows/supabase-migrations.yml` handles this step.

On a push to `main` that changes `supabase/migrations/**`, the workflow:

1. checks out the merged `main` commit
2. loads the official Supabase CLI
3. performs a migration dry run
4. runs `supabase db push` against production
5. does not include seed data

The Supabase access token and public production project ID are stored as `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` in GitHub's `Production` environment. The CLI uses them to link the project and initialize a short-lived database login role; a long-lived database password or connection string is not stored in GitHub. The `Production` environment accepts deployments from `main` only, and pull-request jobs do not receive either environment value.

Treat the release as incomplete until the `Supabase production migrations` workflow passes. If it fails, inspect the migration and history mismatch. Do not automatically use `supabase migration repair`, modify production in the dashboard, or mark the workflow successful without resolving the underlying cause.

## Required PR Notes For Database Changes

The PR description must include:

- migration filename and purpose
- compatibility and locking risk
- local replay result
- whether shared staging was used and how it was restored
- rollback or forward-fix strategy
- production migration workflow status after merge
