# Admin dashboard

The admin dashboard lives at [memoai.eu/admin](https://memoai.eu/admin). It covers the
UGC creator campaign, Stripe sales, site traffic and the user list.

## Access

Access is an explicit allowlist, not a role on the user account.

- `public.admin_users` holds the allowed email addresses. Migration `0027` seeds
  `nace.valencic@gmail.com` as the `owner`.
- Admins sign in through the normal Memo AI login (Google or an emailed code) at
  `/admin/login`. After sign-in the address is matched, case-insensitively,
  against `admin_users`.
- Anyone signed in with an address that is not on the list gets a clear "not
  allowed" screen rather than a redirect loop.
- More admins can be added from **Settings**. The `owner` row cannot be removed
  through the UI, and nobody can remove their own access, so the dashboard
  cannot be locked out.

Two details worth knowing:

- `PREVIEW_AUTH_BYPASS` does **not** open the dashboard. The guard calls
  `getOptionalUser`, not the preview-bypass variant, so a Preview deployment
  cannot be used to read live revenue.
- Every server action re-checks the allowlist. A server action is a public
  endpoint, so the layout guard alone would not protect it.

All admin tables have row level security enabled with **no policies**, which
denies the `anon` and `authenticated` roles outright. Everything is read and
written server-side with the service role after the allowlist check.

## Pages

| Page | What it answers |
| --- | --- |
| `/admin` | Campaign views, revenue, active trials, who is online right now |
| `/admin/creators` | Per-creator views, videos, engagement, followers, attributed revenue; add creators; review queue |
| `/admin/creators/[id]` | One creator: their accounts, every post, and the Memo AI decision per post |
| `/admin/sales` | Revenue, MRR, trial pipeline and projections, revenue by discount code |
| `/admin/visitors` | Visits, page views, who is online, top pages, referrers, countries, devices |
| `/admin/users` | Every account, plan and subscription status, searchable |
| `/admin/settings` | Admin allowlist, Memo AI detection rules, collection status |

Every page has a Today / 7 days / 30 days / This month / All time switch, and
each figure is compared against the equally long window before it.

## Adding a creator

**Creators → Add creator.** Name and at least one TikTok link are required.
Links can be pasted straight from the TikTok share sheet — tracking parameters,
bare handles and `vm.tiktok.com` short links all work — and one creator can hold
several accounts.

The important field is **what kind of account it is**:

| Mode | Behaviour |
| --- | --- |
| `dedicated` | Every post counts. For accounts that only exist for Memo AI. |
| `mixed` | Each post is judged individually. For personal accounts that sometimes post Memo AI content. |
| `personal` | Nothing ever counts. Tracked for context only. |

**Promo codes** matter twice over: they attribute real Stripe revenue to the
creator, and a creator's own code appearing in a caption is the single strongest
signal that the post is Memo AI content.

New creators are picked up by the next sync automatically. Follower counts and
the avatar are filled in immediately from the public TikTok profile page, which
is free and needs no API key.

## How Memo AI posts are detected

Several campaign accounts are personal accounts that only sometimes post about
Memo AI, so every post on a `mixed` account is scored from its caption,
hashtags, mentions, any link in the text, and the creator's own discount code.

Signals add up. A score of 1.0 counts the post; 0.4–0.99 sends it to the review
queue; below that it is treated as personal. A single unambiguous signal — a
`memoai.eu` link, an `@memo_ai` mention, `#memoai`, or the creator's promo code —
reaches 1.0 on its own. Weaker signals such as the bare word "memo" contribute
partially, so an ambiguous post is queued for a human rather than silently
counted.

Rules are editable in **Settings**, and changing one re-runs detection over every
stored post.

A decision made by hand always wins and is never overwritten by a later
automatic pass. Use the **Auto** button on a post to hand it back.

Measured against the live campaign (163 posts across all 14 accounts), the rules
classified every post without needing a human decision.

Two known limits:

- A post with no caption on a `mixed` account has nothing to match on and will
  read as personal. Mark it by hand.
- Only the most recent N posts per account are re-read on each run, so a Memo AI
  post older than that window is not discovered until you raise
  `UGC_SYNC_POSTS_PER_PROFILE` for one run.

## Collecting TikTok stats

TikTok does not give a server per-video metrics: the public profile page carries
account totals only, and the video-list endpoint needs signed request
parameters. Per-video numbers therefore come from
[Apify's TikTok scraper](https://apify.com/clockworks/tiktok-scraper).

Set `APIFY_TOKEN` in the environment. Without it the dashboard still works —
creators, manual classification and every other panel are unaffected — but the
Sync button reports that collection is not configured.

Runs are queued asynchronously and polled, because fourteen accounts comfortably
exceed the serverless time budget. The daily cron in `vercel.json` finishes any
completed run and then starts the next one; **Sync now** in the dashboard does
the same on demand.

### Cost

Apify bills per post scraped. **One run over 14 accounts at 30 posts each cost
$0.61.** The Apify free plan includes $5 of credit per month, which is about
eight runs — not enough for a daily refresh.

- The cron is set to **once a day** (`0 3 * * *`), roughly $18/month at 30 posts
  per account. That needs a paid Apify plan.
- `UGC_SYNC_POSTS_PER_PROFILE` (default 20) is the cost lever. Lower it for
  cheaper daily upkeep; raise it temporarily for a deep backfill.
- To stay inside the free plan, change the cron to every third or fourth day and
  accept a coarser view history.

Posts already collected keep their history regardless — lowering the number only
means older posts stop being re-read for fresh view counts.

## What "backfill" can and cannot mean

TikTok publishes a video's **current** cumulative view count and nothing else.
There is no source — Apify included — for what a video's view count was on a past
day, so a true day-by-day history of the period before tracking started cannot
be reconstructed by anyone.

What the system does instead:

- On first sight, a video's discovered view count is credited to **the day it was
  posted**, not the day it was scraped. Without this, the first sync would pile
  every creator's entire back catalogue onto one day and show a fake spike.
- From the first sync onward, each day's figure is the genuine day-over-day
  increase between snapshots.

So the chart reads as "views from videos posted that day" before tracking
started, and as real daily accrual afterwards. `backfillPostedSnapshots()` runs
automatically after every collection and is safe to re-run; it never touches a
video that already has real history.

## Visitor analytics

Traffic is measured by our own beacon (`/api/track`, fired by
`components/visit-tracker.tsx`) rather than Vercel Analytics, whose API is not
queryable on this plan and cannot answer "who is online right now".

- One `view` per navigation, then a `heartbeat` every 60s while the tab is
  visible, which is what keeps the "online now" panel accurate.
- A session is "online" for 5 minutes after its last beacon.
- No IP address and no raw user agent is stored — only country, device class,
  browser and OS.
- `/admin`, `/api`, `/auth` and `_next` paths are never recorded.
- Bots are recorded but flagged, and excluded from every aggregate.
- `prune_site_analytics(days)` drops page-view rows older than 180 days.

## Sales figures

Read live from Stripe rather than from `billing_subscriptions`, which only
mirrors what the webhook has seen.

- **Revenue** counts paid invoices. Zero-amount invoices (trial starts and
  100%-off comps) are real conversions but not revenue, so they are excluded.
- **MRR** normalises weekly and yearly plans to a monthly figure and counts only
  subscriptions that are actually paying — a `trialing` subscription is full
  access but not yet revenue.
- **Trial conversion rate** is measured over trials that have already *ended*. A
  trial still running has not had its chance to convert and would drag the rate
  down if counted.
- **Projected revenue today** is `trials ending today × conversion rate ×
  average converted value`.
- **Revenue by discount code** reads the promotion code off each paid invoice's
  discount, then rolls codes up to the creator that owns them.

If Stripe is unreachable the rest of the dashboard still renders; only the
revenue panels show as unavailable.

## Setup

1. Merge the branch. `.github/workflows/supabase-migrations.yml` applies
   migration `0027` to production on push to `main`.
2. Set the environment variables in Vercel (Production):
   - `APIFY_TOKEN` — required for automatic TikTok collection.
   - `CRON_SECRET` — required; the cron endpoint refuses to run without a secret
     configured, because a run spends money.
   - `UGC_SYNC_POSTS_PER_PROFILE` — optional, defaults to 20.
3. Seed the campaign roster and backfill:

   ```bash
   node --experimental-strip-types scripts/seed-ugc-creators.mjs --sync --days 14
   ```

   Without `--sync` it only writes the creator rows, which is the safe default.
   With `--sync` it also runs a collection (spending Apify credit), ingests the
   results and seeds the view history at each video's post date.
4. Open `/admin`, check the review queue, and correct any account whose mode was
   guessed wrong.

## Tests

- `tests/migrations.test.mjs` replays every migration in an in-process Postgres
  (PGlite) and exercises the daily-delta and visitor-beacon functions. This is
  how the "replay the migration locally before merge" rule is satisfied on a
  machine with no Docker and no system Postgres. The file skips itself if PGlite
  is not installed.
- `tests/ugc-classification.test.mjs` covers Memo AI detection, including real
  captions taken from the live campaign.
- `tests/admin-sales.test.mjs` covers revenue, MRR, trial conversion and promo
  attribution.
- `tests/admin-ranges.test.mjs` covers the reporting windows and the
  Europe/Ljubljana day boundaries.
- `tests/ugc-tiktok-links.test.mjs` parses all 14 campaign links exactly as
  pasted from the TikTok share sheet.
