"use client";

import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";

/**
 * Exam prep's way in: the first row of the "Novo" sheet's list, and the first row above the quick
 * actions on desktop. It is one of the options (same height, tile, type and spacing as the note
 * sources under it); what makes it the primary is a touch of coral: Memo in a coral-tinted tile
 * and a faint coral edge. Like every option in "Novo" it starts something new; the
 * preps already set up live in the library, next to the notes.
 */
export function ExamEntryCard({
  onOpen,
  className,
}: {
  onOpen: (href: string) => void;
  className?: string;
}) {
  const { t } = useTranslations();

  return (
    <button
      type="button"
      className={["memo-exam-entry", className ?? ""].filter(Boolean).join(" ")}
      onClick={() => onOpen("/app/exams/new")}
    >
      <span className="memo-exam-entry-tile" aria-hidden="true">
        <MemoBuddy mood="wave" size="2.75rem" />
      </span>
      <span className="memo-exam-entry-copy">
        <span className="memo-exam-entry-title">{t("exam.entry.title")}</span>
        <span className="memo-exam-entry-sub">{t("exam.entry.body")}</span>
      </span>
    </button>
  );
}
