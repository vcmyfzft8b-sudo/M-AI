"use client";

import { Check, CircleCheck, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

import { useT, useTranslations } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { Msym } from "@/components/msym";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { useAppleBilling } from "@/components/use-apple-billing";
import { AppleBillingTerms } from "@/components/apple-billing-terms";
import { APPLE_PRODUCTS } from "@/lib/mobile/runtime";
import { useNativeIOS } from "@/lib/mobile/client";
import { useInstantNavigation } from "@/components/navigation-loading";
import { clearOfferResume } from "@/lib/offer-resume";
import { formatCurrency } from "@/lib/utils";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";
import type { BillingSubscriptionRow, ProfileRow } from "@/lib/database.types";

type BillingPlanCard = {
  id: "weekly" | "monthly" | "yearly";
  labelKey: MessageKey;
  cadenceKey: MessageKey;
  amount: number;
  displayAmount?: number;
  billingNoteKey?: MessageKey;
  annualizedAmount: number;
  blurbKey: MessageKey;
};

/**
 * Only the one message the buyer cannot work out for themselves.
 *
 * Backing out of Stripe used to return to a "payment cancelled" pill. It told
 * a buyer who had just pressed the browser's back button something they
 * already knew, and it cost the paywall a row it does not have: the screen is
 * sized to fit exactly once, so the extra line pushed the call to action past
 * the fold and turned the whole thing into a scroller. `success` stays — the
 * subscription is not live until the webhook lands, and that gap is the one
 * moment the screen contradicts itself.
 */
function CheckoutBanner({ state }: { state: string | null }) {
  const t = useT();

  if (state === "success") {
    return (
      <div className="app-start-banner success">
        <Check className="h-4 w-4" />
        {t("paywall.paymentReceived")}
      </div>
    );
  }

  return null;
}

export function OnboardingPaywall({
  profile,
  subscription,
  onboardingComplete,
  hasPaidAccess,
  subscriptionTrialEligible = true,
  plans,
}: {
  profile: ProfileRow | null;
  subscription: BillingSubscriptionRow | null;
  onboardingComplete: boolean;
  hasPaidAccess: boolean;
  subscriptionTrialEligible?: boolean;
  plans: BillingPlanCard[];
}) {
  const { locale, t } = useTranslations();
  const native = useNativeIOS();
  const apple = useAppleBilling(native && onboardingComplete);
  const { navigateWithFeedback, overlay: navigationOverlay } = useInstantNavigation();
  const searchParams = useSearchParams();
  const [selectedPaywallPlan, setSelectedPaywallPlan] = useState<BillingPlanCard["id"]>("yearly");
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanCard["id"] | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);

  async function startCheckout(plan: BillingPlanCard["id"]) {
    if (native) { await apple.purchase(); return; }
    setBillingError(null);
    setCheckoutPlan(plan);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ plan }),
      });

      const payload = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? t("paywall.error.checkoutFailed"));
      }

      window.location.href = payload.url;
    } catch (error) {
      setBillingError(
        error instanceof Error ? error.message : t("paywall.error.checkoutFailed"),
      );
    } finally {
      setCheckoutPlan(null);
    }
  }

  const effectiveOnboardingComplete = onboardingComplete;
  const checkoutState = searchParams.get("checkout");
  const hasNotice = checkoutState === "success" || Boolean(billingError) || (native && Boolean(apple.notice));
  const selectedPlan = native ? APPLE_PRODUCTS[apple.selected] : selectedPaywallPlan;
  const trialEligible = native ? apple.selectedProduct?.trialDays === 3 : subscriptionTrialEligible;
  const checkingOut = native ? apple.busy : checkoutPlan !== null;

  /*
   * A completed purchase ends the wheel's offer, so the note that would put its
   * sheet back on the home screen goes with it. Not left to `hasPaidAccess`:
   * the subscription only lands once Stripe's webhook has been processed, and
   * the buyer can reach the home screen before that.
   */
  useEffect(() => {
    if (checkoutState === "success") {
      clearOfferResume();
    }
  }, [checkoutState]);
  const monthlyPlan = plans.find((plan) => plan.id === "monthly");
  const yearlyPlan = plans.find((plan) => plan.id === "yearly");
  const paywallPlans = [yearlyPlan, monthlyPlan].filter(
    (plan): plan is BillingPlanCard => Boolean(plan),
  );

  if (!effectiveOnboardingComplete) {
    return <OnboardingFlow profile={profile} />;
  }


  return (
    <section className={`app-start-panel app-start-panel-paywall memo-paywall-shell${native ? " memo-paywall-apple" : ""}`}>
      {navigationOverlay}
      {effectiveOnboardingComplete ? (
        <div className="app-start-dismiss-row">
          <button
            type="button"
            className="memo-close-button app-start-close-button"
            onClick={() => navigateWithFeedback("/app")}
            aria-label={t("paywall.close")}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>
      ) : null}

      {/* A notice takes the wordmark's place rather than a row of its own. The
          screen is laid out to land on exactly one viewport, so a row added on
          top of the full column is a row that pushes the footer under the fold
          — which is how the old cancelled-payment banner turned this into a
          scroller. The wordmark is the one block here that says nothing the
          buyer needs, so it is the one that stands aside. */}
      {hasNotice ? (
        <div className="memo-paywall-notices" role="status" aria-live="polite">
          <CheckoutBanner state={checkoutState} />
          {billingError ? <div className="app-start-banner">{billingError}</div> : null}
          {native && apple.notice ? <div className="app-start-banner">{apple.notice}</div> : null}
        </div>
      ) : (
        <div className="memo-paywall-brand">
          <span className="memo-paywall-logo">
            <Image
              src={BRAND_LOCKUP_SRC}
              alt={SEO_BRAND_NAME}
              width={BRAND_LOCKUP_WIDTH}
              height={BRAND_LOCKUP_HEIGHT}
              priority
            />
          </span>
        </div>
      )}

      <h1 className="memo-paywall-title">{t("paywall.title")}</h1>

      <div className="memo-paywall-benefits">
        {(
          [
            {
              titleKey: "paywall.benefit.notesTitle",
              copyKey: "paywall.benefit.notesCopy",
              icon: "📝",
            },
            {
              titleKey: "paywall.benefit.toolsTitle",
              copyKey: "paywall.benefit.toolsCopy",
              icon: "💡",
            },
            {
              titleKey: "paywall.benefit.speedTitle",
              copyKey: "paywall.benefit.speedCopy",
              icon: "⚡",
            },
          ] as const
        ).map((benefit) => (
          <div className="memo-paywall-benefit" key={benefit.titleKey}>
            <span aria-hidden="true">{benefit.icon}</span>
            <div>
              <strong>{t(benefit.titleKey)}</strong>
              <p>{t(benefit.copyKey)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="memo-paywall-plan-grid" role="radiogroup" aria-label={t("paywall.choosePlan")}>
        {paywallPlans.map((plan) => {
          const selected = selectedPlan === plan.id;
          const appleProduct = apple.productForPlan(plan.id);
          const activePlan = subscription?.plan === plan.id && hasPaidAccess;
          const annualizedMonthly = monthlyPlan?.annualizedAmount ?? 0;
          const yearlySavings = native ? (appleProduct?.yearlySavings ?? 0) : annualizedMonthly > plan.annualizedAmount
            ? Math.round((1 - plan.annualizedAmount / annualizedMonthly) * 100)
            : 0;
          const displayPrice = native
            ? appleProduct?.monthlyPrice ?? appleProduct?.price ?? "—"
            : formatCurrency(plan.displayAmount ?? plan.amount, locale);
          const suffix = native && plan.id === "yearly" && !appleProduct?.monthlyPrice
            ? `/${t("native.year")}` : t("paywall.perMonth");
          const detail = native
            ? !appleProduct ? t("native.working")
              : appleProduct.trialDays === 3
                ? t(plan.id === "yearly" ? "native.trialYearPrice" : "native.trialMonthPrice", { renewal: appleProduct.price })
                : appleProduct.introPrice
                  ? t(plan.id === "yearly" ? "native.firstYearPrice" : "native.firstMonthPrice", { initial: appleProduct.introPrice, renewal: appleProduct.price })
                  : plan.id === "yearly" ? t("paywall.billedYearly", { amount: appleProduct.price }) : t("paywall.billedMonthly")
            : plan.id === "yearly"
              ? t("paywall.billedYearly", { amount: formatCurrency(plan.annualizedAmount, locale) })
              : t("paywall.billedMonthly");

          return (
            <button
              type="button"
              key={plan.id}
              className={`memo-paywall-plan ${selected ? "selected" : ""}`}
              onClick={() => native ? apple.selectPlan(plan.id) : setSelectedPaywallPlan(plan.id)}
              disabled={checkingOut || (native && !appleProduct)}
              role="radio"
              aria-checked={selected}
            >
              {plan.id === "yearly" ? (
                <span className="memo-paywall-plan-badge">{t("paywall.mostPopular")}</span>
              ) : null}
              <span className="memo-paywall-plan-header">
                <strong>{t(plan.labelKey)}</strong>
                <span className="memo-paywall-radio" aria-hidden="true">
                  {selected || activePlan ? <span /> : null}
                </span>
              </span>
              <span className="memo-paywall-plan-price">
                {displayPrice}
                <small>{suffix}</small>
              </span>
              <span className="memo-paywall-plan-detail">{detail}</span>
              {plan.id === "yearly" && yearlySavings > 0 ? (
                <span className="memo-paywall-save">
                  {t("paywall.save", { percent: yearlySavings })}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* The app pays through the App Store, so the reassurance line must
          never name Stripe there — not even while the products are loading. */}
      <p className="memo-paywall-due">
        <CircleCheck className="h-5 w-5" />
        {t(trialEligible ? "paywall.nothingToday" : native ? "native.securePayment" : "paywall.securePayment")}
      </p>

      <button
        type="button"
        className={`memo-paywall-cta ${checkingOut ? "loading" : ""}`}
        onClick={() => startCheckout(selectedPlan)}
        disabled={checkingOut || (native && !apple.selectedProduct) || (subscription?.plan === selectedPlan && hasPaidAccess)}
      >
        {checkingOut ? (
          <Loader2 className="memo-paywall-cta-spinner animate-spin" />
        ) : null}
        {checkingOut ? null : (
          <span className="memo-paywall-cta-label">
            {subscription?.plan === selectedPlan && hasPaidAccess
              ? t("paywall.currentPlan")
              : t(
                  trialEligible
                    ? "paywall.startTrial"
                    : "paywall.continueToPayment",
                )}
          </span>
        )}
      </button>

      <div className="memo-paywall-foot">
        <span>
          <CircleCheck className="h-5 w-5" />
          {t("paywall.cancelAnytime")}
        </span>
      </div>
      {native ? <AppleBillingTerms busy={apple.busy} onRestore={() => void apple.restore()} /> : null}
    </section>
  );
}
