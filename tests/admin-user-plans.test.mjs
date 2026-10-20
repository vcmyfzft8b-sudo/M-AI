import assert from "node:assert/strict";
import test from "node:test";

import { classifyPlanMembership } from "../src/lib/admin/user-plans.ts";

/**
 * The plan tabs on /admin/users and the counts in the tiles above them both
 * classify through this. The three filters have to partition the accounts
 * exactly: anyone counted twice, or missed, shows up as a filter that returns
 * the wrong number of rows.
 */
test("a live paid row beats a trial row for the same person", () => {
  const { paying, trialing } = classifyPlanMembership([
    { user_id: "a", status: "trialing" },
    { user_id: "a", status: "active" },
  ]);

  assert.deepEqual([...paying], ["a"]);
  assert.deepEqual([...trialing], []);
});

test("order of the rows does not change the answer", () => {
  const forwards = classifyPlanMembership([
    { user_id: "a", status: "active" },
    { user_id: "a", status: "trialing" },
  ]);

  assert.deepEqual([...forwards.paying], ["a"]);
  assert.deepEqual([...forwards.trialing], []);
});

test("past_due still counts as paying, not as free", () => {
  // They owe us money rather than having stopped being a customer, and the
  // "free" tab is the absence of both sets -- so getting this wrong would file
  // a lapsed payer alongside people who never paid.
  const { paying, trialing } = classifyPlanMembership([
    { user_id: "a", status: "past_due" },
  ]);

  assert.deepEqual([...paying], ["a"]);
  assert.deepEqual([...trialing], []);
});

test("the two sets never overlap, so the three tabs partition the accounts", () => {
  const { paying, trialing } = classifyPlanMembership([
    { user_id: "a", status: "active" },
    { user_id: "b", status: "trialing" },
    { user_id: "c", status: "past_due" },
    { user_id: "b", status: "trialing" },
    { user_id: "d", status: "trialing" },
    { user_id: "d", status: "active" },
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
