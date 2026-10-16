"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

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
  examNextStep,
  percent,
  type ExamLessonKind,
  type PracticeLessonKind,
} from "@/lib/exams/exam-model";
import { pathBuddySide, pathOffset, pathSegment } from "@/lib/exams/exam-path";
import type { ExamDetail, ExamModuleView } from "@/lib/exams/exams-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { currentPaywallBack, paywallPath } from "@/lib/paywall-reasons";

/* Locked stations drawn after "Next up", as Astra draws the levels still to come. */
const LOCKED_AHEAD = 2;

/* Practice lessons a topic needs before "Ponovitev" (repeat the weakest format) opens. */
const REPETITION_AFTER = 3;

type PickerTab = "learn" | "practise" | "exam";

type PickerItem = {
  key: string;
  emoji: string;
  label: MessageKey;
  /** The lesson it opens, or the mock exam. */
  kind: ExamLessonKind | "mock";
  /** Why it is locked, when it is. */
  locked?: MessageKey;
  body?: MessageKey;
};

/*
 * The exam, as Astra AI draws it (studied in its app, 2026-10-16): one path of lessons down the
 * screen. Every lesson done is a station with its score, the next one carries the "Next up" mark
 * and Memo, and the ones after it are locked until it is done. The path picks the next lesson's
 * topic and format (`examNextStep`); the round button beside "Nadaljuj" swaps the format for any
 * other (Astra's "Next lesson" picker: learn, practise, exam). Readiness is the headline; the
 * "Napredek" tab has the forecast, the gaps and every topic's mastery. The mock exam is offered on
 * the path at any time.
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
  const [tab, setTab] = useState<"path" | "progress">("path");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>("learn");
  const [pickerTopic, setPickerTopic] = useState<string | null>(null);
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
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const pickerSheet = useSheet(closePicker);
  const markCurrent = useCallback((node: HTMLElement | null) => {
    currentRef.current = node;
  }, []);

  const canOpen = (lectureId: string) => hasPaidAccess || trialLectureId === lectureId;
  const stage = detail.stage;
  /* The exam's eve and the day itself: Astra's exam-day refresher comes before anything new. */
  const finalDay = detail.daysLeft === 0 || detail.daysLeft === 1;
  const next = examNextStep(modules, stage, canOpen, { finalDay });
  const nextModule = next?.type === "lesson" ? (modules.find((module) => module.topicId === next.topicId) ?? null) : null;
  const nextTutorTopic = next?.type === "lesson" && next.kind === "tutor" ? next.topicId : null;
  const target = exam.target_mastery;
  const examPassed = detail.daysLeft < 0;
  const examToday = detail.daysLeft === 0;
  const byTopic = useMemo(() => new Map(modules.map((module) => [module.topicId, module])), [modules]);
  /* Topics the picker may open: the ones the path has reached, ready and allowed. */
  const openTopics = modules.filter((module) => module.unlocked && module.ready && !module.pending);

  /* The tutor plans by a model call; when it is the next step, start it before the learner taps. */
  useEffect(() => {
    if (nextTutorTopic) {
      prefetchLesson(exam.id, nextTutorTopic, "tutor");
    }
  }, [exam.id, nextTutorTopic]);

  const planning = modules.some((module) => module.pending);
  const planningReady = modules.some((module) => module.pending && module.noteReady);

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

  /* Open on "Next up", wherever it is on a long path (the screen's own scroller). */
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
  }, [tab]);

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

  function openLesson(module: ExamModuleView, kind: ExamLessonKind) {
    if (!canOpen(module.lectureId)) {
      navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
      return;
    }

    navigateWithFeedback(lessonHref(exam.id, module.topicId, kind));
  }

  function openMock() {
    navigateWithFeedback(`/app/exams/${exam.id}/mock`);
  }

  function openPicker() {
    setPickerTopic(nextModule?.topicId ?? openTopics[0]?.topicId ?? null);
    setPickerTab("learn");
    setPickerOpen(true);
  }

  /* What the swap picker offers for the topic it has chosen. */
  const pickerModule = (pickerTopic ? byTopic.get(pickerTopic) : null) ?? nextModule ?? openTopics[0] ?? null;
  const weakestDone = (module: ExamModuleView): PracticeLessonKind =>
    (["quiz", "written", "true_false", "tutor", "flashcards"] as const)
      .filter((kind) => module.done[kind])
      .sort((left, right) => (module.latest[left] ?? 0) - (module.latest[right] ?? 0))[0] ?? "quiz";
  const pickerItems: Record<PickerTab, PickerItem[]> = {
    learn: [
      { key: "summary", emoji: LESSON_KIND_EMOJI.summary, label: LESSON_KIND_KEY.summary, kind: "summary" },
      {
        key: "tutor",
        emoji: LESSON_KIND_EMOJI.tutor,
        label: LESSON_KIND_KEY.tutor,
        kind: "tutor",
        // No talking time left: the tutor waits until there is (the path already suggests others).
        locked: detail.tutorAvailable ? undefined : "exam.picker.tutor.locked",
      },
      { key: "flashcards", emoji: LESSON_KIND_EMOJI.flashcards, label: LESSON_KIND_KEY.flashcards, kind: "flashcards" },
      {
        key: "gaps",
        emoji: "🧩",
        label: "exam.picker.gaps",
        kind: pickerModule?.gapKind ?? "quiz",
        locked: pickerModule && pickerModule.pressingGaps > 0 ? undefined : "exam.picker.gaps.locked",
      },
    ],
    practise: [
      { key: "quiz", emoji: LESSON_KIND_EMOJI.quiz, label: LESSON_KIND_KEY.quiz, kind: "quiz" },
      { key: "true_false", emoji: LESSON_KIND_EMOJI.true_false, label: LESSON_KIND_KEY.true_false, kind: "true_false" },
      { key: "written", emoji: LESSON_KIND_EMOJI.written, label: LESSON_KIND_KEY.written, kind: "written" },
      {
        key: "repetition",
        emoji: "🔁",
        label: "exam.picker.repetition",
        kind: pickerModule ? weakestDone(pickerModule) : "quiz",
        locked:
          pickerModule && pickerModule.practiceLessons >= REPETITION_AFTER ? undefined : "exam.picker.repetition.locked",
      },
    ],
    exam: [
      { key: "mock-written", emoji: "📝", label: "exam.picker.mockWritten", body: "exam.picker.mockWritten.body", kind: "mock" },
      { key: "mock-oral", emoji: "🗣️", label: "exam.picker.mockOral", body: "exam.picker.mockOral.body", kind: "mock" },
    ],
  };

  function choose(item: PickerItem) {
    if (item.locked) {
      return;
    }

    pickerSheet.dismiss();

    if (item.kind === "mock") {
      openMock();
    } else if (pickerModule) {
      openLesson(pickerModule, item.kind);
    }
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

  /* What the learner knows, floored (89.6 % is not the 90 % goal); at the goal the target rings green. */
  const known = percent(detail.mastery);
  const goalLeft = Math.max(0, exam.target_mastery - known);
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  /*
   * The path's stations: every lesson done (oldest first, a topic heading wherever the topic
   * changes), then "Next up", then the locked ones still to come.
   */
  type Station =
    | { type: "done"; id: string; topicId: string; kind: ExamLessonKind; score: number }
    | { type: "next"; topicId: string; kind: ExamLessonKind }
    | { type: "locked"; index: number };
  const stations: Station[] = [
    ...detail.history.map((entry) => ({
      type: "done" as const,
      id: entry.id,
      topicId: entry.topicId,
      kind: entry.kind,
      score: entry.score,
    })),
    ...(next?.type === "lesson" && !examPassed ? [{ type: "next" as const, topicId: next.topicId, kind: next.kind }] : []),
    ...(next?.type === "lesson" && !examPassed
      ? Array.from({ length: LOCKED_AHEAD }, (_, index) => ({ type: "locked" as const, index }))
      : []),
  ];

  /* The stations in runs of one topic each, every run under its topic's heading. */
  type Run = { topicId: string; start: number; stations: Station[] };
  const runs: Run[] = [];
  stations.forEach((station, index) => {
    const topicId = station.type === "locked" ? (runs.at(-1)?.topicId ?? "") : station.topicId;
    const current = runs.at(-1);

    if (current && current.topicId === topicId) {
      current.stations.push(station);
    } else {
      runs.push({ topicId, start: index, stations: [station] });
    }
  });

  const cta =
    examPassed || tab !== "path" ? null : next?.type === "lesson" && nextModule ? (
      <div className="memo-exam-next-bar">
        <button
          type="button"
          className="memo-exam-swap"
          aria-label={t("exam.path.swap")}
          onClick={openPicker}
        >
          <Msym name="swap_horiz" size="1.45rem" fill={false} weight={500} />
        </button>
        <button type="button" className="memo-button-coral" onClick={() => openLesson(nextModule, next.kind)}>
          {t("exam.path.continue", { lesson: t(LESSON_KIND_KEY[next.kind]) })}
        </button>
      </div>
    ) : next?.type === "mock" ? (
      <div className="memo-exam-next-bar">
        <button type="button" className="memo-exam-swap" aria-label={t("exam.path.swap")} onClick={openPicker}>
          <Msym name="swap_horiz" size="1.45rem" fill={false} weight={500} />
        </button>
        <button type="button" className="memo-button-coral" onClick={openMock}>
          {t("exam.path.continue", { lesson: t("exam.mock.title") })}
        </button>
      </div>
    ) : null;

  return (
    <ExamScreen backHref={EXAM_PREPS_HREF} trailing={trailing} cta={cta}>
      <header className="memo-exam-trail-head">
        <h1>{exam.title}</h1>
        <div className="memo-segment memo-exam-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "path"}
            className={tab === "path" ? "active" : undefined}
            onClick={() => setTab("path")}
          >
            {t("exam.path.tab.path")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "progress"}
            className={tab === "progress" ? "active" : undefined}
            onClick={() => setTab("progress")}
          >
            {t("exam.path.tab.progress")}
          </button>
        </div>
        <section className="memo-exam-goal" aria-label={t("exam.dash.goal.label")}>
          <div className="memo-exam-goal-head">
            <span className="memo-exam-goal-label">{t("exam.dash.goal.label")}</span>
            <span className="memo-exam-goal-value">
              <b>{t("exam.percent", { percent: known })}</b>
              <span>{t("exam.dash.target", { percent: exam.target_mastery })}</span>
            </span>
          </div>
          <div
            className="memo-exam-goal-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={known}
            aria-valuetext={t("exam.dash.goal.valueText", { percent: known, target: exam.target_mastery })}
          >
            <div className="memo-progress goal">
              <div style={{ width: `${known}%` }} />
            </div>
            {/* The goal on the bar: a target the fill runs towards. */}
            <span
              className={`memo-exam-goal-mark ${goalLeft === 0 ? "hit" : ""}`.trim()}
              style={{ "--goal": `${exam.target_mastery}%` } as CSSProperties}
              aria-hidden="true"
            >
              <Emoji symbol="🎯" size="1.45rem" />
            </span>
          </div>
          {/*
           * Astra's forecast (where this pace lands on the exam day) and the knowledge gaps still
           * open: the two things that say what reaching the goal takes.
           */}
          {(detail.forecast && !examPassed && stage !== "ready") || detail.gaps > 0 ? (
            <div className="memo-exam-goal-notes">
              {detail.forecast && !examPassed && stage !== "ready" ? (
                <p className={detail.forecast.onTrack ? "on-track" : undefined}>
                  <Emoji symbol={detail.forecast.onTrack ? "📈" : "⏱️"} size="1rem" />
                  {t("exam.dash.forecast", { percent: percent(detail.forecast.atExam) })}
                </p>
              ) : null}
              {detail.gaps > 0 ? (
                <p>
                  <Emoji symbol="🧩" size="1rem" />
                  {t("exam.dash.gaps", { count: detail.gaps })}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
        {/* The Progress tab has these numbers in its own tiles. */}
        {tab === "path" ? (
          <div className="memo-exam-goal-facts">
            <span>
              <Emoji symbol="📅" size="1rem" />
              {examPassed ? (
                <span>{t("exam.list.past")}</span>
              ) : examToday ? (
                <span>{t("exam.dash.countdownToday")}</span>
              ) : (
                <span>
                  <b>{detail.daysLeft}</b> {t("exam.setup.motivate.days", { count: detail.daysLeft })}
                </span>
              )}
            </span>
            <span>
              <Emoji symbol="✅" size="1rem" />
              <span>
                {/* Past the day's goal the count stands alone; "12/5" reads like an error. */}
                <b>{plan.doneToday >= plan.goal ? plan.doneToday : `${plan.doneToday}/${plan.goal}`}</b>{" "}
                {t("exam.path.today")}
              </span>
            </span>
          </div>
        ) : null}
      </header>

      {tab === "path" ? (
        <>
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
            {runs.map((run) => {
              const topic = byTopic.get(run.topicId);

              return (
                <section key={`run:${run.start}`} className="memo-exam-trail-unit">
                  <div
                    className={`memo-exam-trail-banner ${run.stations.some((station) => station.type === "next") ? "current" : ""}`.trim()}
                  >
                    <span className="memo-exam-trail-banner-copy">
                      <i>{t("exam.dash.module", { index: (topic?.position ?? 0) + 1 })}</i>
                      <b>{topic?.title?.trim() || t("note.untitled")}</b>
                      {topic ? <span>{t("exam.path.topicMastery", { percent: percent(topic.mastery), target })}</span> : null}
                    </span>
                    {topic?.mastered ? <Msym name="check_circle" size="1.6rem" className="memo-exam-trail-banner-mark" /> : null}
                  </div>
                  <ol className="memo-exam-trail-stations">
                    {run.stations.map((station, offsetInRun) => {
                      const index = run.start + offsetInRun;
                      const offset = pathOffset(index);
                      const segment = pathSegment(index);
                      const last = offsetInRun === run.stations.length - 1;
                      const line = !last ? (
                        <span
                          aria-hidden="true"
                          className={`memo-exam-station-line ${station.type === "done" ? "done" : ""}`.trim()}
                          style={
                            {
                              "--memo-line-length": `${segment.length}rem`,
                              "--memo-line-angle": `${segment.angle}deg`,
                            } as CSSProperties
                          }
                        />
                      ) : null;

                      if (station.type === "locked") {
                        return (
                          <li
                            key={`locked:${station.index}`}
                            className="memo-exam-station locked"
                            style={{ "--memo-station-x": `${offset}rem` } as CSSProperties}
                          >
                            {line}
                            <span className="memo-exam-station-node" aria-label={t("exam.path.locked")}>
                              <Msym name="lock" size="1.5rem" fill={false} />
                            </span>
                            {station.index === 0 ? <span className="memo-exam-station-label">{t("exam.path.locked")}</span> : null}
                          </li>
                        );
                      }

                      const isNext = station.type === "next";

                      return (
                        <li
                          key={isNext ? "next" : station.id}
                          ref={isNext ? markCurrent : undefined}
                          className={`memo-exam-station ${isNext ? "current" : "done"}`}
                          style={{ "--memo-station-x": `${offset}rem` } as CSSProperties}
                        >
                          {line}
                          <button
                            type="button"
                            className="memo-exam-station-node"
                            aria-label={`${t(LESSON_KIND_KEY[station.kind])} · ${topic?.title?.trim() || t("note.untitled")}`}
                            onClick={() => (topic ? openLesson(topic, station.kind) : undefined)}
                          >
                            <Emoji symbol={LESSON_KIND_EMOJI[station.kind]} size="1.75rem" />
                            {isNext ? null : (
                              <span className="memo-exam-station-check" aria-hidden="true">
                                <Msym name="check" size="0.9rem" weight={700} />
                              </span>
                            )}
                          </button>
                          {isNext ? (
                            <>
                              <span className="memo-exam-station-next">
                                <i>{t("exam.path.nextUp")}</i>
                                {t(LESSON_KIND_KEY[station.kind])}
                              </span>
                              <span className={`memo-exam-station-buddy ${pathBuddySide(index)}`}>
                                <MemoBuddy mood="wave" size="4.6rem" />
                              </span>
                            </>
                          ) : (
                            <span className="memo-exam-station-label">
                              {station.kind === "summary"
                                ? t(LESSON_KIND_KEY[station.kind])
                                : `${t(LESSON_KIND_KEY[station.kind])} · ${t("exam.percent", { percent: percent(station.score) })}`}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              );
            })}

            {/* Astra's mock card: the real exam, tried whenever the learner wants. */}
            <div
              ref={next?.type === "mock" ? markCurrent : undefined}
              className={`memo-exam-card memo-exam-mock-card ${next?.type === "mock" ? "current" : ""}`.trim()}
            >
              <Emoji symbol="🏆" size="2rem" />
              <div>
                <b>
                  {stage === "ready" && detail.latestMock
                    ? t("exam.path.mock.passed", { percent: percent(detail.latestMock.percentage / 100) })
                    : detail.latestMock
                      ? t("exam.path.mock.retry", { percent: percent(detail.latestMock.percentage / 100), target })
                      : t("exam.path.mockCard.title")}
                </b>
                <p>{t("exam.path.mockCard.body")}</p>
              </div>
              <InstantLink href={`/app/exams/${exam.id}/mock`} className="memo-button-ghost memo-exam-mock-card-go">
                {t("exam.path.mockCard.cta")}
              </InstantLink>
            </div>

            <div className="memo-exam-trail-finish">
              <Emoji symbol="🏁" size="1.3rem" />
              <span>{t("exam.path.examDay", { date: formatExamDay(exam.exam_date, locale) })}</span>
            </div>
          </div>
        </>
      ) : (
        <div className="memo-exam-progress">
          <div className="memo-exam-progress-stats">
            <span>
              <b>
                {detail.onTarget} / {modules.length}
              </b>
              {t("exam.progress.onTarget")}
            </span>
            <span>
              <b>{Math.max(0, detail.daysLeft)}</b>
              {t("exam.progress.days")}
            </span>
            <span>
              <b>{detail.history.length}</b>
              {t("exam.progress.lessons", { count: detail.history.length })}
            </span>
          </div>

          <section className="memo-exam-card memo-exam-progress-card">
            <span className="memo-eyebrow">{t("exam.progress.forecast.title")}</span>
            {detail.forecast ? (
              <>
                <b className={detail.forecast.onTrack ? "on-track" : undefined}>
                  {t("exam.dash.forecast", { percent: percent(detail.forecast.atExam) })}
                </b>
                <p>
                  {t("exam.progress.perLesson", { percent: decimal.format(detail.forecast.perLesson * 100) })}
                  {detail.forecast.lessonsNeeded > 0
                    ? ` ${t("exam.progress.needed", { count: detail.forecast.lessonsNeeded })} ${t("exam.progress.perDay", { count: detail.forecast.perDay })}`
                    : ""}
                </p>
              </>
            ) : (
              <p>{t("exam.progress.forecast.none")}</p>
            )}
          </section>

          <section className="memo-exam-card memo-exam-progress-card">
            <span className="memo-eyebrow">{t("exam.progress.gaps.title")}</span>
            <b>{detail.gaps > 0 ? t("exam.dash.gaps", { count: detail.gaps }) : t("exam.progress.gaps.none")}</b>
          </section>

          <section className="memo-exam-card memo-exam-progress-card">
            <span className="memo-eyebrow">{t("exam.progress.topics")}</span>
            <ul className="memo-exam-progress-topics">
              {modules.map((module) => {
                const value = percent(module.mastery);

                return (
                  <li key={module.topicId} className={module.unlocked ? undefined : "locked"}>
                    <span className="memo-exam-progress-topic-head">
                      <b>{module.title?.trim() || t("note.untitled")}</b>
                      <span>{module.unlocked ? t("exam.percent", { percent: value }) : "—"}</span>
                    </span>
                    <div className="memo-exam-mastery-bar">
                      <div className="memo-progress goal">
                        <div style={{ width: `${value}%` }} />
                      </div>
                      <i style={{ "--goal": `${target}%` } as CSSProperties} aria-hidden="true" />
                    </div>
                    <span className="memo-exam-progress-topic-note">
                      {module.unlocked
                        ? t("exam.progress.topicLessons", { count: module.lessons })
                        : t("exam.progress.topicLocked")}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}

      {pickerOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", pickerSheet.closing)}
            onClick={() => pickerSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet memo-dialog memo-exam-picker", pickerSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-picker-title"
            {...pickerSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <div className="memo-sheet-title">
              <span id="exam-picker-title">{t("exam.picker.title")}</span>
              <button type="button" className="memo-sheet-close" aria-label={t("common.close")} onClick={() => pickerSheet.dismiss()}>
                <Msym name="close" size="1.45rem" fill={false} weight={500} />
              </button>
            </div>
            <div className="memo-segment memo-exam-tabs" role="tablist">
              {(["learn", "practise", "exam"] as const).map((entry) => (
                <button
                  key={entry}
                  type="button"
                  role="tab"
                  aria-selected={pickerTab === entry}
                  className={pickerTab === entry ? "active" : undefined}
                  onClick={() => setPickerTab(entry)}
                >
                  {t(`exam.picker.tab.${entry}` as MessageKey)}
                </button>
              ))}
            </div>
            {pickerTab !== "exam" && openTopics.length > 1 ? (
              <div className="memo-exam-picker-topics" aria-label={t("exam.picker.topic")}>
                {openTopics.map((module) => (
                  <button
                    key={module.topicId}
                    type="button"
                    className={`memo-chip ${pickerModule?.topicId === module.topicId ? "active" : ""}`.trim()}
                    onClick={() => setPickerTopic(module.topicId)}
                  >
                    {module.title?.trim() || t("note.untitled")}
                  </button>
                ))}
              </div>
            ) : null}
            <div className={`memo-exam-picker-grid ${pickerTab === "exam" ? "wide" : ""}`.trim()}>
              {pickerItems[pickerTab].map((item) => {
                const recommended =
                  next?.type === "lesson" && pickerModule?.topicId === next.topicId && item.kind === next.kind && !item.locked && item.key === item.kind;

                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`memo-exam-picker-item ${item.locked ? "locked" : ""}`.trim()}
                    aria-disabled={item.locked ? true : undefined}
                    onClick={() => choose(item)}
                  >
                    {recommended ? <span className="memo-exam-picker-badge">{t("exam.picker.recommended")}</span> : null}
                    <Emoji symbol={item.locked ? "🔒" : item.emoji} size="1.6rem" />
                    <b>{t(item.label)}</b>
                    {item.locked ? (
                      <span>{t(item.locked, { count: REPETITION_AFTER })}</span>
                    ) : item.body ? (
                      <span>{t(item.body)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>
        </MemoPortal>
      ) : null}

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
