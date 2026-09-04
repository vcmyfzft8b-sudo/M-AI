// Free of "@/" imports and of `server-only` so the trimming can be asserted on directly. What
// this guards is a request the server rejects outright, and reproducing that in a browser costs
// far more than checking the arithmetic here.

/**
 * How much of what has already been said about a topic travels with the next turn.
 *
 * The turn route caps `spokenSoFar` at 8,000 characters and answers 400 to anything longer, so
 * this has to stay under it with room for the rest of the body — the plan, the conversation and
 * the question all ride in the same request. Nothing trimmed the accumulator before, because
 * nothing needed to: a topic was one teaching turn plus a resume per interruption, and a learner
 * would have had to interrupt nine times on one topic to reach the limit.
 *
 * A resume now hands over to a teaching turn as well, which roughly doubles the turns an
 * interrupted topic collects, and the failure it would eventually produce is the worst kind: not
 * a degraded answer but a 400 in the middle of a session that was going well.
 */
const SPOKEN_SO_FAR_MAX_CHARS = 6_000;

/**
 * Adds what was just said to what had been said, keeping the most recent end of it.
 *
 * The tail, because the tail is what the prompt uses it for: a resume is told to continue from
 * the end of it and every turn is told not to repeat it. Losing the oldest words risks the tutor
 * covering something twice at the far end of a very long topic; losing the newest would have it
 * repeat the sentence it just said.
 */
export function appendSpokenSoFar(existing: string, spoken: string) {
  const joined = `${existing} ${spoken}`.trim();

  if (joined.length <= SPOKEN_SO_FAR_MAX_CHARS) {
    return joined;
  }

  const tail = joined.slice(joined.length - SPOKEN_SO_FAR_MAX_CHARS);
  // Cut at a word boundary so the oldest surviving word is a word, not the end of one.
  const boundary = tail.indexOf(" ");

  return boundary === -1 ? tail : tail.slice(boundary + 1);
}
