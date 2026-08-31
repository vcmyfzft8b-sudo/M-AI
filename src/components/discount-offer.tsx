"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { sheetClass, useSheet } from "@/components/use-sheet";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";

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

/** Matches the design: 6 slices, and the pointer lands on the 50 % one. */
const WHEEL_SLICES = ["10 %", "5 %", "20 %", "50 %", "15 %", "30 %"];
const SPIN_DEGREES = 3390;
/** How long the offer stands, matching WHEEL_PRIZE_TTL_MS on the server. */
const OFFER_SECONDS = 10 * 60;

const SPIN_MS = 6250;

const CONFETTI_COLORS = ["#ff6d68", "#ffb347", "#34c759", "#0066cc", "#b18bff", "#ff9a94"];

type OfferPlan = {
  id: "yearly" | "monthly";
  label: string;
  price: string;
  /** The small print under the price: what is actually charged, and when. */
  billing: string;
  badge: string;
};

/**
 * The coupon is `duration: once`, so it halves the first billing period only.
 * The copy says exactly that rather than implying a permanent price.
 */
const OFFER_PLANS: OfferPlan[] = [
  {
    id: "yearly",
    label: "Enkratna ponudba",
    price: "€1,25/teden",
    /*
     * One line of small print, not two. The card used to say the same thing
     * twice — a "first year / then" line beside a "billed yearly" line — and
     * Stripe restates the full terms at checkout anyway.
     *
     * What stays is the renewal price. That the discount covers one period and
     * the price goes up afterwards is the one thing a buyer cannot find out
     * later, so it is not the sort of text to trim.
     */
    billing: "Obračunano letno: €65, nato €130",
    badge: "PRIHRANI 50 %",
  },
  {
    id: "monthly",
    label: "Mesečno",
    price: "€10/mesec",
    billing: "Obračunano mesečno: €10, nato €20",
    badge: "",
  },
];

