"use client";

import { useTranslations } from "@/components/i18n-provider";
import { giveawayInitials, type GiveawayLeaderboardEntry } from "@/lib/giveaway-shared";

/**
 * The top three on a podium — second, first, third, the way a podium is
 * built — followed by the rest of the ranking as rows. Shared by the app's
 * giveaway screen and the landing page's board; `prefix` picks which
 * stylesheet dresses it (`memo-giveaway` or `landing-v2-giveaway`), the
 * markup is one.
 *
 * Empty stands are drawn rather than hidden: an empty podium is the
 * invitation — three open spots — and the block keeps its height while
 * the board fills up.
 */

/* Microsoft Fluent Emoji, 3D set (MIT), copied into /public/giveaway. */
const MEDALS = ["/giveaway/medal-1.png", "/giveaway/medal-2.png", "/giveaway/medal-3.png"];
/* Visual order left to right; `place` is the rank each column holds. */
const PODIUM_ORDER = [1, 0, 2];

export function GiveawayPodium({
  entries,
  prefix,
  viewer,
  goal,
}: {
  entries: GiveawayLeaderboardEntry[];
  prefix: string;
  /**
   * The signed-in viewer's own count, when the screen knows it. Draws a
   * "your place" row when the viewer is not already on the board.
   */
  viewer?: { qualifiedCount: number } | null;
  goal: number;
}) {
  const { t } = useTranslations();
  const rest = entries.slice(3);
  const viewerOnBoard = entries.some((entry) => entry.isViewer);

  return (
    <>
      <ol className={`${prefix}-podium`} aria-label={t("giveaway.leaderboard.title")}>
        {PODIUM_ORDER.map((place) => {
          const entry = entries[place] ?? null;
          const percent = entry ? Math.min(100, Math.round((entry.qualifiedCount / goal) * 100)) : 0;

          return (
            <li
              key={place}
              className={[
                `${prefix}-podium-place`,
                `place-${place + 1}`,
                entry ? "" : "is-empty",
                entry?.isViewer ? "is-viewer" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ order: PODIUM_ORDER.indexOf(place) }}
            >
              <span className={`${prefix}-podium-medal`} aria-hidden="true">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={MEDALS[place]} alt="" width={64} height={64} />
              </span>
              <span className={`${prefix}-podium-avatar`} aria-hidden="true">
                {entry ? giveawayInitials(entry.name) : "?"}
              </span>
              <span className={`${prefix}-podium-name`}>
                {entry ? entry.name : t("giveaway.podium.free")}
                {entry?.isViewer ? (
                  <span className={`${prefix}-you`}>{t("giveaway.leaderboard.you")}</span>
                ) : null}
              </span>
              <span className={`${prefix}-podium-count`}>
                {entry ? t("giveaway.leaderboard.friends", { count: entry.qualifiedCount }) : "—"}
              </span>
              <span className={`${prefix}-podium-stand`} aria-hidden="true">
                <span className={`${prefix}-podium-fill`} style={{ height: `${percent}%` }} />
                <span className={`${prefix}-podium-rank`}>{place + 1}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {rest.length > 0 ? (
        <ol className={`${prefix}-list`} start={4}>
          {rest.map((entry, index) => (
            <li key={`${entry.name}-${index}`} className={entry.isViewer ? "is-viewer" : undefined}>
              <span className={`${prefix}-rank`} aria-hidden="true">
                {index + 4}
              </span>
              <span className={`${prefix}-name`}>
                {entry.name}
                {entry.isViewer ? <span className={`${prefix}-you`}>{t("giveaway.leaderboard.you")}</span> : null}
              </span>
              <span className={`${prefix}-friends`}>
                {t("giveaway.leaderboard.friends", { count: entry.qualifiedCount })}
              </span>
            </li>
          ))}
        </ol>
      ) : null}

      {viewer && !viewerOnBoard ? (
        <div className={`${prefix}-viewer-row`}>
          <span className={`${prefix}-rank`} aria-hidden="true">
            –
          </span>
          <span className={`${prefix}-name`}>
            {viewer.qualifiedCount > 0
              ? t("giveaway.leaderboard.yourPlace")
              : t("giveaway.leaderboard.notRanked")}
            <span className={`${prefix}-you`}>{t("giveaway.leaderboard.you")}</span>
          </span>
          <span className={`${prefix}-friends`}>
            {t("giveaway.leaderboard.friends", { count: viewer.qualifiedCount })}
          </span>
        </div>
      ) : null}
    </>
  );
}
