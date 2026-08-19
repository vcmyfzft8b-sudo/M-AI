import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import type Stripe from "stripe";

import { addDays, parseDay, todayInReportZone } from "@/lib/admin/ranges";
import type {
  PaymentSnapshot,
  SalesData,
  SubscriptionSnapshot,
} from "@/lib/admin/sales-math";
import { getStripeClient } from "@/lib/billing";

/**
 * Sales reporting straight from Stripe.
 *
 * The local `billing_subscriptions` table only mirrors what the webhook has
 * seen, so revenue is read from Stripe itself. Volumes are small (a few hundred
 * subscriptions), which is what makes full pagination affordable here.
 */

export const SALES_CACHE_TAG = "admin-sales";

/** Hard page caps so a runaway account can never hang a dashboard request. */
const MAX_SUBSCRIPTION_PAGES = 20;
const MAX_INVOICE_PAGES = 20;
const PAGE_SIZE = 100;




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

async function loadSubscriptions(stripe: Stripe) {
  const subscriptions: SubscriptionSnapshot[] = [];
  let startingAfter: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_SUBSCRIPTION_PAGES; page += 1) {
    const result = await stripe.subscriptions.list({
      status: "all",
      limit: PAGE_SIZE,
      starting_after: startingAfter,
      expand: ["data.discounts"],
    });

    for (const subscription of result.data) {
      const period = subscription.items.data[0];

      subscriptions.push({
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
      });
    }

    if (!result.has_more) {
      return { subscriptions, truncated };
    }

    startingAfter = result.data[result.data.length - 1]?.id;

    if (!startingAfter) {
      return { subscriptions, truncated };
    }

    if (page === MAX_SUBSCRIPTION_PAGES - 1) {
      truncated = true;
    }
  }

  return { subscriptions, truncated };
}

async function loadPayments(stripe: Stripe, sinceUnix: number) {
  const payments: PaymentSnapshot[] = [];
  let startingAfter: string | undefined;
  let truncated = false;

  for (let page = 0; page < MAX_INVOICE_PAGES; page += 1) {
    const result = await stripe.invoices.list({
      status: "paid",
      limit: PAGE_SIZE,
      starting_after: startingAfter,
      created: { gte: sinceUnix },
      expand: ["data.discounts"],
    });

    for (const invoice of result.data) {
      // Zero-amount invoices are trial starts and 100%-off comps. They are real
      // conversions but not revenue, so they must not inflate the totals.
      if ((invoice.amount_paid ?? 0) <= 0) {
        continue;
      }

      payments.push({
        id: invoice.id ?? "",
        created: invoice.created,
        amount: invoice.amount_paid ?? 0,
        currency: invoice.currency ?? "eur",
        customerId:
          typeof invoice.customer === "string"
            ? invoice.customer
            : (invoice.customer?.id ?? null),
        promotionCodeIds: (invoice.discounts ?? [])
          .map(readPromotionCodeId)
          .filter((id): id is string => Boolean(id)),
      });
    }

    if (!result.has_more) {
      return { payments, truncated };
    }

    startingAfter = result.data[result.data.length - 1]?.id;

    if (!startingAfter) {
      return { payments, truncated };
    }

    if (page === MAX_INVOICE_PAGES - 1) {
      truncated = true;
    }
  }

  return { payments, truncated };
}

async function loadPromotionCodes(stripe: Stripe) {
  const codes = new Map<string, string>();
  let startingAfter: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const result = await stripe.promotionCodes.list({
      limit: PAGE_SIZE,
      starting_after: startingAfter,
    });

    for (const code of result.data) {
      codes.set(code.id, code.code);
    }

    if (!result.has_more) {
      break;
    }

    startingAfter = result.data[result.data.length - 1]?.id;

    if (!startingAfter) {
      break;
    }
  }

  return codes;
}

/**
 * How long a Stripe read is reused.
 *
 * Fetching every subscription, invoice and promotion code takes several seconds
 * of serial pagination, and each dashboard page needs the same data. Without
 * this, opening the overview meant a fresh full scan every time. Revenue does
 * not move minute to minute, so a short cache costs nothing in accuracy and
 * turns a 15-second page load into an instant one.
 */
const SALES_CACHE_SECONDS = 300;

async function fetchSalesData(historyDays: number): Promise<SalesData> {
  const stripe = getStripeClient();
  const sinceUnix = Math.floor(
    parseDay(addDays(todayInReportZone(), -historyDays)).getTime() / 1000,
  );

  const [subscriptionResult, paymentResult, promotionCodes] = await Promise.all([
    loadSubscriptions(stripe),
    loadPayments(stripe, sinceUnix),
    loadPromotionCodes(stripe),
  ]);

  return {
    subscriptions: subscriptionResult.subscriptions,
    payments: paymentResult.payments,
    // A Map does not survive the cache's serialisation, so it is stored as
    // entries and rebuilt on the way out.
    promotionCodes: Array.from(promotionCodes.entries()) as never,
    truncated: subscriptionResult.truncated || paymentResult.truncated,
  };
}

const cachedSalesData = unstable_cache(
  fetchSalesData,
  ["admin-sales-data"],
  { revalidate: SALES_CACHE_SECONDS, tags: [SALES_CACHE_TAG] },
);

/**
 * Pulls everything the sales views need in one go.
 *
 * `historyDays` bounds the invoice scan; it needs to reach far enough back to
 * cover the widest window the dashboard offers.
 */
export async function loadSalesData(options?: {
  historyDays?: number;
}): Promise<SalesData> {
  const data = await cachedSalesData(options?.historyDays ?? 400);

  return {
    ...data,
    promotionCodes: new Map(
      data.promotionCodes as unknown as Array<[string, string]>,
    ),
  };
}

/** Drops the cached Stripe read, for a "refresh now" control. */
export async function refreshSalesData() {
  // Next 16 requires the cache profile alongside the tag.
  revalidateTag(SALES_CACHE_TAG, "max");
}

export type {
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
  promoCodeStats,
  revenueSeries,
  summarizeSales,
} from "@/lib/admin/sales-math";
