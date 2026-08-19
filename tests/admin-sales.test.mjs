import assert from "node:assert/strict";
import test from "node:test";

import { resolveRange } from "../src/lib/admin/ranges.ts";
import {
  conversionRatesByPlan,
  creatorRevenue,
  projectTrials,
  promoCodeStats,
  revenueSeries,
  summarizeSales,
} from "../src/lib/admin/sales-math.ts";

const NOW = new Date("2026-08-19T12:00:00Z");
const RANGE = resolveRange("7d", { now: NOW });

/** Seconds since the epoch for a wall-clock time, so fixtures read plainly. */
function at(iso) {
  return Math.floor(new Date(iso).getTime() / 1000);
}

function subscription(overrides = {}) {
  return {
    id: "sub_1",
    customerId: "cus_1",
    status: "active",
    plan: "monthly",
    currency: "eur",
    unitAmount: 2000,
    created: at("2026-08-15T10:00:00Z"),
    trialStart: null,
    trialEnd: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    promotionCodeId: null,
    ...overrides,
  };
}

function payment(overrides = {}) {
  return {
    id: "in_1",
    created: at("2026-08-18T10:00:00Z"),
    amount: 2000,
    currency: "eur",
    customerId: "cus_1",
    promotionCodeIds: [],
    ...overrides,
  };
}

function salesData(overrides = {}) {
  return {
    subscriptions: [],
    payments: [],
    promotionCodes: new Map(),
    codeRedemptions: new Map(),
    truncated: false,
    ...overrides,
  };
}

test("revenue counts only invoices inside the window", () => {
  const data = salesData({
    payments: [
      payment({ id: "in_in", created: at("2026-08-18T10:00:00Z"), amount: 2000 }),
      // Two months back: outside both the window and its comparison window.
      payment({ id: "in_old", created: at("2026-06-01T10:00:00Z"), amount: 9900 }),
    ],
  });

  const summary = summarizeSales(data, RANGE, { now: NOW });

  assert.equal(summary.revenue, 2000);
});

test("the comparison window is the seven days before, not overlapping", () => {
  const data = salesData({
    payments: [
      payment({ id: "now", created: at("2026-08-18T10:00:00Z"), amount: 2000 }),
      payment({ id: "prev", created: at("2026-08-08T10:00:00Z"), amount: 5000 }),
    ],
  });

  const summary = summarizeSales(data, RANGE, { now: NOW });

  assert.equal(summary.revenue, 2000);
  assert.equal(summary.previousRevenue, 5000);
});

test("MRR normalises weekly and yearly plans to a monthly figure", () => {
  const data = salesData({
    subscriptions: [
      subscription({ id: "m", plan: "monthly", unitAmount: 2000 }),
      subscription({ id: "y", plan: "yearly", unitAmount: 13000, customerId: "cus_2" }),
      subscription({ id: "w", plan: "weekly", unitAmount: 1000, customerId: "cus_3" }),
    ],
  });

  const summary = summarizeSales(data, RANGE, { now: NOW });

  // 2000 + 13000/12 + 1000*52/12
  assert.equal(Math.round(summary.mrr), Math.round(2000 + 13000 / 12 + (1000 * 52) / 12));
  assert.equal(summary.payingSubscriptions, 3);
});

test("a trialing subscription is live access but not yet MRR", () => {
  const data = salesData({
    subscriptions: [
      subscription({
        status: "trialing",
        trialStart: at("2026-08-18T10:00:00Z"),
        trialEnd: at("2026-08-21T10:00:00Z"),
      }),
    ],
  });

  const summary = summarizeSales(data, RANGE, { now: NOW });

  assert.equal(summary.activeSubscriptions, 1);
  assert.equal(summary.payingSubscriptions, 0);
  assert.equal(summary.mrr, 0);
  assert.equal(summary.trials.activeTrials, 1);
});

