import "server-only";

import { unstable_cache } from "next/cache";

import { callRpc } from "@/lib/admin/db";
import type { AdminFixedCostRow } from "@/lib/database.types";
import { getStripeClient } from "@/lib/billing";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

import {
  fixedMonthlyCents,
  projectMetered,
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
 * Each provider is asked independently and cached for the dashboard's usual
 * quarter of an hour, so opening the page costs nothing extra and one provider
 * being down blanks its own line rather than the page. Nothing here is
 * scheduled: a figure is fetched when someone looks.
 */

/** ECB's rate on 30 Sep 2026, used only if the live rate cannot be fetched. */
const FALLBACK_EUR_PER_USD = 1 / 1.1355;

const TIMEOUT_MS = 10_000;

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

// ---------------------------------------------------------------- sources --

const cachedEurPerUsd = unstable_cache(
  async (): Promise<{ rate: number; date: string | null }> => {
    try {
      const body = (await getJson(
        "https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR",
      )) as { date?: string; rates?: { EUR?: number } };
      const rate = Number(body.rates?.EUR);

      if (Number.isFinite(rate) && rate > 0) {
        return { rate, date: body.date ?? null };
      }
    } catch {
      // Fall through to the fixed rate below.
    }

    return { rate: FALLBACK_EUR_PER_USD, date: null };
  },
  ["admin-costs-eur-per-usd"],
  { revalidate: 12 * 60 * 60 },
);

const cachedStripeMonth = unstable_cache(
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
  ["admin-costs-stripe-month"],
  { revalidate: DASHBOARD_REFRESH_SECONDS },
);

/** OpenRouter's own meter for the current calendar month (UTC), in dollars. */
const cachedOpenRouterMonth = unstable_cache(
  async (): Promise<number> => {
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

/** Soniox's usage summary for a window, in dollars. */
const cachedSonioxWindow = unstable_cache(
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
  ["admin-costs-soniox-window"],
  { revalidate: DASHBOARD_REFRESH_SECONDS },
);

/**
 * Vercel's billed charges for a window, in dollars. Needs a token allowed to
 * read billing (`VERCEL_BILLING_TOKEN`); the analytics token is not.
 */
const cachedVercelWindow = unstable_cache(
  async (fromIso: string, toIso: string): Promise<number> => {
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
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`api.vercel.com answered ${response.status}`);
    }

    // One JSON object per line (FOCUS billing format). The Pro seat is billed
    // once per cycle, so its `BilledCost` lands on one day and makes a month
    // look free or doubled; its `EffectiveCost` spreads it per day. Everything
    // else counts at `BilledCost`, what was actually charged: `EffectiveCost`
    // there includes the usage the plan already covers, priced at list.
    // Measured for Sept 2026: $19.61 seat + $9.78 billed usage = $29.39.
    let total = 0;

    for (const line of (await response.text()).split("\n")) {
      if (!line.trim()) {
        continue;
      }

      const charge = JSON.parse(line) as {
        ServiceName?: string;
        BilledCost?: number;
        EffectiveCost?: number;
      };

      total += Number(
        (charge.ServiceName === "Pro" ? charge.EffectiveCost : charge.BilledCost) ?? 0,
      );
    }

    return total;
  },
  ["admin-costs-vercel-window"],
  { revalidate: DASHBOARD_REFRESH_SECONDS },
);

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
  fixed: AdminFixedCostRow[];
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
  const [fx, stripe, openRouter, soniox, vercel, aiLog, payouts, lastRun, fixed] = await Promise.all([
    cachedEurPerUsd(),
    read(() => cachedStripeMonth(window.fromIso, window.toIso)),
    // OpenRouter only reports the month in progress.
    window.isCurrent
      ? read(() => cachedOpenRouterMonth())
      : Promise.resolve<Reading<number>>({ ok: false, reason: "past months are not reported" }),
    read(() => cachedSonioxWindow(window.utcFromIso, meteredUntil(window))),
    read(() => cachedVercelWindow(window.utcFromIso, meteredUntil(window))),
    read(() => readAiLog(window)),
    read(() => readPayouts(window.period)),
    // The month in progress has no run yet; the last one is the best guess.
    window.isCurrent
      ? read(() => readPayouts(shiftPeriod(window.period, -1)))
      : Promise.resolve<Reading<number>>({ ok: false, reason: "not needed" }),
    listFixedCosts().catch(() => [] as AdminFixedCostRow[]),
  ]);

  const rate = fx.rate;
  const lines: CostLine[] = [];
  const metered = (
    key: string,
    label: string,
    reading: Reading<number>,
    toNote: (value: number) => string,
    kind: CostLine["kind"] = "metered",
  ) => {
    const soFar = reading.ok ? reading.value : null;

    lines.push({
      key,
      label,
      kind,
      soFar,
      projected: projectMetered(soFar, window),
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
      "estimate",
    );
  }

  metered(
    "soniox",
    "Soniox (read-aloud, transcription, live tutor)",
    soniox.ok ? { ok: true, value: usdToEurCents(soniox.value, rate) } : soniox,
    () => `${usd(soniox.ok ? soniox.value : 0)} on Soniox's own meter (UTC month)`,
  );

  {
    const row = logged("gemini");
    metered(
      "gemini",
      "Google Gemini direct (scans, OCR)",
      aiLog.ok ? { ok: true, value: usdToEurCents(Number(row?.cost_usd ?? 0), rate) } : aiLog,
      () =>
        `${usd(Number(row?.cost_usd ?? 0))} over ${Number(row?.calls ?? 0).toLocaleString("en-GB")} calls in our log; Google's own bill is in the Cloud console`,
      "estimate",
    );
  }

  // Without a billing token Vercel is a fixed cost below; with one, a failed
  // read shows as missing rather than quietly falling back to the estimate.
  if (vercel.ok || process.env.VERCEL_BILLING_TOKEN?.trim()) {
    metered(
      "vercel",
      "Vercel",
      vercel.ok ? { ok: true, value: usdToEurCents(vercel.value, rate) } : vercel,
      () => `${usd(vercel.ok ? vercel.value : 0)} from Vercel's billing API: the Pro seat spread per day plus usage billed over the plan (UTC month)`,
    );
  }

  for (const cost of fixed) {
    if (!cost.active || (cost.live_source === "vercel" && process.env.VERCEL_BILLING_TOKEN?.trim())) {
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

  return { lines, stripe, eurPerUsd: rate, rateDate: fx.date, fixed };
}
