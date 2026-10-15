"use client";

import type { CSSProperties } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { Msym } from "@/components/msym";
import { percent } from "@/lib/exams/exam-model";
import type { LibraryExamPrep } from "@/lib/exams/exams-server";

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
 * The library's exam-prep folder ("Priprave na test" in Mape, beside the notes): every prep, the
 * ones ahead first, then the row that starts a new one, then the past ones under their own
 * heading. It is where leaving a prep goes, so a new prep is seen to land there.
 */
export function ExamLibraryList({ preps }: { preps: LibraryExamPrep[] }) {
  const { t } = useTranslations();
  const upcoming = preps.filter((prep) => !prep.past);
  const past = preps.filter((prep) => prep.past);

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
