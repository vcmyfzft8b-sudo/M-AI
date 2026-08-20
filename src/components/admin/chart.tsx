import { formatDayLabel } from "@/lib/admin/ranges";

import {
  ChartSurface,
  type ChartTooltipRow,
  type SurfaceLabel,
  type SurfacePoint,
} from "./chart-surface";
import { formatCount } from "./ui";

/**
 * Inline SVG charts.
 *
 * Hand-rolled rather than pulled from a charting library: these are simple
 * shapes and the project has no chart dependency to reuse. The geometry and
 * every displayed number are computed on the server; only pointer tracking runs
 * on the client, in `ChartSurface`.
 */

export type ChartPoint = {
  day: string;
  value: number;
  /** Extra rows shown in the hover tooltip, below the charted value. */
  rows?: ChartTooltipRow[];
  /**
   * Axis and tooltip caption, when the point is not a whole day. An hourly
   * series repeats the same `day` across every point, so it labels itself.
   */
  label?: string;
};

const VIEW_WIDTH = 1000;
const VIEW_HEIGHT = 300;
const PADDING = { top: 18, right: 14, bottom: 28, left: 52 };

const PLOT_WIDTH = VIEW_WIDTH - PADDING.left - PADDING.right;
const PLOT_HEIGHT = VIEW_HEIGHT - PADDING.top - PADDING.bottom;

/** Rounds a maximum up to a friendly axis value so gridlines read cleanly. */
function niceMax(value: number): number {
  if (value <= 0) {
    return 10;
  }

  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;

  return step * magnitude;
}

/** Evenly spaced x labels that never collide, however long the range is. */
function labelIndices(count: number): Set<number> {
  if (count <= 1) {
    return new Set([0]);
  }

  const target = Math.min(count, 8);
  const stride = Math.max(1, Math.round((count - 1) / (target - 1)));
  const indices: number[] = [];

  for (let index = 0; index < count; index += stride) {
    indices.push(index);
  }

  const last = count - 1;

  // The axis must end where the data does, but the strided run rarely lands on
  // the final day. Adding it blindly printed two labels on top of each other,
  // so a penultimate label that would collide is dropped instead.
  if (indices[indices.length - 1] !== last) {
    if (last - indices[indices.length - 1] < stride * 0.6) {
      indices.pop();
    }

    indices.push(last);
  }

  return new Set(indices);
}

/** Running total, for the cumulative view. */
export function toCumulative(points: ChartPoint[]): ChartPoint[] {
  let total = 0;

  return points.map((point) => {
    total += point.value;
    return { ...point, value: total };
  });
}

function buildSurfacePoints(
  points: ChartPoint[],
  label: string,
  formatter: (value: number) => string,
  xFor: (index: number) => number,
  yFor: (value: number) => number,
  comparison?: ChartPoint[],
): SurfacePoint[] {
  return points.map((point, index) => {
    const rows: ChartTooltipRow[] = [
      { label, value: formatter(point.value) },
      ...(point.rows ?? []),
    ];

    const previous = comparison?.[index];

    if (previous) {
      rows.push({ label: "Previous period", value: formatter(previous.value) });
    }

    return {
      x: xFor(index),
      y: yFor(point.value),
      title: point.label ?? formatDayLabel(point.day),
      rows,
    };
  });
}

