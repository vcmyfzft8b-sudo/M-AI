# Memo iOS — paused agent handoff

Saved 23 September 2026 at the owner's explicit request to stop. The thread
goal is **paused**, not complete. **Do not submit yet.**

## Goal to resume

Finish Memo's iOS app as a faithful WKWebView wrapper of the current PWA and
prepare it for App Store submission. Keep onboarding, design, paywalls,
settings, study features and languages aligned with the PWA. Add the required
Apple-specific authentication, StoreKit purchases, restore/manage controls,
privacy/consent and account-deletion behavior in the same design. Verify the
actual app end to end on Simulator and a physical iPhone, fix discovered issues,
and provide screenshots and an evidence-based readiness report. Apple decides
approval; do not promise acceptance or mark unverified requirements complete.

Preserve the owner's specifics:

- Onboarding first, matching the latest PWA; Google, Apple and email-code login.
- Portrait layout, correct startup/loading screen, no browser chrome in the
  main app, safe areas, haptics and smooth keyboard/sheet/chat movement.
- Shared regional language behavior: Slovenia → Slovenian, Croatia → Croatian,
  Bosnia → Bosnian, Serbia → Serbian, elsewhere → English; manual choice persists.
- Slovenia StoreKit prices: €19.99 monthly / €129.99 yearly; eligible first-period
  discounts €9.99 / €64.99. Separate three-day free-trial products. Wheel/code
  terms and actual purchase sheets must agree; do not hardcode Apple prices.
- Correct s.p. business/trader details and **Zgoša** address; finish verification
  of Small Business Program acceptance, without assuming the 15% fee is approved.
- Policies, privacy labels, review account, screenshots and metadata must describe
  the actual release. Submit only after final tests and owner authorization.

## Read first

1. [SUBMISSION-CHECKLIST.md](SUBMISSION-CHECKLIST.md): complete current remaining
   work, including billing, deletion, audio, notifications, production and portal.
2. [release-readiness.md](release-readiness.md): dated evidence; older sections
   contain superseded blockers, builds and statements. Prefer the current checklist.
3. [NEXT-STEPS.md](NEXT-STEPS.md), [privacy-reconciliation.md](privacy-reconciliation.md),
   [metadata.md](metadata.md), and repository `AGENTS.md`.

## Exact coding state

- Assigned worktree: `/Users/nacevalencic/.codex/worktrees/b2ab/Memo_AI`.
- Branch: `codex/ios-app-wrapper`.
- Previous pushed commit: **a72758a2** (submission checklist and evidence).
  The pause checkpoint adds this handoff and the unfinished test on the same branch.
- Latest verified UI commit: **5b283dac** (code redemption redesigned as paywall).
- Verified READY Preview:
  `https://memo-ebx5i4rr2-nace-valencics-projects.vercel.app`.
- **Unfinished test-only work in the pause checkpoint:**
  `ios/MemoAIUITests/WrapperTests.swift` adds
  `testPreviewAllSettingsLanguagesPersist`. Preserve it. It is not verified yet;
  committing it is a handoff checkpoint, not a passing-test claim.
- Prior authorization permits pushing this test branch. It does not authorize
  production merge/deployment or App Review submission. Do not change another
  task's checkout, stop its processes, or use its simulator.
- Bundled Node (Homebrew Node is broken on this Mac):
  `/Users/nacevalencic/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.

## How to resume this exact branch and worktree

The owner explicitly wants the next agent to continue from this work. **On this
Mac, use this existing assigned worktree; do not start from main and lose the
wrapper work.** In a terminal:

```sh
cd /Users/nacevalencic/.codex/worktrees/b2ab/Memo_AI
pwd
git branch --show-current
git status --short
git log -3 --oneline
```

The branch must be `codex/ios-app-wrapper`. Read this handoff and
`ios/AppStore/SUBMISSION-CHECKLIST.md` there. If the directory, branch or changes
do not match, inspect `git worktree list` and preserve the current contents;
never reset, clean, stash or switch another agent's checkout to force a match.
The latest pause checkpoint was pushed to this branch. Fetch/read remote state
before deciding whether any integration is needed; do not automatically reset
to the remote or replace the existing checkout.

In Codex, open **this folder** as the project/task working directory, or give the
next agent its absolute path and explicitly request continuation of this task.
The primary `/Users/nacevalencic/dev/Memo_AI` checkout is reserved for clean main
and must not be used for these edits.

If this worktree is genuinely unavailable, start a fresh isolated worktree from
the **remote task branch**, not main. From an existing clone of the same repo:

```sh
git fetch origin
git worktree add -b codex/ios-submission-continuation /ABSOLUTE/NEW/SIBLING/PATH origin/codex/ios-app-wrapper
```

Replace the uppercase path with an unused sibling directory, not a child of
another task's checkout. Use a unique branch name if the example already exists.
The repository's canonical GitHub location is
`https://github.com/vcmyfzft8b-sudo/M-AI.git`; the current old `Memo-AI.git` remote
redirects there successfully. Do not create a second GitHub repository.

**Local-only items do not follow Git:** the ignored test runners, private env,
screenshots, xcresults and exported binaries under `ios/build/`, plus credentials
under `~/.config/memoai/`. They are available in this Mac/worktree. If continuing
elsewhere, arrange secure access or regenerate test artifacts; never commit or
paste the credentials into a prompt. Prefer this Mac for continuing device QA.

