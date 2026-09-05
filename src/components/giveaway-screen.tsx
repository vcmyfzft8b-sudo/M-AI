"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAppHref } from "@/components/creator-demo/creator-demo-context";
import { GiveawayPodium } from "@/components/giveaway-podium";
import { useTranslations } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { BRAND_NAME } from "@/lib/brand";
import {
  GIVEAWAY_GOAL,
  GIVEAWAY_POLL_MS,
  GIVEAWAY_PRIZE_NAME,
  buildGiveawayShareUrl,
  type GiveawayLeaderboard,
} from "@/lib/giveaway-shared";

/**
 * The giveaway screen: the account's code, how far it has got, who is ahead,
 * and the rules. Reached from the card at the top of Settings.
 *
 * The code and the standings are rendered from the server's answer and then
 * kept fresh by polling `/api/giveaway` while the tab is visible — the board
 * is the thing people come back to look at, and a leaderboard that only
 * moves on reload is not "live". The demo (`/creator/giveaway`) never polls:
 * it has no account and its numbers are props.
 */

export type GiveawayScreenProps = {
  /** Null until the account has asked for one. */
  code: string | null;
  progress: { qualifiedCount: number; pendingCount: number };
  leaderboard: GiveawayLeaderboard;
  hasSubscription: boolean;
  /** A friend's code the viewer arrived with, for the buy card's small print. */
  referralCode?: string | null;
  isDemo?: boolean;
};

type GiveawayState = Pick<GiveawayScreenProps, "code" | "progress" | "leaderboard">;

