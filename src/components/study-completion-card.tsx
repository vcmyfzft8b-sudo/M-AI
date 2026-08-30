"use client";

import type { CSSProperties, ReactNode } from "react";

import { Emoji } from "@/components/msym";

interface StudyCompletionMetric {
  label: string;
  value: string;
}

interface StudyCompletionCardProps {
  eyebrow: string;
  title: string;
  subtitle?: string;
  percentage: number;
  percentageLabel: string;
  primaryMetric: StudyCompletionMetric;
  secondaryMetrics?: StudyCompletionMetric[];
  actions: ReactNode;
}

/**
 * The redesign's results screen: a tinted orb with the outcome emoji, the score
 * pinned to it on a tilted badge, then the headline and the way onward. The
 * design draws exactly this after a quiz, a deck or a submitted test.
 *
 * A pass keeps the design's green; anything below carries its coral, and the
 * emoji follows — 🎉 when it went well, 💪 when it did not.
 */
const PASS_THRESHOLD = 70;

export function StudyCompletionCard({
  eyebrow,
  title,
  subtitle,
  percentage,
  percentageLabel,
  primaryMetric,
  secondaryMetrics = [],
  actions,
}: StudyCompletionCardProps) {
  const clampedPercentage = Math.max(0, Math.min(100, Math.round(percentage)));
  const isGood = clampedPercentage >= PASS_THRESHOLD;
  const tint = isGood ? "#2aa34a" : "#f45f5a";
  const tintStyle = { "--memo-result-tint": tint } as CSSProperties;

  return (
    <div className="memo-result" style={tintStyle}>
      <div className="memo-result-orb-wrap">
        <div className="memo-result-orb">
          <Emoji symbol={isGood ? "🎉" : "💪"} size="4.4rem" />
        </div>
        <span className="memo-result-badge">{clampedPercentage} %</span>
      </div>

      {eyebrow ? <span className="memo-result-eyebrow">{eyebrow}</span> : null}
      <span className="memo-result-title">{title}</span>

      <span className="memo-result-line">
        <span className="memo-result-score">{clampedPercentage} %</span> {percentageLabel.toLowerCase()}
      </span>
      <span className="memo-result-line">
        {primaryMetric.label.toLowerCase()}{" "}
        <span className="memo-result-score">{primaryMetric.value}</span>
      </span>
      {subtitle ? <span className="memo-result-line">{subtitle}</span> : null}

      {secondaryMetrics.length > 0 ? (
        <div className="memo-result-metrics">
          {secondaryMetrics.map((metric) => (
            <div key={metric.label} className="memo-result-metric">
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
            </div>
          ))}
        </div>
      ) : null}

      <div className="memo-result-actions">{actions}</div>
    </div>
  );
}
