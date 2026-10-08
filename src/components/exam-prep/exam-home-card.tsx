"use client";

import { useEffect, useState } from "react";

import { noteHref, useExamFormat } from "@/components/exam-prep/exam-format";
import { ExamMasteryRing } from "@/components/exam-prep/exam-mastery";
import { InstantLink } from "@/components/instant-link";
import { Msym } from "@/components/msym";
import type { ExamPlanSummary } from "@/lib/exam-prep/model";

/**
 * Home's card for the exam coming up next, while there is one: the mastery
 * ring, days left, today's goals and Continue into the note's Exam tab. Home
 * shows nothing extra when no exam is planned.
 */
export function ExamHomeCard() {
  const { t } = useExamFormat();
  const [plan, setPlan] = useState<ExamPlanSummary | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/exams", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { plans?: ExamPlanSummary[] } | null) => {
        if (!cancelled) {
          // Summaries come soonest exam first, finished ones last.
          setPlan(body?.plans?.find((item) => item.status !== "finished") ?? null);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (!plan || plan.lectureIds.length === 0) {
    return null;
  }

  const target = Math.round(plan.targetPercent);

  return (
    <section className="memo-exam-home" aria-label={plan.title}>
      <div className="memo-exam-home-row">
        <ExamMasteryRing mastery={plan.mastery} target={target} compact />
        <div className="memo-exam-home-copy">
          <span className="memo-eyebrow">
            {plan.status === "exam_day" ? t("exam.astra.homeExamDay") : t("exam.astra.homeEyebrow", { count: plan.daysLeft })}
          </span>
          <strong>{plan.title}</strong>
          <small>
            {plan.todayTotal > 0 && plan.todayDone >= plan.todayTotal
              ? t("exam.astra.homeDone", { target })
              : t("exam.astra.homeToday", { done: plan.todayDone, total: plan.todayTotal, target })}
          </small>
        </div>
      </div>
      <InstantLink href={noteHref(plan.lectureIds[0], "exam")} className="memo-exam-continue">
        <Msym name="play_arrow" size="1.3rem" />
        {t("exam.astra.homeContinue")}
      </InstantLink>
    </section>
  );
}