test("conversion rate is measured over finished trials only", () => {
  const data = salesData({
    subscriptions: [
      // Finished and paid: converted.
      subscription({
        id: "s1",
        customerId: "cus_a",
        status: "active",
        trialStart: at("2026-08-10T10:00:00Z"),
        trialEnd: at("2026-08-13T10:00:00Z"),
      }),
      // Finished and never paid: did not convert.
      subscription({
        id: "s2",
        customerId: "cus_b",
        status: "canceled",
        trialStart: at("2026-08-10T10:00:00Z"),
        trialEnd: at("2026-08-13T10:00:00Z"),
      }),
      // Still running: must not drag the rate down.
      subscription({
        id: "s3",
        customerId: "cus_c",
        status: "trialing",
        trialStart: at("2026-08-18T10:00:00Z"),
        trialEnd: at("2026-08-25T10:00:00Z"),
      }),
    ],
    payments: [payment({ customerId: "cus_a", amount: 2000 })],
  });

  const summary = summarizeSales(data, RANGE, { now: NOW });

  assert.equal(summary.trials.conversionSampleSize, 2, "only finished trials count");
  assert.equal(summary.trials.conversionRate, 0.5);
  assert.equal(summary.trials.averageConvertedValue, 2000);
});

test("projected revenue multiplies trials ending today by rate and value", () => {
  const trialsEndingToday = [0, 1, 2, 3].map((index) =>
    subscription({
      id: `t${index}`,
      customerId: `cus_t${index}`,
      status: "trialing",
      trialStart: at("2026-08-16T10:00:00Z"),
      // Late afternoon Ljubljana time on the 19th.
      trialEnd: at("2026-08-19T16:00:00Z"),
    }),
  );

  const data = salesData({
    subscriptions: [
      ...trialsEndingToday,
      subscription({
        id: "done-yes",
        customerId: "cus_x",
        trialStart: at("2026-08-10T10:00:00Z"),
        trialEnd: at("2026-08-13T10:00:00Z"),
      }),
      subscription({
        id: "done-no",
        customerId: "cus_y",
        status: "canceled",
        trialStart: at("2026-08-10T10:00:00Z"),
        trialEnd: at("2026-08-13T10:00:00Z"),
      }),
    ],
    payments: [payment({ customerId: "cus_x", amount: 2000 })],
  });

  const summary = summarizeSales(data, RANGE, { now: NOW });

  assert.equal(summary.trials.trialsEndingToday, 4);
  assert.equal(summary.trials.conversionRate, 0.5);
  // Each trial at its own €20.00 price x the 50% rate, summed: 4 x 1000.
  assert.equal(summary.trials.projectedRevenueToday, 4000);
});

test("projection is zero rather than NaN when nothing has converted yet", () => {
  const data = salesData({
    subscriptions: [
      subscription({
        status: "trialing",
        trialStart: at("2026-08-18T10:00:00Z"),
        trialEnd: at("2026-08-19T16:00:00Z"),
      }),
    ],
  });

  const summary = summarizeSales(data, RANGE, { now: NOW });

  assert.equal(summary.trials.conversionRate, 0);
  assert.equal(summary.trials.projectedRevenueToday, 0);
  assert.ok(Number.isFinite(summary.trials.averageConvertedValue));
});

test("the daily series covers every day in the window, zero-filled", () => {
  const data = salesData({
    payments: [payment({ created: at("2026-08-18T10:00:00Z"), amount: 2000 })],
    subscriptions: [
      subscription({
        created: at("2026-08-18T09:00:00Z"),
        trialStart: at("2026-08-18T09:00:00Z"),
      }),
    ],
  });

  const series = revenueSeries(data, RANGE);

  assert.equal(series.length, 7);
  assert.deepEqual(series[0], {
    day: "2026-08-13",
    revenue: 0,
    newSubscriptions: 0,
    trialsStarted: 0,
  });

  const eighteenth = series.find((point) => point.day === "2026-08-18");
  assert.deepEqual(eighteenth, {
    day: "2026-08-18",
    revenue: 2000,
    newSubscriptions: 1,
    trialsStarted: 1,
  });
});

