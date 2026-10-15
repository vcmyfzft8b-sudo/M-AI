"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { ExamScreen } from "@/components/exams/exam-screen";
import { formatExamDay } from "@/components/exams/exam-format";
import { EXAM_PREPS_HREF, LESSON_KIND_EMOJI, LESSON_KIND_KEY, lessonHref } from "@/components/exams/exam-links";
import { prefetchLesson } from "@/components/exams/lesson-prefetch";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import {
  EXAM_LESSON_KINDS,
  LESSONS_TO_LEARN,
  examNextStep,
  isPracticeKind,
  percent,
  type ExamLessonKind,
  type ExamStage,
} from "@/lib/exams/exam-model";
import { pathBuddySide, pathOffset, pathSegment } from "@/lib/exams/exam-path";
import type { ExamDetail, ExamModuleView } from "@/lib/exams/exams-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { currentPaywallBack, paywallPath } from "@/lib/paywall-reasons";

const STAGES: { stage: Exclude<ExamStage, "ready">; key: MessageKey }[] = [
  { stage: "learn", key: "exam.path.stage.learn" },
  { stage: "practise", key: "exam.path.stage.practise" },
  { stage: "prove", key: "exam.path.stage.prove" },
];

/*
 * The exam, as Astra and Duolingo draw a course: one path down the screen. Each topic is a module
 * with a heading, its six lessons are stations joined by a line, and a lesson still under the
 * target comes back as a repeat station until it reaches it. The step to do next carries the
 * screen's one call to action, with Memo beside it. Once every module is mastered the mock exam
 * is that step, and passing it at the target is what makes the learner ready.
 *
 * The learner chooses how to practise: the summary and any two formats learn a module
 * (`MIN_PRACTICE_FORMATS`), so once it is learned the formats they did not pick are quiet,
 * optional stations, never locks. Every station of an open module can be tapped at any time, the
 * practice ones before the summary too (the path suggests the summary first; it does not insist).
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
  const router = useRouter();
  const { exam, modules, plan } = detail;
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  /* A save, archive or delete that did not go through: said where it was asked for. */
  const [failed, setFailed] = useState(false);
  const [grade, setGrade] = useState(exam.actual_grade ?? "");
  const [gradeSaved, setGradeSaved] = useState(Boolean(exam.actual_grade));
  const currentRef = useRef<HTMLElement | null>(null);
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setConfirmDelete(false);
    setFailed(false);
  }, []);
  const menuSheet = useSheet(closeMenu, { locked: busy });
  const markCurrent = useCallback((node: HTMLElement | null) => {
    currentRef.current = node;
  }, []);

  const canOpen = (lectureId: string) => hasPaidAccess || trialLectureId === lectureId;
  const stage = detail.stage;
  const next = examNextStep(modules, stage, canOpen);
  const nextTutorTopic = next?.type === "lesson" && next.kind === "tutor" ? next.topicId : null;

  /* The tutor plans by a model call; when it is the next step, start it before the learner taps. */
  useEffect(() => {
    if (nextTutorTopic) {
      prefetchLesson(exam.id, nextTutorTopic, "tutor");
    }
  }, [exam.id, nextTutorTopic]);
  const target = exam.target_mastery;
  /* A module's stations: its six lessons, then a repeat for each lesson still under the target. */
  const stationCount = (module: ExamModuleView) =>
    module.pending ? 0 : EXAM_LESSON_KINDS.length + module.review.length;
  /* Where each module's stations start on the whole path, so the line swings on across modules. */
  const stationStarts: number[] = [];
  modules.forEach((module, index) =>
    stationStarts.push(index === 0 ? 0 : stationStarts[index - 1] + stationCount(modules[index - 1])),
  );
  /* With more than one note, each module says which note it is from. */
  const manyNotes = new Set(modules.map((module) => module.lectureId)).size > 1;
  const planning = modules.some((module) => module.pending);
  const planningReady = modules.some((module) => module.pending && module.noteReady);
  const examPassed = detail.daysLeft < 0;
  const examToday = detail.daysLeft === 0;

  /*
   * A note that was still being made at setup has no topics yet. Once it is ready its topics are
   * planned here; until then the screen checks back now and then.
   */
  useEffect(() => {
    if (!planning) {
      return;
    }

    if (!planningReady) {
      const timer = window.setTimeout(() => router.refresh(), 15_000);
      return () => window.clearTimeout(timer);
    }

    let cancelled = false;
    void fetch(`/api/exams/${exam.id}/topics`, { method: "POST" })
      .then((response) => {
        if (!cancelled && response.ok) {
          router.refresh();
        }
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, [exam.id, planning, planningReady, router]);

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
    setFailed(false);

    try {
      const response = await fetch(`/api/exams/${exam.id}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });

      if (response.ok) {
        after();
      } else {
        setFailed(true);
      }
    } catch {
      // Offline, or the request never came back.
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function openModule(module: ExamModuleView, kind: ExamLessonKind) {
    if (!canOpen(module.lectureId)) {
      navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
      return;
    }

    navigateWithFeedback(lessonHref(exam.id, module.topicId, kind));
  }

  function moduleSubtitle(module: ExamModuleView) {
    if (module.pending) {
      return t(module.noteReady ? "exam.path.planning" : "exam.dash.notReady");
    }

    if (!module.ready) {
      return t("exam.dash.notReady");
    }

    if (!canOpen(module.lectureId)) {
      return t("exam.dash.paid");
    }

    if (module.mastered) {
      // Fading never un-masters a module; it only asks for a refresh (exam-model.ts).
      return module.refresh.length > 0
        ? t("exam.dash.masteredRefresh")
        : t("exam.dash.mastered", { percent: percent(module.mastery) });
    }

    if (module.learned) {
      return t("exam.path.practise", { percent: percent(module.mastery), target });
    }

    // Learning a module takes the summary and two formats of the learner's choice, not all six.
    return t("exam.path.toLearn", { done: LESSONS_TO_LEARN - module.lessonsLeft, total: LESSONS_TO_LEARN });
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
    <ExamScreen backHref={EXAM_PREPS_HREF} trailing={trailing}>
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
            <b>{t("exam.percent", { percent: percent(detail.mastery) })}</b>
            <span>{t("exam.dash.target", { percent: exam.target_mastery })}</span>
          </div>
          <div>
            {/* Past the day's goal the count stands alone; "12/5" reads like an error. */}
            <b>{plan.doneToday >= plan.goal ? plan.doneToday : `${plan.doneToday}/${plan.goal}`}</b>
            <span>{t("exam.path.today")}</span>
          </div>
        </div>
        <ol className="memo-exam-stages">
          {STAGES.map((entry, index) => {
            const reached = STAGES.findIndex((candidate) => candidate.stage === stage);
            const state = stage === "ready" || index < reached ? "done" : index === reached ? "now" : "";

            return (
              <li key={entry.stage} className={state}>
                <span>{state === "done" ? <Msym name="check" size="0.95rem" weight={700} /> : index + 1}</span>
                {t(entry.key)}
              </li>
            );
          })}
        </ol>
      </header>

      {stage === "ready" && !examPassed ? (
        <div className="memo-exam-card memo-exam-after memo-exam-ready">
          <MemoBuddy mood="cheer" size="4rem" sparkles />
          <div>
            <b>{t("exam.path.ready.title")}</b>
            <p>{t("exam.path.ready.body")}</p>
          </div>
        </div>
      ) : null}

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
            {failed && !menuOpen ? <p className="memo-inline-error">{t("exam.dash.actionFailed")}</p> : null}
          </div>
        </div>
      ) : null}

      <div className="memo-exam-trail">
        {modules.map((module, moduleIndex) => {
          const isCurrentModule = next?.type === "lesson" && next.topicId === module.topicId;
          const locked = !module.unlocked && !module.pending;
          const stations = module.pending
            ? []
            : [
                ...EXAM_LESSON_KINDS.map((kind) => ({ kind, repeat: false })),
                ...module.review.map((kind) => ({ kind, repeat: true })),
              ];

          return (
            <section key={module.topicId} className="memo-exam-trail-unit">
              <div
                className={[
                  "memo-exam-trail-banner",
                  isCurrentModule ? "current" : "",
                  module.mastered ? "done" : "",
                  locked || !module.ready ? "locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                <span className="memo-exam-trail-banner-copy">
                  <i>
                    {t("exam.dash.module", { index: module.position + 1 })}
                    {manyNotes && module.noteTitle ? ` · ${module.noteTitle}` : ""}
                  </i>
                  <b>
                    {module.title?.trim() || t("note.untitled")}
                    {module.source !== "material" ? (
                      <span className="memo-exam-trail-source">
                        {t(module.source === "ai" ? "exam.path.source.ai" : "exam.path.source.added")}
                      </span>
                    ) : null}
                  </b>
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
                ) : module.mastered ? (
                  <Msym name="check_circle" size="1.6rem" className="memo-exam-trail-banner-mark" />
                ) : module.pending ? (
                  <span className="memo-gen-track memo-exam-trail-planning" aria-hidden="true">
                    <span />
                  </span>
                ) : null}
              </div>

              <ol className="memo-exam-trail-stations">
                {stations.map(({ kind, repeat }, stationIndex) => {
                  const index = stationStarts[moduleIndex] + stationIndex;
                  const offset = pathOffset(index);
                  const segment = pathSegment(index);
                  /*
                   * A repeat station is current when the next step repeats that lesson; the
                   * first-pass station is current otherwise, including the "keep it fresh"
                   * lesson once the learner is ready (it has no repeat station).
                   */
                  const isCurrent =
                    isCurrentModule &&
                    next?.type === "lesson" &&
                    next.kind === kind &&
                    (repeat ? next.review : !next.review || !module.review.includes(kind));
                  const isDone = repeat ? false : module.done[kind];
                  /* A format the learner did not pick, once the module is learned without it: theirs to try. */
                  const optional = !repeat && module.learned && isPracticeKind(kind) && !module.done[kind];
                  const blocked = !module.ready;
                  const last = stationIndex === stations.length - 1;
                  const score = module.latest[kind];

                  return (
                    <li
                      key={`${kind}:${repeat ? "repeat" : "first"}`}
                      ref={isCurrent ? markCurrent : undefined}
                      className={[
                        "memo-exam-station",
                        isDone ? "done" : "",
                        repeat ? "repeat" : "",
                        optional ? "optional" : "",
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
                        ) : repeat ? (
                          <span className="memo-exam-station-check repeat" aria-hidden="true">
                            <Msym name="replay" size="0.9rem" weight={700} />
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
                            {t(
                              stage === "ready"
                                ? "exam.path.keepSharp"
                                : repeat
                                  ? module.refresh.includes(kind)
                                    ? "exam.path.refresh"
                                    : "exam.path.repeat"
                                  : "exam.path.start",
                            )}{" "}
                            · {t(LESSON_KIND_KEY[kind])}
                          </button>
                          <span className={`memo-exam-station-buddy ${pathBuddySide(index)}`}>
                            <MemoBuddy mood="wave" size="4.6rem" />
                          </span>
                        </>
                      ) : (
                        <span className="memo-exam-station-label">
                          {repeat
                            ? `${t(module.refresh.includes(kind) ? "exam.path.refresh" : "exam.path.repeat")} · ${t(LESSON_KIND_KEY[kind])} · ${t("exam.percent", { percent: percent(score ?? 0) })}`
                            : optional
                              ? `${t(LESSON_KIND_KEY[kind])} · ${t("exam.path.optional")}`
                              : t(LESSON_KIND_KEY[kind])}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}

        {/* The proof: the mock exam, passed at the target. */}
        <div
          ref={next?.type === "mock" ? markCurrent : undefined}
          className={[
            "memo-exam-trail-goal",
            next?.type === "mock" ? "current" : "",
            stage === "ready" ? "done" : "",
            stage === "learn" || stage === "practise" ? "later" : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <InstantLink href={`/app/exams/${exam.id}/mock`} className="memo-exam-trail-trophy" aria-label={t("exam.mock.title")}>
            <Emoji symbol="🏆" size="2.2rem" />
          </InstantLink>
          {next?.type === "mock" ? (
            <>
              <InstantLink href={`/app/exams/${exam.id}/mock`} className="memo-exam-station-go">
                {t("exam.path.start")} · {t("exam.mock.title")}
              </InstantLink>
              <span className="memo-exam-station-buddy right">
                <MemoBuddy mood="wave" size="4.6rem" />
              </span>
            </>
          ) : (
            <b>{t("exam.mock.title")}</b>
          )}
          <span>
            {stage === "ready" && detail.latestMock
              ? t("exam.path.mock.passed", { percent: percent(detail.latestMock.percentage / 100) })
              : stage === "prove"
                ? detail.latestMock
                  ? t("exam.path.mock.retry", { percent: percent(detail.latestMock.percentage / 100), target })
                  : t("exam.path.mock.prove", { target })
                : t("exam.path.mock.later")}
          </span>
        </div>

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
            className={sheetClass("memo-sheet memo-dialog", menuSheet.closing)}
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
            {failed ? <p className="memo-inline-error">{t("exam.dash.actionFailed")}</p> : null}
            {confirmDelete ? (
              <>
                <p className="memo-sheet-copy">{t("exam.dash.delete.body")}</p>
                <div className="memo-sheet-actions">
                  <button
                    type="button"
                    className="memo-sheet-danger"
                    disabled={busy}
                    onClick={() =>
                      void mutate({ method: "DELETE" }, () => navigateWithFeedback(EXAM_PREPS_HREF))
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
                      () => navigateWithFeedback(EXAM_PREPS_HREF),
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
