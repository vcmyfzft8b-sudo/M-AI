import assert from "node:assert/strict";
import test from "node:test";

import {
  GIVEAWAY_CODE_ALPHABET,
  GIVEAWAY_GOAL,
  buildGiveawayShareUrl,
  findGiveawayWinner,
  formatGiveawayCode,
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
