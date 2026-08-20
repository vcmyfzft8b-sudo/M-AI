import type { ReactNode } from "react";

import { PendingLink } from "./pending-link";

/**
 * The selectable KPI strip above the chart.
 *
 * Each tile is a link that sets `metric` in the query string, so picking what
 * to chart survives a reload and needs no client JavaScript.
 */

export type MetricKey =
  | "views"
  | "likes"
  | "comments"
  | "shares"
  | "saves"
  | "videos"
  | "engagement"
  | "revenue"
  | "codeRevenue"
  | "cost"
  | "margin";

export const METRIC_KEYS: MetricKey[] = [
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "videos",
  "engagement",
  "revenue",
  "codeRevenue",
  "cost",
  "margin",
];

export const METRIC_LABELS: Record<MetricKey, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  videos: "Videos",
  engagement: "Engagement",
  revenue: "Est. revenue",
  codeRevenue: "Code revenue",
  cost: "Creator cost",
  margin: "Margin",
};

export function normalizeMetric(value: string | undefined | null): MetricKey {
  return METRIC_KEYS.includes(value as MetricKey) ? (value as MetricKey) : "views";
}

export type Tile = {
  key: MetricKey;
  value: ReactNode;
  hint?: ReactNode;
  /** Charting only makes sense for metrics that have a daily series. */
  chartable?: boolean;
};

export function MetricTiles({
  tiles,
  active,
  hrefFor,
}: {
  tiles: Tile[];
  active: MetricKey;
  hrefFor: (metric: MetricKey) => string;
}) {
  return (
    <div className="admin-tiles">
      {tiles.map((tile) => {
        const selectable = tile.chartable !== false;
        const content = (
          <>
            <span className="admin-tile-label">{METRIC_LABELS[tile.key]}</span>
            <span className="admin-tile-value">{tile.value}</span>
            {tile.hint && <span className="admin-tile-hint">{tile.hint}</span>}
          </>
        );

        if (!selectable) {
          return (
            <div className="admin-tile" key={tile.key} data-static="true">
              {content}
            </div>
          );
        }

        return (
          <PendingLink
            key={tile.key}
            href={hrefFor(tile.key)}
            className="admin-tile"
            data-active={tile.key === active}
            aria-current={tile.key === active ? "true" : undefined}
          >
            {content}
          </PendingLink>
        );
      })}
    </div>
  );
}
