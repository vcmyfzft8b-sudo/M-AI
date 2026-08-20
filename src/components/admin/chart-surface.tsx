"use client";

import { useState } from "react";

/**
 * Interaction layer for the charts.
 *
 * The geometry and every number are worked out on the server; this only tracks
 * the pointer and shows the values for the day nearest to it. Native `<title>`
 * tooltips did technically work, but they wait about a second before appearing
 * and are styled by the OS, which makes reading a trend day by day painful.
 */

export type ChartTooltipRow = { label: string; value: string };

export type SurfacePoint = {
  /** Position in the SVG's own coordinate space. */
  x: number;
  y: number;
  title: string;
  rows: ChartTooltipRow[];
};

/**
 * An axis label, placed as a percentage of the surface.
 *
 * Labels are HTML rather than SVG `<text>`. The chart is drawn with
 * `preserveAspectRatio="none"` so the line stretches to whatever box it is
 * given, which is right for a trend line and wrong for lettering: on a phone,
 * where the box is far taller relative to its width than the viewBox, text
 * inside the SVG was squashed to about a third of its width. Out here it is
 * ordinary text at an ordinary size on every screen, and the chart can be
 * resized without touching the type.
 */
export type SurfaceLabel = { at: number; text: string };

export function ChartSurface({
  viewWidth,
  viewHeight,
  plotTop,
  plotHeight,
  points,
  children,
  showDots,
  xLabels,
  yLabels,
}: {
  viewWidth: number;
  viewHeight: number;
  plotTop: number;
  plotHeight: number;
  points: SurfacePoint[];
  children: React.ReactNode;
  showDots: boolean;
  /** `at` is a percentage across the surface. */
  xLabels?: SurfaceLabel[];
  /** `at` is a percentage down the surface. */
  yLabels?: SurfaceLabel[];
}) {
  const [active, setActive] = useState<number | null>(null);

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    if (points.length === 0) {
      return;
    }

    const bounds = event.currentTarget.getBoundingClientRect();

    if (bounds.width === 0) {
      return;
    }

    // The SVG scales to the container, so the pointer is converted back into
    // the chart's own coordinate space before finding the nearest day.
    const x = ((event.clientX - bounds.left) / bounds.width) * viewWidth;

    let nearest = 0;
    let best = Number.POSITIVE_INFINITY;

    for (let index = 0; index < points.length; index += 1) {
      const distance = Math.abs(points[index].x - x);

      if (distance < best) {
        best = distance;
        nearest = index;
      }
    }

    setActive(nearest);
  }

  const point = active === null ? null : points[active];

  // Flip the tooltip to the left of the cursor near the right edge so it never
  // runs off the chart.
  const flip = point ? point.x > viewWidth * 0.62 : false;

  return (
    <div
      className="admin-chart-surface"
      onPointerMove={onMove}
      onPointerLeave={() => setActive(null)}
    >
      <svg
        className="admin-chart"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        preserveAspectRatio="none"
      >
        {children}

        {point && (
          <line
            className="admin-chart-crosshair"
            x1={point.x}
            x2={point.x}
            y1={plotTop}
            y2={plotTop + plotHeight}
          />
        )}

        {showDots &&
          points.map((entry, index) => (
            <circle
              key={index}
              cx={entry.x}
              cy={entry.y}
              r={index === active ? 4 : 2.5}
              fill="var(--tint)"
            />
          ))}

        {point && !showDots && (
          <circle cx={point.x} cy={point.y} r="4" fill="var(--tint)" />
        )}
      </svg>

      {yLabels && yLabels.length > 0 && (
        <div className="admin-chart-y-labels" aria-hidden="true">
          {yLabels.map((label, index) => (
            <span
              key={index}
              className="admin-chart-axis-label"
              style={{ top: `${label.at}%` }}
            >
              {label.text}
            </span>
          ))}
        </div>
      )}

      {xLabels && xLabels.length > 0 && (
        <div className="admin-chart-x-labels" aria-hidden="true">
          {xLabels.map((label, index) => (
            <span
              key={index}
              className="admin-chart-axis-label"
              style={{ left: `${label.at}%` }}
            >
              {label.text}
            </span>
          ))}
        </div>
      )}

      {point && (
        <div
          className="admin-chart-tooltip"
          data-flip={flip}
          style={{ left: `${(point.x / viewWidth) * 100}%` }}
          role="status"
        >
          <div className="admin-chart-tooltip-title">{point.title}</div>
          {point.rows.map((row) => (
            <div className="admin-chart-tooltip-row" key={row.label}>
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
