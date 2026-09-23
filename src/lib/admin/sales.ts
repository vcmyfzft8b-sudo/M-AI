import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import type Stripe from "stripe";

import { addDays, parseDay, todayInReportZone } from "@/lib/admin/ranges";
import { mapWithConcurrency } from "@/lib/concurrency";
import { DASHBOARD_REFRESH_SECONDS } from "@/lib/admin/refresh";
import type {
  AppleCodeSale,
  PaymentSnapshot,
  SalesData,
  SubscriptionSnapshot,
} from "@/lib/admin/sales-math";
import { getStripeClient } from "@/lib/billing";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Sales reporting straight from Stripe.
 *
 * The local `billing_subscriptions` table only mirrors what the webhook has
 * seen, so revenue is read from Stripe itself. Volumes are small (a few hundred
 * subscriptions), which is what makes full pagination affordable here.
 */

export const SALES_CACHE_TAG = "admin-sales";

/** Hard page caps so a runaway account can never hang a dashboard request. */
const MAX_PAGES_PER_WINDOW = 20;
const PAGE_SIZE = 100;

const DAY_SECONDS = 24 * 60 * 60;

/**
 * How wide each slice of a Stripe listing is, in days.
 *
 * Stripe pages are walked with a cursor, so a listing of 700 invoices was
 * seven dependent round trips — and an invoice page is slow in proportion to
 * its size: 100 invoices take six to ten seconds to come back, 25 take one
 * and a half. Filtering by `created` instead splits the listing into small
 * independent windows that are fetched together, so the whole scan takes
 * about as long as one small page. A week holds a few dozen invoices even in
 * the busiest month so far; a busier week simply paginates on its own.
 *
 * Subscriptions come back far faster per object, so they are sliced wider to
 * keep the number of parallel requests well inside Stripe's rate limit.
 */
const INVOICE_WINDOW_DAYS = 7;
const SUBSCRIPTION_WINDOW_DAYS = 21;

function amountFromSubscription(subscription: Stripe.Subscription): number {
  return subscription.items.data.reduce((sum, item) => {
    const unit = item.price?.unit_amount ?? 0;
    return sum + unit * (item.quantity ?? 1);
  }, 0);
}

function planFromSubscription(subscription: Stripe.Subscription): string | null {
  const price = subscription.items.data[0]?.price;

  if (!price) {
    return null;
  }

  const metadataPlan = price.metadata?.["plan"];

  if (typeof metadataPlan === "string" && metadataPlan) {
    return metadataPlan;
  }

  const interval = price.recurring?.interval;

  return interval ? `${interval}ly` : null;
}

/**
 * Normalises the many shapes a discount reference can take. Depending on the
 * pinned API version a discount arrives as an id string, an expanded object, or
 * a `{ promotion_code }` on the object.
 */
function readPromotionCodeId(discount: unknown): string | null {
  if (typeof discount === "string") {
    return null; // Unexpanded: the id is the discount, not the promotion code.
  }

  if (discount && typeof discount === "object") {
    const promotionCode = (discount as { promotion_code?: unknown }).promotion_code;

    if (typeof promotionCode === "string") {
      return promotionCode;
    }

    if (promotionCode && typeof promotionCode === "object") {
      const id = (promotionCode as { id?: unknown }).id;
      return typeof id === "string" ? id : null;
    }
  }

  return null;
}

type CreatedWindow = { gte: number; lt: number };

/**
 * Consecutive `created` windows covering `sinceUnix` up to now.
 *
 * Boundaries are aligned to multiples of the width from the Unix epoch rather
 * than counted back from now, so the same window has the same boundaries on
 * every call. That is what lets a finished window be cached under a stable
 * key instead of shifting a few minutes each time the page loads.
 *
 * With `openStart` the first window starts at the epoch, for listings that
 * must include everything ever created rather than a recent slice.
 */
