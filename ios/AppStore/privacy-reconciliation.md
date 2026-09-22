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

## Still required

- Correct the five privacy-policy translations in `src/lib/help/`: their
  technical-data and cookies sections describe aggregate Vercel analytics but
  omit the account-linked visit tables and `memo-visit` cookie. Review the
  nonessential cookie consent behavior and data-retention implementation;
  changing disclosure alone is not a consent mechanism.
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
