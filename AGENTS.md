# Project Instructions

- Production domain: `https://memoai.eu` is the canonical live app domain.
- When adding or updating hardcoded production URLs, use `https://memoai.eu`, not legacy Vercel domains.
- Prefer `NEXT_PUBLIC_SITE_URL` or another central config for app URLs when the target supports configuration.
- Treat `notetakingappslo.vercel.app` as deprecated unless a task explicitly requires it.

## Git And Deployment Workflow

- Use a single GitHub repository for this project. Do not create a second repo for testing work.
- Treat `main` as the production branch. Only production-ready code should be merged into `main`.
- The primary checkout (`/Users/nacevalencic/dev/Memo_AI` on this Mac) is reserved for a clean local `main` that matches GitHub `origin/main`. Never use it for task edits or switch it onto a feature branch.
- Start every new work session in a fresh, isolated Git worktree with a descriptive task branch based on the latest `origin/main`, before making code changes. Keep all edits and local testing for that session in its worktree; do not reuse another session's checkout or branch.
- This applies to every new task/thread, including documentation, reviews that require edits, and tasks launched from inside an existing worktree. Fetch first; do not call a cached `origin/main` current if the fetch fails. Create sibling worktrees, not nested worktrees. If the app already created a worktree dedicated to this task, use it and create a descriptive branch there before editing; preserve any user-selected starting state.
- Branch names should be descriptive, for example: `fix/login-redirect`, `feature/flashcards-export`, `chore/update-copy`.
- Continue an existing session in its assigned worktree and branch. Only reuse a different checkout or branch when the user explicitly asks.
- Concurrent tasks must stay isolated: run every file edit, Git command, install, build, and test from that session's worktree. Use a free, task-specific port for each dev server, and keep `.next`, test artifacts, and local environment files in that worktree. Do not mutate a dependency directory shared with another task.
- Never switch, reset, stash, clean, delete, or commit another task's checkout or branch, and never stop its processes. Stop only servers started by the current session. Do not remove another task's worktree or branch, including during PR merge cleanup.
- Git worktrees share repository refs: fetch updates normally, but integrate `origin/main` only into your own task branch. Check the final PR diff contains only the current task's intended changes before pushing or merging.
- Synchronizing the designated clean `main` checkout is the sole routine cross-worktree exception: at task start and after an authorized PR merge, fetch `origin`, verify that checkout is on `main` with no tracked or untracked changes, then run `git -C <main-checkout> merge --ff-only origin/main`. Serialize concurrent syncs. Verify `main` and `origin/main` have identical commit IDs and the checkout is clean. If it is dirty, on another branch, or divergent, preserve it and report the problem; never reset, stash, or force-update it to make the check pass.
- Keep other task worktrees on their own branches after a merge. A GitHub merge does not update local files automatically. To incorporate production changes into an ongoing task, merge the freshly fetched `origin/main` inside that task's worktree, resolve conflicts there, and rerun affected checks. Prefer merging over rewriting a published branch; never force-push without explicit authorization.
- A task branch that has been squash-merged remains historical work. Start a new task from current `origin/main`; do not reuse the merged branch or create substitute production branches such as `main-latest`.
- Test changes locally first with the normal local development workflow.
- After local testing, agents may prepare commits on the branch, but they must not push to GitHub unless the user explicitly asks for that push.
- The user is the default person responsible for pushing branches to GitHub and opening or merging pull requests.
- Use Vercel Preview Deployments to test branch work on the web before merging to `main`.
- Do not treat a Vercel preview URL as the production URL. Production remains `https://memoai.eu`.
- Merge to `main` only after the branch has been checked locally and in its Vercel preview deployment.
- After an authorized merge, synchronize local `main` as above and verify the production deployment separately. Report the local/GitHub commit IDs and deployment status accurately; a successful Git sync alone does not prove that Vercel has deployed the commit. See [docs/development-workflow.md](docs/development-workflow.md) for commands and conflict handling.

## Web And iOS App Parity

The iOS app (`ios/`) is a WKWebView wrapper around the same web app, so **every change to the
web app is a change to the iOS app**. Do not ship a feature, redesign, copy change or UI/UX fix
to one and not the other: build it once in `src/`, then check it under both user agents.

- **Same product on both.** New features, design changes, layout and flow updates apply to the
  browser and to the app alike. The app must never fall behind the web (or the other way round);
  if a change cannot work in the app yet, say so in the PR rather than hiding it from one side.
- **The only deliberate differences are the platform ones**, and they are switched by the
  `MemoAI-iOS` user agent, never by anything the client can claim:
  - **Billing.** Browsers buy through Stripe Checkout and manage plans in the Stripe portal. The
    app buys through StoreKit (`useAppleBilling`, verified by `/api/mobile/transactions`) and
    manages plans through Apple. Browsers never see Apple billing, restore or Apple terms; the app
    never sees Stripe, a checkout link, a portal link or a Stripe price. The web wheel awards a
    Stripe coupon; the app's wheel shows Apple's introductory offer. Both are once a day.
  - **Sign-in.** Google and Apple use native flows in the app (`/api/mobile/google-auth`,
    `/api/mobile/apple-auth`) and Supabase OAuth on the web. E-mail sign-in is by code on both;
    there is no password screen. App Review's synthetic accounts use a fixed code
    (`APP_REVIEW_ACCOUNT_EMAILS` / `APP_REVIEW_LOGIN_CODE`).
  - **Chrome.** The app has no landing page, no back arrow on sign-in, no install guide, and lays
    out edge to edge under `--memo-safe-top/bottom` (`html[data-native]`). Anything fixed near a
    screen edge needs the inset. Support articles lead with App Store instructions in the app.
