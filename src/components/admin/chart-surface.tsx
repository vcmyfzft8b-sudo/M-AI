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

export function ChartSurface({
  viewWidth,
  viewHeight,
  plotTop,
  plotHeight,
  points,
  children,
  showDots,
}: {
  viewWidth: number;
  viewHeight: number;
  plotTop: number;
  plotHeight: number;
  points: SurfacePoint[];
  children: React.ReactNode;
  showDots: boolean;
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
