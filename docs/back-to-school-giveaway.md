# Back-to-school giveaway

A referral campaign: every account gets its own 50 %-off code, a friend who
subscribes with it pays half for the first billing period, and the first
account whose friends reach the goal wins an iPhone.

The campaign's constants live in `src/lib/giveaway-shared.ts`
(`GIVEAWAY_CAMPAIGN`, `GIVEAWAY_GOAL`, the coupon id, the code shape). The
server side — Stripe, the database, attribution, the leaderboard — is
`src/lib/giveaway.ts`.

## Where it appears

- **Landing page** (`/`): nothing about the giveaway itself. A visitor who
  came through a share link sees a pill under the hero buttons saying their
  friend's code will be applied at checkout.
- **Settings** (`/app/settings`): a card at the top, drawn like a settings row, that opens the
  giveaway screen.
- **Giveaway screen** (`/app/giveaway`): a title and one line, the live
  board with the podium, the account's code with copy, share and progress,
  a buy button for accounts without a subscription, and one line of rules.
  The creator demo has the same screen on made-up data at `/creator/giveaway`.
- **Paywall** (`/app/start`): when a friend's code is waiting, the "nothing to
  pay today" line becomes "Code X: first period €65 instead of €130" for the
  selected plan.

## Codes

A code is created the first time an account opens `/app/giveaway` (or calls
`GET /api/giveaway`): a Stripe **promotion code** on the existing
`memo50-first-cycle` coupon (50 % off, `duration: once`), shaped `BTS-XXXXXX`
from an alphabet without 0/O/1/I. It carries the same metadata every other
Memo promotion has (`app`, `billing_key`, `coupon_id`, `promotion_code`) plus
`campaign` and `referrer_user_id`, so the payout scripts and dashboard filters
keep working and a giveaway sale is distinguishable from a creator sale.

The row is in `public.giveaway_codes`, one per account per campaign.

## The share link and checkout

`/r/<code>` sets the `memo-giveaway-ref` cookie (30 days) and redirects to
`/`, or to `/app/start` for a signed-in visitor. Checkout
(`/api/billing/checkout`) reads the cookie, resolves it to the promotion code
and attaches it as the session's discount. Because the discount is on the
first payment, a checkout with a code **skips the 3-day trial** and charges
the discounted first period straight away — the same decision the prize wheel
made, and the reason a referral can qualify the moment a friend pays.

An account cannot use its own code through the link (the cookie is ignored
for the code's owner). A friend can also type the code on Stripe's page when
no cookie is set; that path keeps the trial and the referral stays `pending`
until the trial converts.

## Attribution

`syncStripeSubscriptionRecord` (the Stripe webhook's path, and the
reconciliation path) calls `recordGiveawayReferral` after every upsert. It
reads the subscription's discounts, expanding them when the event only sent
ids, matches the promotion code against `giveaway_codes`, and writes a row in
`public.giveaway_referrals`:

- `pending` while the subscription has not collected money (`trialing`);
- `qualified` once the subscription is `active` — the one status that means a
  payment went through, at checkout or when the trial converted;
- `reversed` is never set by code. Set it by hand for a refund or abuse and the
  row stops counting.

A friend counts once per campaign (partial unique index on
`referred_user_id`), and a purchase with the buyer's own code is not a
referral. Attribution never fails the billing sync: errors are logged.

The webhook endpoint only sends `checkout.session.completed` and the three
`customer.subscription.*` events; nothing here needs `invoice.*`.

## The leaderboard

`public.giveaway_leaderboard(campaign, goal, limit)` (service-role only)
returns one row per referrer with a qualified referral, ordered by:

1. the time the goal-th referral qualified (so whoever got there first stays
   on top even if somebody later overtakes them on count),
2. the count,
3. the time the current count was reached.

The winner is the first row when it has reached the goal. Names are masked on
the server before they leave (`Ana K.`, or `ma***` for an account with no
name); no email address ever reaches a browser.

`GET /api/giveaway` is the signed-in view (code, progress, board); the screen
polls it every 30 s while the tab is visible.

**Seeded field.** `GIVEAWAY_SEED_ENTRIES` in `giveaway-shared.ts` is a list
of made-up Slovenian names with small counts (the leader has 7). They are
merged into the ranking on the way out by `rankGiveawayEntries`, which
applies the same rule as the SQL. They are never stored, sit below any real
account with the same count, and cannot reach the goal, so real accounts
take the board over simply by referring more friends. Remove the list to
end the illusion.

## Operating it

- The winner is not notified automatically. Watch the board (or query
  `giveaway_leaderboard`) and email them; the rules on the screen say that is
  how it works.
- To end the campaign, set the winner by letting the board conclude, or change
  the copy; codes keep working (they are ordinary promotion codes) unless you
  deactivate them in Stripe, which `giveaway_codes.stripe_promotion_code_id`
  maps to.
- Migration: `supabase/migrations/0040_back_to_school_giveaway.sql`. Replayed
  in `tests/migrations.test.mjs`, which also exercises the ordering rule.