- **How to check.** Run `tests/mobile-*.test.mjs` (they fail if Stripe leaks into the app or
  Apple into the web), and for anything touching billing, login, the home dock or a sheet, load
  the preview with both user agents (`curl -A "... MemoAI-iOS/1.0"` is enough for server output;
  the simulator against the preview for layout — see `docs/ios-app.md`).
- **Prices.** Web prices live in `src/lib/billing.ts` (EUR). Apple prices live in App Store
  Connect and reach the app through StoreKit; the paywall never hardcodes them. Keep the two
  aligned when either changes (Apple has no exact €20/€130 points, so the app shows the nearest:
  €19.99/€129.99, and $19.99/$129.99 with $9.99/$64.99 first periods in the US storefront).

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
- Follow [docs/preview-staging.md](/docs/preview-staging.md) for safe verification, staging synchronization, migration testing, and production release rules.

## Migrations: never push one from an unmerged branch

Read this before adding a file to `supabase/migrations`. On 2026-09-04 three feature branches
each wrote to production's migration history from an unmerged branch and cost an afternoon.

- **Never run `supabase db push` against production from a branch.** Production migrations are
  applied by `.github/workflows/supabase-migrations.yml` from `main`, after merge, and by nothing
  else. A push from a branch records a version `main` does not have, and **a single remote version
  with no local file aborts every later push from every branch** — one branch's shortcut blocks
  the whole team.
- **Never `supabase migration repair --status applied`.** It marks a version as done without
  running its SQL, so that migration is skipped for good and its table is never created. This is
  what happened to `0044`, `0045` and `0046`; each looked applied and none of them was. Repair is
  only ever right in the other direction — `--status reverted`, for a record whose SQL provably
  never ran, so the migration can apply properly on merge.
- **Claim your number before you write the file**, because Supabase keys history by the number
  alone and two branches taking `0043` means the second can never apply:
  `ls supabase/migrations | sed 's/_.*//' | sort | uniq -d` and check the open PRs. Renumber the
  file no database has recorded; never renumber one that is already live.
- **To check whether a migration really applied**, read the live schema rather than the history:
  `GET /rest/v1/<table>?select=*&limit=0` with the service-role key is 200 if the table exists and
  404 if not, and `GET /rest/v1/` returns every table and column production actually has. Verify a
  known-applied migration's table first — a wrong guess at a table's *name* also returns 404.
- Background and the full incident: [docs/mindmap.md](/docs/mindmap.md) and the two collisions it
  cites.

## Automated Production Error Triage

- One automation covers production errors: the `Error triage` GitHub Actions workflow, scheduled every three hours. It runs in GitHub's cloud and does not depend on the Mac being on. The earlier local two-hourly Sentry job is retired; do not recreate it.
- Vercel production logs define the scan window and what counts as actionable: 5xx responses, function timeouts, and uncaught runtime exceptions. Sentry is read on every run to enrich those findings with stack traces and source context, and to catch client-side exceptions that never produce a 5xx.
- The query window must start at the last successful scan cursor, not at a fixed three-hour offset. If runs were skipped, the next window covers the full elapsed interval, with a 10-minute overlap and record deduplication, capped at 24 hours.
- Advance the cursor only after a complete scan and triage succeed. Keep actionable errors without a dedicated fix PR in the durable backlog and revisit them on every run regardless of age.
- A staging, Preview, CI, or implementation failure must not create a gap in error coverage or cause a completed interval to be scanned as if it failed.
- The automation fixes every actionable error in the window, giving each its own branch and its own pull request so they can be reviewed and reverted independently. A run is bounded by `TRIAGE_MAX_FIXES` (default 5) and the job timeout; anything not reached is deferred to the backlog and named explicitly in the run summary.
- The automation opens pull requests and never merges them. It must not push to `main`, stack one fix branch on another, or write a database migration.
- The operating procedure is [.claude/skills/error-triage/SKILL.md](/.claude/skills/error-triage/SKILL.md); setup and troubleshooting are in [docs/error-triage-automation.md](/docs/error-triage-automation.md).

## Lecture Pipeline And Inngest Steps