function createdWindows(
  sinceUnix: number,
  widthDays: number,
  options?: { openStart?: boolean },
): CreatedWindow[] {
  const width = widthDays * DAY_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  const windows: CreatedWindow[] = [];

  for (let from = Math.floor(sinceUnix / width) * width; from < now; from += width) {
    windows.push({ gte: from, lt: from + width });
  }

  if (options?.openStart) {
    windows[0] = { gte: 0, lt: windows[0].lt };
  }

  return windows;
}

/**
 * How many windows of one listing are in flight at once.
 *
 * Stripe caps concurrent requests per endpoint (the 429 says
 * `endpoint-concurrency`), and 60 invoice windows fired together hit it.
 * Eight in flight keeps the scan well inside the cap while still finishing
 * in a fraction of the serial walk's time.
 */
const WINDOW_CONCURRENCY = 8;

/** Walks one window page by page. Each page arrives newest first. */
async function listWindow<T extends { id: string }>(
  window: CreatedWindow,
  fetchPage: (params: {
    created: CreatedWindow;
    starting_after?: string;
  }) => Promise<Stripe.ApiList<T>>,
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = [];
  let startingAfter: string | undefined;

  for (let page = 0; page < MAX_PAGES_PER_WINDOW; page += 1) {
    const result = await fetchPage({ created: window, starting_after: startingAfter });

    items.push(...result.data);

    if (!result.has_more) {
      return { items, truncated: false };
    }

    startingAfter = result.data[result.data.length - 1]?.id;

    if (!startingAfter) {
      return { items, truncated: false };
    }
  }

  return { items, truncated: true };
}

/**
 * Concatenates window results from the latest window backwards.
 *
 * Stripe returns each page newest first, so this keeps the order a single
 * serial walk would have produced — which the invoice pass relies on when it
 * takes the first code it sees for a customer.
 */
function newestFirst<T>(
  shards: Array<{ items: T[]; truncated: boolean }>,
): { items: T[]; truncated: boolean } {
  return {
    items: shards
      .slice()
      .reverse()
      .flatMap((shard) => shard.items),
    truncated: shards.some((shard) => shard.truncated),
  };
}

async function loadSubscriptions(stripe: Stripe, sinceUnix: number) {
  const { items, truncated } = newestFirst(
    await mapWithConcurrency(
      // Open at the bottom: a subscription is live however long ago it began.
      createdWindows(sinceUnix, SUBSCRIPTION_WINDOW_DAYS, { openStart: true }),
      WINDOW_CONCURRENCY,
      (window) =>
        listWindow(window, (params) =>
          stripe.subscriptions.list({
            status: "all",
            limit: PAGE_SIZE,
            ...params,
            expand: ["data.discounts"],
          }),
        ),
    ),
  );

  const subscriptions: SubscriptionSnapshot[] = items.map((subscription) => {
    const period = subscription.items.data[0];

    return {
      id: subscription.id,
      customerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : (subscription.customer?.id ?? null),
      status: subscription.status,
      plan: planFromSubscription(subscription),
      currency: subscription.currency ?? "eur",
      unitAmount: amountFromSubscription(subscription),
      created: subscription.created,
      trialStart: subscription.trial_start ?? null,
      trialEnd: subscription.trial_end ?? null,
      // Newer API versions moved the period end onto the subscription item.
      currentPeriodEnd:
        (subscription as unknown as { current_period_end?: number | null })
          .current_period_end ??
        (period as unknown as { current_period_end?: number | null })
          ?.current_period_end ??
        null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
      canceledAt: subscription.canceled_at ?? null,
      promotionCodeId:
        (subscription.discounts ?? [])
          .map(readPromotionCodeId)
          .find((id): id is string => Boolean(id)) ?? null,
    };
  });

  return { subscriptions, truncated };
}

/**
 * How much further back than the reported window the invoice scan reaches.
 *
 * Invoices can only be filtered by creation date, but revenue is dated by
 * payment. An invoice raised just before the floor and paid just after it
 * belongs to the window and would otherwise be missed, so the scan starts
 * early enough to catch the longest retry Stripe will attempt.
 */
const LATE_PAYMENT_GRACE_DAYS = 30;

