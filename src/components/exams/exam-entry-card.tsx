"use client";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MemoBuddy } from "@/components/exams/memo-buddy";

export type UpcomingExam = {
  id: string;
  title: string;
  daysLeft: number;
  hasMore: boolean;
};

/**
 * Exam prep's way in: the first thing in the "Novo" sheet, and in front of the quick actions on
 * desktop. It is the sheet's one primary, so it carries the coral. With an exam already set up it
 * continues that exam instead of starting another.
 */
export function ExamEntryCard({
  upcoming,
  onOpen,
  className,
}: {
  upcoming: UpcomingExam | null;
  onOpen: (href: string) => void;
  className?: string;
}) {
  const { t } = useTranslations();

  return (
    <div className={["memo-exam-entry", className ?? ""].filter(Boolean).join(" ")}>
      <button
        type="button"
        className="memo-exam-entry-main"
        onClick={() => onOpen(upcoming ? `/app/exams/${upcoming.id}` : "/app/exams/new")}
      >
        <span className="memo-exam-entry-tag">{t("exam.entry.tag")}</span>
        <span className="memo-exam-entry-title">{upcoming ? upcoming.title : t("exam.entry.title")}</span>
        <span className="memo-exam-entry-body">
          {upcoming
            ? upcoming.daysLeft === 0
              ? t("exam.dash.countdownToday")
              : t("exam.list.inDays", { count: upcoming.daysLeft })
            : t("exam.entry.body")}
        </span>
        <span className="memo-exam-entry-go">
          {upcoming ? t("exam.entry.continue") : t("exam.entry.start")}
          <Msym name="arrow_forward" size="1.15rem" fill={false} />
        </span>
      </button>
      <span className="memo-exam-entry-buddy" aria-hidden="true">
        <MemoBuddy mood="wave" size="5.2rem" />
      </span>
      {upcoming ? (
        <button type="button" className="memo-exam-entry-more" onClick={() => onOpen("/app/exams")}>
          {upcoming.hasMore ? t("exam.entry.all") : t("exam.list.new")}
        </button>
      ) : null}
    </div>
  );
}
