"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { ExamScreen } from "@/components/exams/exam-screen";
import { formatExamDay } from "@/components/exams/exam-format";
import { LESSON_KIND_EMOJI, LESSON_KIND_KEY, lessonHref } from "@/components/exams/exam-links";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { EXAM_LESSON_KINDS, percent, type ExamLessonKind } from "@/lib/exams/exam-model";
import { pathBuddySide, pathOffset, pathSegment } from "@/lib/exams/exam-path";
import type { ExamDetail, ExamModuleView } from "@/lib/exams/exams-server";

/** The lesson the path points at: the first untried one, else the weakest module's weakest lesson. */
function nextLesson(modules: ExamModuleView[]) {
  for (const entry of modules) {
    if (!entry.unlocked || !entry.ready || entry.completed) {
      continue;
    }

    const kind = EXAM_LESSON_KINDS.find((candidate) => !entry.done[candidate]);

    if (kind) {
      return { module: entry, kind };
    }
  }

  const review = [...modules]
    .filter((entry) => entry.unlocked && entry.ready)
    .sort((left, right) => left.mastery - right.mastery)[0];

  return review ? { module: review, kind: review.nextKind } : null;
}

/*
 * The exam, as Astra and Duolingo draw a course: one path down the screen. Each note is a module
 * with a heading, its five lessons are stations joined by a line, the station to do next carries
 * the screen's one coral button, and Memo stands beside it. The mock exam and the exam day end it.
 */
