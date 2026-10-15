"use client";

import { useId, useState, type CSSProperties } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { Msym } from "@/components/msym";
import { EXAM_PREPS_COLLAPSED_COOKIE, percent } from "@/lib/exams/exam-model";
import type { LibraryExamPrep } from "@/lib/exams/exams-server";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * The learner's exam preps, where their notes are: a group of its own above the notes, with
 * rows cut like note rows so it reads as part of the library. What tells a prep from a note is
 * Memo in the tile, ringed by how much of the goal is mastered, and the countdown in the meta.
 * "Vse" opens every prep, the finished ones included.
 *
 * The heading folds the group away, for a learner who wants their notes first. The choice is
 * kept in a cookie rather than local storage so the server paints the library already folded.
 */
export function ExamLibraryList({
  preps,
  notesFollow,
  initialCollapsed,
}: {
  preps: LibraryExamPrep[];
  /** Whether notes are listed under the group, which then gets their heading to end it. */
  notesFollow: boolean;
  initialCollapsed: boolean;
}) {
  const { t } = useTranslations();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const listId = useId();

  if (preps.length === 0) {
    return null;
  }

  function toggle() {
    const next = !collapsed;

    setCollapsed(next);
    document.cookie = next
      ? `${EXAM_PREPS_COLLAPSED_COOKIE}=1; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
      : `${EXAM_PREPS_COLLAPSED_COOKIE}=; path=/; max-age=0; samesite=lax`;
  }

  return (
    <section className="memo-prep-group" aria-label={t("exam.library.title")}>
      <div className="memo-library-head">
        <button
          type="button"
          className="memo-library-toggle"
          aria-expanded={!collapsed}
          aria-controls={listId}
          onClick={toggle}
        >
          <span className="memo-eyebrow">{t("exam.library.title")}</span>
          <span className="memo-library-count">{preps.length}</span>
          <Msym name="expand_more" size="1.3rem" fill={false} weight={500} className="memo-library-chevron" />
        </button>
        <InstantLink href="/app/exams" className="memo-library-head-link">
          {t("exam.library.all")}
        </InstantLink>
      </div>

      <div id={listId} className="memo-prep-fold" data-open={!collapsed} inert={collapsed}>
        <div className="memo-prep-fold-inner">
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
                      {prep.daysLeft === 0
                        ? t("exam.dash.countdownToday")
                        : t("exam.list.inDays", { count: prep.daysLeft })}
                      {" · "}
                      {t("exam.list.mastery", { percent: mastered })}
                    </span>
                  </span>

                  <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
                </InstantLink>
              );
            })}
          </div>
        </div>
      </div>

      {notesFollow ? (
        <div className="memo-library-head">
          <span className="memo-eyebrow">{t("exam.library.notes")}</span>
        </div>
      ) : null}
    </section>
  );
}
