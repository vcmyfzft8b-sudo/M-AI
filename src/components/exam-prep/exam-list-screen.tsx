"use client";

import { useEffect, useState } from "react";

import { EXAM_TYPE_LABEL, PHASE_LABEL, useExamFormat } from "@/components/exam-prep/exam-format";
import { InstantLink } from "@/components/instant-link";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import type { ExamPlanSummary } from "@/lib/exam-prep/model";

export async function fetchExamSummaries(): Promise<ExamPlanSummary[]> {
  const response = await fetch("/api/exams", { cache: "no-store" });

  if (!response.ok) {
    throw new Error(String(response.status));
  }

  const body = (await response.json()) as { plans?: ExamPlanSummary[] };
  return body.plans ?? [];
}

/** The round badge on an exam row: days left, or what the day is. */
export function ExamCountBadge({ summary }: { summary: Pick<ExamPlanSummary, "status" | "daysLeft"> }) {
  const { t } = useExamFormat();

  if (summary.status === "upcoming") {
    return (
      <span className="memo-exam-count">
        <strong>{summary.daysLeft}</strong>
        <span>{t("exam.card.daysShort", { count: summary.daysLeft })}</span>
      </span>
    );
  }

  return (
    <span className="memo-exam-count">
      <Msym name={summary.status === "exam_day" ? "flag" : "check"} size="1.45rem" />
    </span>
  );
}

function ExamRow({ summary }: { summary: ExamPlanSummary }) {
  const { t, longDate, grade } = useExamFormat();
  const upcoming = summary.status === "upcoming";

  return (
    <InstantLink href={`/app/exams/${summary.id}`} className="memo-exam-row">
      <div className="memo-exam-row-top">
        <ExamCountBadge summary={summary} />
        <span className="memo-exam-row-copy">
          <span className="memo-exam-row-title">{summary.title}</span>
          <span className="memo-exam-row-meta">
            {t(EXAM_TYPE_LABEL[summary.examType])} · {longDate(summary.examDate)} ·{" "}
            {t("exam.card.notes", { count: summary.noteCount })}
          </span>
        </span>
        <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
      </div>
      <div className="memo-exam-row-stats">
        {upcoming && summary.todayTotal > 0 ? (
          <span className="memo-exam-chip">
            <Msym name="schedule" size="1rem" fill={false} />
            {t("exam.card.today", { done: summary.todayDone, total: summary.todayTotal })}
          </span>
        ) : null}
        {upcoming && summary.phase ? (
          <span className="memo-exam-chip muted">{t(PHASE_LABEL[summary.phase])}</span>
        ) : null}
        <span className="memo-exam-chip muted">
          {t("exam.card.target", { grade: grade(summary.gradeScale, summary.targetGrade) })}
        </span>
        {summary.forecastGrade ? (
          <span className="memo-exam-chip">
            <Msym name="trending_up" size="1rem" />
            {t("exam.card.forecast", { grade: grade(summary.gradeScale, summary.forecastGrade) })}
          </span>
        ) : (
          <span className="memo-exam-chip muted">
            {t("exam.card.coverage", { percent: Math.round(summary.coverage * 100) })}
          </span>
        )}
        {summary.resultGrade ? (
          <span className="memo-exam-chip">
            {t("exam.card.result", { grade: grade(summary.gradeScale, summary.resultGrade) })}
          </span>
        ) : null}
      </div>
    </InstantLink>
  );
}

export function ExamListScreen({
  initialPlans,
  backHref = "/app",
}: {
  initialPlans: ExamPlanSummary[] | null;
  backHref?: string;
}) {
  const { t } = useExamFormat();
  const { navigateWithFeedback, overlay: navigationOverlay, isNavigating } = useInstantNavigation();
  const [plans, setPlans] = useState<ExamPlanSummary[] | null>(initialPlans);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetchExamSummaries()
      .then((next) => {
        if (!cancelled) {
          setPlans(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(t("exam.error.load"));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  return (
    <div className="memo-support-screen memo-exam-screen">
      {navigationOverlay}
      <div className="memo-settings-topbar memo-exam-topbar memo-only-mobile flex">
        <button
          type="button"
          aria-label={t("common.back")}
          className="memo-m-round"
          aria-busy={isNavigating}
          onClick={() => navigateWithFeedback(backHref)}
        >
          <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
        </button>
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          <div className="memo-exam-head">
            <div>
              <span className="memo-eyebrow">{t("exam.list.eyebrow")}</span>
              <h1>{t("exam.list.title")}</h1>
            </div>
          </div>
          <p className="memo-exam-intro">{t("exam.list.intro")}</p>

          {error ? <p className="memo-inline-error">{error}</p> : null}

          {plans && plans.length > 0 ? (
            <div className="memo-exam-list">
              {plans.map((summary) => (
                <ExamRow key={summary.id} summary={summary} />
              ))}
            </div>
          ) : plans ? (
            <div className="memo-exam-card memo-empty">
              <Emoji symbol="🗓️" size="2rem" />
              <p>{t("exam.list.emptyTitle")}</p>
              <p className="memo-exam-note">{t("exam.list.emptyBody")}</p>
            </div>
          ) : null}

          <InstantLink href="/app/exams/new" className="memo-button-coral memo-exam-new">
            <span className="memo-exam-new-label">
              <Msym name="add" size="1.4rem" />
              {t("exam.list.new")}
            </span>
          </InstantLink>
        </div>
      </div>
    </div>
  );
}
