import { formatDayLabel } from "@/lib/admin/ranges";

import { formatCount } from "./ui";

/**
 * Inline SVG charts.
 *
 * Hand-rolled rather than pulled from a charting library: these are two simple
 * shapes, and the project has no chart dependency to reuse. Rendering server
 * side keeps the dashboard free of client JavaScript for the visuals, with
 * native `<title>` tooltips carrying the per-day values.
 */

export type ChartPoint = {
  day: string;
  value: number;
  /** Extra lines for the hover tooltip. */
  detail?: string;
};

const VIEW_WIDTH = 900;
const VIEW_HEIGHT = 240;
const PADDING = { top: 16, right: 12, bottom: 26, left: 44 };

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

  const target = Math.min(count, 7);
  const stride = Math.max(1, Math.round((count - 1) / (target - 1)));
  const indices = new Set<number>();

  for (let index = 0; index < count; index += stride) {
    indices.add(index);
  }

  // Always anchor the last day so the axis ends where the data does.
  indices.add(count - 1);

  return indices;
}

export function AreaChart({
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

  // A single-day range has no width to interpolate across, so the point is
  // centred instead of pinned to the left edge.
  const xFor = (index: number) =>
    points.length === 1
      ? PADDING.left + PLOT_WIDTH / 2
      : PADDING.left + (index / (points.length - 1)) * PLOT_WIDTH;

  const yFor = (value: number) =>
    PADDING.top + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;

  const line = points
    .map((point, index) => `${index === 0 ? "M" : "L"}${xFor(index)},${yFor(point.value)}`)
    .join(" ");

  const area = `${line} L${xFor(points.length - 1)},${PADDING.top + PLOT_HEIGHT} L${xFor(0)},${
    PADDING.top + PLOT_HEIGHT
  } Z`;

  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => max * ratio);
  const gradientId = `admin-area-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <svg
      className="admin-chart"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={`${label} over time`}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--tint)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--tint)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {gridValues.map((value) => (
        <g key={value}>
          <line
            className="admin-chart-grid"
            x1={PADDING.left}
            x2={VIEW_WIDTH - PADDING.right}
            y1={yFor(value)}
            y2={yFor(value)}
          />
          <text
            className="admin-chart-axis"
            x={PADDING.left - 8}
            y={yFor(value) + 3}
            textAnchor="end"
          >
            {formatter(value)}
          </text>
        </g>
      ))}

      <path d={area} fill={`url(#${gradientId})`} />
      <path className="admin-chart-line" d={line} />

      {points.map((point, index) => (
        <g key={point.day}>
          {/* A wide invisible target makes the tooltip reachable on any day. */}
          <rect
            x={xFor(index) - PLOT_WIDTH / Math.max(points.length, 1) / 2}
            y={PADDING.top}
            width={PLOT_WIDTH / Math.max(points.length, 1)}
            height={PLOT_HEIGHT}
            fill="transparent"
          >
            <title>
              {`${formatDayLabel(point.day)} · ${formatter(point.value)} ${label}${
                point.detail ? `\n${point.detail}` : ""
              }`}
            </title>
          </rect>
          {points.length <= 45 && (
            <circle
              cx={xFor(index)}
              cy={yFor(point.value)}
              r="2.5"
              fill="var(--tint)"
            />
          )}
        </g>
      ))}

      {points.map((point, index) =>
        labels.has(index) ? (
          <text
            key={`label-${point.day}`}
            className="admin-chart-axis"
            x={xFor(index)}
            y={VIEW_HEIGHT - 8}
            textAnchor={
              index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"
            }
          >
            {formatDayLabel(point.day)}
          </text>
        ) : null,
      )}
    </svg>
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

  const yFor = (value: number) =>
    PADDING.top + PLOT_HEIGHT - (value / max) * PLOT_HEIGHT;

  return (
    <svg
      className="admin-chart"
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      role="img"
      aria-label={`${label} over time`}
      preserveAspectRatio="none"
    >
      {[0, 0.5, 1].map((ratio) => (
        <g key={ratio}>
          <line
            className="admin-chart-grid"
            x1={PADDING.left}
            x2={VIEW_WIDTH - PADDING.right}
            y1={yFor(max * ratio)}
            y2={yFor(max * ratio)}
          />
          <text
            className="admin-chart-axis"
            x={PADDING.left - 8}
            y={yFor(max * ratio) + 3}
            textAnchor="end"
          >
            {formatter(max * ratio)}
          </text>
        </g>
      ))}

      {points.map((point, index) => {
        const x = PADDING.left + index * slot + (slot - barWidth) / 2;
        const y = yFor(point.value);

        return (
          <rect
            key={point.day}
            className="admin-chart-bar"
            x={x}
            y={point.value > 0 ? y : PADDING.top + PLOT_HEIGHT - 1}
            width={barWidth}
            height={point.value > 0 ? PADDING.top + PLOT_HEIGHT - y : 1}
            rx="2"
          >
            <title>
              {`${formatDayLabel(point.day)} · ${formatter(point.value)} ${label}${
                point.detail ? `\n${point.detail}` : ""
              }`}
            </title>
          </rect>
        );
      })}

      {points.map((point, index) =>
        labels.has(index) ? (
          <text
            key={`label-${point.day}`}
            className="admin-chart-axis"
            x={PADDING.left + index * slot + slot / 2}
            y={VIEW_HEIGHT - 8}
            textAnchor="middle"
          >
            {formatDayLabel(point.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
