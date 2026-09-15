"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { sheetClass, useSheet } from "@/components/use-sheet";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { clearOfferResume, markOfferResume, readOfferResume } from "@/lib/offer-resume";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";
import { formatCurrency } from "@/lib/utils";
import { nativeRequest } from "@/lib/mobile/client";
import { halfOffProducts, type NativeProduct } from "@/lib/mobile/products";
import { NativePaywall } from "@/components/native-paywall";

/**
 * The one-shot prize wheel and the offer sheet it hands off to.
 *
 * The wheel is presentation: the prize is decided by the server
 * (`/api/discount-wheel`, which latches one spin per account and awards the
 * 50 % coupon). The spin is started as soon as the learner taps, so a reload
 * mid-animation cannot buy a second go, and the reveal waits for the wheel to
 * stop so the result reads as earned rather than announced.
 *
 * Checkout picks the coupon up on its own — see the wheel branch in
 * `src/app/api/billing/checkout/route.ts` — so "Nadaljuj" is an ordinary
 * checkout call with no discount plumbing in the client.
 */

/**
 * Matches the design: 6 slices, and the pointer lands on the 50 % one.
 *
 * The order is not the design's. The disc turns clockwise, so the pointer
 * travels *backwards* through this list, which makes the slice at index 4 the
 * last one it crosses before 50 %. That is the slice the wheel pretends to
 * stop on, so it is the worst prize on the board rather than a middling one.
 */
const WHEEL_SLICES = ["10 %", "15 %", "20 %", "50 %", "5 %", "30 %"];
/** How long the offer stands, matching WHEEL_PRIZE_TTL_MS on the server. */
const OFFER_SECONDS = 10 * 60;

/*
 * The spin is a near miss, and it is driven by `memo-wheel-spin` in
 * redesign.css rather than by a transition — the shape of the motion is the
 * whole point, and a single easing curve cannot make a wheel hesitate in the
 * middle and then carry on.
 *
 * The keyframes there are a sampled simulation of a disc losing speed to
 * friction, and nothing about them is a brake: it sheds about a quarter of its
 * speed every step of the way down, from three and a half turns a second to a
 * standstill. It is already crawling by the time it reaches 5 %, takes 2.5
 * seconds to cross that one slice, and then hangs on the stick at the far edge
 * of it — three degrees in the better part of a second — before slipping over
 * and rolling to a stop just inside 50 %.
 *
 * The angles are in the stylesheet because that is the only place that can
 * interpolate them. What matters here is only how long it all takes.
 */
const SPIN_MS = 9650;

/** The prize is announced as the disc settles, not a beat after it. */
const REVEAL_MS = SPIN_MS + 120;

/**
 * Where the countdown starts before the server has answered.
 *
 * A freshly won offer starts at the full ten minutes. A restored one starts on
 * the deadline the note kept from before checkout, so the clock picks up where
 * the buyer left it instead of jumping back up and then correcting itself a
 * round trip later.
 */
function remainingSeconds(restored: boolean) {
  if (!restored) {
    return OFFER_SECONDS;
  }

  const expiresAt = readOfferResume().expiresAt;

  return expiresAt === null
    ? OFFER_SECONDS
    : Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
}

const CONFETTI_COLORS = [
  "#ff6d68",
  "#ffb347",
  "#34c759",
  "#0066cc",
  "#b18bff",
  "#ff9a94",
  "#ffd93d",
  "#4fc3f7",
];

/** How many pieces fall when the prize lands. */
const CONFETTI_COUNT = 56;

/**
 * A deterministic stand-in for randomness, so no two pieces match.
 *
 * Not `Math.random`: this list is rebuilt on every render of the sheet — the
 * countdown alone re-renders it once a second — and random values would
 * re-scatter the confetti in mid-air on each tick. Keyed off the index, every
 * render lays out exactly the same fall.
 */
function scatter(index: number, salt: number) {
  const n = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;

  return n - Math.floor(n);
}

