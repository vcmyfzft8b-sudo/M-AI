"use client";

import { noteHref, useExamFormat } from "@/components/exam-prep/exam-format";
import { InstantLink } from "@/components/instant-link";
import { Emoji, Msym } from "@/components/msym";
import type { JourneyDay, JourneyTask } from "@/lib/exam-prep/model";

const RING = 2 * Math.PI * 15.5;

function ProgressCheck({ task }: { task: JourneyTask }) {
  if (task.done) {
    return <Msym name="check" size="1.15rem" weight={700} />;
  }

  return (
    <>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle className="track" cx="18" cy="18" r="15.5" />
        <circle
          className="fill"
          cx="18"
          cy="18"
          r="15.5"
          strokeDasharray={RING}
          strokeDashoffset={RING * (1 - task.progress)}
        />
      </svg>
    </>
  );
}

/**
 * Today's tasks, in order. Every task that can be detected ticks itself off
 * from real study; only what the app cannot see (explaining aloud, winding
 * down, reading a note with no cards) has a check to tap. The first task not
 * yet done carries the screen's one primary action.
 */
export function ExamTodayTasks({
  day,
  onToggle,
  pendingKey = null,
  linkTasks = true,
}: {
  day: JourneyDay;
  onToggle?: (task: JourneyTask) => void;
  pendingKey?: string | null;
  /** False on the landing page, where nothing navigates. */
  linkTasks?: boolean;
}) {
  const { t, taskTitle, taskMeta } = useExamFormat();
  const firstOpen = day.tasks.find((task) => !task.done)?.key ?? null;

  return (
    <div className="memo-exam-tasks">
      {day.tasks.map((task) => {
        const className = `memo-exam-task ${task.done ? "done" : ""}`.trim();
        const href = task.lectureId && linkTasks ? noteHref(task.lectureId, task.tab) : null;
        const copy = (
          <span className="memo-exam-task-copy">
            <span className="memo-exam-task-title">{taskTitle(task)}</span>
            <span className="memo-exam-task-meta">
              {task.noteEmoji && task.kind !== "learn" ? (
                <>
                  <Emoji symbol={task.noteEmoji} size="0.9rem" />{" "}
                </>
              ) : null}
              {taskMeta(task)}
            </span>
          </span>
        );
        const trailing =
          task.key === firstOpen && href ? (
            <span className="memo-exam-task-start">{t("exam.today.start")}</span>
          ) : (
            <>
              <span className="memo-exam-task-time">
                {t("exam.minutes", { count: task.minutes })}
              </span>
              {href ? <Msym name="chevron_right" size="1.4rem" fill={false} weight={400} /> : null}
            </>
          );

        if (task.manual) {
          return (
            <div key={task.key} className={className}>
              <button
                type="button"
                className="memo-exam-check"
                aria-pressed={task.done}
                aria-label={task.done ? t("exam.today.unmark") : t("exam.today.mark")}
                disabled={!onToggle || pendingKey === task.key}
                onClick={() => onToggle?.(task)}
              >
                <ProgressCheck task={task} />
              </button>
              {href ? (
                <InstantLink href={href} className="memo-exam-task-link">
                  {copy}
                </InstantLink>
              ) : (
                copy
              )}
              <span className="memo-exam-task-time">
                {t("exam.minutes", { count: task.minutes })}
              </span>
            </div>
          );
        }

        if (!href) {
          return (
            <div key={task.key} className={className}>
              <span className="memo-exam-check">
                <ProgressCheck task={task} />
              </span>
              {copy}
              {trailing}
            </div>
          );
        }

        return (
          <InstantLink key={task.key} href={href} className={className}>
            <span className="memo-exam-check">
              <ProgressCheck task={task} />
            </span>
            {copy}
            {trailing}
          </InstantLink>
        );
      })}
    </div>
  );
}
