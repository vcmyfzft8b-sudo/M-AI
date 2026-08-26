// Kept free of "server-only" so the ownership-reuse contract stays unit-testable
// (tests/lecture-ownership.test.mjs) outside the Next.js runtime.

/**
 * Whether a lecture row a caller is already holding is provably the same row an ownership
 * lookup for `lectureId` + `userId` would return.
 *
 * Handlers that call ensureUserOwnsLecture and then getLectureDetailForUser issue the identical
 * `lectures` query twice, and the second one is what times out under transient database latency.
 * Handing the first row to the second call removes that query — but only when this returns true.
 * A row for another lecture, another owner, or with a missing id falls through to the real query,
 * so a caller that passes the wrong row loses the optimisation and never gains access.
 */
export function lectureRowMatchesOwner(
  lecture: { id: string; user_id: string } | null | undefined,
  params: { lectureId: string; userId: string },
): boolean {
  if (!lecture) {
    return false;
  }

  return (
    typeof lecture.id === "string" &&
    lecture.id.length > 0 &&
    lecture.id === params.lectureId &&
    typeof lecture.user_id === "string" &&
    lecture.user_id.length > 0 &&
    lecture.user_id === params.userId
  );
}