type OfferPlan = {
  id: "yearly" | "monthly";
  labelKey: MessageKey;
  priceKey: MessageKey;
  /** The small print under the price: what is actually charged, and when. */
  billingKey: MessageKey;
  /** Null on the plan the design leaves unbadged. */
  badgeKey: MessageKey | null;
  headlineAmount: number;
  discountedAmount: number;
  renewalAmount: number;
};

/**
 * The coupon is `duration: once`, so it halves the first billing period only.
 * The copy says exactly that rather than implying a permanent price.
 */
const OFFER_PLANS: OfferPlan[] = [
  {
    id: "yearly",
    labelKey: "offer.plan.oneOff",
    priceKey: "offer.plan.oneOffPrice",
    /*
     * One line of small print, not two. The card used to say the same thing
     * twice — a "first year / then" line beside a "billed yearly" line — and
     * Stripe restates the full terms at checkout anyway.
     *
     * What stays is the renewal price. That the discount covers one period and
     * the price goes up afterwards is the one thing a buyer cannot find out
     * later, so it is not the sort of text to trim.
     */
    billingKey: "offer.plan.oneOffBilling",
    badgeKey: "offer.plan.saveBadge",
    headlineAmount: 1.25,
    discountedAmount: 65,
    renewalAmount: 130,
  },
  {
    id: "monthly",
    labelKey: "billing.plan.monthly",
    priceKey: "offer.plan.monthlyPrice",
    billingKey: "offer.plan.monthlyBilling",
    badgeKey: null,
    headlineAmount: 10,
    discountedAmount: 10,
    renewalAmount: 20,
  },
];

