import "server-only";

import { unstable_cache } from "next/cache";

import { callRpc } from "@/lib/admin/db";
import type { AdminFixedCostRow } from "@/lib/database.types";
import { getStripeClient } from "@/lib/billing";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

import {
  fixedMonthlyCents,
  projectMetered,
  shareBefore,
  summarizeStripeBalance,
  usdToEurCents,
  type CostLine,
  type MonthWindow,
  type StripeBalanceRow,
  type StripeMonth,
} from "./costs-math.ts";
import { periodStart, shiftPeriod, toCents, type PeriodKey } from "./payouts-math.ts";
import { DASHBOARD_REFRESH_SECONDS } from "./refresh.ts";

/**
 * Reads every running cost for a month.
 *
 * Each provider is asked independently, so one being down blanks its own line
 * rather than the page. Nothing here is scheduled: a figure is fetched when
 * someone looks, and cached so that looking again costs nothing. A month still
 * in progress is re-read on the dashboard's quarter-hour beat; a month that
 * has closed cannot change and is kept for a week.
 */

/** ECB's rate on 30 Sep 2026, used only if the live rate cannot be fetched. */
const FALLBACK_EUR_PER_USD = 1 / 1.1355;

const TIMEOUT_MS = 10_000;

const CLOSED_SECONDS = 7 * 24 * 60 * 60;

type Reading<T> = { ok: true; value: T } | { ok: false; reason: string };

async function read<T>(work: () => Promise<T>): Promise<Reading<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`${new URL(url).host} answered ${response.status}`);
  }

  return response.json();
}

/**
 * The same reader cached twice: on the dashboard's beat for windows that can
 * still move, for a week for ones that cannot. Next keys each by its
 * arguments, and never caches a thrown error.
 */
function cachedTwice<A extends string[], T>(name: string, fn: (...args: A) => Promise<T>) {
  const recent = unstable_cache(fn, [`${name}-recent`], { revalidate: DASHBOARD_REFRESH_SECONDS });
  const closed = unstable_cache(fn, [`${name}-closed`], { revalidate: CLOSED_SECONDS });

  return (isClosed: boolean, ...args: A) => (isClosed ? closed(...args) : recent(...args));
}

/**
 * A month is closed once it ended more than two days ago: late charges and
 * provider meters settle within that.
 */
function isClosed(window: MonthWindow): boolean {
  return !window.isCurrent && Date.now() - Date.parse(window.toIso) > 2 * 24 * 60 * 60 * 1000;
}

// ---------------------------------------------------------------- sources --

const cachedEurPerUsd = unstable_cache(
  async (): Promise<{ rate: number; date: string | null }> => {
    const body = (await getJson(
      "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR",
    )) as { date?: string; rates?: { EUR?: number } };
    const rate = Number(body.rates?.EUR);

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("no EUR rate in the answer");
    }

    return { rate, date: body.date ?? null };
  },
  ["admin-costs-eur-per-usd"],
  { revalidate: 12 * 60 * 60 },
);

const stripeMonth = cachedTwice(
  "admin-costs-stripe-month",
  async (fromIso: string, toIso: string): Promise<StripeMonth> => {
    const stripe = getStripeClient();
    const rows: StripeBalanceRow[] = [];
    let startingAfter: string | undefined;

    // A month is a few hundred transactions; the cap only guards a runaway.
    for (let page = 0; page < 30; page += 1) {
      const result = await stripe.balanceTransactions.list({
        created: {
          gte: Math.floor(Date.parse(fromIso) / 1000),
          lt: Math.floor(Date.parse(toIso) / 1000),
        },
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });

      rows.push(
        ...result.data.map((row) => ({ type: row.type, amount: row.amount, fee: row.fee })),
      );

      if (!result.has_more || result.data.length === 0) {
        return summarizeStripeBalance(rows);
      }

      startingAfter = result.data[result.data.length - 1].id;
    }

    throw new Error("Stripe returned more transactions than expected for one month");
  },
);

/**
 * OpenRouter's own meter for the current UTC month, in dollars. It only ever
 * reports the month in progress; the month is passed in so a cached reading
 * cannot outlive the month it belongs to.
 */
