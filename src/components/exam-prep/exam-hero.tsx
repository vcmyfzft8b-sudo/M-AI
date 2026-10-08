"use client";

import { PHASE_HINT, PHASE_LABEL, useExamFormat } from "@/components/exam-prep/exam-format";
import { Msym } from "@/components/msym";
import type { ExamJourney, JourneyDay, JourneyPhase } from "@/lib/exam-prep/model";

function cellState(day: JourneyDay) {
  if (day.kind === "exam") {
    return "exam";
  }

  if (day.isToday) {
    return "today";
  }

  if (day.isPast) {
    const studied =
      day.activity && day.activity.cards + day.activity.questions + day.activity.tests > 0;

    if (studied) {
      return "studied";
    }

    return day.kind === "rest" ? "rest" : "missed";
  }

  return day.kind === "rest" ? "rest" : "planned";
}

/** Consecutive runs of the same phase, for the labels under the strip. */
function phaseRuns(days: JourneyDay[]) {
  const runs: Array<{ phase: JourneyPhase | null; length: number }> = [];
  let current: JourneyPhase | null | undefined;

  for (const day of days) {
    // Rest days and the past belong to whatever run they sit in.
    const phase = day.isPast || day.kind === "exam" ? null : day.kind === "rest" ? current ?? null : day.phase;

    if (runs.length > 0 && phase === runs[runs.length - 1].phase) {
      runs[runs.length - 1].length += 1;
    } else {
      runs.push({ phase, length: 1 });
    }

    current = phase;
  }

  return runs;
}

/** The countdown, the phase the learner is in, and the whole journey as one strip. */
export function ExamHero({ journey }: { journey: ExamJourney }) {
  const { t } = useExamFormat();
  const runs = phaseRuns(journey.days);
  const phase = journey.phase;

  return (
    <section className="memo-exam-card memo-exam-hero">
      <div className="memo-exam-hero-top">
        {journey.status === "upcoming" ? (
          <div className="memo-exam-days">
            <strong>{journey.daysLeft}</strong>
            <span>{t("exam.journey.daysLeft", { count: journey.daysLeft })}</span>
          </div>
        ) : (
          <div className="memo-exam-days">
            <span>
              {journey.status === "exam_day" ? t("exam.journey.examToday") : t("exam.journey.finished")}
            </span>
          </div>
        )}
        {phase && journey.status === "upcoming" ? (
          <span className="memo-exam-phase">
            <Msym name={phase === "final" ? "bedtime" : "flag"} size="1.05rem" fill={false} />
            {t(PHASE_LABEL[phase])}
          </span>
        ) : null}
      </div>

      <div className="memo-exam-strip" role="img" aria-label={t("exam.journey.stripLabel")}>
        {journey.days.map((day) => (
          <span key={day.day} data-state={cellState(day)} />
        ))}
      </div>
      <div className="memo-exam-phases" aria-hidden="true">
        {runs.map((run, index) => (
          <span
            key={`${run.phase ?? "none"}-${index}`}
            className={run.phase && run.phase === phase ? "current" : undefined}
            style={{ flex: `${run.length} 1 0` }}
          >
            {run.phase && run.length >= 2 ? t(PHASE_LABEL[run.phase]) : ""}
          </span>
        ))}
      </div>

      {phase && journey.status === "upcoming" ? (
        <p className="memo-exam-phase-hint">{t(PHASE_HINT[phase])}</p>
      ) : null}
      {journey.status === "exam_day" ? (
        <p className="memo-exam-phase-hint">{t("exam.journey.examTodayHint")}</p>
      ) : null}
    </section>
  );
}