test("promo code revenue is attributed from the invoice discount", () => {
  const data = salesData({
    promotionCodes: new Map([
      ["promo_ema", "EMA50"],
      ["promo_david", "DAVID50"],
    ]),
    payments: [
      payment({ id: "p1", customerId: "cus_1", amount: 1000, promotionCodeIds: ["promo_ema"] }),
      payment({ id: "p2", customerId: "cus_2", amount: 1000, promotionCodeIds: ["promo_ema"] }),
      payment({ id: "p3", customerId: "cus_3", amount: 2000, promotionCodeIds: ["promo_david"] }),
      payment({ id: "p4", customerId: "cus_4", amount: 5000 }),
    ],
  });

  const stats = promoCodeStats(data, RANGE);

  assert.equal(stats.get("EMA50").revenue, 2000);
  assert.equal(stats.get("EMA50").payments, 2);
  assert.equal(stats.get("EMA50").customers, 2);
  assert.equal(stats.get("DAVID50").revenue, 2000);
  assert.equal(stats.get("DAVID50").customers, 1);
});

test("the same customer paying twice on one code counts once as a customer", () => {
  const data = salesData({
    promotionCodes: new Map([["promo_ema", "EMA50"]]),
    payments: [
      payment({ id: "p1", customerId: "cus_1", amount: 1000, promotionCodeIds: ["promo_ema"] }),
      payment({ id: "p2", customerId: "cus_1", amount: 1000, promotionCodeIds: ["promo_ema"] }),
    ],
  });

  const stats = promoCodeStats(data, RANGE);

  assert.equal(stats.get("EMA50").payments, 2);
  assert.equal(stats.get("EMA50").customers, 1);
});

test("a creator's revenue is the sum of every code they own", () => {
  const data = salesData({
    promotionCodes: new Map([
      ["promo_martin", "MARTIN50"],
      ["promo_david", "DAVID50"],
      ["promo_ema", "EMA50"],
    ]),
    payments: [
      payment({ id: "p1", customerId: "c1", amount: 1000, promotionCodeIds: ["promo_martin"] }),
      payment({ id: "p2", customerId: "c2", amount: 3000, promotionCodeIds: ["promo_david"] }),
      payment({ id: "p3", customerId: "c3", amount: 7000, promotionCodeIds: ["promo_ema"] }),
    ],
  });

  const byCreator = creatorRevenue(
    [
      // Martin & David share one creator row and hold a code each.
      { id: "creator-md", promo_codes: ["MARTIN50", "DAVID50"] },
      { id: "creator-ema", promo_codes: ["ema50"] },
      { id: "creator-none", promo_codes: [] },
    ],
    promoCodeStats(data, RANGE),
  );

  assert.equal(byCreator.get("creator-md").revenue, 4000);
  assert.equal(byCreator.get("creator-md").payments, 2);
  // Codes are matched case-insensitively.
  assert.equal(byCreator.get("creator-ema").revenue, 7000);
  assert.equal(byCreator.get("creator-none").revenue, 0);
});

test("a payment outside the window is not attributed to the creator", () => {
  const data = salesData({
    promotionCodes: new Map([["promo_ema", "EMA50"]]),
    payments: [
      payment({ created: at("2026-06-01T10:00:00Z"), amount: 9900, promotionCodeIds: ["promo_ema"] }),
    ],
  });

  const byCreator = creatorRevenue(
    [{ id: "creator-ema", promo_codes: ["EMA50"] }],
    promoCodeStats(data, RANGE),
  );

  assert.equal(byCreator.get("creator-ema").revenue, 0);
});

