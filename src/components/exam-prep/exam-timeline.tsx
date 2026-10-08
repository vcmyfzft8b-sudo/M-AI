"use client";

import { Fragment, useState } from "react";

import { PHASE_LABEL, useExamFormat } from "@/components/exam-prep/exam-format";
import { Msym } from "@/components/msym";
import type { JourneyActivity, JourneyDay, JourneyPhase } from "@/lib/exam-prep/model";

/** Days shown ahead of today before "show the whole plan". */
const AHEAD = 6;

function hasActivity(activity: JourneyActivity | null) {
  return Boolean(activity && activity.cards + activity.questions + activity.tests > 0);
}

/**
 * The journey, day by day: what was done, what today holds, and what each day
 * ahead is for. A day with no study is just that — no red, no "missed": the
 * plan already moved its work to the days that are left.
 */
export function ExamTimeline({ days }: { days: JourneyDay[] }) {
  const { t, weekday, dayOfMonth, taskTitle } = useExamFormat();
  const [showPast, setShowPast] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const todayIndex = days.findIndex((day) => day.isToday);
  const pivot = todayIndex >= 0 ? todayIndex : days.findIndex((day) => !day.isPast);
  const start = showPast ? 0 : Math.max(0, (pivot >= 0 ? pivot : days.length) - 1);
  const examIndex = days.length - 1;
  const end = showAll ? examIndex : Math.min(examIndex, (pivot >= 0 ? pivot : 0) + AHEAD);
  const visible = days.slice(start, end + 1);

  if (end < examIndex) {
    visible.push(days[examIndex]);
  }

  const activityText = (activity: JourneyActivity) =>
    [
      activity.cards > 0 ? t("exam.timeline.cards", { count: activity.cards }) : null,
      activity.questions > 0 ? t("exam.timeline.questions", { count: activity.questions }) : null,
      activity.tests > 0 ? t("exam.timeline.tests", { count: activity.tests }) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  // A phase heading above the first day of each phase that is shown.
  const phaseRows = visible.map((day, index) => {
    if (day.isPast || day.kind !== "study" || !day.phase) {
      return null;
    }

    const previous = visible
      .slice(0, index)
      .reverse()
      .find((item) => !item.isPast && item.kind === "study" && item.phase);

    return previous?.phase === day.phase ? null : day.phase;
  });

  return (
    <div className="memo-exam-days-list">
      {start > 0 ? (
        <button type="button" className="memo-exam-more" onClick={() => setShowPast(true)}>
          {t("exam.timeline.showPast", { count: start })}
        </button>
      ) : null}

      {visible.map((day, index) => {
        const phaseRow: JourneyPhase | null = phaseRows[index];
        const studied = hasActivity(day.activity);
        let className = "memo-exam-day";
        let title: string;
        let meta: string | null = null;
        let mark: React.ReactNode = null;

        if (day.kind === "exam") {
          className += " exam";
          title = t("exam.timeline.exam");
          mark = <Msym name="flag" size="1.1rem" />;
        } else if (day.isPast) {
          if (studied && day.activity) {
            className += " studied";
            title = t("exam.timeline.studied");
            meta = activityText(day.activity);
            mark = <Msym name="check" size="1.1rem" weight={700} />;
          } else {
            className += day.kind === "rest" ? " rest" : " quiet";
            title = day.kind === "rest" ? t("exam.timeline.rest") : t("exam.timeline.noStudy");
            mark = day.kind === "rest" ? <Msym name="spa" size="1.1rem" fill={false} /> : null;
          }
        } else if (day.kind === "rest") {
          className += " rest";
          title = t("exam.timeline.rest");
          mark = <Msym name="spa" size="1.1rem" fill={false} />;
        } else {
          if (day.isToday) {
            className += " today";
          }

          title = day.isToday
            ? t("exam.timeline.today")
            : day.tasks
                .slice(0, 2)
                .map((task) => taskTitle(task))
                .join(" · ");
          meta = t("exam.timeline.plan", {
            tasks: t("exam.timeline.tasks", { count: day.tasks.length }),
            minutes: day.minutes,
          });

          if (day.isToday && studied && day.activity) {
            meta = activityText(day.activity);
          }

          mark = day.isToday ? <Msym name="schedule" size="1.1rem" /> : null;
        }

        return (
          <Fragment key={`${day.day}-${index}`}>
            {phaseRow ? <div className="memo-exam-phase-row">{t(PHASE_LABEL[phaseRow])}</div> : null}
            {day.kind === "exam" && examIndex - end - 1 > 0 ? (
              <button type="button" className="memo-exam-more" onClick={() => setShowAll(true)}>
                {t("exam.timeline.showAll", { count: examIndex - end - 1 })}
              </button>
            ) : null}
            <div className={className}>
              <span className="memo-exam-date">
                <span>{weekday(day.day)}</span>
                <strong>{dayOfMonth(day.day)}</strong>
              </span>
              <span className="memo-exam-day-copy">
                <span className="memo-exam-day-title">{title}</span>
                {meta ? <span className="memo-exam-day-meta">{meta}</span> : null}
              </span>
              <span className="memo-exam-day-mark">{mark}</span>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