export function ExamDashboard({
  detail,
  hasPaidAccess,
  trialLectureId,
}: {
  detail: ExamDetail;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
}) {
  const { t, locale } = useTranslations();
  const { navigateWithFeedback } = useInstantNavigation();
  const { exam, modules, plan } = detail;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState(exam.actual_grade ?? "");
  const [gradeSaved, setGradeSaved] = useState(Boolean(exam.actual_grade));
  const currentRef = useRef<HTMLLIElement | null>(null);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setConfirmDelete(false);
  }, []);
  const menuSheet = useSheet(closeMenu, { locked: busy });

  const canOpen = (lectureId: string) => hasPaidAccess || trialLectureId === lectureId;
  const next = nextLesson(modules);
  const examPassed = detail.daysLeft < 0;
  const examToday = detail.daysLeft === 0;

  /* Open on the station to do next, wherever it is on a long path (the screen's own scroller). */
  useEffect(() => {
    const station = currentRef.current;
    const scroller = station?.closest<HTMLElement>(".memo-screen-scroll");

    if (!station || !scroller) {
      return;
    }

    const box = station.getBoundingClientRect();
    const frame = scroller.getBoundingClientRect();

    if (box.bottom > frame.bottom - 40) {
      scroller.scrollTop += box.top - frame.top - frame.height / 2 + box.height / 2;
    }
  }, []);

  async function mutate(init: RequestInit, after: () => void) {
    setBusy(true);

    try {
      const response = await fetch(`/api/exams/${exam.id}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });

      if (response.ok) {
        after();
      }
    } finally {
      setBusy(false);
    }
  }

  function openModule(module: ExamModuleView, kind: ExamLessonKind) {
    if (!canOpen(module.lectureId)) {
      navigateWithFeedback("/app/start");
      return;
    }

    navigateWithFeedback(lessonHref(exam.id, module.lectureId, kind));
  }

  function moduleSubtitle(module: ExamModuleView) {
    if (!module.ready) {
      return t("exam.dash.notReady");
    }

    if (!canOpen(module.lectureId)) {
      return t("exam.dash.paid");
    }

    if (module.completed) {
      return t("exam.dash.mastered", { percent: percent(module.mastery) });
    }

    return t("exam.dash.lessonsDone", { done: module.lessonsDone, total: EXAM_LESSON_KINDS.length });
  }

  const trailing = (
    <>
      {detail.streak > 0 ? (
        <span className="memo-exam-flame" aria-label={t("exam.dash.streak", { count: detail.streak })}>
          <Emoji symbol="🔥" size="1rem" /> {detail.streak}
        </span>
      ) : null}
      <button
        type="button"
        className="memo-close-button"
        aria-label={t("exam.dash.menu")}
        onClick={() => setMenuOpen(true)}
      >
        <Msym name="more_horiz" size="1.45rem" fill={false} weight={500} />
      </button>
    </>
  );

  return (
    <ExamScreen backHref="/app/exams" backLabel={t("exam.list.title")} trailing={trailing}>
      <header className="memo-exam-trail-head">
        <h1>{exam.title}</h1>
        <div className="memo-exam-stats compact">
          <div>
            <b>{examPassed ? "✓" : Math.max(0, detail.daysLeft)}</b>
            <span>
              {examPassed
                ? t("exam.list.past")
                : examToday
                  ? t("exam.dash.countdownToday")
                  : t("exam.setup.motivate.days", { count: detail.daysLeft })}
            </span>
          </div>
          <div>
            <b>{percent(detail.mastery)} %</b>
            <span>{t("exam.dash.target", { percent: exam.target_mastery })}</span>
          </div>
          <div>
            <b>
              {plan.doneToday}/{plan.goal}
            </b>
            <span>{t("exam.path.today")}</span>
          </div>
        </div>
      </header>

      {examPassed ? (
        <div className="memo-exam-card memo-exam-after">
          <MemoBuddy mood={gradeSaved ? "cheer" : "wave"} size="4rem" />
          <div>
            <b>{t("exam.dash.after.title")}</b>
            <p>{gradeSaved ? t("exam.dash.after.saved", { grade }) : t("exam.dash.after.body")}</p>
            {!gradeSaved ? (
              <div className="memo-exam-after-form">
                <input
                  id="exam-actual-grade"
                  className="memo-field"
                  value={grade}
                  maxLength={12}
                  inputMode="text"
                  placeholder={t("exam.dash.after.placeholder")}
                  onChange={(event) => setGrade(event.target.value)}
                />
                <button
                  type="button"
                  className="memo-primary-pill"
                  disabled={busy || grade.trim().length === 0}
                  onClick={() =>
                    void mutate(
                      { method: "PATCH", body: JSON.stringify({ actualGrade: grade.trim() }) },
                      () => setGradeSaved(true),
                    )
                  }
                >
                  {t("common.save")}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="memo-exam-trail">
        {modules.map((module, moduleIndex) => {
          const isCurrentModule = next?.module.lectureId === module.lectureId;
          const locked = !module.unlocked;

          return (
            <section key={module.lectureId} className="memo-exam-trail-unit">
              <div
                className={[
                  "memo-exam-trail-banner",
                  isCurrentModule ? "current" : "",
                  module.completed ? "done" : "",
                  locked || !module.ready ? "locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="memo-exam-trail-banner-copy">
                  <i>{t("exam.dash.module", { index: module.position + 1 })}</i>
                  <b>{module.title?.trim() || t("note.untitled")}</b>
                  {locked && module.ready ? null : <span>{moduleSubtitle(module)}</span>}
                </span>
                {locked && module.ready ? (
                  <button
                    type="button"
                    className="memo-exam-trail-skip"
                    onClick={() => openModule(module, "quiz")}
                  >
                    {t("exam.path.skip")}
                  </button>
                ) : module.completed ? (
                  <Msym name="check_circle" size="1.6rem" className="memo-exam-trail-banner-mark" />
                ) : null}
              </div>

              <ol className="memo-exam-trail-stations">
                {EXAM_LESSON_KINDS.map((kind, kindIndex) => {
                  const index = moduleIndex * EXAM_LESSON_KINDS.length + kindIndex;
                  const offset = pathOffset(index);
                  const segment = pathSegment(index);
                  const isCurrent = isCurrentModule && next?.kind === kind;
                  const isDone = module.done[kind];
                  const blocked = !module.ready;
                  const last = kindIndex === EXAM_LESSON_KINDS.length - 1;

                  return (
                    <li
                      key={kind}
                      ref={isCurrent ? currentRef : undefined}
                      className={[
                        "memo-exam-station",
                        isDone ? "done" : "",
                        isCurrent ? "current" : "",
                        locked || blocked ? "locked" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      style={{ "--memo-station-x": `${offset}rem` } as CSSProperties}
                    >
                      {!last ? (
                        <span
                          aria-hidden="true"
                          className={`memo-exam-station-line ${isDone ? "done" : ""}`.trim()}
                          style={
                            {
                              "--memo-line-length": `${segment.length}rem`,
                              "--memo-line-angle": `${segment.angle}deg`,
                            } as CSSProperties
                          }
                        />
                      ) : null}
                      <button
                        type="button"
                        className="memo-exam-station-node"
                        disabled={blocked}
                        aria-label={`${t(LESSON_KIND_KEY[kind])} · ${module.title?.trim() || t("note.untitled")}`}
                        onClick={() => openModule(module, locked ? "quiz" : kind)}
                      >
                        {locked || blocked ? (
                          <Msym name="lock" size="1.5rem" fill={false} />
                        ) : (
                          <Emoji symbol={LESSON_KIND_EMOJI[kind]} size="1.75rem" />
                        )}
                        {isDone ? (
                          <span className="memo-exam-station-check" aria-hidden="true">
                            <Msym name="check" size="0.9rem" weight={700} />
                          </span>
                        ) : null}
                      </button>
                      {isCurrent ? (
                        <>
                          <button
                            type="button"
                            className="memo-exam-station-go"
                            onClick={() => openModule(module, kind)}
                          >
                            {t("exam.path.start")} · {t(LESSON_KIND_KEY[kind])}
                          </button>
                          <span className={`memo-exam-station-buddy ${pathBuddySide(index)}`}>
                            <MemoBuddy mood="wave" size="4.6rem" />
                          </span>
                        </>
                      ) : (
                        <span className="memo-exam-station-label">{t(LESSON_KIND_KEY[kind])}</span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}

        <InstantLink href={`/app/exams/${exam.id}/mock`} className="memo-exam-trail-goal">
          <span className="memo-exam-trail-trophy">
            <Emoji symbol="🏆" size="2.2rem" />
          </span>
          <b>{t("exam.mock.title")}</b>
          <span>
            {detail.latestMock
              ? t("exam.dash.mock.last", {
                  grade: detail.latestMock.grade,
                  percent: Math.round(detail.latestMock.percentage),
                })
              : t("exam.dash.mock.body")}
          </span>
        </InstantLink>

        <div className="memo-exam-trail-finish">
          <Emoji symbol="🏁" size="1.3rem" />
          <span>{t("exam.path.examDay", { date: formatExamDay(exam.exam_date, locale) })}</span>
        </div>
      </div>

      {menuOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", menuSheet.closing)}
            onClick={() => menuSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet", menuSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-menu-title"
            {...menuSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <div className="memo-sheet-title">
              <span id="exam-menu-title">{confirmDelete ? t("exam.dash.delete.title") : exam.title}</span>
              <button
                type="button"
                className="memo-sheet-close"
                aria-label={t("common.close")}
                onClick={() => menuSheet.dismiss()}
              >
                <Msym name="close" size="1.45rem" fill={false} weight={500} />
              </button>
            </div>
            {confirmDelete ? (
              <>
                <p className="memo-sheet-copy">{t("exam.dash.delete.body")}</p>
                <div className="memo-sheet-actions">
                  <button
                    type="button"
                    className="memo-sheet-danger"
                    disabled={busy}
                    onClick={() =>
                      void mutate({ method: "DELETE" }, () => navigateWithFeedback("/app/exams"))
                    }
                  >
                    {t("exam.dash.delete.confirm")}
                  </button>
                  <button type="button" className="memo-sheet-ghost" onClick={() => setConfirmDelete(false)}>
                    {t("common.cancel")}
                  </button>
                </div>
              </>
            ) : (
              <div className="memo-sheet-actions">
                <button
                  type="button"
                  className="memo-sheet-ghost"
                  disabled={busy}
                  onClick={() =>
                    void mutate(
                      { method: "PATCH", body: JSON.stringify({ archived: !exam.archived_at }) },
                      () => navigateWithFeedback("/app/exams"),
                    )
                  }
                >
                  {exam.archived_at ? t("exam.dash.unarchive") : t("exam.dash.archive")}
                </button>
                <button type="button" className="memo-sheet-danger" onClick={() => setConfirmDelete(true)}>
                  {t("exam.dash.delete.title")}
                </button>
              </div>
            )}
          </div>
        </MemoPortal>
      ) : null}
    </ExamScreen>
  );
}