const cachedOpenRouterMonth = unstable_cache(
  async (utcMonth: string): Promise<number> => {
    // The meter answers for whatever month it is now, not the one asked for.
    if (utcMonth !== new Date().toISOString().slice(0, 7)) {
      throw new Error(`OpenRouter only reports the current month, not ${utcMonth}`);
    }

    const key = process.env.OPENROUTER_API_KEY?.trim();

    if (!key) {
      throw new Error("OPENROUTER_API_KEY is not set here");
    }

    const body = (await getJson("https://openrouter.ai/api/v1/key", {
      headers: { Authorization: `Bearer ${key}` },
    })) as { data?: { usage_monthly?: number } };
    const usage = Number(body.data?.usage_monthly);

    if (!Number.isFinite(usage)) {
      throw new Error("OpenRouter did not report a monthly usage");
    }

    return usage;
  },
  ["admin-costs-openrouter-month"],
  { revalidate: DASHBOARD_REFRESH_SECONDS },
);

/** Soniox's usage summary for a window of whole UTC days, in dollars. */
const sonioxWindow = cachedTwice(
  "admin-costs-soniox-window",
  async (fromIso: string, toIso: string): Promise<number> => {
    const key = process.env.SONIOX_API_KEY?.trim();

    if (!key) {
      throw new Error("SONIOX_API_KEY is not set here");
    }

    const url = new URL("https://api.soniox.com/v1/usage/summary");
    url.searchParams.set("start_time", fromIso);
    url.searchParams.set("end_time", toIso);

    const body = (await getJson(url.toString(), {
      headers: { Authorization: `Bearer ${key}` },
    })) as { total?: { total_cost_usd?: string | number } };
    const cost = Number(body.total?.total_cost_usd);

    if (!Number.isFinite(cost)) {
      throw new Error("Soniox did not report a cost");
    }

    return cost;
  },
);

/**
 * What one billing line costs, in dollars.
 *
 * The Pro seat is billed once per cycle, so its `BilledCost` lands on one day
 * and makes a month look free or doubled; its `EffectiveCost` spreads it per
 * day. Everything else counts at `BilledCost`, what was actually charged:
 * `EffectiveCost` there includes usage the plan already covers, priced at
 * list. Measured for Sept 2026: $19.61 seat + $9.78 billed usage = $29.39.
 */
function vercelChargeUsd(line: string): number {
  if (!line.trim()) {
    return 0;
  }

  try {
    const charge = JSON.parse(line) as {
      ServiceName?: string;
      BilledCost?: number;
      EffectiveCost?: number;
    };
    const cost = Number(
      (charge.ServiceName === "Pro" ? charge.EffectiveCost : charge.BilledCost) ?? 0,
    );

    return Number.isFinite(cost) ? cost : 0;
  } catch {
    return 0;
  }
}

/**
 * Vercel's charges for a window, in dollars, read as a stream: a whole month
 * is ~15 MB of JSON lines, so nothing holds it all at once. Needs a token
 * allowed to read billing (`VERCEL_BILLING_TOKEN`); the analytics one is not.
 * Returns the charge periods (07:00–07:00 UTC) that ended inside the window.
 */
