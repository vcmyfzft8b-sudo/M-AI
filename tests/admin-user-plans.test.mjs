import assert from "node:assert/strict";
import test from "node:test";

import { classifyPlanMembership, holdsPlan } from "../src/lib/admin/user-plans.ts";

const row = (user_id, status) => ({ user_id, status, stripe_subscription_id: `sub_${user_id}` });

/**
 * The plan tabs on /admin/users and the counts in the tiles above them both
 * classify through this. The three filters have to partition the accounts
 * exactly: anyone counted twice, or missed, shows up as a filter that returns
 * the wrong number of rows.
 */
test("a live paid row beats a trial row for the same person", () => {
  const { paying, trialing } = classifyPlanMembership([
    row("a", "trialing"),
    row("a", "active"),
  ]);

  assert.deepEqual([...paying], ["a"]);
  assert.deepEqual([...trialing], []);
});

test("order of the rows does not change the answer", () => {
  const forwards = classifyPlanMembership([
    row("a", "active"),
    row("a", "trialing"),
  ]);

  assert.deepEqual([...forwards.paying], ["a"]);
  assert.deepEqual([...forwards.trialing], []);
});

test("past_due still counts as paying, not as free", () => {
  // They owe us money rather than having stopped being a customer, and the
  // "free" tab is the absence of both sets -- so getting this wrong would file
  // a lapsed payer alongside people who never paid.
  const { paying, trialing } = classifyPlanMembership([
    row("a", "past_due"),
  ]);

  assert.deepEqual([...paying], ["a"]);
  assert.deepEqual([...trialing], []);
});

test("the two sets never overlap, so the three tabs partition the accounts", () => {
  const { paying, trialing } = classifyPlanMembership([
    row("a", "active"),
    row("b", "trialing"),
    row("c", "past_due"),
    row("b", "trialing"),
    row("d", "trialing"),
    row("d", "active"),
  ]);

  assert.deepEqual([...paying].sort(), ["a", "c", "d"]);
  assert.deepEqual([...trialing].sort(), ["b"]);

  for (const id of trialing) {
    assert.equal(paying.has(id), false);
  }
});

test("no subscriptions means nobody is paying and nobody is trialing", () => {
  const { paying, trialing } = classifyPlanMembership([]);

  assert.equal(paying.size, 0);
  assert.equal(trialing.size, 0);
});

/**
 * A comp is free premium granted by hand (`comp_<user>_<end date>`, no customer,
 * no price, 0 €). Its status is written `active` once and never moves, so it
 * used to count as paying -- in one case a month after it had ended.
 */
const comp = (user_id, end) => ({
  user_id,
  status: "active",
  stripe_subscription_id: `comp_${user_id}_${end.slice(0, 10).replaceAll("-", "")}`,
  current_period_end: end,
  cancel_at_period_end: true,
});
const NOW = Date.parse("2026-10-21T12:00:00Z");

test("a comp is neither paying nor trialing, live or ended", () => {
  const { paying, trialing } = classifyPlanMembership([
    comp("live", "2026-10-23T23:59:59Z"),
    comp("ended", "2026-09-14T13:54:49.99Z"),
  ]);

  assert.equal(paying.size, 0);
  assert.equal(trialing.size, 0);
});

test("a comped account that also pays is still paying", () => {
  const { paying, trialing } = classifyPlanMembership([
    comp("a", "2026-10-23T23:59:59Z"),
    row("a", "active"),
    comp("b", "2026-10-23T23:59:59Z"),
    row("b", "trialing"),
  ]);

  assert.deepEqual([...paying], ["a"]);
  assert.deepEqual([...trialing], ["b"]);
});

test("a comp holds a plan until its end date; a Stripe row by its status", () => {
  assert.equal(holdsPlan(comp("a", "2026-10-23T23:59:59Z"), NOW), true);
  assert.equal(holdsPlan(comp("a", "2026-09-14T13:54:49.99Z"), NOW), false);

  const stripeRow = { ...row("a", "active"), current_period_end: "2026-09-14T00:00:00Z", cancel_at_period_end: false };
  assert.equal(holdsPlan(stripeRow, NOW), true);
  assert.equal(holdsPlan({ ...stripeRow, status: "canceled" }, NOW), false);
});