export function DiscountOffer({
  wheelOpen,
  offerOpen,
  offerRestored = false,
  onWheelOpenChange,
  onOfferOpenChange,
  onClaimed,
}: {
  wheelOpen: boolean;
  offerOpen: boolean;
  /** Restored after checkout rather than opened by the wheel: no entrance. */
  offerRestored?: boolean;
  onWheelOpenChange: (open: boolean) => void;
  onOfferOpenChange: (open: boolean) => void;
  /** Fired once the prize is banked, so the home card can stop offering it. */
  onClaimed: () => void;
}) {
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
  /*
   * The offer's ten minutes, counted from the moment it opens. The server is
   * what actually enforces the window — it measures from the recorded spin and
   * refuses the coupon after it — so this is the honest display of a deadline
   * rather than the deadline itself.
   */
  const [secondsLeft, setSecondsLeft] = useState(OFFER_SECONDS);

  useEffect(
    () => () => {
      if (spinTimerRef.current !== null) {
        window.clearTimeout(spinTimerRef.current);
      }
    },
    [],
  );

  async function spin() {
    if (isSpinning || hasWon) {
      return;
    }

    setIsSpinning(true);
    setError(null);

    // Bank the prize first: the animation is long enough that a learner could
    // navigate away mid-spin, and the award should survive that.
    try {
      const response = await fetch("/api/discount-wheel", { method: "POST" });

      if (!response.ok) {
        throw new Error("Nagrade ni bilo mogoče shraniti.");
      }

      onClaimed();
    } catch {
      // The wheel still resolves; checkout simply will not carry a coupon, and
      // the learner sees the ordinary price rather than a broken screen.
      setError("Nagrade ni bilo mogoče shraniti. Popust morda ne bo upoštevan.");
    }

    spinTimerRef.current = window.setTimeout(() => {
      spinTimerRef.current = null;
      setHasWon(true);
    }, SPIN_MS);
  }

  async function startCheckout() {
    // The purchase carries the coupon from here on, so leaving this screen
    // must not withdraw it.
    boughtRef.current = true;
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
        throw new Error(payload?.error ?? "Nakupa ni bilo mogoče začeti.");
      }

      window.location.href = payload.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nakupa ni bilo mogoče začeti.");
      setIsCheckingOut(false);
    }
  }

  /*
   * Both are full-height sheets the design marks scrollable, so the grabber is
   * the only place a drag starts, and both leave through the shared exit.
   */
  useEffect(() => {
    if (!offerOpen) {
      setSecondsLeft(OFFER_SECONDS);
      expiresAtRef.current = null;
      return;
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
      .then((state: { prizeExpiresAt?: string | null } | null) => {
        const expiresAt = state?.prizeExpiresAt ? Date.parse(state.prizeExpiresAt) : Number.NaN;

        if (!cancelled && Number.isFinite(expiresAt)) {
          expiresAtRef.current = expiresAt;
          setSecondsLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
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
  }, [offerOpen]);

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
      if (!boughtRef.current) {
        void fetch("/api/discount-wheel", { method: "DELETE" }).catch(() => {});
      }

      onOfferOpenChange(false);
      onWheelOpenChange(false);
    }, [onOfferOpenChange, onWheelOpenChange]),
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
        aria-label="Zapri"
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
              aria-label="Zapri"
              className="memo-close-button"
              onClick={() => closeWheel()}
            >
              <Msym name="close" size="1.45rem" fill={false} weight={500} />
            </button>
          </div>

          <div className="memo-wheel-body">
            {hasWon ? (
              <div className="memo-confetti" aria-hidden="true">
                {Array.from({ length: 18 }, (_, index) => (
                  <span
                    key={index}
                    style={
                      {
                        left: `${4 + index * 5.4}%`,
                        background: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                        "--dx": `${((index % 5) - 2) * 26}px`,
                        animation: `memo-confetti-fall ${
                          1.5 + (index % 4) * 0.35
                        }s cubic-bezier(0.3,0.7,0.4,1) ${(index % 6) * 0.09}s both`,
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>
            ) : null}

            <span className="memo-emoji" style={{ fontSize: "2rem" }}>
              🎁
            </span>
            <h1 className="memo-wheel-title">Zavrti kolo sreče</h1>
            <p className="memo-wheel-sub">
              {hasWon
                ? "Popust je zaklenjen — uporabi ga zdaj."
                : isSpinning
                  ? "Vrti se…"
                  : "En vrtljaj, en popust — velja samo danes."}
            </p>

            <div className="memo-wheel">
              <div className="memo-wheel-glow" aria-hidden="true" />
              <div className="memo-wheel-pointer" aria-hidden="true" />
              <div
                className="memo-wheel-disc"
                style={{ transform: `rotate(${isSpinning || hasWon ? SPIN_DEGREES : 0}deg)` }}
              >
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
                <p>50 % popusta</p>
                <p>Tvoja enkratna nagrada 🎉</p>
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
              {hasWon ? "Prevzemi popust" : isSpinning ? "Vrtim…" : "Zavrti kolo"}
            </button>
          </div>
        </div>
      ) : null}

      {offerOpen ? (
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
              aria-label="Zapri ponudbo"
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
            <p className="memo-offer-kicker">Tvoja enkratna ponudba</p>
            <p className="memo-offer-headline">50 % ceneje</p>
            <p className="memo-offer-sub">Ko zapreš ponudbo, je ni več.</p>

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
                  {offerPlan.badge ? (
                    <span className="memo-offer-badge">{offerPlan.badge}</span>
                  ) : null}
                  <span className="memo-offer-radio" />
                  {/* Name over its small print on the left, the headline price
                      on the right — the long billing line needs the full width
                      of the card, not the sliver beside the price. */}
                  <span className="memo-offer-plan-copy">
                    <span>{offerPlan.label}</span>
                    <span className="memo-offer-billing">{offerPlan.billing}</span>
                  </span>
                  <span className="memo-offer-price">{offerPlan.price}</span>
                </button>
              ))}

              {error ? <p className="memo-inline-error">{error}</p> : null}

              <button
                type="button"
                className="memo-offer-cta"
                onClick={() => void startCheckout()}
                disabled={isCheckingOut}
              >
                {isCheckingOut ? "Odpiram…" : "Nadaljuj"}
              </button>
              <p className="memo-offer-fine">Brez obveznosti. Prekliči kadarkoli.</p>
            </div>
          </div>
        </div>
      ) : null}
    </MemoPortal>
  );
}
