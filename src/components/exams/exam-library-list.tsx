"use client";

import type { CSSProperties } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { Emoji, Msym } from "@/components/msym";
import { percent } from "@/lib/exams/exam-model";
import type { LibraryExamPrep } from "@/lib/exams/exams-server";

/* Exam things, one per prep in turn, so two preps side by side never share a picture. */
const PREP_EMOJI = ["📝", "📚", "🎓", "✏️", "📖", "🗓️"];

/** One prep, cut like a note row; an exam emoji in the tile, ringed by how much of the goal is mastered. */
function PrepRow({ prep, emoji }: { prep: LibraryExamPrep; emoji: string }) {
  const { t } = useTranslations();
  const mastered = percent(prep.mastery);
  /* Only an exam whose day has gone is done; one archived ahead of it is just put away. */
  const pastLabel = prep.archived && prep.daysLeft >= 0 ? t("exam.list.archived") : t("exam.list.past");

  return (
    <InstantLink
      href={`/app/exams/${prep.id}`}
      className={`memo-note-row memo-prep-row ${prep.past ? "past" : ""}`.trim()}
    >
      <span className="memo-prep-ring" style={{ "--prep-mastery": `${mastered}%` } as CSSProperties} aria-hidden="true">
        <span className="memo-prep-ring-face">
          <Emoji symbol={emoji} size="1.4rem" />
        </span>
      </span>

      <span className="memo-note-copy">
        <span className="memo-note-title">{prep.title}</span>
        <span className="memo-note-meta">
          {prep.past
            ? prep.grade
              ? `${pastLabel} · ${t("exam.list.grade", { grade: prep.grade })}`
              : `${pastLabel} · ${t("exam.list.mastery", { percent: mastered })}`
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
 * ones ahead first, then the past ones under their own heading. A new one starts from "Novo". It is where leaving a prep goes, so a new prep is seen to land there.
 */
export function ExamLibraryList({ preps, searching = false }: { preps: LibraryExamPrep[]; searching?: boolean }) {
  const { t } = useTranslations();
  const upcoming = preps.filter((prep) => !prep.past);
  const past = preps.filter((prep) => prep.past);

  return (
    <section className="memo-prep-folder" aria-label={t("exam.library.title")}>
      {preps.length === 0 && searching ? (
        <div className="memo-empty">
          <Emoji symbol="🎓" size="2rem" />
          <p>{t("library.empty.noMatchTitle")}</p>
          <p>{t("library.empty.noMatchBody")}</p>
        </div>
      ) : preps.length === 0 ? (
        <div className="memo-exam-empty memo-prep-empty">
          <MemoBuddy mood="wave" size="6rem" thought="📅" />
          <h2>{t("exam.list.empty.title")}</h2>
          <p>{t("exam.list.empty.body")}</p>
        </div>
      ) : null}

      {upcoming.length > 0 ? (
        <div className="memo-note-list">
          {upcoming.map((prep, index) => (
            <PrepRow key={prep.id} prep={prep} emoji={PREP_EMOJI[index % PREP_EMOJI.length]} />
          ))}
        </div>
      ) : null}

      {past.length > 0 ? (
        <>
          <div className="memo-library-head">
            <span className="memo-eyebrow">{t("exam.list.pastSection")}</span>
          </div>
          <div className="memo-note-list">
            {past.map((prep, index) => (
              <PrepRow
                key={prep.id}
                prep={prep}
                emoji={PREP_EMOJI[(upcoming.length + index) % PREP_EMOJI.length]}
              />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