export function AreaChart({
  points,
  label,
  formatter = formatCount,
  /** The same metric over the preceding window, drawn as a dashed line. */
  comparison,
}: {
  points: ChartPoint[];
  label: string;
  formatter?: (value: number) => string;
  comparison?: ChartPoint[];
}) {
  if (points.length === 0) {
    return null;
  }

  // Both series share one scale, otherwise the comparison would be misleading.
  const peak = Math.max(
    ...points.map((point) => point.value),
    ...(comparison ?? []).map((point) => point.value),
  );
  const max = niceMax(peak);
  const labels = labelIndices(points.length);

  // A single-day range has no width to interpolate across, so the point is
  // centred instead of pinned to the left edge.
  const xFor = (index: number, count = points.length) =>
    count === 1
      ? PADDING.left + PLOT_WIDTH / 2
      : PADDING.left + (index / (count - 1)) * PLOT_WIDTH;

  const yFor = (value: number) =>
    PADDING.top + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;

  const path = (series: ChartPoint[]) =>
    series
      .map(
        (point, index) =>
          `${index === 0 ? "M" : "L"}${xFor(index, series.length)},${yFor(point.value)}`,
      )
      .join(" ");

  const line = path(points);
  const area = `${line} L${xFor(points.length - 1)},${PADDING.top + PLOT_HEIGHT} L${xFor(0)},${
    PADDING.top + PLOT_HEIGHT
  } Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => max * ratio);
  const gradientId = `admin-area-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <ChartSurface
      viewWidth={VIEW_WIDTH}
      viewHeight={VIEW_HEIGHT}
      plotTop={PADDING.top}
      plotHeight={PLOT_HEIGHT}
      showDots={points.length <= 45}
      xLabels={points
        .map((point, index) =>
          labels.has(index)
            ? {
                at: (xFor(index) / VIEW_WIDTH) * 100,
                text: point.label ?? formatDayLabel(point.day),
              }
            : null,
        )
        .filter((entry): entry is SurfaceLabel => entry !== null)}
      yLabels={gridValues.map((value) => ({
        at: (yFor(value) / VIEW_HEIGHT) * 100,
        text: formatter(value),
      }))}
      points={buildSurfacePoints(
        points,
        label,
        formatter,
        (index) => xFor(index),
        yFor,
        comparison,
      )}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tint)" stopOpacity="0.26" />
          <stop offset="100%" stopColor="var(--tint)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridValues.map((value) => (
        <line
          key={value}
          className="admin-chart-grid"
          x1={PADDING.left}
          x2={VIEW_WIDTH - PADDING.right}
          y1={yFor(value)}
          y2={yFor(value)}
        />
      ))}

      {comparison && comparison.length > 0 && (
        <path className="admin-chart-line-compare" d={path(comparison)} />
      )}

      <path d={area} fill={`url(#${gradientId})`} />
      <path className="admin-chart-line" d={line} />
    </ChartSurface>
  );
}

export function BarChart({
  points,
  label,
  formatter = formatCount,
}: {
  points: ChartPoint[];
  label: string;
  formatter?: (value: number) => string;
}) {
  if (points.length === 0) {
    return null;
  }

  const max = niceMax(Math.max(...points.map((point) => point.value)));
  const labels = labelIndices(points.length);
  const slot = PLOT_WIDTH / points.length;
  const barWidth = Math.max(Math.min(slot * 0.62, 34), 2);

  const xFor = (index: number) => PADDING.left + index * slot + slot / 2;
  const yFor = (value: number) =>
    PADDING.top + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;

  return (
    <ChartSurface
      viewWidth={VIEW_WIDTH}
      viewHeight={VIEW_HEIGHT}
      plotTop={PADDING.top}
      plotHeight={PLOT_HEIGHT}
      showDots={false}
      xLabels={points
        .map((point, index) =>
          labels.has(index)
            ? {
                at: (xFor(index) / VIEW_WIDTH) * 100,
                text: point.label ?? formatDayLabel(point.day),
              }
            : null,
        )
        .filter((entry): entry is SurfaceLabel => entry !== null)}
      yLabels={[0, 0.5, 1].map((ratio) => ({
        at: (yFor(max * ratio) / VIEW_HEIGHT) * 100,
        text: formatter(max * ratio),
      }))}
      points={buildSurfacePoints(points, label, formatter, xFor, yFor)}
    >
      {[0, 0.5, 1].map((ratio) => (
        <line
          key={ratio}
          className="admin-chart-grid"
          x1={PADDING.left}
          x2={VIEW_WIDTH - PADDING.right}
          y1={yFor(max * ratio)}
          y2={yFor(max * ratio)}
        />
      ))}

      {points.map((point, index) => {
        const y = yFor(point.value);

        return (
          <rect
            key={`bar-${index}`}
            className="admin-chart-bar"
            x={xFor(index) - barWidth / 2}
            y={point.value > 0 ? y : PADDING.top + PLOT_HEIGHT - 1}
            width={barWidth}
            height={point.value > 0 ? PADDING.top + PLOT_HEIGHT - y : 1}
            rx="2"
          />
        );
      })}
    </ChartSurface>
  );
}