test("cancellations are counted by the day they were cancelled", () => {
  const data = salesData({
    subscriptions: [
      subscription({ id: "c1", canceledAt: at("2026-08-18T10:00:00Z") }),
      subscription({ id: "c2", canceledAt: at("2026-06-01T10:00:00Z") }),
      subscription({ id: "c3", canceledAt: null }),
    ],
  });

  assert.equal(summarizeSales(data, RANGE, { now: NOW }).canceledInRange, 1);
});

test("the daily forecast is trials ending that day at the current rate", async () => {
  const { trialForecast } = await import("../src/lib/admin/sales-math.ts");

  const data = salesData({
    subscriptions: [
      // Two finished trials, one converted: a 50% rate at €20.
      subscription({
        id: "done-yes",
        customerId: "cus_x",
        trialStart: at("2026-08-10T10:00:00Z"),
        trialEnd: at("2026-08-13T10:00:00Z"),
      }),
      subscription({
        id: "done-no",
        customerId: "cus_y",
        status: "canceled",
        trialStart: at("2026-08-10T10:00:00Z"),
        trialEnd: at("2026-08-13T10:00:00Z"),
      }),
      // Three still running: two end tomorrow, one in three days.
      subscription({
        id: "t1",
        customerId: "cus_1",
        status: "trialing",
        trialEnd: at("2026-08-20T16:00:00Z"),
      }),
      subscription({
        id: "t2",
        customerId: "cus_2",
        status: "trialing",
        trialEnd: at("2026-08-20T18:00:00Z"),
      }),
      subscription({
        id: "t3",
        customerId: "cus_3",
        status: "trialing",
        trialEnd: at("2026-08-22T09:00:00Z"),
      }),
    ],
    payments: [payment({ customerId: "cus_x", amount: 2000 })],
  });

  const forecast = trialForecast(data, { days: 5, now: NOW });

  assert.equal(forecast.rates.overall, 0.5);
  assert.equal(forecast.days.length, 5);
  assert.equal(forecast.days[0].day, "2026-08-19");

  const tomorrow = forecast.days.find((day) => day.day === "2026-08-20");
  assert.equal(tomorrow.trialsEnding, 2);
  // 2 trials x 50% x €20.00
  assert.equal(tomorrow.projectedRevenue, 2000);

  const later = forecast.days.find((day) => day.day === "2026-08-22");
  assert.equal(later.trialsEnding, 1);
  assert.equal(later.projectedRevenue, 1000);
});

test("a better conversion rate raises the forecast with no other change", async () => {
  const { trialForecast } = await import("../src/lib/admin/sales-math.ts");

  const upcoming = subscription({
    id: "t1",
    customerId: "cus_1",
    status: "trialing",
    trialEnd: at("2026-08-20T16:00:00Z"),
  });

  const finished = (id, converted) =>
    subscription({
      id,
      customerId: `cus_${id}`,
      status: converted ? "active" : "canceled",
      trialEnd: at("2026-08-13T10:00:00Z"),
    });

  const poor = trialForecast(
    salesData({
      subscriptions: [upcoming, finished("a", true), finished("b", false), finished("c", false)],
      payments: [payment({ customerId: "cus_a", amount: 2000 })],
    }),
    { days: 3, now: NOW },
  );

  const good = trialForecast(
    salesData({
      subscriptions: [upcoming, finished("a", true), finished("b", true), finished("c", false)],
      payments: [
        payment({ id: "p1", customerId: "cus_a", amount: 2000 }),
        payment({ id: "p2", customerId: "cus_b", amount: 2000 }),
      ],
    }),
    { days: 3, now: NOW },
  );

  assert.ok(good.rates.overall > poor.rates.overall);

  const poorDay = poor.days.find((day) => day.day === "2026-08-20");
  const goodDay = good.days.find((day) => day.day === "2026-08-20");
  assert.ok(goodDay.projectedRevenue > poorDay.projectedRevenue);
});