/** What the dashboard keeps of a paid invoice. Plain data, so it can be cached. */
type InvoiceSnapshot = {
  id: string;
  customerId: string | null;
  /** Promotion codes on the invoice, including on zero-amount ones. */
  codeIds: string[];
  amountPaid: number;
  paidAt: number;
  currency: string;
};

async function fetchInvoiceWindow(
  gte: number,
  lt: number,
): Promise<{ invoices: InvoiceSnapshot[]; truncated: boolean }> {
  const stripe = getStripeClient();
  const { items, truncated } = await listWindow({ gte, lt }, (params) =>
    stripe.invoices.list({
      status: "paid",
      limit: PAGE_SIZE,
      ...params,
      expand: ["data.discounts"],
    }),
  );

  return {
    invoices: items.map((invoice) => ({
      id: invoice.id ?? "",
      customerId:
        typeof invoice.customer === "string"
          ? invoice.customer
          : (invoice.customer?.id ?? null),
      codeIds: (invoice.discounts ?? [])
        .map(readPromotionCodeId)
        .filter((id): id is string => Boolean(id)),
      amountPaid: invoice.amount_paid ?? 0,
      // Dated by when the money actually arrived, not when the invoice was
      // drawn up. Stripe finalises a subscription invoice and only then
      // charges it, and a card that fails is retried for days -- so an
      // invoice raised on Wednesday is routinely paid on Friday. Dating
      // revenue by `created` filed those euros under the day the invoice was
      // written, which is how 21 Aug came to report €30 against the €90
      // Stripe actually took that day.
      paidAt: invoice.status_transitions?.paid_at ?? invoice.created,
      currency: invoice.currency ?? "eur",
    })),
    truncated,
  };
}

/**
 * When an invoice window stops being re-read.
 *
 * A paid invoice never changes, and once a window's creation dates are older
 * than any payment Stripe will still collect, nothing in it can move. Stripe's
 * own retries stop inside a month; sixty days also covers an invoice settled
 * by hand a while after it was raised. Windows older than that are final and
 * kept for a week instead of being re-read every quarter of an hour; the
 * recent ones, where an invoice can still flip to paid, follow the
 * dashboard's own beat.
 */
const FINAL_AFTER_DAYS = 60;
const FINAL_WINDOW_CACHE_SECONDS = 7 * DAY_SECONDS;

const cachedFinalInvoiceWindow = unstable_cache(
  fetchInvoiceWindow,
  ["admin-stripe-invoices-final"],
  { revalidate: FINAL_WINDOW_CACHE_SECONDS, tags: [SALES_CACHE_TAG] },
);

const cachedRecentInvoiceWindow = unstable_cache(
  fetchInvoiceWindow,
  ["admin-stripe-invoices-recent"],
  { revalidate: DASHBOARD_REFRESH_SECONDS, tags: [SALES_CACHE_TAG] },
);

type InvoiceWindows = { invoices: InvoiceSnapshot[]; truncated: boolean };

function mergeNewestFirst(windows: InvoiceWindows[]): InvoiceWindows {
  const merged = newestFirst(
    windows.map((window) => ({ items: window.invoices, truncated: window.truncated })),
  );

  return { invoices: merged.items, truncated: merged.truncated };
}

/**
 * Every final window between two epoch-aligned bounds, already merged.
 *
 * The per-window entries above are what make a cold read parallel; this one
 * is what makes a warm read cheap. Without it every render fetched some sixty
 * window entries from the data cache — a network round trip each on Vercel —
 * and merged every invoice ever paid to reach a figure that cannot have
 * moved. Keyed on the bounds, which only change when a window becomes final.
 */
async function fetchFinalInvoices(gte: number, lt: number): Promise<InvoiceWindows> {
  const windows = await mapWithConcurrency(
    createdWindows(gte, INVOICE_WINDOW_DAYS).filter((window) => window.lt <= lt),
    WINDOW_CONCURRENCY,
    (window) => cachedFinalInvoiceWindow(window.gte, window.lt),
  );

  return mergeNewestFirst(windows);
}

const cachedFinalInvoices = unstable_cache(
  fetchFinalInvoices,
  ["admin-stripe-invoices-final-merged"],
  { revalidate: FINAL_WINDOW_CACHE_SECONDS, tags: [SALES_CACHE_TAG] },
);

