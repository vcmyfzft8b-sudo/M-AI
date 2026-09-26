# Page performance and Speed Insights

Vercel Speed Insights scores real visits (Real Experience Score, RES). This page records where the
time went when it was last measured, what was changed, and how to pull the numbers again.

## Where the functions run

**Pages and user-facing APIs run in `dub1` (Dublin), set by `regions` in `vercel.json`.**
Production Supabase (`zrcwmhuwwvguiekzmcdj`) is in `eu-west-1` (Ireland), and the users are in
Slovenia and the Balkans. Until 2026-09 every function ran in the project default, `iad1`
(Washington), so each database call crossed the Atlantic and back, and a signed-in page makes
five or six of them in sequence (the proxy's `getUser`, profile + subscriptions, Apple
entitlement, trial state, the page's own queries).

**The lecture pipeline stays in `iad1`**, pinned in the `functions` block of `vercel.json`:
`/api/inngest`, every `/api/internal/lectures/*` route, and `/api/lectures/[id]/retry`. Those
routes fetch third-party content (YouTube's innertube player, arbitrary web pages) where an EU
address can get a different answer, such as a consent wall, and they talk to US-hosted model
providers for minutes at a time. Moving them is a separate decision, and one that a preview
cannot verify (see [lecture-pipeline-inngest.md](lecture-pipeline-inngest.md)).

**Do not pin a route with `export const preferredRegion`.** Next records it in
`functions-config-manifest.json`, so a local build looks right, but Vercel's Next builder
(`@vercel/next`) strips `regions` from that manifest and the function runs in the project
region anyway. That is what happened on this branch's first preview. The `functions` entry in
`vercel.json` is the one the builder reads. To confirm where a request actually ran, the
dashboard's request-log API lists a `region` for every middleware and function invocation:
`https://vercel.com/api/logs/request-logs?projectId=…&ownerId=<team>&deploymentId=…&startDate=<ms>&endDate=<ms>`.
The `x-vercel-id` header is not enough, because it names where the proxy ran.

## Stripe stays off the render path

- `resolveUserSubscriptionState` used to ask Stripe on every render for any account that has a
  Stripe customer and no live subscription. That is everybody who ever opened Checkout and did
  not buy: 2,058 profiles against 195 live subscriptions on 2026-09-26. A page render now
  reconciles in `after()`, once the response is sent. The paywall (`/app/start`) still waits,
  because it is where Checkout returns a buyer and where every screen sends somebody it believes
  has not paid, and so do all API routes.
- The free-trial answer on the paywall (`getSubscriptionTrialEligibility`) is the one read on
  `/app/start` that goes to Stripe. It is only asked once onboarding is complete. The survey shows
  no price, so it never needed the answer.

## Measured before the change (production, 2026-09-19 to 2026-09-26, p75)

| | desktop | mobile |
|---|---|---|
| RES | 90 | 87 |
| TTFB | 1946 ms | 1561 ms |
| FCP | 2754 ms | 3130 ms |
| LCP | 2889 ms | 2900 ms |

Time to first byte by route (desktop, p75): `/` 627 ms, `/app` 1902 ms, `/app/start` 2757 ms,
`/auth/check-email` 3071 ms. Most of FCP was TTFB. `/auth/check-email`'s time includes the form
POST to `/auth/email`, which sends the code and redirects there, because navigation timing counts
from the submit.

## Pulling the numbers

The dashboard's data is behind an API that accepts the CLI's login token
(`~/Library/Application Support/com.vercel.cli/auth.json`, account `nacevalencic-1988`):

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://vercel.com/api/speed-insights/v2/timeseries?projectId=prj_tYSLuzeXWSnRDwXzYUxATzPIAQg3&teamId=team_M7dIKgcG5cpfNBndEjvN9fqn&device=mobile&environment=production&from=2026-09-19T00:00:00.000Z&to=2026-09-26T21:00:00.000Z"
```

- `timeseries` gives an `overview` of p75/p90/p95/p99 and the good/improvable/poor split for
  every metric. `device` is `desktop` or `mobile`.
- `breakdown` adds `metric` (`RES`, `TTFB`, `FCP`, `LCP`, `CLS`, `INP`) and `type`
  (`route`, `path`, `country`, or `selector`). `selector` names the element that shifted
  (CLS), was painted (LCP) or was interacted with (INP).
- Without `from` and `to`, both return empty.
