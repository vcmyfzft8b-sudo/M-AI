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
each figure is compared against the equally long window before it. Everything on
a page shares that window — including the post lists on a creator's page, so the
tiles and the posts behind them can never disagree.

### Staying current

A dashboard left open refreshes itself, on a cadence set per source in
`src/lib/admin/refresh.ts`:

| Source | Cadence | Why |
| --- | --- | --- |
| Supabase (creators, posts, users) | every page load | Our own database, and cheap |
| Stripe and Vercel | 15 minutes | Paginated third-party calls taking seconds; revenue does not move minute to minute |
| Online now | 60 seconds | Worthless if it is stale |
| TikTok posts | daily cron | Billed per post scraped, so a page view must never trigger one |

Refreshing pauses while the tab is hidden and catches up on return, so a
dashboard left open in a background tab does not spend Stripe and Vercel calls
all day for nobody to read.

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

### Our own accounts

`@memo_ai_si` and `@rubissiti` (Klara) are tracked alongside the creators but
marked `kind = 'owned'`. Their views and the revenue they drive are real and
belong in the totals, but they are not a creator's work and they are never paid,
so they are badged **ours** and can be filtered out. `@memo_ai_si` is currently
the single largest channel — 104K views over 30 days against Ema's 72K — which
is exactly why it should not be silently averaged into "per creator" figures.

## What each creator costs

Pay has **two independent parts**, and a creator can be on either, both or
neither. They were originally one exclusive choice, which could not express the
real arrangement and silently underpaid anyone on both.

| Part | Column | Stored as | Who |
| --- | --- | --- | --- |
| Flat fee | **Base pay** | `rate_kind` + `rate_amount` | Ema, Martin & David, Mavija, Milos (€5/video); Lara (€22/video) |
| Share of their code | **Code bonus** | `revenue_share_percent` | everyone except Lara and our own accounts (20%) |

Both are editable from a creator's page, and the two are shown as separate
columns so a payout can be explained line by line rather than as one number.

Worked example from the live data: Martin & David posted 5 videos and their
codes sold €160, so they are owed **€25 base + €32 bonus = €57**. Lara posted 2
videos at €22 and takes no share, so her bonus column reads "—" rather than €0 —
the distinction being "no such arrangement" versus "nothing earned yet".

From that the table derives **margin** (estimated revenue less both parts) with
its percentage, and return on spend. A creator who costs nothing has no return
*on spend* to report, so that reads as "—" rather than as infinity or a
misleading zero, and a creator with no measurable revenue shows no margin
percentage rather than dividing by zero.

**Owed this month** is always month-to-date, whatever range is selected —
payouts happen at the end of the calendar month, and showing a seven-day figure
in a column people pay from would be dangerous. Per-video creators accrue on
posts; revenue-share creators accrue only when their code actually sells.

**Codes used** counts paid checkouts attributed to that creator's codes **inside
the selected range**. The lifetime redemption count is in the cell's tooltip,
and the two differ a lot: `EMA50` has been redeemed 34 times but produced two
paying invoices. A redemption means the code was applied at checkout; only a
paid invoice above zero means money arrived. Trial starts are €0 invoices and
never count.

### Attributing a conversion after a trial

`memo50-first-cycle` is a **once**-only coupon, so it is consumed by the
customer's first invoice — which for a trial is the €0 one. Their first real
payment then carries no discount at all, and attributing purely by what is
stamped on the invoice credited the creator with nothing for a genuine sale. On
the live account that was 16 customers and €460 of revenue no code was credited
with.

So attribution has two paths: a code stamped on the invoice, or — for a customer
known to have used a code, learned from any invoice including the €0 one — their
**first paying invoice**. Renewals after that are not the creator's, and an
invoice already stamped is never counted twice.

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

On a `mixed` account the caption is then read by **Gemini** as well, and the
model's verdict is what gets stored. Keyword rules cannot tell "this app saved
me" from "this memo from my boss", and they miss a promotion written without any
of the expected tokens — on an account that mixes real campaign posts with
everyday video, that is the difference between a trustworthy number and a guess.
The rules still run first: they are shown to the model as a prior, and they are
the fallback when `GEMINI_API_KEY` is not set or a call fails.

`dedicated` and `personal` accounts skip the model entirely. Their mode already
decides every post, so paying to confirm it would be waste.

The model answers `memo`, `personal` or `unclear` directly rather than a boolean
with a confidence score. That matters: models report low confidence on a clear
negative just as readily as on a genuine toss-up, so scoring confidence pushed
obviously personal videos — a family post with two million views — into the
review queue. Only an explicit `unclear` now goes to a human.

