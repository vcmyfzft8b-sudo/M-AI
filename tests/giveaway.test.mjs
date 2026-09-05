import assert from "node:assert/strict";
import test from "node:test";

import {
  GIVEAWAY_CODE_ALPHABET,
  GIVEAWAY_GOAL,
  buildGiveawayShareUrl,
  findGiveawayWinner,
  formatGiveawayCode,
  giveawayInitials,
  giveawaySeedEntries,
  rankGiveawayEntries,
  isGiveawayCodeFormat,
  maskGiveawayName,
  normalizeGiveawayCode,
} from "../src/lib/giveaway-shared.ts";

/*
 * The rules the giveaway screens and the share link depend on. The Stripe
 * and database halves live in the server-only module and are exercised by
 * the migration replay (tests/migrations.test.mjs) for the ordering rule.
 */

test("a drawn code has the prefix, a dash and six characters from the safe alphabet", () => {
  const code = formatGiveawayCode([0, 1, 2, 31, 32, 63]);

  assert.match(code, /^BTS-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(code, "BTS-ABC9A9");
  assert.ok(isGiveawayCodeFormat(code));
  // The alphabet has no 0/O/1/I: they are the characters people misread.
  for (const glyph of ["0", "O", "1", "I"]) {
    assert.equal(GIVEAWAY_CODE_ALPHABET.includes(glyph), false, glyph);
  }
});

test("codes are matched case-insensitively and trimmed, but not guessed", () => {
  assert.equal(normalizeGiveawayCode("  bts-7k2xq4 "), "BTS-7K2XQ4");
  assert.ok(isGiveawayCodeFormat("bts-7k2xq4"));
  assert.equal(isGiveawayCodeFormat("BTS-7K2XQ"), false, "too short");
  assert.equal(isGiveawayCodeFormat("BTS-7K2XQ0"), false, "zero is not in the alphabet");
  assert.equal(isGiveawayCodeFormat("MEMO50"), false, "a creator code is not a giveaway code");
  assert.equal(isGiveawayCodeFormat(null), false);
});

test("the share link is /r/<code> on the given origin", () => {
  assert.equal(buildGiveawayShareUrl("https://memoai.eu/", "bts-7k2xq4"), "https://memoai.eu/r/BTS-7K2XQ4");
  assert.equal(buildGiveawayShareUrl("http://localhost:3000", "BTS-7K2XQ4"), "http://localhost:3000/r/BTS-7K2XQ4");
});

test("leaderboard names never carry a surname or an address", () => {
  assert.equal(maskGiveawayName("Ana Kovač", "ana@example.com", "Memo user"), "Ana K.");
  assert.equal(maskGiveawayName("  Luka   ", null, "Memo user"), "Luka");
  assert.equal(maskGiveawayName("Ana Marija Novak", null, "Memo user"), "Ana N.");
  assert.equal(maskGiveawayName(null, "matej.k@example.com", "Memo user"), "ma***");
  assert.equal(maskGiveawayName("", "m@example.com", "Memo user"), "Memo user");
  assert.equal(maskGiveawayName(null, null, "Memo user"), "Memo user");
});

test("the winner is the first row only when it has reached the goal", () => {
  const leader = { name: "Ana K.", qualifiedCount: GIVEAWAY_GOAL, reachedGoalAt: "2026-09-10T10:00:00Z" };
  const runnerUp = { name: "Jan P.", qualifiedCount: GIVEAWAY_GOAL + 3, reachedGoalAt: "2026-09-11T10:00:00Z" };

  // The SQL orders by the time the goal was reached, so the first row is the
  // winner even when somebody below has a bigger count.
  assert.equal(findGiveawayWinner([leader, runnerUp]), leader);
  assert.equal(findGiveawayWinner([{ name: "Ana K.", qualifiedCount: 12, reachedGoalAt: null }]), null);
  assert.equal(findGiveawayWinner([]), null);
});

test("podium initials come from the masked name and never from the mask", () => {
  assert.equal(giveawayInitials("Zala K."), "ZK");
  assert.equal(giveawayInitials("ma***"), "M");
  assert.equal(giveawayInitials("Nika"), "N");
  assert.equal(giveawayInitials("Memo user"), "MU");
});

test("real accounts pass the seeded field on count, win ties, and win outright at the goal", () => {
  const seeds = giveawaySeedEntries();
  const real = (name, qualifiedCount, extra = {}) => ({
    name,
    qualifiedCount,
    reachedGoalAt: null,
    latestQualifiedAt: "2026-09-10T10:00:00.000Z",
    ...extra,
  });

  // More friends than the seeded leader: first place.
  assert.equal(rankGiveawayEntries([...seeds, real("Ana K.", 8)])[0].name, "Ana K.");
  // The same count as the seeded leader: still above it.
  assert.equal(rankGiveawayEntries([...seeds, real("Ana K.", 7)])[0].name, "Ana K.");
  assert.equal(rankGiveawayEntries([...seeds, real("Ana K.", 7)])[1].name, "Žiga K.");
  // Fewer: slotted where the count says, above seeds with the same count.
  const board = rankGiveawayEntries([...seeds, real("Ana K.", 3)]);
  assert.deepEqual(board.slice(4, 7).map((row) => row.name), ["Maja Z.", "Ana K.", "Jan H."]);
  // Reaching the goal: first, whatever the counts around it.
  const winner = real("Ana K.", GIVEAWAY_GOAL, { reachedGoalAt: "2026-09-20T10:00:00.000Z" });
  assert.equal(findGiveawayWinner(rankGiveawayEntries([...seeds, winner]))?.name, "Ana K.");
  // The board is capped and the ranked rows carry no tie-break time.
  assert.equal(rankGiveawayEntries(seeds, 5).length, 5);
  assert.equal("latestQualifiedAt" in rankGiveawayEntries(seeds)[0], false);
});