async function loadPayments(sinceUnix: number) {
  const finalBefore = Math.floor(Date.now() / 1000) - FINAL_AFTER_DAYS * DAY_SECONDS;
  const windows = createdWindows(sinceUnix, INVOICE_WINDOW_DAYS);
  const finalWindows = windows.filter((window) => window.lt <= finalBefore);
  const recentWindows = windows.filter((window) => window.lt > finalBefore);

  const [finalInvoices, recentInvoices] = await Promise.all([
    finalWindows.length > 0
      ? cachedFinalInvoices(finalWindows[0].gte, finalWindows[finalWindows.length - 1].lt)
      : Promise.resolve<InvoiceWindows>({ invoices: [], truncated: false }),
    mapWithConcurrency(recentWindows, WINDOW_CONCURRENCY, (window) =>
      cachedRecentInvoiceWindow(window.gte, window.lt),
    ).then(mergeNewestFirst),
  ]);

  // Every recent window is newer than every final one, so newest first means
  // the recent invoices ahead of the final ones.
  const items = [...recentInvoices.invoices, ...finalInvoices.invoices];

  const payments: PaymentSnapshot[] = [];
  // Which promotion code a customer used, learned from any invoice carrying one
  // — including the zero-amount trial invoice that usually consumes a
  // once-only coupon.
  const customerCodes = new Map<string, string>();

  for (const invoice of items) {
    // Remember the association even when the invoice itself is worth nothing.
    if (invoice.customerId && invoice.codeIds.length > 0 && !customerCodes.has(invoice.customerId)) {
      customerCodes.set(invoice.customerId, invoice.codeIds[0]);
    }

    // Zero-amount invoices are trial starts and 100%-off comps. They are real
    // conversions but not revenue, so they must not inflate the totals.
    if (invoice.amountPaid <= 0) {
      continue;
    }

    payments.push({
      id: invoice.id,
      paidAt: invoice.paidAt,
      amount: invoice.amountPaid,
      currency: invoice.currency,
      customerId: invoice.customerId,
      promotionCodeIds: invoice.codeIds,
    });
  }

  return {
    payments,
    customerCodes,
    truncated: finalInvoices.truncated || recentInvoices.truncated,
  };
}

async function loadPromotionCodes(stripe: Stripe) {
  const codes = new Map<string, string>();
  const redemptions = new Map<string, number>();
  let startingAfter: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const result = await stripe.promotionCodes.list({
      limit: PAGE_SIZE,
      starting_after: startingAfter,
    });

    for (const code of result.data) {
      codes.set(code.id, code.code);
      redemptions.set(
        code.code.toUpperCase(),
        (redemptions.get(code.code.toUpperCase()) ?? 0) + (code.times_redeemed ?? 0),
      );
    }

    if (!result.has_more) {
      break;
    }

    startingAfter = result.data[result.data.length - 1]?.id;

    if (!startingAfter) {
      break;
    }
  }

  return { codes, redemptions };
}

/**
 * How long a Stripe read is reused.
 *
 * Each dashboard page needs the same data, and revenue does not move minute
 * to minute, so subscriptions and promotion codes are kept on the dashboard's
 * refresh beat and rebuilt from the cached invoice windows above. Once an
 * entry is stale Next serves it as it is and refreshes it in the background,
 * so a page only ever waits on Stripe the first time after a deploy.
 */
const SALES_CACHE_SECONDS = DASHBOARD_REFRESH_SECONDS;

async function fetchSubscriptions(sinceUnix: number) {
  return loadSubscriptions(getStripeClient(), sinceUnix);
}

async function fetchPromotionCodes() {
  const { codes, redemptions } = await loadPromotionCodes(getStripeClient());

  // A Map does not survive the cache's serialisation, so it is stored as
  // entries and rebuilt on the way out.
  return {
    codes: Array.from(codes.entries()),
    redemptions: Array.from(redemptions.entries()),
  };
}

