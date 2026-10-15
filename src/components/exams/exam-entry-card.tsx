"use client";

import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { Msym } from "@/components/msym";

export type UpcomingExam = {
  id: string;
  title: string;
  daysLeft: number;
  hasMore: boolean;
};

/**
 * Exam prep's way in: the first row of the "Novo" sheet's list, and the first row above the quick
 * actions on desktop. It is one of the options (same height, tile, type and spacing as the note
 * sources under it); what makes it the primary is a touch of coral: Memo in a coral-tinted tile,
 * a coral edge and a small coral arrow. With an exam already set up it continues that exam.
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
        {/* Named for what it does, like the options under it; the exam it continues goes underneath. */}
        <span className="memo-exam-entry-title">{t("exam.entry.title")}</span>
        <span className="memo-exam-entry-sub">
          {upcoming
            ? `${upcoming.title} · ${
                upcoming.daysLeft === 0
                  ? t("exam.dash.countdownToday")
                  : t("exam.list.inDays", { count: upcoming.daysLeft })
              }`
            : t("exam.entry.body")}
        </span>
      </span>
      <span className="memo-exam-entry-go" aria-hidden="true">
        <Msym name="arrow_forward" size="1.2rem" weight={600} />
      </span>
      <span className="sr-only">{upcoming ? t("exam.entry.continue") : t("exam.entry.start")}</span>
    </button>
  );
}
