"use client";

import { Check, CircleCheck, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useT, useTranslations } from "@/components/i18n-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { Msym } from "@/components/msym";
import { OnboardingFlow } from "@/components/onboarding-flow";
import { useAppleBilling } from "@/components/use-apple-billing";
import { AppleBillingTerms } from "@/components/apple-billing-terms";
import { APPLE_PRODUCTS } from "@/lib/mobile/runtime";
import { useNativeIOS } from "@/lib/mobile/client";
import { clearOfferResume } from "@/lib/offer-resume";
import { formatCurrency } from "@/lib/utils";
import type { PaywallReason } from "@/lib/paywall-reasons";
import { cameFromAppPath, quietNextEntrance } from "@/lib/app-history";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";
import { notePaywallShown, paywallVisitCounted } from "@/lib/paywall-offer-timing";
import { discountedAmount, paywallOffer, weeklyAmount } from "@/lib/paywall-ladder";
import { fitScreenScript, useFitScreen } from "@/components/use-fit-screen";
import { PaywallDeck, PaywallHero, paywallAccentStyle } from "@/components/paywall-hero";
import { Checklist, HAND_FONT, Marked, NotebookSpiral, PenCircle, PenTick, Tape, Ticket, TrialTimeline } from "@/components/paywall-notebook";
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
 * What the plan adds, ticked off in pen under the headline: three short items
 * for the screen nothing opened, and for each feature the ones that answer it.
 */
