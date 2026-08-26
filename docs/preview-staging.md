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
   **One deliberate exception:** the source material in `generation_failure_captures`
   may be replayed into a Preview to reproduce that captured failure and verify its
   fix — that reproduction is the table's whole purpose. The replay must run under
   the synthetic triage account, be titled with the Sentry issue or PR number, and
   the staging lecture must be deleted once the fix is verified. The material still
   never enters the repo, a PR, a test fixture, or a log line.
6. Use a synthetic test account and identify test records with the PR or Sentry issue number when practical.
7. Test the public page, `/api/health`, and the complete user flow affected by the PR.
8. If safe test credentials for an affected integration are unavailable, keep the PR draft and state exactly which integration cannot be tested.

Vercel environment changes affect new deployments only. Redeploy the PR after correcting Preview configuration.

## Error Triage Automation And Missed Runs

The `Error triage` GitHub Actions workflow is scheduled every three hours. It runs in GitHub's cloud, so the Mac being off no longer skips runs, but it still uses a durable successful-scan cursor rather than assuming every scheduled run happened.

- normally the next window is approximately three hours
- if a run was skipped or failed, the next window covers the full elapsed interval
- the catch-up window is capped at 24 hours, because Vercel runtime log retention is shorter than that
- the query includes a 10-minute overlap and deduplicates Vercel log record IDs and Sentry issue IDs
- actionable errors without a fix PR remain in the backlog and are revisited even when their latest occurrence is older than the current window

The cursor advances only after the interval was retrieved and triaged completely. A failed or partial scan leaves the cursor unchanged so the next run retries the interval. Staging or Preview failures are tracked separately and do not erase successful coverage.

Reports state the exact UTC start and end plus the human-readable covered duration. A normal no-bug report says no new or regressed production errors were found in the last three hours; after missed runs it states the actual six-hour, nine-hour, or longer interval.

Full setup and behaviour: [error-triage-automation.md](/docs/error-triage-automation.md).

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

## Keeping Staging Aligned With Production

Staging must stay aligned with the migration files already released on `main`. Synchronize it from a clean `origin/main` checkout:

1. fetch `origin/main`
2. obtain the staging branch connection without printing it
3. run `supabase db push` against staging from the clean `main` worktree
4. do not include seed data
5. verify Auth, REST, and Storage health
6. confirm that no branch-specific Vercel Supabase override exists

This keeps staging aligned with the migration files already released on `main`, without copying production records. The error-triage automation does not synchronize staging and never writes a migration; a database-changing fix is handed to a human instead.

### The command, and the two things that go wrong

`supabase db push` has **no `--project-ref` flag**. It defaults to `--linked`, and the
linked project is *production*. Targeting staging means passing `--db-url` explicitly,
so never run a bare `supabase db push` while intending to hit staging.

The connection string comes from the branch itself. Take `POSTGRES_URL` (the pooler),
not `POSTGRES_URL_NON_POOLING` — the direct `db.<ref>.supabase.co` host resolves to
IPv6 only and fails with `dial tcp [2a05:...]:5432: connect: no route to host` from a
normal machine. Then move the pooler off its transaction port (`6543`) onto the session
port (`5432`); migrations need session mode.

```bash
URL=$(supabase branches get yviipoccwsndxyrhtcjm --output json | python3 -c "
import sys, json, urllib.parse as u
d = json.load(sys.stdin)
p = u.urlparse(d['POSTGRES_URL'])
assert 'yviipoccwsndxyrhtcjm' in p.username, 'not staging'
print(u.urlunparse(p._replace(netloc=f'{p.username}:{u.quote(p.password, safe=\"\")}@{p.hostname}:5432')))
")

# Refuse to continue if that is not the staging branch.
case "$URL" in *zrcwmhuwwvguiekzmcdj*) echo 'ABORT: production'; exit 1;; esac

supabase db push --db-url "$URL" --dry-run   # always first
supabase db push --db-url "$URL" --yes
```

Keep `$URL` in the shell variable. It carries the staging database password, so do not
echo it, and filter it out of any output you quote: `sed -E 's#postgres(ql)?://[^ ]*#<redacted>#g'`.

The dry run is not a formality — it prints exactly which migrations are missing. If it
lists more than you expect, staging has drifted further than you thought; if it errors
with "Remote migration versions not found in local migrations directory", a remote-only
version is blocking the chain and must be restored as a file rather than repaired.

### History

Staging was synchronized on 2026-08-19, when it was found to be missing `0027`-`0029`
(the admin dashboard schema, shipped in #203). Every preview build of `/admin` had been
returning 500 on `site_sessions` and `ugc_creators` since that PR merged, and the failure
reached Sentry as `MEMOAI-WEB-2P` with a preview URL in it. Production was never affected.

Two things made that slow to diagnose, both worth knowing:

- `scripts/sentry-error-scan.mjs` queries `is:unresolved` with **no environment filter**,
  so preview-only issues reach the triage gate even though the Vercel half of the scan is
  production-only. A Sentry issue is not evidence of a production problem until you have
  checked the URL on the event.
- Nothing about the staging branch appears in `supabase projects list`, which reads as
  "this database is not mine" if you have not read the section above.

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