test("a trial that already ended is not forecast again", async () => {
  const { trialForecast } = await import("../src/lib/admin/sales-math.ts");

  const forecast = trialForecast(
    salesData({
      subscriptions: [
        subscription({
          id: "past",
          status: "trialing",
          trialEnd: at("2026-08-01T10:00:00Z"),
        }),
      ],
    }),
    { days: 5, now: NOW },
  );

  assert.equal(
    forecast.days.reduce((sum, day) => sum + day.trialsEnding, 0),
    0,
  );
});

test("a yearly and a monthly trial are valued separately, never averaged", () => {
  // The bug this guards: projecting `trials x rate x mean price` valued a
  // €130 yearly trial and a €20 monthly one at the same blended €75, which
  // matches no actual customer and moves with the mix rather than the money.
  const finished = (id, plan, amount, converted) =>
    subscription({
      id,
      customerId: `cus_${id}`,
      plan,
      unitAmount: amount,
      status: converted ? "active" : "canceled",
      trialEnd: at("2026-08-13T10:00:00Z"),
    });

  // 30 finished monthly trials, 15 converted -> 50%.
  const monthlyFinished = Array.from({ length: 30 }, (_, index) =>
    finished(`m${index}`, "monthly", 2000, index < 15),
  );
  // 20 finished yearly trials, 5 converted -> 25%.
  const yearlyFinished = Array.from({ length: 20 }, (_, index) =>
    finished(`y${index}`, "yearly", 13000, index < 5),
  );

  const payments = [...monthlyFinished, ...yearlyFinished]
    .filter((s) => s.status === "active")
    .map((s, index) =>
      payment({ id: `p${index}`, customerId: s.customerId, amount: s.unitAmount }),
    );

  const upcoming = [
    subscription({
      id: "up-m",
      customerId: "cus_up_m",
      plan: "monthly",
      unitAmount: 2000,
      status: "trialing",
      trialEnd: at("2026-08-19T16:00:00Z"),
    }),
    subscription({
      id: "up-y",
      customerId: "cus_up_y",
      plan: "yearly",
      unitAmount: 13000,
      status: "trialing",
      trialEnd: at("2026-08-19T16:00:00Z"),
    }),
  ];

  const data = salesData({
    subscriptions: [...monthlyFinished, ...yearlyFinished, ...upcoming],
    payments,
  });

  const rates = conversionRatesByPlan(data, NOW);
  assert.equal(rates.byPlan.get("monthly").rate, 0.5);
  assert.equal(rates.byPlan.get("yearly").rate, 0.25);

  // €20.00 x 50% + €130.00 x 25% = €10.00 + €32.50
  assert.equal(projectTrials(upcoming, rates), 1000 + 3250);

  const summary = summarizeSales(data, RANGE, { now: NOW });
  assert.equal(summary.trials.projectedRevenueToday, 4250);
});

test("a plan with too little history falls back to the overall rate", () => {
  const finished = (id, converted) =>
    subscription({
      id,
      customerId: `cus_${id}`,
      plan: "monthly",
      unitAmount: 2000,
      status: converted ? "active" : "canceled",
      trialEnd: at("2026-08-13T10:00:00Z"),
    });

  const monthly = Array.from({ length: 30 }, (_, index) =>
    finished(`m${index}`, index < 15),
  );

  // One weekly trial upcoming, with no weekly history at all to learn from.
  const weekly = subscription({
    id: "w",
    customerId: "cus_w",
    plan: "weekly",
    unitAmount: 1000,
    status: "trialing",
    trialEnd: at("2026-08-19T16:00:00Z"),
  });

  const data = salesData({
    subscriptions: [...monthly, weekly],
    payments: monthly
      .filter((s) => s.status === "active")
      .map((s, index) => payment({ id: `p${index}`, customerId: s.customerId })),
  });

  const rates = conversionRatesByPlan(data, NOW);
  assert.equal(rates.byPlan.has("weekly"), false, "too small a sample to trust");
  // Falls back to the overall 50%: €10.00 x 50%.
  assert.equal(projectTrials([weekly], rates), 500);
});
