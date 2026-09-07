/**
 * When a session should ask the server for its next slice of talking time.
 *
 * The server mints the Soniox keys for the slice it reserved plus a little grace, and the
 * client renews on a margin before they expire so the swap never lands in the middle of a
 * turn. That arithmetic quietly assumed the slice was a full day — which it is only for a
 * learner with a full day left. It is not for the one on their free minute, and it is not
 * for anyone down to their last seconds: their keys are minted for less than the margin,
 * so the renewal came due before the session had said anything.
 *
 * A renewal that comes due that early is worse than useless. The slice it is trying to
 * replace has already reserved everything the learner had left, so the server can only
 * refuse it, and the refusal is a paywall — shown while the time it is refusing to extend
 * is still sitting unspent in the learner's hand.
 */

/** The shape the session route answers with, narrowed to what the timing depends on. */
type SliceGrant = {
  grantedSeconds: number;
  usage: Pick<VoiceAllowance, "remainingSeconds" | "hasUnlimitedUsage">;
};

type VoiceAllowance = {
  remainingSeconds: number;
  hasUnlimitedUsage: boolean;
};

/**
 * Whether this slice is the last one the learner can be given.
 *
 * The allowance the session answers with is the one measured *before* its own grant was
 * reserved, so a grant that covers all of it has left nothing behind for a second. Asking
 * anyway is the request that can only come back 402.
 *
 * An unlimited account is never final — it reports no remaining seconds because there is
 * no meter to report, not because there is nothing left.
 */
export function isFinalSlice(grant: SliceGrant): boolean {
  if (grant.usage.hasUnlimitedUsage) {
    return false;
  }

  return grant.grantedSeconds >= grant.usage.remainingSeconds;
}

/**
 * The moment the session should reach for its next slice.
 *
 * An ordinary slice is renewed on the margin, early enough to swap the keys between turns.
 * A final slice has nothing to renew, so the same request means something else entirely:
 * it is how the session finds out the time is gone and shows the paywall. That belongs at
 * the end of the talking time the learner was actually granted — which is the key expiry
 * less the grace the keys carry past it — and not a moment before.
 */
export function nextSliceDueAt(params: {
  expiresAt: number;
  finalSlice: boolean;
  renewalMarginMs: number;
  keyGraceMs: number;
}): number {
  return params.finalSlice
    ? params.expiresAt - params.keyGraceMs
    : params.expiresAt - params.renewalMarginMs;
}
