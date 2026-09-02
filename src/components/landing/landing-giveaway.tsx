"use client";

import { useEffect, useState } from "react";

import { GiveawayPodium } from "@/components/giveaway-podium";
import { useTranslations } from "@/components/i18n-provider";
import { GIVEAWAY_POLL_MS, type GiveawayLeaderboard } from "@/lib/giveaway-shared";

/* The standings on the landing page. Rendered from the server's copy so the
   first paint already has them, then refreshed while the tab is visible — a
   board that says "live" and only moves on reload is not one. Names arrive
   masked from the API; nothing here has ever seen an address. */
export function LandingGiveawayBoard({ initial }: { initial: GiveawayLeaderboard }) {
  const { t } = useTranslations();
  const [board, setBoard] = useState(initial);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    async function refresh() {
      if (document.visibilityState !== "visible") {
        return;
      }

      try {
        const response = await fetch("/api/giveaway/leaderboard");

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as GiveawayLeaderboard;

        if (!cancelled && Array.isArray(payload.entries)) {
          setBoard(payload);
        }
      } catch {
        // Stale for one more interval; nothing to tell the visitor.
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

    schedule();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const entries = board.entries.slice(0, 6);

  return (
    <div className="landing-v2-giveaway-board">
      <div className="landing-v2-giveaway-board-head">
        <h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/giveaway/trophy.png" alt="" width={64} height={64} />
          {t("landing.giveaway.leaderboardTitle")}
        </h3>
        <span className="landing-v2-giveaway-live">
          <span aria-hidden="true" />
          {t("giveaway.leaderboard.live")}
        </span>
      </div>

      {board.winner ? (
        <p className="landing-v2-giveaway-winner">
          🏆 <strong>{t("giveaway.leaderboard.winner", { name: board.winner.name })}</strong>{" "}
          {t("giveaway.leaderboard.concluded")}
        </p>
      ) : null}

      <GiveawayPodium entries={entries} prefix="landing-v2-giveaway" goal={board.goal} />

      {entries.length === 0 ? (
        <p className="landing-v2-giveaway-empty">{t("landing.giveaway.leaderboardEmpty")}</p>
      ) : null}

      <p className="landing-v2-giveaway-goal">{t("landing.giveaway.step3Title", { goal: board.goal })}</p>
    </div>
  );
}
