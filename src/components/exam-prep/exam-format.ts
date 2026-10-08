"use client";

import { useTranslations } from "@/components/i18n-provider";
import type { GradeScaleId } from "@/lib/exam-prep/grade-scales";
import type {
  ExamTypeId,
  JourneyTask,
} from "@/lib/exam-prep/model";
import { LOCALE_INTL_TAG } from "@/lib/i18n/locales";
import type { MessageKey } from "@/lib/i18n/messages/keys";

export const EXAM_TYPE_LABEL: Record<ExamTypeId, MessageKey> = {
  written: "exam.type.written",
  multiple_choice: "exam.type.multiple_choice",
  problem_solving: "exam.type.problem_solving",
  oral: "exam.type.oral",
  mixed: "exam.type.mixed",
};

/** A day key as a date at noon UTC, so no zone can move it to a neighbour. */
function dayDate(day: string) {
  return new Date(`${day}T12:00:00Z`);
}

export function useExamFormat() {
  const { locale, t } = useTranslations();
  const tag = LOCALE_INTL_TAG[locale];

  const format = (day: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag, { ...options, timeZone: "UTC" }).format(dayDate(day));

  /** A grade label as the learner reads it: "8", "B", "75 %", "passed". */
  const grade = (scale: GradeScaleId, label: string) => {
    if (scale === "percent") {
      return t("exam.grade.percent", { value: label });
    }

    if (scale === "pass_fail") {
      return label === "pass" ? t("exam.grade.pass") : t("exam.grade.fail");
    }

    return label;
  };


  const taskTitle = (task: JourneyTask) => {
    switch (task.kind) {
      case "learn":
        return task.manual
          ? t("exam.task.read", { note: task.noteTitle ?? "" })
          : t("exam.task.learn", { section: task.sectionTitle ?? task.noteTitle ?? "" });
      case "review":
        return t(task.tab === "quiz" ? "exam.task.reviewQuestions" : "exam.task.review", {
          count: task.count,
        });
      case "quiz":
        return t("exam.task.quiz", { count: task.count });
      case "mock":
        return task.tab === "quiz" ? t("exam.task.mockQuiz") : t("exam.task.mock");
      case "explain":
        return t("exam.task.explain");
      case "wind_down":
        return t("exam.task.windDown");
    }
  };

  const taskMeta = (task: JourneyTask) => {
    switch (task.kind) {
      case "learn":
        return task.manual
          ? t("exam.task.readMeta")
          : t("exam.task.learnMeta", { note: task.noteTitle ?? "", count: task.count });
      case "mock":
        return t("exam.task.mockMeta", { note: task.noteTitle ?? "", count: task.count });
      case "explain":
        return t("exam.task.explainMeta", { note: task.noteTitle ?? "" });
      case "wind_down":
        return t("exam.task.windDownMeta");
      default:
        return task.noteTitle ?? "";
    }
  };

  return {
    locale,
    t,
    /** "Wed 28 Oct" in the reader's language. */
    longDate: (day: string) => format(day, { weekday: "short", day: "numeric", month: "short" }),
    /** "Wednesday, 28 October 2026", for a calendar day read aloud. */
    fullDate: (day: string) =>
      format(day, { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    /** "October 2026" over a calendar, capitalised as a heading in every language. */
    monthTitle: (day: string) => {
      const title = format(day, { month: "long", year: "numeric" });
      return title.charAt(0).toLocaleUpperCase(tag) + title.slice(1);
    },
    /** Monday-first short weekday names, for the rest-day picker. */
    weekdayNames: () =>
      // 2026-10-05 is a Monday.
      Array.from({ length: 7 }, (_, index) =>
        format(`2026-10-${String(5 + index).padStart(2, "0")}`, { weekday: "narrow" }),
      ),
    percent: (value: number) => t("exam.percent", { value: Math.round(value) }),
    grade,
    taskTitle,
    taskMeta,
  };
}

export function noteHref(lectureId: string, tab: string | null) {
  return tab && tab !== "notes" ? `/app/lectures/${lectureId}?tab=${tab}` : `/app/lectures/${lectureId}`;
}
