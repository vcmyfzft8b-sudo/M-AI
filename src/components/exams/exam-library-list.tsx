"use client";

import { useId, useState, type CSSProperties } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { Msym } from "@/components/msym";
import { EXAM_PREPS_COLLAPSED_COOKIE, percent } from "@/lib/exams/exam-model";
import type { LibraryExamPrep } from "@/lib/exams/exams-server";

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** One prep, cut like a note row; Memo in the tile, ringed by how much of the goal is mastered. */
function PrepRow({ prep }: { prep: LibraryExamPrep }) {
  const { t } = useTranslations();
  const mastered = percent(prep.mastery);

  return (
    <InstantLink
      href={`/app/exams/${prep.id}`}
      className={`memo-note-row memo-prep-row ${prep.past ? "past" : ""}`.trim()}
    >
      <span className="memo-prep-ring" style={{ "--prep-mastery": `${mastered}%` } as CSSProperties} aria-hidden="true">
        <span className="memo-prep-ring-face">
          <MemoBuddy size="2.2rem" />
        </span>
      </span>

      <span className="memo-note-copy">
        <span className="memo-note-title">{prep.title}</span>
        <span className="memo-note-meta">
          {prep.past
            ? prep.grade
              ? `${t("exam.list.past")} · ${t("exam.list.grade", { grade: prep.grade })}`
              : `${t("exam.list.past")} · ${t("exam.list.mastery", { percent: mastered })}`
            : `${
                prep.daysLeft === 0 ? t("exam.dash.countdownToday") : t("exam.list.inDays", { count: prep.daysLeft })
              } · ${t("exam.list.mastery", { percent: mastered })}`}
        </span>
      </span>

      <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
    </InstantLink>
  );
}

/**
 * The library's exam preps, where the notes are.
 *
 * In "Vsi zapiski" they are a group of their own above the notes: the preps still ahead of their
 * exam, under a heading that folds them away (kept in a cookie, so the server paints the library
 * already folded) and a "Vse" that opens their folder. The folder ("Priprave na test", pinned in
 * the folder picker) holds every prep, past ones under their own heading, and the way to start a
 * new one; it is where leaving a prep goes, so a new prep is seen to land there.
 */
export function ExamLibraryList({
  preps,
  view,
  notesFollow = false,
  initialCollapsed = false,
  onOpenFolder,
}: {
  preps: LibraryExamPrep[];
  view: "group" | "folder";
  /** Whether notes are listed under the group, which then gets their heading to end it. */
  notesFollow?: boolean;
  initialCollapsed?: boolean;
  onOpenFolder?: () => void;
}) {
  const { t } = useTranslations();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const listId = useId();
  const upcoming = preps.filter((prep) => !prep.past);
  const past = preps.filter((prep) => prep.past);

  if (view === "folder") {
    return (
      <section className="memo-prep-folder" aria-label={t("exam.library.title")}>
        {preps.length === 0 ? (
          <div className="memo-exam-empty memo-prep-empty">
            <MemoBuddy mood="wave" size="6rem" thought="📅" />
            <h2>{t("exam.list.empty.title")}</h2>
            <p>{t("exam.list.empty.body")}</p>
          </div>
        ) : null}

        <div className="memo-note-list">
          {upcoming.map((prep) => (
            <PrepRow key={prep.id} prep={prep} />
          ))}
          <InstantLink href="/app/exams/new" className="memo-note-row memo-prep-new">
            <span className="memo-prep-new-tile" aria-hidden="true">
              <Msym name="add" size="1.5rem" fill={false} weight={600} />
            </span>
            <span className="memo-note-copy">
              <span className="memo-note-title">{t("exam.library.new")}</span>
              <span className="memo-note-meta">{t("exam.entry.body")}</span>
            </span>
          </InstantLink>
        </div>

        {past.length > 0 ? (
          <>
            <div className="memo-library-head">
              <span className="memo-eyebrow">{t("exam.list.pastSection")}</span>
            </div>
            <div className="memo-note-list">
              {past.map((prep) => (
                <PrepRow key={prep.id} prep={prep} />
              ))}
            </div>
          </>
        ) : null}
      </section>
    );
  }

  if (upcoming.length === 0) {
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
          <span className="memo-library-count">{upcoming.length}</span>
          <Msym name="expand_more" size="1.3rem" fill={false} weight={500} className="memo-library-chevron" />
        </button>
        {onOpenFolder ? (
          <button type="button" className="memo-library-head-link" onClick={onOpenFolder}>
            {t("exam.library.all")}
          </button>
        ) : null}
      </div>

      <div id={listId} className="memo-prep-fold" data-open={!collapsed} inert={collapsed}>
        <div className="memo-prep-fold-inner">
          <div className="memo-note-list">
            {upcoming.map((prep) => (
              <PrepRow key={prep.id} prep={prep} />
            ))}
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