const CHECKLISTS: Record<PaywallReason | "plain", MessageKey[]> = {
  plain: ["paywall.check.unlimitedNotes", "paywall.check.everyTool", "paywall.check.tutorPodcasts"],
  note: ["paywall.check.everyLecture", "paywall.check.flashcards", "paywall.check.quizzes"],
  locked: ["paywall.check.allNotes", "paywall.check.everyTool", "paywall.check.tutor"],
  chat: ["paywall.check.everyNote", "paywall.check.noLimits", "paywall.check.instant"],
  listen: ["paywall.check.everyNote", "paywall.check.anywhere", "paywall.check.noLimits"],
  tutor: ["paywall.check.everyNote", "paywall.check.everyDay", "paywall.check.yourPace"],
  podcast: ["paywall.check.everyNote", "paywall.check.everyDay", "paywall.check.anywhere"],
  regenerate: ["paywall.check.flashcards", "paywall.check.mindMaps", "paywall.check.tests"],
  library: ["paywall.check.everySubject", "paywall.check.oneChat"],
  offer: ["paywall.check.notes", "paywall.check.chat", "paywall.check.tutor"],
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

/** Compact levels the paywall may step down to (`redesign.css`). */
const PAYWALL_FIT_LEVELS = 4;

export function OnboardingPaywall({
  profile,
  subscription,
  onboardingComplete,
  hasPaidAccess,
  subscriptionTrialEligible = true,
  plans,
  reason = null,
  backHref = null,
  offerStep = 1,
  offerImproved = false,
}: {
  profile: ProfileRow | null;
  subscription: BillingSubscriptionRow | null;
  onboardingComplete: boolean;
  hasPaidAccess: boolean;
  subscriptionTrialEligible?: boolean;
  plans: BillingPlanCard[];
  /** What sent the learner here; names it in the headline and first benefit. */
  reason?: PaywallReason | null;
  /** Where closing returns to: the screen they were on, or home. */
  backHref?: string | null;
  /** This paywall's step on the offer ladder (`paywall-ladder.ts`); web only. */
  offerStep?: number;
  /**
   * A browsing offer that just lifted the price may say so; one shown on the
   * top rung, where nothing is left to lift, says the best price still stands.
   */
  offerImproved?: boolean;
}) {
  const { locale, t } = useTranslations();
  const native = useNativeIOS();
  const apple = useAppleBilling(native && onboardingComplete);
  const searchParams = useSearchParams();
  const router = useRouter();
  const [selectedPaywallPlan, setSelectedPaywallPlan] = useState<BillingPlanCard["id"]>("yearly");
  const [checkoutPlan, setCheckoutPlan] = useState<BillingPlanCard["id"] | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  /*
   * The rung the server recorded for this paywall's moment, once it answers.
   * Until then, the rung the page predicted; the two agree unless a cached
   * copy of this page was shown, which the answer then corrects.
   */
  /*
   * A paywall opened by a limit or a browsing offer records its moment, so the
   * offer climbs a rung (`paywall-ladder.ts`). Not in the app, not for the
   * paywall nothing opened, and not while the survey is still showing instead
   * of the prices. Once per paywall: the ref outlives the effect running twice.
   */
  const viewKey = `${reason ?? ""}?${searchParams.toString()}`;
  const [recorded, setRecorded] = useState<{ key: string; step: number; advanced: boolean } | null>(null);
  const viewRequest = useRef<{ key: string; done: Promise<unknown> } | null>(null);
  // Only this paywall's own answer; another one's may still be on screen.
  const answer = recorded?.key === viewKey ? recorded : null;
  // The app sells at Apple's prices, so it never shows a step past the first.
  const offer = paywallOffer(native ? 1 : answer?.step ?? offerStep);
  const discounted = offer.percentOff > 0;
  const improved = answer ? answer.advanced : offerImproved;

  // Where closing goes. A close that has to navigate rather than step back
  // (the paywall after onboarding) gets it loaded ahead, so it opens at once
  // rather than on a skeleton. Checked a moment after mounting, once the shell
  // has noted this page.
  const closeTo = backHref ?? "/app";
  useEffect(() => {
    if (!onboardingComplete) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!cameFromAppPath(closeTo)) {
        safeRouterPrefetch(router, closeTo, { full: true });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [router, closeTo, onboardingComplete]);

  useEffect(() => {
    if (native || !onboardingComplete || hasPaidAccess) {
      return;
    }

    // Any paywall restarts the count to the next browsing offer (`paywall-nudge.tsx`).
    notePaywallShown();

    if (!reason || viewRequest.current?.key === viewKey) {
      return;
    }

    // A reload, or coming back to it through history, is the same moment
    // again: the server answers with the rung it reached and records nothing.
    const counted = paywallVisitCounted();

    const done = fetch("/api/billing/paywall-view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason, counted }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ step?: unknown; advanced?: unknown }>) : null))
      .then((body) => {
        if (body && typeof body.step === "number") {
          setRecorded({ key: viewKey, step: body.step, advanced: body.advanced === true });
        }
      })
      .catch(() => null);

    viewRequest.current = { key: viewKey, done };
  }, [native, reason, viewKey, onboardingComplete, hasPaidAccess]);

  // One screen, never a page to scroll (`use-fit-screen.ts`, `redesign.css`).
  const shellRef = useRef<HTMLElement | null>(null);
  useFitScreen(shellRef, PAYWALL_FIT_LEVELS);

  async function startCheckout(plan: BillingPlanCard["id"]) {
    if (native) { await apple.purchase(); return; }
    setBillingError(null);
    setCheckoutPlan(plan);

    try {
      // Checkout reads the rung from the cookie, so the moment goes first.
      await viewRequest.current?.done;
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ plan, reason, step: offer.step }),
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
  // The free trial comes with a ladder discount too; the discount is then the
  // first payment after it (only the wheel's prize, on its own sheet, has none).
  const trialEligible = native
    ? apple.selectedProduct?.trialDays === 3
    : subscriptionTrialEligible;
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


  const yearlySavingsFor = (plan: BillingPlanCard) => {
    const annualizedMonthly = monthlyPlan?.annualizedAmount ?? 0;
    return native
      ? (apple.productForPlan(plan.id)?.yearlySavings ?? 0)
      : annualizedMonthly > plan.annualizedAmount
        ? Math.round((1 - plan.annualizedAmount / annualizedMonthly) * 100)
        : 0;
  };

  return (
    <>
    <section
      ref={shellRef}
      // `data-fit` is set before the app starts (`fitScreenScript`), on purpose.
      suppressHydrationWarning
      className={`app-start-panel app-start-panel-paywall memo-paywall-shell memo-nb-paper ${HAND_FONT.variable}${native ? " memo-paywall-apple" : ""}`}
      data-reason={reason ?? undefined}
      style={paywallAccentStyle(reason)}
    >
      <NotebookSpiral />
      {effectiveOnboardingComplete ? (
        <div className="app-start-dismiss-row">
          <button
            type="button"
            className="memo-close-button app-start-close-button"
            onClick={() => {
              // Opened from that page: step back to it, so it shows at once as
              // it was. Otherwise go there, loaded ahead above. Either way
              // without the page's entrance fades (`app-history.ts`).
              quietNextEntrance();

              if (cameFromAppPath(closeTo)) {
                router.back();
              } else {
                router.push(closeTo);
              }
            }}
            aria-label={t("paywall.close")}
          >
            <Msym name="close" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>
      ) : null}

      {/* A notice takes the scene's place rather than a row of its own: the
          screen is laid out to land on exactly one viewport, so a row added
          on top is a row that pushes the button under the fold. */}
      {hasNotice ? (
        <div className="memo-paywall-notices" role="status" aria-live="polite">
          <CheckoutBanner state={checkoutState} />
          {billingError ? <div className="app-start-banner">{billingError}</div> : null}
          {native && apple.notice ? <div className="app-start-banner">{apple.notice}</div> : null}
        </div>
      ) : reason ? (
        <PaywallHero reason={reason} step={offer.step} />
      ) : (
        <PaywallDeck />
      )}

      {/* The discount is a coupon taped to the page; that it covers the first
          payment only is written on it, and the renewal price is on each plan. */}
      {discounted ? (
        <Ticket percent={offer.percentOff} off={t("paywall.offer.off")} note={t("paywall.offer.firstPayment")} />
      ) : null}

      <h1 className="memo-nb-title">
        <Marked
          text={t(
            reason === "offer" && !improved
              ? "paywall.reason.offer.titleBest"
              : reason ? `paywall.reason.${reason}.title` : "paywall.title",
          )}
        />
      </h1>

      <Checklist items={CHECKLISTS[reason ?? "plain"].map((key) => t(key))} />

      <div className="memo-nb-plans" role="radiogroup" aria-label={t("paywall.choosePlan")}>
        {paywallPlans.map((plan) => {
          const selected = selectedPlan === plan.id;
          const appleProduct = apple.productForPlan(plan.id);
          const activePlan = subscription?.plan === plan.id && hasPaidAccess;
          const yearlySavings = yearlySavingsFor(plan);
          /*
           * At full price (the paywall after onboarding) the year reads as a
           * month, as it always has. A discounted year is priced by the week, as
           * on the wheel's sheet: the first year's charge spread over 52 weeks,
           * rounded down. The month stays a month. The app shows Apple's own
           * figures.
           */
          const weekly = discounted && plan.id === "yearly";
          const regularShown = weekly ? weeklyAmount(plan.amount) : plan.amount;
          const displayPrice = native
            ? appleProduct?.monthlyPrice ?? appleProduct?.price ?? "—"
            : formatCurrency(
                !discounted
                  ? plan.displayAmount ?? plan.amount
                  : weekly
                    ? weeklyAmount(discountedAmount(plan.amount, offer.percentOff))
                    : discountedAmount(plan.amount, offer.percentOff),
                locale,
              );
          const suffix = native
            ? plan.id === "yearly" && !appleProduct?.monthlyPrice ? `/${t("native.year")}` : t("paywall.perMonth")
            : weekly ? t("paywall.perWeek") : t("paywall.perMonth");
          const detail = native
            ? !appleProduct ? t("native.working")
              : appleProduct.trialDays === 3
                ? t(plan.id === "yearly" ? "native.trialYearPrice" : "native.trialMonthPrice", { renewal: appleProduct.price })
                : appleProduct.introPrice
                  ? t(plan.id === "yearly" ? "native.firstYearPrice" : "native.firstMonthPrice", { initial: appleProduct.introPrice, renewal: appleProduct.price })
                  : plan.id === "yearly" ? t("paywall.billedYearly", { amount: appleProduct.price }) : t("paywall.billedMonthly")
            : discounted
              ? t(plan.id === "yearly" ? "paywall.offer.firstYear" : "paywall.offer.firstMonth", {
                  amount: formatCurrency(discountedAmount(plan.amount, offer.percentOff), locale),
                  renewal: formatCurrency(plan.amount, locale),
                })
              : plan.id === "yearly"
                ? t("paywall.billedYearly", { amount: formatCurrency(plan.annualizedAmount, locale) })
                : t("paywall.billedMonthly");

          return (
            <button
              type="button"
              key={plan.id}
              className={`memo-nb-plan ${selected ? "selected" : ""}`.trim()}
              onClick={() => native ? apple.selectPlan(plan.id) : setSelectedPaywallPlan(plan.id)}
              disabled={checkingOut || (native && !appleProduct)}
              role="radio"
              aria-checked={selected}
            >
              <Tape tone={plan.id === "yearly" ? "yellow" : "mint"} />
              {plan.id === "yearly" ? (
                <span className="memo-nb-badge">{t("paywall.mostPopular")}</span>
              ) : null}
              <PenCircle />
              <span className="memo-nb-plan-name">
                {/* The plan a subscriber is already on is ticked, whichever one is circled. */}
                {activePlan ? (
                  <>
                    <PenTick delay={0.5} />
                    <span className="sr-only">{t("paywall.currentPlan")}: </span>
                  </>
                ) : null}
                {t(plan.labelKey)}
                {/* Not beside a discount: two percentages on one note contradict each other. */}
                {plan.id === "yearly" && yearlySavings > 0 && !discounted ? (
                  <span className="memo-nb-save">−{yearlySavings}%</span>
                ) : null}
              </span>
              {discounted ? (
                <s className="memo-nb-plan-was">{formatCurrency(regularShown, locale)}</s>
              ) : null}
              <span className="memo-nb-plan-price">
                {displayPrice}
                <small> {suffix}</small>
              </span>
              <span className="memo-nb-plan-detail">{detail}</span>
            </button>
          );
        })}
      </div>

      {/* The plain paywall says what the trial means, day by day. */}
      {!reason && trialEligible && !discounted ? (
        <TrialTimeline
          steps={[
            { icon: "lock_open", title: t("paywall.timeline.today"), body: t("paywall.timeline.free") },
            { icon: "workspace_premium", title: t("paywall.timeline.day3"), body: t("paywall.timeline.starts") },
            { icon: "event_busy", title: t("paywall.timeline.anyTime"), body: t("paywall.timeline.cancel") },
          ]}
        />
      ) : null}

      {/* The app pays through the App Store, so the reassurance line must
          never name Stripe there — not even while the products are loading. */}
      {/* Where the timeline is drawn it already says all this — until a short
          screen folds the timeline away, and then this line takes its place. */}
      <p className={`memo-nb-due ${!reason && trialEligible && !discounted ? "with-timeline" : ""}`.trim()}>
        <CircleCheck className="h-5 w-5" />
        {t(trialEligible ? "paywall.nothingToday" : native ? "native.securePayment" : "paywall.securePayment")}
        {" · "}
        {t("paywall.cancelAnytime")}
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
              : discounted
                ? t(trialEligible ? "paywall.offer.ctaTrial" : "paywall.offer.cta", { percent: offer.percentOff })
                : t(
                    trialEligible
                      ? "paywall.startTrial"
                      : "paywall.continueToPayment",
                  )}
          </span>
        )}
      </button>

      {native ? <AppleBillingTerms busy={apple.busy} onRestore={() => void apple.restore()} /> : null}
    </section>
    {/* Fits a freshly loaded page as it is first drawn (`use-fit-screen.ts`). */}
    <script dangerouslySetInnerHTML={{ __html: fitScreenScript(PAYWALL_FIT_LEVELS) }} />
    </>
  );
}
