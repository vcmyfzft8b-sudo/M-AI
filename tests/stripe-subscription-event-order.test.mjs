import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { writeStripeSubscriptionRow } from "../src/lib/billing-subscription-write.ts";

// 2026-10-03 00:26 UTC: support voided the open invoice of a past_due subscription, then
// cancelled it. Stripe emitted updated(active) for the void and deleted(canceled) for the
// cancellation, delivered the active one last, and the row read `active` for a canceled plan.
const SUBSCRIPTION_ID = "sub_test_event_order";
const row = (status) => ({
  user_id: "user-1",
  stripe_customer_id: "cus_test",
  stripe_subscription_id: SUBSCRIPTION_ID,
  plan: "monthly",
  status,
});

/**
 * An in-memory `billing_subscriptions` with the semantics the write relies on: a filtered
 * UPDATE that returns the rows it touched, and an upsert on `stripe_subscription_id` that
 * either merges or, with `ignoreDuplicates`, leaves an existing row alone. Every statement
 * yields first, so two writes started together interleave the way two webhook deliveries do.
 */
function createTable() {
  const rows = new Map();
  const tick = () => new Promise((resolve) => setImmediate(resolve));

  return {
    rows,
    update(values) {
      return {
        eq(column, value) {
          return {
            not(notColumn, operator, list) {
              assert.equal(operator, "in");
              const excluded = list.replace(/[()]/g, "").split(",");
              return {
                async select() {
                  await tick();
                  const touched = [...rows.values()].filter(
                    (stored) => stored[column] === value && !excluded.includes(stored[notColumn]),
                  );
                  for (const stored of touched) {
                    Object.assign(stored, values);
                  }
                  return { data: touched.map(() => ({ id: "row" })), error: null };
                },
              };
            },
          };
        },
      };
    },
    async upsert(values, { onConflict, ignoreDuplicates = false }) {
      await tick();
      const key = values[onConflict];
      const existing = rows.get(key);
      if (existing && ignoreDuplicates) {
        return { data: null, error: null };
      }
      rows.set(key, { ...existing, ...values });
      return { data: null, error: null };
    },
  };
}

const statusOf = (table) => table.rows.get(SUBSCRIPTION_ID)?.status;

test("updated(active) delivered after deleted(canceled) leaves the row canceled", async () => {
  const table = createTable();
  await writeStripeSubscriptionRow(table, row("past_due"));
  await writeStripeSubscriptionRow(table, row("canceled"));
  await writeStripeSubscriptionRow(table, row("active"));
  assert.equal(statusOf(table), "canceled");
});

test("an expired incomplete subscription stays expired too", async () => {
  const table = createTable();
  await writeStripeSubscriptionRow(table, row("incomplete_expired"));
  await writeStripeSubscriptionRow(table, row("incomplete"));
  assert.equal(statusOf(table), "incomplete_expired");
});

test("the two deliveries racing still end canceled, whichever starts first", async () => {
  for (const order of [["active", "canceled"], ["canceled", "active"]]) {
    const table = createTable();
    await Promise.all(order.map((status) => writeStripeSubscriptionRow(table, row(status))));
    assert.equal(statusOf(table), "canceled", order.join(" then "));
  }
});

test("live states still move both ways, and a new subscription is created", async () => {
  const table = createTable();
  await writeStripeSubscriptionRow(table, row("trialing"));
  assert.equal(statusOf(table), "trialing");
  await writeStripeSubscriptionRow(table, row("past_due"));
  assert.equal(statusOf(table), "past_due");
  await writeStripeSubscriptionRow(table, row("active"));
  assert.equal(statusOf(table), "active");
  await writeStripeSubscriptionRow(table, { ...row("active"), cancel_at_period_end: true });
  assert.equal(table.rows.get(SUBSCRIPTION_ID).cancel_at_period_end, true);
});

test("a failed write throws so Stripe redelivers the event", async () => {
  const failing = {
    ...createTable(),
    async upsert() {
      return { data: null, error: { message: "boom" } };
    },
  };
  await assert.rejects(writeStripeSubscriptionRow(failing, row("canceled")), /boom/);
});

test("the webhook stores the subscription Stripe has now, not the event's copy", () => {
  const source = readFileSync(new URL("../src/app/api/stripe/webhook/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /syncStripeSubscriptionRecord/);
  const payloadReads = [...source.matchAll(/event\.data\.object as Stripe\.Subscription\)(\.\w+)?/g)];
  assert.ok(payloadReads.length > 0);
  assert.deepEqual(payloadReads.map((match) => match[1]), payloadReads.map(() => ".id"), "only the id is read from the event");
  assert.match(source, /await syncStripeSubscription\(subscriptionId\)/);
  for (const type of ["created", "updated", "deleted"]) {
    assert.match(source, new RegExp(`"customer\\.subscription\\.${type}"`));
  }

  const billing = readFileSync(new URL("../src/lib/billing.ts", import.meta.url), "utf8");
  assert.match(billing, /stripe\.subscriptions\.retrieve\(subscriptionId\)/);
});

test("billing.ts writes subscription rows only through the guarded write", () => {
  const billing = readFileSync(new URL("../src/lib/billing.ts", import.meta.url), "utf8");
  assert.match(billing, /writeStripeSubscriptionRow\(\s*service\.from\("billing_subscriptions"\)/);
  assert.doesNotMatch(billing, /from\("billing_subscriptions"\)\s*\.(upsert|update|insert)\(/);
});
