"use client";

import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";

export type UpcomingExam = {
  id: string;
  title: string;
  daysLeft: number;
  hasMore: boolean;
};

/**
 * Exam prep's way in: the first row of the "Novo" sheet, and the first row above the quick
 * actions on desktop. It is the same size and shape as the note sources around it; what makes it
 * the sheet's one primary is the coral — a tinted tile with Memo in it, a coral edge and a small
 * coral pill — not its size. With an exam already set up it continues that exam.
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
    <button
      type="button"
      className={["memo-exam-entry", className ?? ""].filter(Boolean).join(" ")}
      onClick={() => onOpen(upcoming ? `/app/exams/${upcoming.id}` : "/app/exams/new")}
    >
      <span className="memo-exam-entry-tile" aria-hidden="true">
        <MemoBuddy mood="wave" size="2.75rem" />
      </span>
      <span className="memo-exam-entry-copy">
        <span className="memo-exam-entry-title">{upcoming ? upcoming.title : t("exam.entry.title")}</span>
        <span className="memo-exam-entry-sub">
          {upcoming
            ? upcoming.daysLeft === 0
              ? t("exam.dash.countdownToday")
              : t("exam.list.inDays", { count: upcoming.daysLeft })
            : t("exam.entry.body")}
        </span>
      </span>
      <span className="memo-exam-entry-go">{upcoming ? t("exam.entry.continue") : t("exam.entry.start")}</span>
    </button>
  );
}