export function GiveawayScreen({
  code,
  progress,
  leaderboard,
  hasSubscription,
  referralCode = null,
  isDemo = false,
}: GiveawayScreenProps) {
  const { t } = useTranslations();
  const { navigateWithFeedback, overlay: navigationOverlay, isNavigating } = useInstantNavigation();
  const settingsHref = useAppHref("/app/settings");
  const startHref = useAppHref("/app/start");
  const [state, setState] = useState<GiveawayState>({ code, progress, leaderboard });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [isGettingCode, setIsGettingCode] = useState(false);

  useEffect(() => {
    if (isDemo) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    async function refresh() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch("/api/giveaway", { cache: "no-store" });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as GiveawayState;

        if (!cancelled && payload.leaderboard) {
          setState(payload);
        }
      } catch {
        // A missed poll is a board that is a little stale; the next one catches up.
      }
    }

    function schedule() {
      timer = window.setTimeout(async () => {
        await refresh();
        if (!cancelled) {
          schedule();
        }
      }, GIVEAWAY_POLL_MS);
    }

    // Coming back to the tab is the moment somebody expects fresh numbers.
    function onVisible() {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    }

    document.addEventListener("visibilitychange", onVisible);
    schedule();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [isDemo]);

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }

  function shareUrl() {
    return buildGiveawayShareUrl(window.location.origin, state.code ?? "");
  }

  /** The "Get my code" button: one POST, and the code takes the button's place. */
  async function getCode() {
    if (isDemo) {
      setState((current) => ({ ...current, code: "BTS-DEMO26" }));
      return;
    }

    setIsGettingCode(true);

    try {
      const response = await fetch("/api/giveaway", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { code?: string; error?: string }
        | null;

      if (!response.ok || !payload?.code) {
        throw new Error(payload?.error ?? t("giveaway.code.getFailed"));
      }

      setState((current) => ({ ...current, code: payload.code ?? current.code }));
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : t("giveaway.code.getFailed"));
    } finally {
      setIsGettingCode(false);
    }
  }

  async function copyText(text: string, message: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(message);
    } catch {
      // Clipboard access can be refused; the code is on screen to read.
      window.prompt(message, text);
    }
  }

  async function share() {
    const url = shareUrl();
    const text = t("giveaway.share.text", { brand: BRAND_NAME, url });

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: t("giveaway.share.title", { brand: BRAND_NAME }), text, url });
        return;
      } catch (error) {
        // Closing the sheet is not a failure; anything else falls back to copying.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
      }
    }

    await copyText(url, t("giveaway.share.copied"));
  }

  const goal = state.leaderboard.goal || GIVEAWAY_GOAL;
  const qualified = state.progress.qualifiedCount;
  const remaining = Math.max(goal - qualified, 0);
  const percent = Math.min(100, Math.round((qualified / goal) * 100));
  const winner = state.leaderboard.winner;

  return (
    <>
      {navigationOverlay}
      <div className="memo-settings-screen memo-giveaway-screen">
        {/* Phone: the way back to settings floats over the screen. */}
        <div className="memo-settings-topbar memo-giveaway-topbar memo-only-mobile flex">
          <button
            type="button"
            aria-label={t("common.back")}
            className="memo-close-button"
            aria-busy={isNavigating}
            onClick={() => navigateWithFeedback(settingsHref)}
          >
            <Msym name="arrow_back" size="1.45rem" fill={false} weight={500} />
          </button>
        </div>

        <div className="memo-screen-scroll">
          <div className="memo-page">
            <h1>{t("giveaway.title", { prize: GIVEAWAY_PRIZE_NAME })}</h1>
            <p className="memo-giveaway-lead">{t("giveaway.lead", { goal, prize: GIVEAWAY_PRIZE_NAME })}</p>

            <section className="memo-giveaway-board">
              <span className="memo-giveaway-board-head">
                <h2 className="memo-settings-heading">{t("giveaway.leaderboard.title")}</h2>
                {!isDemo ? (
                  <span className="memo-giveaway-live">
                    <span aria-hidden="true" />
                    {t("giveaway.leaderboard.live")}
                  </span>
                ) : null}
              </span>

              {winner ? (
                <p className="memo-giveaway-winner">
                  <Emoji symbol="🏆" size="1.2rem" />
                  <span>
                    <strong>{t("giveaway.leaderboard.winner", { name: winner.name })}</strong>{" "}
                    {t("giveaway.leaderboard.concluded")}
                  </span>
                </p>
              ) : null}

              <GiveawayPodium entries={state.leaderboard.entries} prefix="memo-giveaway" goal={goal} />
            </section>

            <section className="memo-giveaway-code-section">
              <h2 className="memo-settings-heading">{t("giveaway.code.label")}</h2>
              <div className="memo-card-row memo-giveaway-code-card">
              {state.code ? (
                <>
                  <span className="memo-giveaway-code" aria-label={state.code}>
                    {state.code}
                  </span>
                  <div className="memo-giveaway-actions">
                    <button
                      type="button"
                      className="memo-giveaway-secondary"
                      onClick={() => copyText(state.code ?? "", t("giveaway.code.copied"))}
                    >
                      <Msym name="content_copy" size="1.2rem" fill={false} weight={500} />
                      <span>{t("giveaway.code.copy")}</span>
                    </button>
                    <button type="button" className="memo-primary-pill memo-giveaway-share" onClick={share}>
                      <Msym name="ios_share" size="1.2rem" fill={false} weight={500} />
                      <span>{t("giveaway.share.button")}</span>
                    </button>
                  </div>
                </>
              ) : (
                <div className="memo-giveaway-actions">
                  <button
                    type="button"
                    className="memo-primary-pill memo-giveaway-share"
                    onClick={getCode}
                    disabled={isGettingCode}
                    aria-busy={isGettingCode}
                  >
                    {isGettingCode ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Emoji symbol="🎟️" size="1rem" />
                    )}
                    <span>{t("giveaway.code.get")}</span>
                  </button>
                </div>
              )}

              {/* Progress lives with the code: the code is how the number moves. */}
              <div className="memo-giveaway-progress">
                <span className="memo-giveaway-progress-row">
                  <span className="memo-giveaway-count">
                    {t("giveaway.progress.count", { count: qualified, goal })}
                  </span>
                  <span className="memo-giveaway-progress-note">
                    {remaining === 0
                      ? t("giveaway.progress.reached")
                      : t("giveaway.progress.remaining", { count: remaining })}
                  </span>
                </span>
                <div
                  className="memo-giveaway-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={goal}
                  aria-valuenow={qualified}
                  aria-label={t("giveaway.progress.label")}
                >
                  <span style={{ width: `${percent}%` }} />
                </div>
                {state.progress.pendingCount > 0 ? (
                  <span className="memo-giveaway-progress-note">
                    {t("giveaway.progress.pending", { count: state.progress.pendingCount })}
                  </span>
                ) : null}
              </div>
              </div>
            </section>

            {!hasSubscription ? (
              <div className="memo-giveaway-buy">
                <span className="memo-giveaway-buy-copy">
                  <span className="memo-card-row-title">{t("giveaway.buy.title")}</span>
                  {referralCode ? (
                    <span className="memo-card-row-detail">
                      {t("giveaway.buy.withCode", { code: referralCode })}
                    </span>
                  ) : null}
                </span>
                <InstantLink href={startHref} className="memo-primary-pill">
                  <Emoji symbol="✨" size="1rem" />
                  <span>{t("giveaway.buy.cta", { brand: BRAND_NAME })}</span>
                </InstantLink>
              </div>
            ) : null}

            <p className="memo-fine-print">{t("giveaway.rules.short")}</p>
          </div>
        </div>
      </div>

      {toast ? (
        <MemoPortal>
          <div className="memo-toast" role="status">
            <Msym name="check_circle" size="1.25rem" />
            <span>{toast}</span>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