export function DiscountOffer({
  wheelOpen,
  offerOpen,
  offerRestored = false,
  onWheelOpenChange,
  onOfferOpenChange,
  onClaimed,
  nativeOffer = false,
}: {
  wheelOpen: boolean;
  offerOpen: boolean;
  /** Restored after checkout rather than opened by the wheel: no entrance. */
  offerRestored?: boolean;
  onWheelOpenChange: (open: boolean) => void;
  onOfferOpenChange: (open: boolean) => void;
  /** Fired once the prize is banked, so the home card can stop offering it. */
  onClaimed: () => void;
  nativeOffer?: boolean;
}) {
  const { locale, t } = useTranslations();
  const spinTimerRef = useRef<number | null>(null);
  /** Set once checkout has been started, so leaving does not withdraw a prize
   *  the purchase is already carrying. */
  const boughtRef = useRef(false);
  /** Read through a ref: the countdown effect runs before the sheet exists. */
  const closeOfferRef = useRef<(() => void) | null>(null);
  /** The prize's deadline, as the server knows it. Null until it answers. */
  const expiresAtRef = useRef<number | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasWon, setHasWon] = useState(false);
  const [plan, setPlan] = useState<OfferPlan["id"]>("yearly");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appleOffers, setAppleOffers] = useState<NativeProduct[]>([]);
  /*
   * The offer's ten minutes. The server is what actually enforces the window —
   * it measures from the recorded spin and refuses the coupon after it — so
   * this is the honest display of a deadline rather than the deadline itself.
   */
  const [secondsLeft, setSecondsLeft] = useState(() => remainingSeconds(offerRestored));

  useEffect(
    () => () => {
      if (spinTimerRef.current !== null) {
        window.clearTimeout(spinTimerRef.current);
      }
    },
    [],
  );

  /*
   * Coming back from Stripe without the page being rebuilt.
   *
   * Safari and Chrome keep the page alive when the buyer navigates back, so
   * this component comes back exactly as it left: the button still says
   * "Odpiram…" and is still disabled, and `boughtRef` still says a purchase is
   * carrying the coupon — which would leave a live offer nobody could act on
   * and a prize that closing the sheet no longer withdraws. The trip is over,
   * so the sheet is put back the way it was before it started.
   */
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) {
        return;
      }

      boughtRef.current = false;
      setIsCheckingOut(false);
    };

    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  async function spin() {
    if (isSpinning || hasWon) {
      return;
    }

    // The disc starts turning on the tap, not on the answer below.
    const startedAt = Date.now();

    setIsSpinning(true);
    setError(null);

    if (nativeOffer) {
      // Introductory offers are governed by Apple eligibility, with no invented
      // ten-minute expiry or Stripe coupon written to the learner's profile.
      try {
        const offers = halfOffProducts(await nativeRequest("products"));
        if (!offers.length) throw new Error("Offer unavailable");
        setAppleOffers(offers);
        onClaimed();
        spinTimerRef.current = window.setTimeout(() => {
          spinTimerRef.current = null;
          setHasWon(true);
        }, Math.max(0, REVEAL_MS - (Date.now() - startedAt)));
      } catch {
        setIsSpinning(false);
        setError(t("native.priceChanged"));
      }
      return;
    }

    // Bank the prize first: the animation is long enough that a learner could
    // navigate away mid-spin, and the award should survive that.
    try {
      const response = await fetch("/api/discount-wheel", { method: "POST" });

      if (!response.ok) {
        throw new Error(t("offer.error.prizeSave"));
      }

      onClaimed();
    } catch {
      // The wheel still resolves; checkout simply will not carry a coupon, and
      // the learner sees the ordinary price rather than a broken screen.
      setError(t("offer.error.prizeSaveDetail"));
    }

    /*
     * Counted from the tap, not from this line. The request above took however
     * long it took and the disc has been turning for all of it, so timing the
     * reveal from here would announce the prize after the wheel had already
     * come to rest.
     */
    spinTimerRef.current = window.setTimeout(
      () => {
        spinTimerRef.current = null;
        setHasWon(true);
      },
      Math.max(0, REVEAL_MS - (Date.now() - startedAt)),
    );
  }

  async function startCheckout() {
    // The purchase carries the coupon from here on, so leaving this screen
    // must not withdraw it.
    boughtRef.current = true;
    /*
     * And the offer is not closed by going to Stripe — only by closing it. The
     * note is what puts the sheet back when the buyer returns, whichever way
     * they come back, and it carries the prize's deadline so the countdown
     * resumes rather than restarting; see src/lib/offer-resume.ts.
     */
    markOfferResume(expiresAtRef.current);
    setIsCheckingOut(true);
    setError(null);

    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? t("offer.error.checkout"));
      }

      window.location.href = payload.url;
    } catch (caught) {
      // Nothing was opened, so there is nothing to come back from: the sheet is
      // still here, and the note would only resurrect it after the next reload.
      boughtRef.current = false;
      clearOfferResume();
      setError(caught instanceof Error ? caught.message : t("offer.error.checkout"));
      setIsCheckingOut(false);
    }
  }

  /*
   * Both are full-height sheets the design marks scrollable, so the grabber is
   * the only place a drag starts, and both leave through the shared exit.
   */
  useEffect(() => {
    if (nativeOffer) return;
    if (!offerOpen) {
      setSecondsLeft(remainingSeconds(offerRestored));
      expiresAtRef.current = null;
      return;
    }

    /*
     * A restored sheet starts on the deadline it left with rather than on a
     * fresh ten minutes: the fetch below is a round trip away, and putting a
     * minute back on a clock the buyer has been watching is worse than being a
     * second out until the server answers.
     */
    if (offerRestored) {
      const remembered = readOfferResume().expiresAt;

      if (remembered !== null) {
        expiresAtRef.current = remembered;
        setSecondsLeft(Math.max(0, Math.round((remembered - Date.now()) / 1000)));
      }
    }

    /*
     * Count down to the server's deadline, not to ten minutes from now.
     *
     * The clock starts at the spin and belongs to the prize, so opening Stripe
     * and coming back has to resume it rather than restart it — a countdown
     * that resets every time the sheet reopens is not a deadline, it is a
     * decoration. `expiresAtRef` is filled by the fetch below; until it
     * answers, the full ten minutes is the honest guess.
     */
    const started = Date.now();
    let cancelled = false;

    void fetch("/api/discount-wheel")
      .then((response) => (response.ok ? response.json() : null))
      .then((state: { prizeExpiresAt?: string | null; hasUnredeemedPrize?: boolean } | null) => {
        if (cancelled || !state) {
          return;
        }

        /*
         * A restored offer can outlive the prize it is selling. Coming back
         * from Stripe puts a buyer where they left off, and if they left off
         * long enough — a checkout tab abandoned for a quarter of an hour —
         * the ten minutes are gone and checkout would quietly charge full
         * price under a headline that says half. The server is the only one
         * who knows, so the sheet closes on its word rather than opening on a
         * fresh countdown it cannot honour.
         *
         * Only when restoring. A sheet the wheel has just opened is trusted
         * even if the server says there is nothing banked, because that is
         * what a failed spin looks like — and the answer to it is the error
         * the sheet already shows and an honest full-price checkout, not the
         * offer vanishing out from under the tap that opened it.
         */
        if (offerRestored && state.hasUnredeemedPrize === false) {
          closeOfferRef.current?.();
          return;
        }

        const expiresAt = state.prizeExpiresAt ? Date.parse(state.prizeExpiresAt) : Number.NaN;

        if (Number.isFinite(expiresAt)) {
          expiresAtRef.current = expiresAt;
          setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));

          // So the next trip through checkout resumes on the server's deadline
          // rather than on whatever the last one happened to know.
          if (offerRestored) {
            markOfferResume(expiresAt);
          }
        }
      })
      .catch(() => {});

    const id = window.setInterval(() => {
      const deadline = expiresAtRef.current;
      const left =
        deadline === null
          ? Math.max(0, OFFER_SECONDS - Math.floor((Date.now() - started) / 1000))
          : Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(left);

      // Out of time closes the offer, which withdraws the prize the same way
      // walking away does. The server would refuse the coupon by now anyway;
      // this is so the screen says so rather than sitting on a dead offer.
      if (left === 0) {
        window.clearInterval(id);
        closeOfferRef.current?.();
      }
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [offerOpen, offerRestored, nativeOffer]);

  const wheelSheet = useSheet(
    useCallback(() => onWheelOpenChange(false), [onWheelOpenChange]),
    { scrollable: true },
  );
  /*
   * Closing the offer gives the prize up, and closes the wheel with it.
   *
   * The wheel is what opened the offer and stays mounted behind it, so
   * dismissing only the top sheet put the learner back on a spun wheel showing
   * a prize they had just declined. And the offer is "now or not at all": if
   * walking away left the coupon attached, the countdown would be a bluff and
   * checkout would still be half price an hour later.
   *
   * Fire-and-forget. The prize is the server's to withdraw and it has already
   * happened as far as this screen is concerned; a failed request should not
   * hold the sheet open or put an error in front of somebody leaving.
   */
  const offerSheet = useSheet(
    useCallback(() => {
      if (!nativeOffer && !boughtRef.current) {
        void fetch("/api/discount-wheel", { method: "DELETE" }).catch(() => {});
      }

      /*
       * This is the close the flag was waiting for. Every way out lands here —
       * the cross, the scrim, the drag, and the countdown reaching zero — so
       * closing the sheet is the one thing that stops it coming back, which is
       * what "still there until you close it" has to mean.
       */
      clearOfferResume();
      onOfferOpenChange(false);
      onWheelOpenChange(false);
    }, [onOfferOpenChange, onWheelOpenChange, nativeOffer]),
    { scrollable: true },
  );

  const closeWheel = wheelSheet.dismiss;
  const closeOffer = offerSheet.dismiss;
  const isClosing = offerOpen ? offerSheet.closing : wheelSheet.closing;

  useEffect(() => {
    closeOfferRef.current = closeOffer;
  });

  if (!wheelOpen && !offerOpen) {
    return null;
  }

  return (
    <MemoPortal>
      <button
        type="button"
        aria-label={t("common.close")}
        className={sheetClass("memo-scrim", isClosing)}
        onClick={() => {
          if (offerOpen) {
            closeOffer();
            return;
          }

          closeWheel();
        }}
      />

      {wheelOpen && !offerOpen ? (
        <div
          className={sheetClass("memo-sheet-full memo-wheel-sheet", wheelSheet.closing)}
          role="dialog"
          aria-modal="true"
          {...wheelSheet.dragProps}
        >
          <div className="memo-grab-wide" data-drag-handle>
            <span />
          </div>
          {/* The whole header drags, not just the 3.4rem grabber — the same
              zone the app's other sheets give a thumb. */}
          <div className="memo-wheel-close-row" data-drag-zone>
            <button
              type="button"
              aria-label={t("common.close")}
              className="memo-close-button"
              onClick={() => closeWheel()}
            >
              <Msym name="close" size="1.45rem" fill={false} weight={500} />
            </button>
          </div>

          <div className="memo-wheel-body">
            {hasWon ? (
              <div className="memo-confetti" aria-hidden="true">
                {Array.from({ length: CONFETTI_COUNT }, (_, index) => {
                  const size = 0.34 + scatter(index, 3) * 0.42;
                  const round = scatter(index, 6) > 0.72;

                  return (
                    <span
                      key={index}
                      style={
                        {
                          left: `${-2 + scatter(index, 1) * 104}%`,
                          background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                          "--w": `${size}rem`,
                          // Round pieces stay round; the rest are longer than
                          // they are wide, so they read as tumbling paper.
                          "--h": `${round ? size : size * (1.3 + scatter(index, 4) * 1.1)}rem`,
                          "--r": round ? "999px" : "2px",
                          "--dx": `${(scatter(index, 2) - 0.5) * 190}px`,
                          "--dy": `${300 + scatter(index, 7) * 190}px`,
                          "--spin": `${(scatter(index, 5) - 0.5) * 1600}deg`,
                          animation: `memo-confetti-fall ${
                            1.45 + scatter(index, 8) * 1.5
                          }s cubic-bezier(0.3,0.7,0.4,1) ${scatter(index, 9) * 0.62}s both`,
                        } as React.CSSProperties
                      }
                    />
                  );
                })}
              </div>
            ) : null}

            <span className="memo-emoji" style={{ fontSize: "2rem" }}>
              🎁
            </span>
            <h1 className="memo-wheel-title">{t("offer.wheelTitle")}</h1>
            <p className="memo-wheel-sub">
              {t(
                hasWon
                  ? (nativeOffer ? "native.introReady" : "offer.wheelWon")
                  : isSpinning
                    ? "offer.wheelSpinning"
                    : (nativeOffer ? "native.introReveal" : "offer.wheelIdle"),
              )}
            </p>

            {/* One class drives both the disc and the pointer that knocks
                against its sticks, so the two cannot drift apart. */}
            <div
              className={`memo-wheel ${isSpinning || hasWon ? "spinning" : ""}`.trim()}
              style={{ "--memo-wheel-spin-duration": `${SPIN_MS}ms` } as React.CSSProperties}
            >
              <div className="memo-wheel-glow" aria-hidden="true" />
              <div className="memo-wheel-pointer" aria-hidden="true" />
              <div className="memo-wheel-disc">
                {WHEEL_SLICES.map((label, index) => (
                  <span
                    key={label}
                    className="memo-wheel-slice"
                    style={{
                      transform: `translate(-50%, -50%) rotate(${
                        index * 60 + 30
                      }deg) translateY(-4.9rem)`,
                    }}
                  >
                    {label}
                  </span>
                ))}
                {Array.from({ length: 6 }, (_, index) => (
                  <span
                    key={`peg-${index}`}
                    className="memo-wheel-peg"
                    style={{ transform: `rotate(${index * 60}deg) translateY(-6.35rem)` }}
                  />
                ))}
              </div>
              <div className="memo-wheel-hub">
                <Image src="/memo-mascot.png" alt="" width={320} height={288} />
              </div>
            </div>

            {hasWon ? (
              <div className="memo-wheel-prize">
                <p>{t("offer.prizeAmount")}</p>
                <p>{t(nativeOffer ? "native.introCaption" : "offer.prizeCaption")}</p>
                {nativeOffer ? appleOffers.map(product => <p key={product.id}>{t(
                  product.id === "eu.memoai.premium.yearly" ? "native.firstYearPrice" : "native.firstMonthPrice",
                  { initial: product.introPrice!, renewal: product.price },
                )}</p>) : null}
              </div>
            ) : null}

            {error ? <p className="memo-inline-error">{error}</p> : null}

            <button
              type="button"
              className={`memo-wheel-cta ${isSpinning && !hasWon ? "waiting" : ""}`.trim()}
              onClick={() => {
                if (hasWon) {
                  onOfferOpenChange(true);
                  return;
                }

                void spin();
              }}
              disabled={isSpinning && !hasWon}
            >
              {hasWon ? t("offer.claim") : t(isSpinning ? "offer.spinning" : "offer.spin")}
            </button>
          </div>
        </div>
      ) : null}

      {offerOpen && nativeOffer ? (
        <div className={sheetClass("memo-sheet-full memo-wheel-sheet", offerSheet.closing)} role="dialog" aria-modal="true">
          <NativePaywall halfOffOnly onClose={closeOffer} />
        </div>
      ) : null}

      {offerOpen && !nativeOffer ? (
        <div
          className={sheetClass(`memo-sheet-full memo-offer-sheet ${offerRestored ? "restored" : ""}`.trim(), offerSheet.closing)}
          role="dialog"
          aria-modal="true"
          {...offerSheet.dragProps}
        >
          <div className="memo-grab-wide" data-drag-handle>
            <span className="light" />
          </div>
          {/* The logo below already says whose offer this is. */}
          <div className="memo-offer-head" data-drag-zone>
            <button
              type="button"
              aria-label={t("offer.close")}
              className="memo-offer-close"
              onClick={() => closeOffer()}
            >
              <Msym name="close" size="1.45rem" fill={false} weight={500} />
            </button>
          </div>

          <div className="memo-offer-body">
            <Image
              src={BRAND_LOCKUP_SRC}
              alt={SEO_BRAND_NAME}
              width={BRAND_LOCKUP_WIDTH}
              height={BRAND_LOCKUP_HEIGHT}
              className="memo-offer-logo"
            />
            <p className="memo-offer-kicker">{t("offer.kicker")}</p>
            <p className="memo-offer-headline">{t("offer.headline")}</p>
            <p className="memo-offer-sub">{t("offer.sub")}</p>

            {/* Big numbers and nothing else. The urgency is the number. */}
            <p
              className={`memo-offer-timer ${secondsLeft <= 60 ? "urgent" : ""}`.trim()}
              role="timer"
              aria-live="off"
            >
              {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </p>

            <div className="memo-offer-plans">
              {OFFER_PLANS.map((offerPlan) => (
                <button
                  key={offerPlan.id}
                  type="button"
                  className={`memo-offer-plan ${plan === offerPlan.id ? "selected" : ""}`.trim()}
                  onClick={() => setPlan(offerPlan.id)}
                >
                  {offerPlan.badgeKey ? (
                    <span className="memo-offer-badge">{t(offerPlan.badgeKey)}</span>
                  ) : null}
                  <span className="memo-offer-radio" />
                  {/* Name over its small print on the left, the headline price
                      on the right — the long billing line needs the full width
                      of the card, not the sliver beside the price. */}
                  <span className="memo-offer-plan-copy">
                    <span>{t(offerPlan.labelKey)}</span>
                    <span className="memo-offer-billing">
                      {t(offerPlan.billingKey, {
                        discounted: formatCurrency(offerPlan.discountedAmount, locale),
                        renewal: formatCurrency(offerPlan.renewalAmount, locale),
                      })}
                    </span>
                  </span>
                  <span className="memo-offer-price">
                    {t(offerPlan.priceKey, {
                      amount: formatCurrency(offerPlan.headlineAmount, locale),
                    })}
                  </span>
                </button>
              ))}

              {error ? <p className="memo-inline-error">{error}</p> : null}

              <button
                type="button"
                className="memo-offer-cta"
                onClick={() => void startCheckout()}
                disabled={isCheckingOut}
              >
                {t(isCheckingOut ? "offer.opening" : "common.continue")}
              </button>
              <p className="memo-offer-fine">{t("offer.fine")}</p>
            </div>
          </div>
        </div>
      ) : null}
    </MemoPortal>
  );
}