- Production runs the lecture pipeline as Inngest functions, one stage per step. Previews and local runs take the internal HTTP routes instead and never cross a step boundary, so **a Vercel preview does not verify an Inngest change** — the general "check it on the preview before merging" rule does not cover this area. Verify on production right after the merge, and do not claim preview coverage the deployment did not provide.
- Inngest hashes a step's id from its name alone, so a deploy that lands mid-run replays completed steps from state written by the previous code. Giving an existing step a return value therefore breaks runs already in flight: a step that returned nothing replays as `null`, not `undefined`. Make the consumer tolerate the old shape. Renaming a step is the same trap in reverse — it re-runs, and for `transcribe-lecture` that means paying to transcribe twice.
- Classify a failure that is the user's file rather than our bug on the throwing side of the step, via `runLectureStage`. Inngest flattens a failed step's error to `{ name: "Error", message, stack }`, so `isExpectedLectureInputFailure` cannot recognise anything once the function body's `catch` has it, and an expected failure ends up in Sentry and fails the run.
- Details, the production check-list and the two incidents behind these rules are in [docs/lecture-pipeline-inngest.md](/docs/lecture-pipeline-inngest.md).

## Mindmap

- The mindmap is generated the first time somebody opens its tab and stored whole as one `jsonb`
  document. A note that fits one call gets one call; a longer one has its **topics** planned once
  over a skeleton of the whole note and only its **filling** windowed. Never split the topics per
  chunk — chunks that each choose their own merge into several maps sharing a title.
- Coverage is the point. There is no length cap on what gets mapped any more; if you add one back,
  you have re-introduced the bug the windowing was written to fix.
- Nothing is warmed ahead of time. Opening the tab is free when the note has not changed (the
  stored `notes_hash` decides); "draw again" is the only control that always spends.
- The opening fold, not the fit, is what makes a map readable. `suggestMindmapFold` measures
  against `MINDMAP_REFERENCE_FRAMES`, which are measured stage sizes — re-measure them if the
  note screen's chrome changes rather than adjusting them by eye.
- Layout lives in `src/lib/mindmap-layout.ts` and `src/lib/mindmap-tidy.ts` (van der Ploeg's
  non-layered tidy tree), is pure, and is shared by the canvas, the PNG export and its tests. Put
  new layout rules there, never in the component.
- **Nothing about the layout may depend on what is currently folded except which nodes exist.**
  Which side a branch sits on is weighed over the whole branch, folded parts included, so that
  opening one topic cannot fling another across the middle.
- Opening is a tap on the node; folding is the badge or the detail card, never a tap. Nothing on
  the map is ever dimmed by a selection — only a search dims, and only what it did not match.
- Details are in [docs/mindmap.md](/docs/mindmap.md).

## Admin Dashboard

- The admin dashboard is at `/admin`, gated by the `public.admin_users` email allowlist rather than a role on the user account. `PREVIEW_AUTH_BYPASS` deliberately does not open it.
- Its tables are service-role only: RLS is enabled with no policies, and every read and write goes through the server after the allowlist check. Server actions re-check the allowlist themselves.
- TikTok per-video stats come from Apify and are billed per post scraped, so the cron frequency and `UGC_SYNC_POSTS_PER_PROFILE` are cost decisions, not just tuning.
- Reporting days are Europe/Ljubljana everywhere, in both the SQL aggregates and `src/lib/admin/ranges.ts`. Do not bucket a date by UTC in this area.
- Setup, cost, detection rules and the limits of historical backfill are in [docs/admin-dashboard.md](/docs/admin-dashboard.md).

## Design rules

Read [docs/design-system.md](/docs/design-system.md) before any UI change. In short:

- New UI goes in the `.memo` layer (`src/app/redesign.css`). `globals.css` is
  legacy — do not extend it. `onboarding.css` reuses the redesign's token names
  with different values; do not assume a name means the same colour there.
- Never type a raw colour. Use a token. A new token that changes between
  appearances must be added to the `.memo` block **and both** dark blocks
  (`:root[data-theme="dark"]`, and the `prefers-color-scheme: dark` block that
  covers unset and `data-theme="system"`).
- Reuse an existing `.memo-*` component before writing CSS. New classes are
  `.memo-*` and live in `redesign.css`, not in a component file.
- One primary action per screen, and it is coral. Ink confirms; periwinkle
  upsells. They never appear in the same row.
- Hover marks an edge (`inset 0 0 0 1px var(--hover-ring)`), never a lift. Focus
  goes on the container via `--focus-ring`, never the browser outline.
- Snap to the existing scales: radius 12/14/16/18/20/22/26/34/999, the nine type
  sizes, the listed control heights. Do not introduce a new value.
- One structural breakpoint: 1100px. Build the phone layout first; desktop is the
  rail wrapped around it. One scroller per screen, never `scrollIntoView`, never
  a visible scrollbar.
- Every user-facing string comes from the i18n catalogue. No literal copy in a
  component — `tests/i18n-catalogues.test.mjs` checks coverage.
- A new Material Symbols name must be added to `MATERIAL_SYMBOL_NAMES` in
  `src/app/layout.tsx`, or the glyph renders as literal text.
- `prefers-reduced-motion` is handled globally in `globals.css`. Do not
  re-implement it.

## Documentation

- Follow the workflow in [docs/development-workflow.md](/docs/development-workflow.md) for branching, GitHub pushes, Vercel previews, and merging to production.
- Follow [docs/design-system.md](/docs/design-system.md) for tokens, components, layout and the known inconsistencies before changing the UI.
