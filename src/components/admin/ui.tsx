import Link from "next/link";
import type { ReactNode } from "react";

import { percentChange } from "@/lib/admin/ranges";

/** Presentational building blocks shared by every admin page. */

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }

  const abs = Math.abs(value);

  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }

  if (abs >= 10_000) {
    return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}K`;
  }

  return new Intl.NumberFormat("en-GB").format(Math.round(value));
}

export function formatExact(value: number): string {
  return new Intl.NumberFormat("en-GB").format(Math.round(value));
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatDateTime(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDate(value: string | null): string {
  if (!value) {
    return "—";
  }

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatRelative(value: string | null): string {
  if (!value) {
    return "never";
  }

  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);

  if (seconds < 60) {
    return "just now";
  }

  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }

  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }

  return `${Math.floor(seconds / 86400)}d ago`;
}

export function StatCard({
  label,
  value,
  meta,
  current,
  previous,
  invertDelta,
}: {
  label: string;
  value: ReactNode;
  meta?: ReactNode;
  /** Supply both to render a trend against the preceding window. */
  current?: number;
  previous?: number;
  /** For metrics where a fall is good, such as cancellations. */
  invertDelta?: boolean;
}) {
  const change =
    typeof current === "number" && typeof previous === "number"
      ? percentChange(current, previous)
      : null;

  const direction =
    change === null || Math.abs(change) < 0.5
      ? "flat"
      : (change > 0) !== Boolean(invertDelta)
        ? "up"
        : "down";

  return (
    <div className="admin-stat">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {(meta || change !== null) && (
        <div className="admin-stat-meta">
          {change !== null && (
            <span className="admin-delta" data-direction={direction}>
              {change > 0 ? "▲" : change < 0 ? "▼" : "■"}{" "}
              {Math.abs(change).toFixed(Math.abs(change) >= 10 ? 0 : 1)}%
            </span>
          )}
          {change !== null && meta ? " · " : null}
          {meta}
        </div>
      )}
    </div>
  );
}

export function Card({
  title,
  hint,
  actions,
  children,
  bodyless,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  /** Skip the padded body wrapper, for tables that should reach the edges. */
  bodyless?: boolean;
}) {
  return (
    <section className="admin-card">
      {(title || actions) && (
        <header className="admin-card-header">
          <div>
            {title && <h2 className="admin-card-title">{title}</h2>}
            {hint && <p className="admin-card-hint">{hint}</p>}
          </div>
          {actions}
        </header>
      )}
      {bodyless ? children : <div className="admin-card-body">{children}</div>}
    </section>
  );
}

export function Badge({
  tone = "grey",
  children,
  pulse,
}: {
  tone?: "green" | "red" | "blue" | "grey";
  children: ReactNode;
  pulse?: boolean;
}) {
  return (
    <span className="admin-badge" data-tone={tone}>
      {pulse && <span className="admin-dot" data-pulse="true" />}
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="admin-empty">
      <p className="admin-empty-title">{title}</p>
      {children}
    </div>
  );
}

export const RANGE_LABELS: Record<string, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  month: "This month",
  all: "All time",
};

/** Range switcher. Renders as links so the selection survives a reload. */
export function RangeTabs({
  active,
  basePath,
  extraParams,
}: {
  active: string;
  basePath: string;
  extraParams?: Record<string, string | undefined>;
}) {
  return (
    <nav className="admin-range">
      {Object.entries(RANGE_LABELS).map(([value, label]) => {
        const params = new URLSearchParams();

        for (const [key, param] of Object.entries(extraParams ?? {})) {
          if (param) {
            params.set(key, param);
          }
        }

        params.set("range", value);

        return (
          <Link
            key={value}
            href={`${basePath}?${params.toString()}`}
            className="admin-range-item"
            data-active={value === active}
            prefetch={false}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Alert({
  tone,
  children,
}: {
  tone: "error" | "success" | "info";
  children: ReactNode;
}) {
  return (
    <div className="admin-alert" data-tone={tone}>
      {children}
    </div>
  );
}

export function Avatar({
  src,
  name,
}: {
  src: string | null | undefined;
  name: string;
}) {
  if (src) {
    // Remote TikTok CDN URLs are signed and expire, so they are rendered with a
    // plain <img> rather than next/image to avoid optimiser cache misses.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="admin-avatar" src={src} alt="" loading="lazy" />;
  }

  return (
    <span className="admin-avatar admin-avatar-fallback" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** A labelled row with a proportional bar, for top-N breakdowns. */
export function BarRow({
  label,
  value,
  max,
  formatter = formatExact,
}: {
  label: string;
  value: number;
  max: number;
  formatter?: (value: number) => string;
}) {
  const width = max > 0 ? Math.max((value / max) * 100, 2) : 0;

  return (
    <div className="admin-list-row">
      <span className="admin-list-label" title={label}>
        {label}
      </span>
      <span className="admin-bar-track">
        <span className="admin-bar-fill" style={{ width: `${width}%` }} />
      </span>
      <span className="admin-list-value">{formatter(value)}</span>
    </div>
  );
}
