"use client";

import type { CSSProperties } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { Msym } from "@/components/msym";
import { percent } from "@/lib/exams/exam-model";
import type { LibraryExamPrep } from "@/lib/exams/exams-server";

/**
 * The learner's exam preps, where their notes are: a group of its own above the notes, with
 * rows cut like note rows so it reads as part of the library. What tells a prep from a note is
 * Memo in the tile, ringed by how much of the goal is mastered, and the countdown in the meta.
 * "Vse" opens every prep, the finished ones included.
 */
export function ExamLibraryList({
  preps,
  notesFollow,
}: {
  preps: LibraryExamPrep[];
  /** Whether notes are listed under the group, which then gets their heading to end it. */
  notesFollow: boolean;
}) {
  const { t } = useTranslations();

  if (preps.length === 0) {
    return null;
  }

  return (
    <section className="memo-prep-group" aria-label={t("exam.library.title")}>
      <div className="memo-library-head">
        <span className="memo-eyebrow">{t("exam.library.title")}</span>
        <InstantLink href="/app/exams" className="memo-library-head-link">
          {t("exam.library.all")}
        </InstantLink>
      </div>

      <div className="memo-note-list">
        {preps.map((prep) => {
          const mastered = percent(prep.mastery);

          return (
            <InstantLink key={prep.id} href={`/app/exams/${prep.id}`} className="memo-note-row memo-prep-row">
              <span
                className="memo-prep-ring"
                style={{ "--prep-mastery": `${mastered}%` } as CSSProperties}
                aria-hidden="true"
              >
                <span className="memo-prep-ring-face">
                  <MemoBuddy size="2.2rem" />
                </span>
              </span>

              <span className="memo-note-copy">
                <span className="memo-note-title">{prep.title}</span>
                <span className="memo-note-meta">
                  {prep.daysLeft === 0 ? t("exam.dash.countdownToday") : t("exam.list.inDays", { count: prep.daysLeft })}
                  {" · "}
                  {t("exam.list.mastery", { percent: mastered })}
                </span>
              </span>

              <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
            </InstantLink>
          );
        })}
      </div>

      {notesFollow ? (
        <div className="memo-library-head">
          <span className="memo-eyebrow">{t("exam.library.notes")}</span>
        </div>
      ) : null}
    </section>
  );
}
