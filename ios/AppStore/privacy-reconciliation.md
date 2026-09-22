# Privacy reconciliation — 22 September 2026

This is an implementation audit, not confirmation that every published App Store
answer or legal-policy statement is correct. The portal was previously observed
as Published with 15 data types; purpose-level answers still need comparison.

## Findings and corrections

- `src/app/api/track/route.ts` stores a 24-hour `memo-visit` session cookie,
  page paths, optional account ID, referral/campaign values, approximate
  country/region/city and device/browser classes. It does not store raw IP or
  raw user agent in the visitor tables. These records are **not exclusively
  anonymous aggregates**: signed-in records are linked to `auth.users`.
- User ID therefore has Analytics as well as App Functionality in the native
  privacy manifest. Compare the corresponding published Apple purpose answer
  before release. Build 9 predates this manifest correction.
- `src/instrumentation-client.ts` previously enabled masked Sentry session
  replay for errors, without an explicit replay-consent flow or recording
  indicator. Replay integration has been removed and both replay rates set to
  zero. Error reporting and sampled performance traces remain active.
- `src/lib/monitoring.ts` explicitly attaches account IDs and note IDs to some
  error reports. `sendDefaultPii: false` does not make those reports unlinked.
  The manifest already marks diagnostics as linked.
- Account erasure previously relied on Auth deletion to set analytics owners
  to null. It now deletes owned page views and sessions before Auth deletion;
  session deletion cascades associated anonymous page views. Deletion also
  expires `memo-visit` in the response. Failure preserves the owner and cleanup
  job so the next attempt can still find the records.

## Evidence

The original UI-deleted synthetic account completed its unchanged three-hour
drain at 17:04:56 CEST. Auth, its one note and the deletion request were removed;
all eight storage objects (3,635,379 bytes) were gone. The prior code retained
one session and 73 page views with null owners. The captured IDs established
ownership before deletion; only those known test records were then removed.

The corrected erasure engine passed an isolated staging integration test:
owned session, signed-in view and anonymous view removed; unrelated session and
view preserved; Auth removed; fixture cleaned up. The fixture had no sign-in
credentials or upload tokens issued. Its already-due job is a database test,
not evidence of a second native UI deletion or Apple grant revocation.

Local artifacts in `ios/build/`:

- `review-sep22-erasure-complete.json`
- `review-sep22-erasure-storage-before.json`
- `review-sep22-erasure-storage-after.json`
- `review-sep22-erasure-analytics-before.json`
- `review-sep22-erasure-analytics-repair.json`
- `review-sep22-erasure-analytics-integration.json`

Five erasure regression tests cover the drain, account isolation, analytics
failure/retry, Apple revocation failure, storage failure and post-Auth retry.

The same isolation/cascade test also passed through the actual deployed Preview
`/api/cron/account-erasure` at 17:10:53 CEST, using its authenticated cron route:
`review-sep22-erasure-preview-integration.json`. Commit `bc816773` was READY at
`https://memo-12fux1759-nace-valencics-projects.vercel.app`, deployment
`dpl_Fx9BA4J61YhnbtxkjaQZzw2fJfEg`. The endpoint deleted one synthetic account,
reported zero failures, removed its owned session and both types of page view,
and preserved the unrelated fixture until explicit fixture cleanup. TypeScript,
focused lint and `plutil` validation passed. No production merge was performed.

## Still required

- Deploy the optional-analytics change to production after release authorization.
  The five policy translations now describe account-linked visits, the visit
  cookie and the Settings choice. See the implementation and test scope below.
- Compare all 15 published data types, purposes, linkage and tracking answers
  with the final release, including AI providers, support, purchase records,
  push tokens, diagnostics and approximate location. A count of 15 does not
  establish that the answers match.
- Verify the final deployed app no longer initializes replay. These source
  changes do not alter an existing production deployment.
- Actual Apple-auth revocation still needs a real authenticated test identity.
- Build and upload a release containing the corrected manifest after the
  remaining release gates are resolved.

Sources checked 22 September:
[Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/)
and [App Review guideline 2.5.14](https://developer.apple.com/app-store/review/guidelines/#software-requirements).

## Optional analytics implementation

Commit `5bcc4427` adds one shared PWA/iOS Settings switch. The default and the
server-rendered state are off. Only an explicit, current `v1.granted` preference
permits analytics; missing, denied, malformed, future and expired values do not.
The choice expires after 180 days. First-party page-view tracking, Vercel Web
Analytics and Speed Insights mount after opt-in. The tracking endpoint also
checks consent before parsing a body, authenticating or writing any analytics.

Withdrawal clears the 24-hour visitor cookie and each vendor event callback
checks the current choice. A first-party response already in flight clears any
late visitor cookie when it returns after withdrawal. Account deletion expires
the analytics choice as well as the visitor cookie. Security/error diagnostics
continue separately; session replay remains disabled. The policy explains that
withdrawing consent stops future optional collection and does not automatically
remove previously collected server records. Existing account-linked records are
removed during account erasure; support can handle separate removal requests.

This intentionally means traffic reports cover opted-in visitors, rather than
every visitor. There is no extra onboarding interruption or cookie banner;
users can optionally enable analytics from Settings.

Local validation:

- TypeScript and focused lint pass.
- 24 consent, catalogue, UI-string and help-article tests pass.
- `review-sep22-analytics-local-browser.json`: no analytics scripts or page-view
  calls before consent; direct unconsented tracking returns 204 without setting
  a cookie; opt-in records a visit and survives reload; withdrawal removes the
  visitor cookie, survives reload and stops collection. A delayed real tracking
  response does not restore its cookie after withdrawal. No page errors.
- The phone-width Settings screenshot was visually inspected. This local
  development screenshot contains Next.js development chrome and is not an
  App Store asset. Native and deployed-Preview verification are recorded below.

Deployed native check: `review-sep22-analytics-native.xcresult`, one pass in
51.5 seconds, on READY Preview `5bcc4427`
(`memo-del8juj3d-nace-valencics-projects.vercel.app`,
`dpl_8SSieqF7dAc63trNyHS8EiiJQAso`). The actual wrapper opens Settings with
analytics off, enables it, relaunches with it still enabled, withdraws it, then
relaunches with it still off. Both native screenshots were visually inspected;
they show the shared Settings content in portrait without browser or Preview
toolbar controls. This is English native coverage, not every locale on-device.

Deployed browser check: `review-sep22-analytics-preview-localized-browser.json`
passed at 17:29:42 CEST on the same immutable Preview. It covers the local
consent/cookie cases above and explicitly calls the already-loaded Vercel
page-view function after withdrawal, verifying no new analytics request. The
first browser run timed out because its test expected an English switch while
geo-detection selected Slovenian; the localized rerun passed without changing
the product. All five public policy translations returned 200 and disclosed
the default-off behavior and both cookies:
`review-sep22-analytics-policy-locales.json`.

An early browser screenshot caught unloaded icon glyphs and the switch color
transition. A separate settled capture explicitly waited for the Material
Symbols font and confirmed the off state; it was visually inspected:
`review-sep22-analytics-preview-settled.png`. Its diagnostic probe reported
failed Sentry requests, so this is not proof of Sentry delivery. The actual
native captures have loaded icons and the correct off state.

Consent basis reviewed against the Slovenian Information Commissioner's
[guidance on analytics cookies](https://www.ip-rs.si/mnenja-gdpr/varovanje-osebnih-podatkov-in-spletni-pi%C5%A1kotki-1669965271).
