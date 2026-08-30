"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
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
const SPIN_MS = 6250;

const CONFETTI_COLORS = ["#ff6d68", "#ffb347", "#34c759", "#0066cc", "#b18bff", "#ff9a94"];

type OfferPlan = {
  id: "yearly" | "monthly";
  label: string;
  detail: string;
  price: string;
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
    detail: "Prvo leto €65, nato €130 na leto",
    price: "€1,25/teden",
    badge: "PRIHRANI 50 %",
  },
  {
    id: "monthly",
    label: "Mesečno",
    detail: "Prvi mesec €10, nato €20 na mesec",
    price: "€10/mesec",
    badge: "",
  },
];

export function DiscountOffer({
  wheelOpen,
  offerOpen,
  onWheelOpenChange,
  onOfferOpenChange,
  onClaimed,
}: {
  wheelOpen: boolean;
  offerOpen: boolean;
  onWheelOpenChange: (open: boolean) => void;
  onOfferOpenChange: (open: boolean) => void;
  /** Fired once the prize is banked, so the home card can stop offering it. */
  onClaimed: () => void;
}) {
  const spinTimerRef = useRef<number | null>(null);
  const [isSpinning, setIsSpinning] = useState(false);
  const [hasWon, setHasWon] = useState(false);
  const [plan, setPlan] = useState<OfferPlan["id"]>("yearly");
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function closeWheel() {
    onWheelOpenChange(false);
  }

  if (!wheelOpen && !offerOpen) {
    return null;
  }

  return (
    <MemoPortal>
      <button
        type="button"
        aria-label="Zapri"
        className="memo-scrim"
        onClick={() => {
          if (offerOpen) {
            onOfferOpenChange(false);
            return;
          }

          closeWheel();
        }}
      />

      {wheelOpen && !offerOpen ? (
        <div className="memo-sheet-full memo-wheel-sheet" role="dialog" aria-modal="true">
          <div className="memo-grab-wide">
            <span />
          </div>
          <div className="memo-wheel-close-row">
            <button
              type="button"
              aria-label="Zapri"
              className="memo-m-round"
              onClick={closeWheel}
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
              {hasWon ? "Uporabi kodo" : isSpinning ? "Vrtim…" : "Zavrti kolo"}
            </button>
          </div>
        </div>
      ) : null}

      {offerOpen ? (
        <div className="memo-sheet-full memo-offer-sheet" role="dialog" aria-modal="true">
          <div className="memo-grab-wide">
            <span className="light" />
          </div>
          <div className="memo-offer-head">
            <span>{SEO_BRAND_NAME}</span>
            <button
              type="button"
              aria-label="Zapri ponudbo"
              className="memo-offer-close"
              onClick={() => onOfferOpenChange(false)}
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
                  <span className="memo-offer-plan-copy">
                    <span>{offerPlan.label}</span>
                    {offerPlan.detail ? <span>{offerPlan.detail}</span> : null}
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
