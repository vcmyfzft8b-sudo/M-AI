import { isNativeUserAgent } from "@/lib/mobile/runtime";
import { NextResponse } from "next/server";

import {
  ensureStripeCustomer,
  getBillingPortalReturnUrl,
  getStripeClient,
  getViewerAppState,
} from "@/lib/billing";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { STRIPE_CHECKOUT_LOCALE } from "@/lib/i18n/locales";
import { getLocale, tr } from "@/lib/i18n/server";

export async function POST(request: Request) {
  if (isNativeUserAgent(request.headers.get("user-agent"))) {
    return NextResponse.json({ error: await tr("native.manage"), code: "native_purchase_required" }, { status: 403 });
  }
  const appState = await getViewerAppState();

  if (!appState) {
    return NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:billing:portal:post",
    rules: rateLimitPresets.mutate,
    userId: appState.user.id,
  });

  if (limited) {
    return limited;
  }

  try {
    const customerId = await ensureStripeCustomer({
      userId: appState.user.id,
      email: appState.user.email ?? null,
      fullName: appState.profile?.full_name ?? null,
      existingCustomerId: appState.profile?.stripe_customer_id ?? null,
    });

    const stripe = getStripeClient();
    const session = await stripe.billingPortal.sessions.create({
      // The portal is Stripe's page, in the language the app is being read in.
      locale: STRIPE_CHECKOUT_LOCALE[await getLocale()],
      customer: customerId,
      return_url: getBillingPortalReturnUrl(request),
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : await tr("api.portalSessionFailed"),
      },
      { status: 500 },
    );
  }
}
