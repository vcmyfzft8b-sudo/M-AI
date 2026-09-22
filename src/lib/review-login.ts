import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * App Review's way in, and nothing else's.
 *
 * Sign-in is by e-mail code everywhere — the app has no password screen, the
 * same as the web. Apple's reviewers, though, cannot read a mailbox of ours,
 * and a demo account they cannot open is a rejection. So a handful of named
 * accounts accept one fixed code instead of a mailed one, and are never
 * mailed at all.
 *
 * Both values are server-side configuration: `APP_REVIEW_ACCOUNT_EMAILS` is
 * the comma-separated list of accounts this applies to and
 * `APP_REVIEW_LOGIN_CODE` is the code. Leave either unset and the feature does
 * not exist — every account is mailed its code as usual. The accounts are
 * synthetic, created for review and QA; a real learner's address must never be
 * listed here, and the code goes into App Store Connect's review sign-in
 * fields, not into the repository.
 */
function reviewAccountEmails() {
  return (process.env.APP_REVIEW_ACCOUNT_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/** True when this account is one the fixed code applies to. */
export function isReviewAccount(email: string) {
  return reviewAccountEmails().includes(email.trim().toLowerCase());
}

/** True when this is a review account and the code is its fixed code. */
export function reviewCodeMatches(email: string, code: string) {
  const expected = process.env.APP_REVIEW_LOGIN_CODE ?? "";

  if (!expected || !isReviewAccount(email)) {
    return false;
  }

  const a = Buffer.from(code.trim());
  const b = Buffer.from(expected);

  return a.length === b.length && timingSafeEqual(a, b);
}
