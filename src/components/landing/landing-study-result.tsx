"use client";

import type { CSSProperties, ReactNode } from "react";

import { Emoji } from "@/components/msym";

/*
 * The app's own results screen, for the demos on the marketing page.
 *
 * A transcription of `StudyCompletionCard` — same props, same thresholds, same
 * copy through the same catalogue keys — kept as a second file only because the
 * landing page never loads the app's stylesheet. Anything that changes about how
 * a finished deck, quiz or test reports itself has to change in both, which is
 * the price of the two of them being one-to-one.
 */

interface LandingStudyMetric {
  label: string;
  value: string;
}

interface LandingStudyResultProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  percentage: number;
  percentageLabel: string;
  primaryMetric: LandingStudyMetric;
  secondaryMetrics?: LandingStudyMetric[];
  actions: ReactNode;
  /** Token overrides, and `--lr-s` for a host with less room than a phone. */
  style?: CSSProperties;
}

/** A pass keeps the design's green; anything below carries its coral. */
const PASS_THRESHOLD = 70;

export function LandingStudyResult({
  eyebrow,
  title,
  subtitle,
  percentage,
  percentageLabel,
  primaryMetric,
  secondaryMetrics = [],
  actions,
  style,
}: LandingStudyResultProps) {
  const clampedPercentage = Math.max(0, Math.min(100, Math.round(percentage)));
  const isGood = clampedPercentage >= PASS_THRESHOLD;
  const tint = isGood ? "#2aa34a" : "#f45f5a";

  return (
    <div className="landing-result" style={{ "--lr-tint": tint, ...style } as CSSProperties}>
      <div className="landing-result-orb-wrap">
        <div className="landing-result-orb">
          <Emoji symbol={isGood ? "🎉" : "💪"} size="calc(4.4 * var(--lr-u))" />
        </div>
        <span className="landing-result-badge">{clampedPercentage} %</span>
      </div>

      {eyebrow ? <span className="landing-result-eyebrow">{eyebrow}</span> : null}
      <span className="landing-result-title">{title}</span>

      <span className="landing-result-line">
        <span className="landing-result-score">{clampedPercentage} %</span> {percentageLabel.toLowerCase()}
      </span>
      <span className="landing-result-line">
        {primaryMetric.label.toLowerCase()} <span className="landing-result-score">{primaryMetric.value}</span>
      </span>
      {subtitle ? <span className="landing-result-line">{subtitle}</span> : null}

      {secondaryMetrics.length > 0 ? (
        <div className="landing-result-metrics">
          {secondaryMetrics.map((metric) => (
            <div key={metric.label} className="landing-result-metric">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      ) : null}

      <div className="landing-result-actions">{actions}</div>
    </div>
  );
}
