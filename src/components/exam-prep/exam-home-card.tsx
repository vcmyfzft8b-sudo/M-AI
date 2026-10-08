"use client";

import { useEffect, useState } from "react";

import { useExamFormat } from "@/components/exam-prep/exam-format";
import { ExamCountBadge, fetchExamSummaries } from "@/components/exam-prep/exam-list-screen";
import { InstantLink } from "@/components/instant-link";
import { Msym } from "@/components/msym";
import type { ExamPlanSummary } from "@/lib/exam-prep/model";

const INVITE_DISMISSED_KEY = "memo-exam-invite-dismissed";

function readDismissed() {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    return window.localStorage.getItem(INVITE_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The library's way into exam prep. With an exam coming up it is that exam:
 * how many days, and how much of today is done. With none, and something to
 * study from, it is a quiet invitation that can be dismissed for good.
 */
export function ExamHomeCard({ hasReadyNotes }: { hasReadyNotes: boolean }) {
  const { t } = useExamFormat();
  const [plans, setPlans] = useState<ExamPlanSummary[] | null>(null);
  // Nothing renders until the plans arrive, so reading storage here cannot
  // make the first client render differ from the server's.
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    let cancelled = false;

    fetchExamSummaries()
      .then((next) => {
        if (!cancelled) {
          setPlans(next);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!plans) {
    return null;
  }

  const next = plans.find((plan) => plan.status !== "finished");

  if (next) {
    const progress = next.todayTotal > 0 ? next.todayDone / next.todayTotal : 0;

    return (
      <InstantLink href={`/app/exams/${next.id}`} className="memo-exam-home">
        <ExamCountBadge summary={next} />
        <span className="memo-exam-row-copy">
          <span className="memo-exam-row-title">{next.title}</span>
          <span className="memo-exam-row-meta">
            {next.status === "upcoming" && next.todayTotal > 0
              ? t("exam.home.today", {
                  done: next.todayDone,
                  total: next.todayTotal,
                  minutes: next.todayMinutes,
                })
              : next.status === "exam_day"
                ? t("exam.journey.examToday")
                : t("exam.home.rest")}
          </span>
          {next.status === "upcoming" && next.todayTotal > 0 ? (
            <span className="memo-exam-home-progress" aria-hidden="true">
              <span style={{ width: `${Math.round(progress * 100)}%` }} />
            </span>
          ) : null}
        </span>
        <Msym name="chevron_right" size="1.4rem" fill={false} weight={400} />
      </InstantLink>
    );
  }

  if (!hasReadyNotes || dismissed || plans.length > 0) {
    return null;
  }

  return (
    <div className="memo-exam-home">
      <span className="memo-exam-count">
        <Msym name="event" size="1.45rem" fill={false} />
      </span>
      <InstantLink href="/app/exams/new" className="memo-exam-task-link">
        <span className="memo-exam-row-title">{t("exam.home.inviteTitle")}</span>
        <span className="memo-exam-row-meta">{t("exam.home.inviteBody")}</span>
      </InstantLink>
      <button
        type="button"
        className="memo-exam-home-dismiss"
        aria-label={t("common.close")}
        onClick={() => {
          setDismissed(true);

          try {
            window.localStorage.setItem(INVITE_DISMISSED_KEY, "1");
          } catch {
            // Dismissing is a convenience; it simply comes back next time.
          }
        }}
      >
        <Msym name="close" size="1.2rem" />
      </button>
    </div>
  );
}