const cachedSubscriptions = unstable_cache(
  fetchSubscriptions,
  ["admin-stripe-subscriptions"],
  { revalidate: SALES_CACHE_SECONDS, tags: [SALES_CACHE_TAG] },
);

const cachedPromotionCodes = unstable_cache(
  fetchPromotionCodes,
  ["admin-stripe-promotion-codes"],
  { revalidate: SALES_CACHE_SECONDS, tags: [SALES_CACHE_TAG] },
);

/**
 * How far back the invoice scan reaches.
 *
 * Deliberately a constant rather than a per-page option. The window is part
 * of every cache key, so a page asking for a different window would pay for
 * a second full pagination of the account instead of sharing the first.
 */
const SALES_HISTORY_DAYS = 400;

/** Pulls everything the sales views need in one go. */
export async function loadSalesData(): Promise<SalesData> {
  const sinceUnix = Math.floor(
    parseDay(
      addDays(todayInReportZone(), -(SALES_HISTORY_DAYS + LATE_PAYMENT_GRACE_DAYS)),
    ).getTime() / 1000,
  );

  const [subscriptionResult, paymentResult, promotionCodes, appleCodeSales] = await Promise.all([
    cachedSubscriptions(sinceUnix),
    loadPayments(sinceUnix),
    cachedPromotionCodes(),
    loadAppleCodeSales(sinceUnix),
  ]);

  return {
    subscriptions: subscriptionResult.subscriptions,
    payments: paymentResult.payments,
    promotionCodes: new Map(promotionCodes.codes),
    codeRedemptions: new Map(promotionCodes.redemptions),
    customerCodes: paymentResult.customerCodes,
    truncated: subscriptionResult.truncated || paymentResult.truncated,
    appleCodeSales,
  };
}

/**
 * Creator-code purchases made through Apple in the iOS app. Production reads
 * only real purchases; any other deployment reads its Sandbox ones.
 */
async function loadAppleCodeSales(sinceUnix: number): Promise<AppleCodeSale[]> {
  const { data, error } = await createSupabaseServiceRoleClient()
    .from("apple_code_redemptions")
    .select("id,code,price_minor,currency,paid_at")
    .eq("environment", process.env.VERCEL_ENV === "production" ? "production" : "sandbox")
    .not("paid_at", "is", null)
    .is("revoked_at", null)
    .gte("paid_at", new Date(sinceUnix * 1000).toISOString());

  // Bookkeeping on top of the Stripe figures, never a reason to lose them: a
  // deploy can land before migration 0055 has created the table.
  if (error) {
    console.error("Apple code sales unavailable", { code: error.code });
    return [];
  }

  return ((data ?? []) as Array<{ id: string; code: string; price_minor: number; currency: string; paid_at: string }>)
    .map((row) => ({
      id: row.id,
      code: row.code,
      amount: row.price_minor,
      currency: row.currency,
      paidAt: Math.floor(Date.parse(row.paid_at) / 1000),
    }));
}

/** Paid revenue between two reporting days, in minor units. */
export function revenueBetween(
  data: Pick<SalesData, "payments">,
  from: string,
  to: string,
): number {
  return data.payments
    .filter((payment) => {
      const day = todayInReportZone(new Date(payment.paidAt * 1000));
      return day >= from && day <= to;
    })
    .reduce((sum, payment) => sum + payment.amount, 0);
}

/** Drops the cached Stripe read, for a "refresh now" control. */
export async function refreshSalesData() {
  // Next 16 requires the cache profile alongside the tag.
  revalidateTag(SALES_CACHE_TAG, "max");
}

export type {
  AppleCodeSale,
  DayProjection,
  ForecastDay,
  PaymentSnapshot,
  SubscriptionStatus,
  PromoCodeStats,
  RevenueDay,
  SalesData,
  SalesSummary,
  SubscriptionSnapshot,
  TrialProjection,
} from "@/lib/admin/sales-math";
export {
  creatorRevenue,
  trialForecast,
  formatMoney,
  projectionAtDayStart,
  promoCodeStats,
  revenueSeries,
  summarizeSales,
} from "@/lib/admin/sales-math";
