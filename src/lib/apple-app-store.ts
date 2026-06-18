import "server-only";

import { Environment, SignedDataVerifier } from "@apple/app-store-server-library";

import type { PurchasableBillingPlan } from "@/lib/billing";
import { getServerEnv } from "@/lib/server-env";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

export type VerifiedAppStoreTransaction = {
  originalTransactionId: string;
  transactionId: string;
  productId: string;
  plan: PurchasableBillingPlan;
  status: "active" | "canceled";
  currency: string;
  unitAmount: number | null;
  expiresAt: string | null;
  environment: string | null;
  appAccountToken: string | null;
};

export type VerifiedAppStoreNotification = {
  notificationType: string | null;
  subtype: string | null;
  transaction: VerifiedAppStoreTransaction | null;
};

function getAppStoreEnvironment() {
  const env = getServerEnv().APPLE_APP_STORE_ENVIRONMENT.toLowerCase();

  if (env === "production") {
    return Environment.PRODUCTION;
  }

  if (env === "xcode") {
    return Environment.XCODE;
  }

  if (env === "localtesting" || env === "local_testing") {
    return Environment.LOCAL_TESTING;
  }

  return Environment.SANDBOX;
}

function getAppleRootCertificates() {
  const encodedCertificates = getServerEnv().APPLE_ROOT_CERTIFICATES_BASE64;

  if (!encodedCertificates) {
    throw new Error("APPLE_ROOT_CERTIFICATES_BASE64 is not configured.");
  }

  return encodedCertificates
    .split(",")
    .map((certificate) => certificate.trim())
    .filter(Boolean)
    .map((certificate) => Buffer.from(certificate, "base64"));
}

function getAppAppleId() {
  const env = getServerEnv();

  if (getAppStoreEnvironment() !== Environment.PRODUCTION) {
    return undefined;
  }

  const appAppleId = env.APPLE_APP_APPLE_ID ? Number(env.APPLE_APP_APPLE_ID) : Number.NaN;

  if (!Number.isFinite(appAppleId)) {
    throw new Error("APPLE_APP_APPLE_ID is required for production App Store verification.");
  }

  return appAppleId;
}

function getProductPlan(productId: string): PurchasableBillingPlan | null {
  const env = getServerEnv();

  if (productId === env.APPLE_IAP_MONTHLY_PRODUCT_ID) {
    return "monthly";
  }

  if (productId === env.APPLE_IAP_YEARLY_PRODUCT_ID) {
    return "yearly";
  }

  return null;
}

function getAppStoreVerifier() {
  const env = getServerEnv();

  return new SignedDataVerifier(
    getAppleRootCertificates(),
    true,
    getAppStoreEnvironment(),
    env.APPLE_BUNDLE_ID,
    getAppAppleId(),
  );
}

function isUuid(value: string | null | undefined) {
  return Boolean(
    value?.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  );
}

export async function verifyAppStoreTransaction(
  signedTransactionInfo: string,
): Promise<VerifiedAppStoreTransaction> {
  const transaction = await getAppStoreVerifier().verifyAndDecodeTransaction(signedTransactionInfo);
  const productId = transaction.productId;
  const transactionId = transaction.transactionId;
  const originalTransactionId = transaction.originalTransactionId ?? transactionId;

  if (!productId || !transactionId || !originalTransactionId) {
    throw new Error("App Store transaction is missing required identifiers.");
  }

  const plan = getProductPlan(productId);

  if (!plan) {
    throw new Error(`Unsupported App Store product id: ${productId}`);
  }

  const expiresAtMs = transaction.expiresDate ?? null;
  const isActive = Boolean(
    expiresAtMs && expiresAtMs > Date.now() && !transaction.revocationDate,
  );

  return {
    originalTransactionId,
    transactionId,
    productId,
    plan,
    status: isActive ? "active" : "canceled",
    currency: transaction.currency?.toLowerCase() ?? "eur",
    unitAmount: typeof transaction.price === "number" ? Math.round(transaction.price / 10) : null,
    expiresAt: expiresAtMs ? new Date(expiresAtMs).toISOString() : null,
    environment: transaction.environment ? String(transaction.environment) : null,
    appAccountToken: transaction.appAccountToken ?? null,
  };
}

export async function verifyAppStoreNotification(
  signedPayload: string,
): Promise<VerifiedAppStoreNotification> {
  const notification = await getAppStoreVerifier().verifyAndDecodeNotification(signedPayload);
  const signedTransactionInfo = notification.data?.signedTransactionInfo ?? null;

  return {
    notificationType: notification.notificationType ? String(notification.notificationType) : null,
    subtype: notification.subtype ? String(notification.subtype) : null,
    transaction: signedTransactionInfo
      ? await verifyAppStoreTransaction(signedTransactionInfo)
      : null,
  };
}

export async function syncAppStoreTransactionEntitlement(params: {
  transaction: VerifiedAppStoreTransaction;
  userId?: string | null;
}) {
  const subscriptionId = `appstore:${params.transaction.originalTransactionId}`;
  const service = createSupabaseServiceRoleClient();
  let userId = params.userId ?? null;

  if (!userId) {
    const { data: existing } = await service
      .from("billing_subscriptions")
      .select("user_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    userId = (existing as { user_id?: string } | null)?.user_id ?? null;
  }

  if (!userId && isUuid(params.transaction.appAccountToken)) {
    userId = params.transaction.appAccountToken;
  }

  if (!userId) {
    throw new Error(`Unable to resolve user for App Store transaction ${params.transaction.transactionId}.`);
  }

  const { error } = await service
    .from("billing_subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: null,
        stripe_subscription_id: subscriptionId,
        stripe_price_id: params.transaction.productId,
        plan: params.transaction.plan,
        status: params.transaction.status,
        currency: params.transaction.currency,
        unit_amount: params.transaction.unitAmount,
        current_period_end: params.transaction.expiresAt,
        cancel_at_period_end: params.transaction.status !== "active",
      } as never,
      { onConflict: "stripe_subscription_id" },
    );

  if (error) {
    throw error;
  }
}