async function fetchVercelWindow(fromIso: string, toIso: string): Promise<number> {
  const token = process.env.VERCEL_BILLING_TOKEN?.trim();
  const teamId =
    process.env.VERCEL_ANALYTICS_TEAM_ID?.trim() || process.env.VERCEL_TEAM_ID?.trim();

  if (!token || !teamId) {
    throw new Error("no billing token");
  }

  const url = new URL("https://api.vercel.com/v1/billing/charges");
  url.searchParams.set("teamId", teamId);
  url.searchParams.set("from", fromIso);
  url.searchParams.set("to", toIso);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
    // A month runs to ~15 MB; measured at about 4 s.
    signal: AbortSignal.timeout(2 * TIMEOUT_MS),
  });

  // Vercel only returns charge periods that have finished inside the window,
  // and answers a window with none (the first hours of a month) with a 404.
  if (response.status === 404) {
    const body = await response.text();

    if (body.includes("costs_not_found")) {
      return 0;
    }

    throw new Error("api.vercel.com answered 404");
  }

  if (!response.ok || !response.body) {
    throw new Error(`api.vercel.com answered ${response.status}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += value;

    let newline = buffer.indexOf("\n");

    while (newline >= 0) {
      total += vercelChargeUsd(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }

  return total + vercelChargeUsd(buffer);
}

/**
 * Vercel for a window, cached like the others. Always asked for a whole month
 * (or the month so far), never a day at a time: the billed amount for the same
 * charge period changes with the window asked about, because the plan's
 * included usage is spread over it — Sept 2026 came to $29.39 asked as a month
 * and $47.69 summed day by day.
 */
const vercelWindow = cachedTwice("admin-costs-vercel-window", fetchVercelWindow);

async function readAiLog(window: MonthWindow) {
  const { data, error } = await callRpc(
    createSupabaseServiceRoleClient(),
    "admin_ai_cost_by_provider",
    { p_from: window.fromIso, p_to: window.toIso },
  );

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

async function readPayouts(period: PeriodKey): Promise<number> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("ugc_creator_payouts")
    .select("base_amount, bonus_amount")
    .eq("period", periodStart(period));

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<{ base_amount: number | string; bonus_amount: number | string }>)
    .reduce((sum, row) => sum + toCents(row.base_amount) + toCents(row.bonus_amount), 0);
}

export async function listFixedCosts(): Promise<AdminFixedCostRow[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("admin_fixed_costs")
    .select("*")
    .order("active", { ascending: false })
    .order("name", { ascending: true });

  if (error) {
    throw new Error(`Could not load fixed costs: ${error.message}`);
  }

  return (data as unknown as AdminFixedCostRow[]) ?? [];
}

// ------------------------------------------------------------------ table --

export type RunningCosts = {
  lines: CostLine[];
  stripe: Reading<StripeMonth>;
  eurPerUsd: number;
  /** The ECB reference date of the rate, null when the fallback was used. */
  rateDate: string | null;
  /** Null when the fixed costs could not be read. */
  fixed: AdminFixedCostRow[] | null;
};

const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * Where to stop asking a day-metered provider about the month in progress.
 *
 * Vercel answers a window that runs into the future with charges it has only
 * scheduled — the whole month's Pro seat on the 2nd — so the current month
 * stops at the present hour (an hour, not the instant, so the cache key holds
 * for the quarter-hour the dashboard caches for).
 */
function meteredUntil(window: MonthWindow): string {
  if (!window.isCurrent) {
    return window.utcToIso;
  }

  const hour = new Date();
  hour.setUTCMinutes(0, 0, 0);

  return hour.toISOString();
}

export async function loadRunningCosts(window: MonthWindow): Promise<RunningCosts> {
  const closed = isClosed(window);
  const until = meteredUntil(window);
  // Vercel's periods finish once a day, so the month in progress is read up to
  // the last UTC midnight: complete periods only, and one cold read a day.
  const vercelUntil = window.isCurrent ? `${until.slice(0, 10)}T00:00:00.000Z` : window.utcToIso;
  const utcMonthNow = new Date().toISOString().slice(0, 7);
  // OpenRouter's meter is the current UTC month, which is a different month
  // from Ljubljana's for an hour or two at each end.
  const openRouterLive = window.isCurrent && utcMonthNow === window.period;

  const [fx, stripe, openRouter, soniox, vercel, aiLog, payouts, lastRun, fixed] = await Promise.all([
    cachedEurPerUsd().catch(() => ({ rate: FALLBACK_EUR_PER_USD, date: null })),
    read(() => stripeMonth(closed, window.fromIso, window.toIso)),
    openRouterLive
      ? read(() => cachedOpenRouterMonth(utcMonthNow))
      : Promise.resolve<Reading<number>>({ ok: false, reason: "only the month in progress is reported" }),
    read(() => sonioxWindow(closed, window.utcFromIso, until)),
    read(() => vercelWindow(closed, window.utcFromIso, vercelUntil)),
    read(() => readAiLog(window)),
    read(() => readPayouts(window.period)),
    // The month in progress has no run yet; the last one is the best guess.
    window.isCurrent
      ? read(() => readPayouts(shiftPeriod(window.period, -1)))
      : Promise.resolve<Reading<number>>({ ok: false, reason: "not needed" }),
    read(() => listFixedCosts()),
  ]);

  const rate = fx.rate;
  const hasBillingToken = Boolean(process.env.VERCEL_BILLING_TOKEN?.trim());
  // How much of the month each kind of reading has seen.
  const coveredUtcToHour = shareBefore(window.utcFromIso, window.utcToIso, until);
  const coveredUtcNow = shareBefore(window.utcFromIso, window.utcToIso, new Date().toISOString());
  const coveredVercel = shareBefore(window.utcFromIso, window.utcToIso, vercelUntil);

  const lines: CostLine[] = [];
  const metered = (
    key: string,
    label: string,
    reading: Reading<number>,
    toNote: (value: number) => string,
    options: { kind?: CostLine["kind"]; covered?: number } = {},
  ) => {
    const soFar = reading.ok ? reading.value : null;

    lines.push({
      key,
      label,
      kind: options.kind ?? "metered",
      soFar,
      projected: projectMetered(soFar, window, options.covered),
      note: reading.ok ? toNote(reading.value) : `Unavailable — ${reading.reason}`,
    });
  };

  metered(
    "stripe",
    "Stripe fees",
    stripe.ok ? { ok: true, value: stripe.value.fees } : stripe,
    () => "Card processing plus Stripe Billing, from Stripe's balance",
  );

  const aiRows = aiLog.ok ? aiLog.value : [];
  const logged = (bucket: string) => aiRows.find((row) => row.bucket === bucket);

  if (openRouter.ok) {
    metered(
      "openrouter",
      "OpenRouter (GLM notes, tutor, checks)",
      { ok: true, value: usdToEurCents(openRouter.value, rate) },
      () => `${usd(openRouter.value)} on OpenRouter's own meter (UTC month)`,
      { covered: coveredUtcNow },
    );
  } else {
    const row = logged("openrouter");
    metered(
      "openrouter",
      "OpenRouter (GLM notes, tutor, checks)",
      aiLog.ok
        ? { ok: true, value: usdToEurCents(Number(row?.cost_usd ?? 0), rate) }
        : aiLog,
      () =>
        `${usd(Number(row?.cost_usd ?? 0))} from our call log — runs low: some models are logged without a price`,
      { kind: "estimate" },
    );
  }

  metered(
    "soniox",
    "Soniox (read-aloud, transcription, live tutor)",
    soniox.ok ? { ok: true, value: usdToEurCents(soniox.value, rate) } : soniox,
    () => `${usd(soniox.ok ? soniox.value : 0)} on Soniox's own meter (UTC month)`,
    { covered: coveredUtcToHour },
  );

  {
    const row = logged("gemini");
    metered(
      "gemini",
      "Google Gemini direct (scans, OCR)",
      aiLog.ok ? { ok: true, value: usdToEurCents(Number(row?.cost_usd ?? 0), rate) } : aiLog,
      () =>
        `${usd(Number(row?.cost_usd ?? 0))} over ${Number(row?.calls ?? 0).toLocaleString("en-GB")} calls in our log; Google's own bill is in the Cloud console`,
      { kind: "estimate" },
    );
  }

  // Without a billing token Vercel is a fixed cost below; with one, a failed
  // read shows as missing rather than quietly falling back to the estimate.
  if (hasBillingToken) {
    metered(
      "vercel",
      "Vercel",
      vercel.ok ? { ok: true, value: usdToEurCents(vercel.value, rate) } : vercel,
      () =>
        `${usd(vercel.ok ? vercel.value : 0)} from Vercel's billing API: the Pro seat spread per day plus usage billed over the plan (UTC month${window.isCurrent ? ", to last midnight" : ""})`,
      { covered: coveredVercel },
    );
  }

  if (fixed.ok) {
    for (const cost of fixed.value) {
      if (!cost.active || (cost.live_source === "vercel" && hasBillingToken)) {
        continue;
      }

      const monthly = fixedMonthlyCents(cost, rate);
      const amount = `${cost.currency === "usd" ? "$" : "€"}${Number(cost.amount).toFixed(2)}`;

      lines.push({
        key: `fixed:${cost.id}`,
        label: cost.name,
        kind: "fixed",
        soFar: monthly,
        projected: monthly,
        note: `${amount} ${cost.cadence === "yearly" ? "a year, a twelfth each month" : "a month"}${
          cost.note ? ` · ${cost.note}` : ""
        }`,
      });
    }
  } else {
    lines.push({
      key: "fixed",
      label: "Fixed costs",
      kind: "fixed",
      soFar: null,
      projected: null,
      note: `Unavailable — ${fixed.reason}`,
    });
  }

  const expected =
    payouts.ok && payouts.value === 0 && window.isCurrent && lastRun.ok && lastRun.value > 0
      ? lastRun.value
      : null;

  lines.push({
    key: "payouts",
    label: "Creator payouts",
    kind: "payouts",
    soFar: payouts.ok ? payouts.value : null,
    projected: payouts.ok ? (expected ?? payouts.value) : null,
    note: !payouts.ok
      ? `Unavailable — ${payouts.reason}`
      : payouts.value > 0
        ? "The run recorded on the Payouts page for this month"
        : expected !== null
          ? "Paid after the month ends — projected at last month's run"
          : "No run recorded yet — creators are paid after the month ends",
  });

  return {
    lines,
    stripe,
    eurPerUsd: rate,
    rateDate: fx.date,
    fixed: fixed.ok ? fixed.value : null,
  };
}