The task-owned language test was stopped at the pause request. Its runner and
`xcodebuild` processes were verified no longer present. Do not restart any test
until the owner resumes the task.

## What changed since the checklist was sent

### Sandbox sign-in: still incomplete

The owner connected the iPhone and asked the agent to do the sign-in. CUA reached
the **Simulator Settings → Developer → Sandbox Apple Account** login, entered the
existing tester credentials, and completed the account-security prompt without
changing security settings. Apple returned to **Sign In**, without retaining the
account. Do not report this as a successful Sandbox login.

iPhone Mirroring was then attempted. Apple explicitly reported that mirroring
cannot be set up because it is unavailable in this country/region. The app was
dismissed. Cable/Xcode availability does not supply CUA control of physical
iPhone Settings. The pending user request is to sign in directly on the iPhone:

`Settings → Developer → Sandbox Apple Account`

Tester: `nace.valencic+memo-sandbox-20260922@gmail.com`. The account already exists
and has five-minute monthly renewals. Do not create another tester or reset its
password. The owner provided its existing saved password earlier in the thread;
never copy credentials into Git, logs or this handoff.

### Fresh purchase-state evidence

`ios/build/review-sep23-sandbox-lifecycle-read.mjs` was rerun at
**07:26:05 UTC on 23 September**. Apple's verified response for the synthetic Word
account still shows the yearly trial active, auto-renew on, no revocation, original
purchase transaction matching our staging ledger, expiry **21:58:04 UTC that day**.
It remains a PURCHASE, not a renewal. Evidence:
`ios/build/review-sep23-sandbox-lifecycle-current.json`.

### Language test WIP

New XCTest walks all five language options in Settings, relaunches between them,
checks the selected language persists, and opens the translated Apple code form.
It requires the signed-in synthetic PDF account and a staging Preview.

- Runner: `ios/build/run-sep23-languages-sim.mjs` (ignored local file).
- First run: `review-sep23-languages-sim.xcresult`, failed at the first relaunch
  because the unpaid account's normal launch paywall hid Settings. The initial
  Settings selection worked. This was a test-navigation gap, not evidence that
  language persistence failed.
- Updated test closes that normal offer in all five languages before opening
  Settings. Rerun `review-sep23-languages-sim-final` was **INTERRUPTED at the
  owner's stop request**, not passed. Its result must not be counted as coverage.
- Next agent: inspect the WIP, rerun with a new unique artifact tag, fix test or
  product based on evidence, inspect screenshots and restore the synthetic account
  to English. Test runner uses only the designated simulator below.

### Business/discount follow-up

- Fresh Gmail search still found only the 15 September Small Business enrollment
  receipt, no acceptance message. Approval remains unconfirmed.
- Code audit confirms creator attribution is still unimplemented: the Apple
  promotion route reads/validates Stripe codes but does not persist a creator
  redemption; current creator sales reporting reads Stripe attribution. Do not
  pretend code validation means creator reporting works. No attribution code or
  database changes were made in this continuation.

## Recommended next work order

1. Resume/fix the interrupted native five-language test and save screenshots.
2. Verify the dedicated Sandbox tester is signed into the physical iPhone, then
   run actual code purchases, trial/monthly/yearly purchases and restore. Validate
   each Apple-signed transaction against the server ledger. Never manufacture access.
3. Run accelerated renewals, cancellation/expiry, refund/revocation, interrupted
   delivery and account-binding checks. Existing UI success is not lifecycle proof.
4. Implement remaining agreed code-attribution/parity work; use ordered migrations
   and repository staging rules if schema is needed. Do not push branch migrations
   to production. Audit supported versus excluded recurring/gift code behavior.
5. Finish disposable Apple-account deletion/revocation and physical audio,
   interruption, permission and notification checks from the full checklist.
6. Prepare the final production release for owner approval, then verify the actual
   deployment with the exact TestFlight build. Finish screenshots/metadata/reviewer
   access and replace build 9 in the draft with the final tested build.
7. Give the owner a truthful readiness report and obtain final submission approval.

## Devices, build and environment boundaries

- Own simulator: **142F8E4E-E0DE-4361-B3A4-A7DB54122BD0**, Memo wrapper QA.
- Own iPad simulator: **2E996AB3-509A-446E-8AA0-FF526606CB41**.
- Do not use the other task's iPhone 17 simulator.
- Physical iPhone 16: UDID **00008140-000C18983679401C**;
  CoreDevice **A8384010-80D2-58B0-A681-B60F98438D78**, paired/available at last check.
- App Store Connect app **6812409212**, team **J4PCHZ8P7T**, bundle **eu.memoai.memo**.
- Build **12** public-keyboard archive is VALID / IN_BETA_TESTING. Final native
  or web changes still need their appropriate release verification.
- Shared Preview/staging Supabase: **yviipoccwsndxyrhtcjm**. Production:
  **zrcwmhuwwvguiekzmcdj**. Never run Preview tests against production.
- Private local credentials remain under `~/.config/memoai/`; local test env and
  artifacts are under ignored `ios/build/`. Do not publish these files.
- Use CLI/API and isolated app tests so the owner can keep using the Mac. Any
  physical Face ID, side-button confirmation or unresolved account verification
  may still need a brief owner handoff.