Rules are editable in **Settings**, and changing one re-runs detection over every
stored post, model pass included. That can also be triggered directly:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://memoai.eu/api/cron/ugc-sync?reclassify=1"
```

A decision made by hand always wins and is never overwritten by a later
automatic pass. Use the **Auto** button on a post to hand it back.

Measured against the live campaign — 284 posts across all 14 accounts, covering
more than a month — the model and the rules agreed exactly: 48 counted as Memo
AI, 236 as personal, none left ambiguous. The difference is that each of those
verdicts has now been reached by reading the caption rather than by matching a
token.

Two known limits:

- A post with no caption on a `mixed` account has nothing to match on and will
  read as personal. Mark it by hand.
- Only the most recent N posts per account are re-read on each run, so a Memo AI
  post older than that window is not discovered until you raise
  `UGC_SYNC_POSTS_PER_PROFILE`, or use `posts=` on the cron endpoint, for one
  run. Leila is the live example: `LEILA50` has real redemptions in Stripe, but
  her Memo AI posts sit further back than her last 60 posts, so none are counted
  yet.

## Collecting TikTok stats

TikTok does not give a server per-video metrics: the public profile page carries
account totals only, and the video-list endpoint needs signed request
parameters. Per-video numbers therefore come from
[Apify's TikTok scraper](https://apify.com/clockworks/tiktok-scraper).

Set `APIFY_TOKEN` in the environment. Without it the dashboard still works —
creators, manual classification and every other panel are unaffected — but the
Sync button reports that collection is not configured.

The nightly cron in `vercel.json` is the **only** thing that reads TikTok. It
collects, waits and ingests inside one invocation, so the day's views are
stamped with the day they belong to.

There is deliberately no button that starts a scrape. Collection is billed per
post, and a control anyone could press turns a fixed nightly cost into an
unpredictable one — as well as being able to write a second snapshot for a day
that already has one. The two controls on the panel touch TikTok not at all:

- **Re-check detection** re-scores posts already stored, for after a rule change.
- **Finish ingesting** appears only if a nightly run outlived its time budget,
  and stores what that run already collected. It never scrapes again.

A one-off collection can still be run deliberately from the cron endpoint with
`force=1`, which is a considered act with a secret rather than a button.

### Cost

Apify bills per post scraped. **One run over 14 accounts cost $0.46 at 20 posts
each, and $1.05 at 60.** The Apify free plan includes $5 of credit per month, which is about
eight runs — not enough for a daily refresh.

- The cron is set to **once a day** (`0 3 * * *`), roughly $14/month at 20 posts
  per account. That needs a paid Apify plan.
- `UGC_SYNC_POSTS_PER_PROFILE` (default 20) is the cost lever. Lower it for
  cheaper daily upkeep; raise it temporarily for a deep backfill.
- To stay inside the free plan, change the cron to every third or fourth day and
  accept a coarser view history.
- The cron endpoint will not start a second collection within six hours of the
  last one finishing. The schedule never trips this; it exists so triggering the
  endpoint by hand cannot double-spend by accident.

For a one-off deep pull, both guards can be overridden on the endpoint:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "https://memoai.eu/api/cron/ugc-sync?force=1&posts=60"
```

`force=1` skips the debounce and `posts=` widens the per-creator pull for that
run only, leaving the daily schedule and its cost untouched. Add `handle=` (once
per account) to scope the run, which is how a newly added creator is collected
without paying to re-read the other fourteen. Call the endpoint again without
parameters a minute later to ingest the result.

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

Two sources, each doing what the other cannot.

**Vercel Web Analytics** owns the history. It has been recording memoai.eu since
March, so it supplies visits, page views, top paths, referrers, countries and
browsers, plus the live "online now" count. Set `VERCEL_ANALYTICS_TOKEN` to a
Vercel API token; `VERCEL_PROJECT_ID` and `VERCEL_TEAM_ID` are injected
automatically on Vercel and only need setting for local development. The
endpoints used are the ones Vercel's own dashboard calls rather than documented
public API, so every response is parsed defensively and any failure falls back
to the beacon instead of breaking the page.

One caveat: Vercel returns hourly buckets for short windows and daily ones for
long windows. Daily visitor counts are summed from those buckets, so a visitor
spanning two hours is counted twice; the window totals come from Vercel's own
deduplicated breakdowns and are exact.

**Our own beacon** (`/api/track`, fired by `components/visit-tracker.tsx`) is
what can name a signed-in visitor, which Vercel never exposes. It supplies the
"who is online" table and the first-time-visitor count.

- One `view` per navigation, then a `heartbeat` every 60s while the tab is
  visible, which is what keeps the "who is online" table accurate.
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
- **Projected revenue** values every trial due to end at **its own subscription
  price times the conversion rate measured for its own plan**, then sums them.
  Plans differ on both counts — in the live data yearly converts at 27.4% and
  monthly at 41.6%, at €130 and €20 — so a single blended "trials × rate ×
  average price" produced a figure matching no actual customer and moving with
  the plan mix rather than the money. A plan with fewer than 20 finished trials
  falls back to the overall rate rather than trusting a thin sample. The Sales
  page charts this forward for 14 days and shows the per-plan breakdown behind
  it.
- **Codes used** counts redemptions of each creator's promotion codes. It
  measures *tracked* signups and is deliberately **not** used as their revenue:
  most people who see a video and subscribe never type the code, so code
  revenue is a floor, not a measure.

### What a view is worth

Creator revenue is derived from views instead. Campaign revenue over a rolling
30-day baseline, divided by tracked views over the same days, gives a revenue
per thousand views; a creator's share is their own views at that rate. The
denominator includes the brand account, because the revenue in the numerator
comes from every channel — excluding those views while keeping their revenue
would inflate the rate for everyone else.

At the time of writing that is **€4.17 per 1,000 tracked views** — €1,665 from
399,251 views. It is the same figure behind "10,000 views is worth about €56" on the
Sales page, and it sharpens on its own as the window fills with more days.

The rate is withheld entirely until there is both revenue and a meaningful
number of views behind it (`MIN_VIEWS_FOR_RATE`), because a handful of views
against a month of revenue produces an absurd per-view figure that would then be
multiplied across every creator.

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
   - `VERCEL_ANALYTICS_TOKEN` — for visitor history and the live online count.
   - `GEMINI_API_KEY` — already set for the app; it also powers the AI review of
     mixed-account posts.
3. Seed the campaign roster and backfill:

   ```bash
   node --experimental-strip-types scripts/seed-ugc-creators.mjs --sync --days 30
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
- `tests/admin-campaign-value.test.mjs` covers the revenue-per-view rate,
  including the guard that withholds it until there is enough data.
