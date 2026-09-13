import assert from "node:assert/strict";
import test from "node:test";

import {
  FREE_TUTOR_LIFETIME_SECONDS,
  PAID_TUTOR_DAILY_SECONDS,
  TUTOR_GRANT_KEY_GRACE_SECONDS,
} from "../src/lib/tutor-allowance.ts";
import { credentialsExpireAt, isFinalSlice, nextSliceDueAt } from "../src/lib/tutor/slice.ts";

/*
 * A session read its keys' expiry off somebody else's clock.
 *
 * Soniox mints the keys and answers with an absolute `expires_at`. The client took that
 * instant as the end of its credentials and then asked `Date.now()` whether it had arrived —
 * one deadline, two clocks. A browser whose clock is behind reads that deadline as further
 * away than it is by exactly its own error, so the renewal never came due: the alarm was set
 * for minutes after the keys were already refused, and the check before every turn agreed.
 *
 * Measured in production on 2026-09-13: a device 273 seconds slow, on the free minute, whose
 * keys live 105 seconds. Nothing asked for a new slice, and the fifth turn was refused with
 * `Invalid or expired temporary API key` — where the learner should have been shown the
 * paywall at the end of the minute they had been given.
 */

const RENEWAL_MARGIN_MS = 120_000;
const KEY_GRACE_MS = TUTOR_GRANT_KEY_GRACE_SECONDS * 1000;
/** What the slow device in the production report was out by. */
const OBSERVED_SKEW_MS = 273_400;

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

/**
 * One session, run on a device whose clock is `skewMs` behind the world's.
 *
 * Every value the client computes or compares is on its own clock, which is the whole point:
 * the question is not what time it is, it is whether the session reaches for its next slice
 * while the keys it holds are still being accepted.
 */
function session(sessionGrant, { skewMs = 0 } = {}) {
  const trueStartedAt = 1_700_000_000_000;
  /* What `Date.now()` reads on this device as the response lands. */
  const clientStartedAt = trueStartedAt - skewMs;
  const ttlSeconds = sessionGrant.grantedSeconds + TUTOR_GRANT_KEY_GRACE_SECONDS;

  const expiresAt = credentialsExpireAt({
    grantedSeconds: sessionGrant.grantedSeconds,
    keyGraceSeconds: TUTOR_GRANT_KEY_GRACE_SECONDS,
    receivedAt: clientStartedAt,
  });

  const dueAt = nextSliceDueAt({
    expiresAt,
    finalSlice: isFinalSlice(sessionGrant),
    renewalMarginMs: RENEWAL_MARGIN_MS,
    keyGraceMs: KEY_GRACE_MS,
  });

  return {
    /** How far into the session the next slice comes due, in seconds. */
    dueSecondsIn: (dueAt - clientStartedAt) / 1000,
    /** When Soniox stops accepting the keys, in seconds into the session. */
    keysDieSecondsIn: ttlSeconds,
  };
}

test("the renewal is due before the keys die on a clock that keeps time", () => {
  for (const seconds of [1, 30, 60, 300, PAID_TUTOR_DAILY_SECONDS]) {
    const { dueSecondsIn, keysDieSecondsIn } = session(grant(seconds));

    assert.ok(
      dueSecondsIn < keysDieSecondsIn,
      `a ${seconds}s slice came due ${dueSecondsIn}s in, ${keysDieSecondsIn}s of key life`,
    );
  }
});

test("the free minute is not lost to a clock four minutes slow", () => {
  // The production failure, stated as the arithmetic it came from. Reading Soniox's instant
  // instead would have put this 273 seconds out: due at 333s into a session whose keys stop
  // working at 105s, which is a 401 nobody asked for and no paywall.
  const { dueSecondsIn, keysDieSecondsIn } = session(grant(FREE_TUTOR_LIFETIME_SECONDS), {
    skewMs: OBSERVED_SKEW_MS,
  });

  assert.equal(dueSecondsIn, FREE_TUTOR_LIFETIME_SECONDS);
  assert.ok(dueSecondsIn < keysDieSecondsIn);
});

test("no slice, on any clock, comes due after its keys have stopped working", () => {
  // Fast and slow alike: a device ahead of the world used to come due early rather than late,
  // which spends a slice the learner still had. Neither error may reach the arithmetic now.
  for (const skewMs of [-3_600_000, -OBSERVED_SKEW_MS, 0, OBSERVED_SKEW_MS, 3_600_000]) {
    for (const seconds of [1, 60, 300, PAID_TUTOR_DAILY_SECONDS]) {
      const { dueSecondsIn, keysDieSecondsIn } = session(grant(seconds), { skewMs });

      assert.ok(
        dueSecondsIn > 0 && dueSecondsIn < keysDieSecondsIn,
        `a ${seconds}s slice on a ${skewMs}ms clock came due ${dueSecondsIn}s in`,
      );
    }
  }
});

test("a renewable slice still renews on the margin, and still on the local clock", () => {
  // The margin is unchanged by any of this: a full day with credit behind it comes due 28
  // minutes in, counted from when the response landed rather than from Soniox's clock.
  const renewable = grant(PAID_TUTOR_DAILY_SECONDS, {
    remainingSeconds: PAID_TUTOR_DAILY_SECONDS + 3600,
  });

  assert.equal(
    session(renewable, { skewMs: OBSERVED_SKEW_MS }).dueSecondsIn,
    PAID_TUTOR_DAILY_SECONDS + TUTOR_GRANT_KEY_GRACE_SECONDS - RENEWAL_MARGIN_MS / 1000,
  );
});

test("a slice that is not a number leaves no deadline to believe in", () => {
  // A response malformed enough to lose its grant has nothing to count from, and saying so is
  // better than inventing a deadline. The session carries on; `renewCredentials` reads a null
  // as nothing due, which is what it did before this and is not this defect.
  for (const grantedSeconds of [undefined, null, Number.NaN, "60"]) {
    assert.equal(
      credentialsExpireAt({
        grantedSeconds,
        keyGraceSeconds: TUTOR_GRANT_KEY_GRACE_SECONDS,
        receivedAt: 1_700_000_000_000,
      }),
      null,
    );
  }
});
