import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_TUTOR_LIFETIME_SECONDS,
  PAID_TUTOR_DAILY_SECONDS,
  TUTOR_GRANT_KEY_GRACE_SECONDS,
} from "../src/lib/tutor-allowance.ts";
import { isFinalSlice, nextSliceDueAt } from "../src/lib/tutor/slice.ts";

/*
 * A session renewed on the margin no matter how short its slice was.
 *
 * The server mints the Soniox keys for the slice plus 45 seconds of grace; the client set
 * its renewal alarm two minutes before those keys expire. For a full day that is 28 minutes
 * in. For the free minute it is `60 + 45 - 120` — a negative delay, so the alarm fired on
 * the same tick the session started, and the check before the first turn agreed with it.
 *
 * The renewal it fired could only fail. The slice being renewed has already reserved every
 * second the learner had, so the server finds nothing left and answers 402, which the client
 * reads as "their time is genuinely spent" and turns into a paywall — over a session that
 * had not yet said a word, with the whole free minute still unspent.
 */

const RENEWAL_MARGIN_MS = 120_000;
const KEY_GRACE_MS = TUTOR_GRANT_KEY_GRACE_SECONDS * 1000;

/** What the session route answers with, for a grant of `grantedSeconds`. */
function grant(grantedSeconds, usage = {}) {
  return {
    grantedSeconds,
    usage: {
      remainingSeconds: grantedSeconds,
      hasUnlimitedUsage: false,
      ...usage,
    },
  };
}

/** How far into the session the next slice comes due, in seconds. */
function dueSecondsIn(sessionGrant) {
  const startedAt = 1_700_000_000_000;
  const expiresAt = startedAt + (sessionGrant.grantedSeconds + TUTOR_GRANT_KEY_GRACE_SECONDS) * 1000;

  const dueAt = nextSliceDueAt({
    expiresAt,
    finalSlice: isFinalSlice(sessionGrant),
    renewalMarginMs: RENEWAL_MARGIN_MS,
    keyGraceMs: KEY_GRACE_MS,
  });

  return (dueAt - startedAt) / 1000;
}

test("a grant that took the whole allowance leaves no next slice to reserve", () => {
  // The allowance the session reports is the one measured before its own grant, so a grant
  // covering all of it has left nothing behind. Asking again can only come back 402.
  assert.equal(isFinalSlice(grant(FREE_TUTOR_LIFETIME_SECONDS)), true);
});

test("a grant with allowance still behind it can be renewed", () => {
  // A subscriber a full day in, with a bought hour still untouched: the day was granted, the
  // credit was not, so the next slice is really there.
  assert.equal(
    isFinalSlice(grant(PAID_TUTOR_DAILY_SECONDS, { remainingSeconds: PAID_TUTOR_DAILY_SECONDS + 3600 })),
    false,
  );
});

test("an unlimited account is never on its last slice", () => {
  // It reports no remaining seconds because there is no meter, not because there is nothing
  // left. Read as a number that would make every slice the final one.
  assert.equal(
    isFinalSlice(grant(PAID_TUTOR_DAILY_SECONDS, { remainingSeconds: 0, hasUnlimitedUsage: true })),
    false,
  );
});

test("the free minute is not spent before it is spoken", () => {
  // The regression: `60 + 45 - 120` came due 15 seconds before the session began.
  assert.equal(dueSecondsIn(grant(FREE_TUTOR_LIFETIME_SECONDS)), FREE_TUTOR_LIFETIME_SECONDS);
});

test("a last few seconds are still the learner's to use", () => {
  // A subscriber down to their final half minute got the paywall on the opening word.
  assert.equal(dueSecondsIn(grant(30)), 30);
});

test("a final slice comes due exactly when its talking time runs out", () => {
  // Not a moment before, and not after: the keys carry 45 seconds of grace past it, which is
  // what the last sentence and its report are for, not more talking time.
  for (const seconds of [1, 60, 300, PAID_TUTOR_DAILY_SECONDS]) {
    assert.equal(dueSecondsIn(grant(seconds)), seconds);
  }
});

test("an ordinary slice still renews on the margin, between turns", () => {
  // Unchanged, and the reason the margin exists: the swap needs room for a round trip and
  // must not land mid-sentence. A full day with credit behind it comes due at 28 minutes.
  const renewable = grant(PAID_TUTOR_DAILY_SECONDS, {
    remainingSeconds: PAID_TUTOR_DAILY_SECONDS + 3600,
  });

  assert.equal(
    dueSecondsIn(renewable),
    PAID_TUTOR_DAILY_SECONDS + TUTOR_GRANT_KEY_GRACE_SECONDS - RENEWAL_MARGIN_MS / 1000,
  );
});

test("the next slice never comes due before the session starts", () => {
  // The shape of the bug, stated on its own: no slice, however short, may be due at or
  // before zero, because a renewal that early refuses time nobody has had the chance to use.
  for (const seconds of [1, 5, 30, 60, 74, 75, 76, 120, PAID_TUTOR_DAILY_SECONDS]) {
    assert.ok(
      dueSecondsIn(grant(seconds)) > 0,
      `a ${seconds}s slice came due ${dueSecondsIn(grant(seconds))}s in`,
    );
  }
});
