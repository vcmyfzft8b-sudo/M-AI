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
  reachableModules,
  type ExamLessonKind,
  type PracticeLessonKind,
} from "@/lib/exams/exam-model";
import { pathBuddySide, pathCurve, pathPoint, pathStations } from "@/lib/exams/exam-path";
import type { ExamDetail, ExamModuleView } from "@/lib/exams/exams-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { currentPaywallBack, paywallPath } from "@/lib/paywall-reasons";

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
  /* A new function every render; an effect keyed on it would restart (and plan again) each time. */
  const navigateRef = useRef(navigateWithFeedback);

  useEffect(() => {
    navigateRef.current = navigateWithFeedback;
  });
  const router = useRouter();
  const { exam, modules, plan } = detail;
  const [tab, setTab] = useState<"path" | "progress">("path");
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTab, setPickerTab] = useState<PickerTab>("learn");
  /* Modules whose earlier lessons the learner opened on the path. */
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(() => new Set());
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
  const menuSheet = useSheet(closeMenu, { locked: busy, closeOnEscape: menuOpen });
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const pickerSheet = useSheet(closePicker, { closeOnEscape: pickerOpen });
  const markCurrent = useCallback((node: HTMLElement | null) => {
    currentRef.current = node;
  }, []);

  const canOpen = (lectureId: string) => hasPaidAccess || trialLectureId === lectureId;
  /* An archived prep takes no lessons (the lesson page sends them back here): it offers to come back. */
  const archived = Boolean(exam.archived_at);
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
  /* The modules the path has reached, as the model and the lesson page count them; the picker offers these. */
  const reachedTopics = new Set(
    reachableModules(modules, canOpen).flatMap((reached, index) => (reached ? [modules[index].topicId] : [])),
  );
  const openTopics = modules.filter((module) => reachedTopics.has(module.topicId) && module.ready && !module.pending);

  /* The tutor plans by a model call; when it is the next step, start it before the learner taps. */
  useEffect(() => {
    if (nextTutorTopic) {
      prefetchLesson(exam.id, nextTutorTopic, "tutor");
    }
  }, [exam.id, nextTutorTopic]);

  const planning = modules.some((module) => module.pending);
  const planningReady = modules.some((module) => module.pending && module.noteReady);
  const pendingNotes = modules.filter((module) => module.pending).length;
  /* Any module with material to study; until then there is nothing a mock could ask either. */
  const studiable = modules.some((module) => module.ready && !module.pending);
  /*
   * Material to study, none of it open to this account (a plan that lapsed, the free note used
   * elsewhere): the path has no next step, so the bar's way on is the paywall rather than nothing.
   */
  const accessLocked =
    next === null && studiable && !modules.some((module) => module.ready && !module.pending && canOpen(module.lectureId));

  /*
   * A note that was still being made at setup has no topics yet. Once it is ready its topics are
   * planned here; until then the screen checks back now and then.
   */
  useEffect(() => {
    // An archived prep plans nothing (the route refuses it), so it does not ask every 15 s for good.
    if (!planning || exam.archived_at) {
      return;
    }

    // Every 8 s while the note is being made: a refresh that finds it unchanged leaves this effect's
    // inputs as they were, so a one-off timer would have checked only once.
    if (!planningReady) {
      const timer = window.setInterval(() => router.refresh(), 8_000);
      return () => window.clearInterval(timer);
    }

    // Planned now, and asked again every 15 s if that did not land (an error, a rate limit), so a
    // failed attempt never leaves the screen on "planning"; a refusal for access is the paywall.
    // One request at a time: planning a note takes up to a minute and every request pays for it.
    let cancelled = false;
    let inFlight = false;
    const plan = () => {
      if (inFlight) {
        return Promise.resolve();
      }

      inFlight = true;
      return fetch(`/api/exams/${exam.id}/topics`, { method: "POST" })
        .then((response) => {
          if (cancelled) {
            return;
          }

          if (response.status === 402) {
            navigateRef.current(paywallPath("exam", currentPaywallBack()));
          } else if (response.ok) {
            router.refresh();
          }
        })
        .catch(() => null)
        .finally(() => {
          inFlight = false;
        });
    };

    void plan();
    const timer = window.setInterval(() => void plan(), 15_000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [exam.archived_at, exam.id, planning, planningReady, router]);

  /* Each tab starts at its top; the path then brings "Next up" into view (below). */
  function showTab(from: HTMLElement, next: "path" | "progress") {
    from.closest<HTMLElement>(".memo-screen-scroll")?.scrollTo({ top: 0 });
    setTab(next);
  }

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

  function openLesson(module: ExamModuleView, kind: ExamLessonKind, check = false) {
    if (archived) {
      return;
    }

    if (!canOpen(module.lectureId)) {
      navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
      return;
    }

    navigateWithFeedback(lessonHref(exam.id, module.topicId, kind, check));
  }

  /* The mock exam; the picker's oral one opens its setup on the oral kind. */
  function openMock(mode: "written" | "oral" = "written") {
    navigateWithFeedback(`/app/exams/${exam.id}/mock${mode === "oral" ? "?mode=oral" : ""}`);
  }

  function openPaywall() {
    navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
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
      // Without talking time the tutor is simply not offered (the path already suggests others).
      ...(detail.tutorAvailable
        ? [{ key: "tutor", emoji: LESSON_KIND_EMOJI.tutor, label: LESSON_KIND_KEY.tutor, kind: "tutor" as const }]
        : []),
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
      openMock(item.key === "mock-oral" ? "oral" : "written");
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

  const showsNext = next?.type === "lesson" && !examPassed && !archived && nextModule !== null;
  const { runs, folded } = pathStations({
    modules,
    history: detail.history,
    next: showsNext && next?.type === "lesson" ? next : null,
    ahead: !examPassed && !archived,
    unfolded,
    target: target / 100,
  });

  const cta =
    examPassed || tab !== "path" ? null : archived ? (
      // Brought back where it is: the path then has its next step again.
      <button
        type="button"
        className="memo-button-coral"
        disabled={busy}
        onClick={() =>
          void mutate({ method: "PATCH", body: JSON.stringify({ archived: false }) }, () => router.refresh())
        }
      >
        {t("exam.dash.unarchive")}
      </button>
    ) : next?.type === "lesson" && nextModule ? (
      <div className="memo-exam-next-bar">
        <button
          type="button"
          className="memo-exam-swap"
          aria-label={t("exam.path.swap")}
          onClick={openPicker}
        >
          <Msym name="swap_horiz" size="1.45rem" fill={false} weight={500} />
        </button>
        <button type="button" className="memo-button-coral" onClick={() => openLesson(nextModule, next.kind, next.check)}>
          {t("exam.path.continue", { lesson: next.check ? t("exam.lesson.check") : t(LESSON_KIND_KEY[next.kind]) })}
        </button>
      </div>
    ) : next?.type === "mock" ? (
      <div className="memo-exam-next-bar">
        <button type="button" className="memo-exam-swap" aria-label={t("exam.path.swap")} onClick={openPicker}>
          <Msym name="swap_horiz" size="1.45rem" fill={false} weight={500} />
        </button>
        <button type="button" className="memo-button-coral" onClick={() => openMock()}>
          {t("exam.path.continue", { lesson: t("exam.mock.title") })}
        </button>
      </div>
    ) : accessLocked ? (
      // The shared paywall, which knows whether this is the browser or the app.
      <button type="button" className="memo-button-coral" onClick={openPaywall}>
        {t("paywall.choosePlan")}
      </button>
    ) : modules.length === 0 && pendingNotes === 0 ? (
      // A prep left with no material: its one way on, in the bar every screen has it in.
      <InstantLink href="/app/exams/new" className="memo-button-coral">
        {t("exam.dash.empty.cta")}
      </InstantLink>
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
            onClick={(event) => showTab(event.currentTarget, "path")}
          >
            {t("exam.path.tab.path")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "progress"}
            className={tab === "progress" ? "active" : undefined}
            onClick={(event) => showTab(event.currentTarget, "progress")}
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
          {goalLeft === 0 || (detail.forecast && !examPassed && stage !== "ready") || detail.gaps > 0 ? (
            <div className="memo-exam-goal-notes">
              {/* Reaching the goal is worth saying, first and in green. */}
              {goalLeft === 0 ? (
                <span className="memo-path-ontarget">
                  <Msym name="check" size="0.95rem" weight={700} />
                  {t("exam.dash.onTarget")}
                </span>
              ) : null}
              {detail.forecast && !examPassed && stage !== "ready" ? (
                <p className={detail.forecast.onTrack ? "on-track" : undefined}>
                  <Emoji symbol={detail.forecast.onTrack ? "📈" : "⏱️"} size="1rem" />
                  {t("exam.dash.forecast", { percent: percent(detail.forecast.atExam) })}
                </p>
              ) : null}
              {/* On the Progress tab, what each lesson adds and what the goal still takes. */}
              {tab === "progress" && detail.forecast && !examPassed && stage !== "ready" ? (
                <p>
                  <Emoji symbol="🧮" size="1rem" />
                  {t("exam.progress.perLesson", { percent: decimal.format(detail.forecast.perLesson * 100) })}
                  {detail.forecast.lessonsNeeded > 0
                    ? ` ${t("exam.progress.needed", { count: detail.forecast.lessonsNeeded })} ${t("exam.progress.perDay", { count: detail.forecast.perDay })}`
                    : ""}
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
                <b>{plan.doneToday >= plan.goal ? plan.doneToday : `${plan.doneToday} / ${plan.goal}`}</b>{" "}
                {t("exam.path.today", { count: plan.doneToday >= plan.goal ? plan.doneToday : plan.goal })}
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
                    aria-label={t("exam.dash.after.title")}
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

        {/* Archived: why the path has no next step, over the bar's way back. */}
        {archived && !examPassed ? (
          <div className="memo-exam-card memo-exam-after" role="status">
            <MemoBuddy mood="idle" size="4rem" />
            <div>
              <b>{t("exam.dash.archived.title")}</b>
              <p>{t("exam.dash.archived.body")}</p>
              {failed && !menuOpen ? <p className="memo-inline-error">{t("exam.dash.actionFailed")}</p> : null}
            </div>
          </div>
        ) : null}
          <div className="memo-exam-trail">
            {/* No material left (every note failed to be made, or was deleted): say so, and the way on. */}
            {modules.length === 0 && pendingNotes === 0 ? (
              <div className="memo-exam-empty">
                <MemoBuddy mood="sad" size="6rem" />
                <h2>{t("exam.dash.empty.title")}</h2>
                <p>{t("exam.dash.empty.body")}</p>
              </div>
            ) : null}
            {/* Material still being read at setup: its topics join the path when the note is ready. */}
            {pendingNotes > 0 ? (
              <div className="memo-exam-card memo-exam-mock-card memo-exam-preparing" aria-live="polite">
                <Emoji symbol="🧠" size="2rem" />
                <div>
                  <b>{t("exam.path.preparing.title")}</b>
                  <p>{t("exam.path.preparing.body", { count: pendingNotes })}</p>
                </div>
                <span className="memo-gen-track memo-exam-material-track" aria-hidden="true">
                  <span />
                </span>
              </div>
            ) : null}
            {runs.map((run) => {
              const topic = byTopic.get(run.topicId);
              // Not reached yet: shut until the module before it is on its goal.
              const gated = !reachedTopics.has(run.topicId);
              const current = run.stations.some((station) => station.type === "next");
              const mastery = topic ? percent(topic.mastery) : 0;
              // Where each stop sits on the line, and how far the learner has walked along it.
              const points = run.stations.map((_, row) => pathPoint(run.start + row, row));
              const walkedTo = run.stations.reduce((last, station, row) => (station.type === "done" || station.type === "next" ? row : last), 0);
              const height = run.stations.length > 0 ? points[points.length - 1].y + 4.6 : 0;

              return (
                <section key={`run:${run.start}`} className="memo-exam-trail-unit">
                  {/* The module as a chapter: its name, and the app's bar towards its goal with the goal marked. */}
                  <div
                    className={`memo-path-chapter ${current ? "current" : ""} ${gated ? "locked" : ""} ${
                      !gated && mastery >= target ? "on-target" : ""
                    }`.trim()}
                  >
                    <div className="memo-path-chapter-head">
                      <i>{t("exam.dash.module", { index: (topic?.position ?? 0) + 1 })}</i>
                      {topic?.mastered ? (
                        <span className="memo-path-chapter-mark" aria-hidden="true">
                          <Msym name="check" size="1rem" weight={700} />
                        </span>
                      ) : null}
                    </div>
                    <b className="memo-path-chapter-title">{topic?.title?.trim() || t("note.untitled")}</b>
                    {/* Shut until the module before it (the gate's position, counted from 1) is on target. */}
                    {gated && topic ? (
                      <span className="memo-path-chapter-gate">{t("exam.path.gate", { target, index: topic.position })}</span>
                    ) : topic ? (
                      <div
                        className="memo-path-chapter-bar"
                        role="img"
                        aria-label={t("exam.path.topicMastery", { percent: mastery, target })}
                      >
                        <div className="memo-path-chapter-track">
                          <div className="memo-progress goal">
                            <div style={{ width: `${Math.max(mastery, 3)}%` }} />
                          </div>
                          <span className="memo-path-goal" style={{ left: `${target}%` }} />
                        </div>
                        <b>
                          {t("exam.percent", { percent: mastery })} <span>· {t("exam.dash.target", { percent: target })}</span>
                        </b>
                      </div>
                    ) : null}
                  </div>
                  {folded.get(run.topicId) && run.stations[0]?.type === "done" ? (
                    <button
                      type="button"
                      className="memo-exam-trail-earlier"
                      onClick={() => setUnfolded((current) => new Set(current).add(run.topicId))}
                    >
                      <Msym name="expand_more" size="1.2rem" fill={false} weight={500} />
                      {t("exam.path.earlier", { count: folded.get(run.topicId) ?? 0 })}
                    </button>
                  ) : null}
                  {run.stations.length > 0 ? (
                    <ol className="memo-path" style={{ height: `${height}rem` }}>
                      {/* One smooth line through the stops: coral as far as the learner has come, dotted after. */}
                      {points.length > 1 ? (
                        <svg
                          className="memo-path-svg"
                          viewBox={`-8 0 16 ${height}`}
                          style={{ height: `${height}rem` }}
                          aria-hidden="true"
                        >
                          {walkedTo < points.length - 1 ? (
                            <path className="memo-path-line ahead" d={pathCurve(points.slice(walkedTo))} />
                          ) : null}
                          {walkedTo > 0 ? <path className="memo-path-line walked" d={pathCurve(points.slice(0, walkedTo + 1))} /> : null}
                        </svg>
                      ) : null}
                      {run.stations.map((station, row) => {
                        const index = run.start + row;
                        const place = { "--x": `${points[row].x}rem`, top: `${points[row].y}rem` } as CSSProperties;

                        if (station.type === "locked") {
                          return (
                            <li key={`locked:${station.index}`} className="memo-path-stop" style={place}>
                              <span className="memo-path-node locked" aria-label={t("exam.path.locked")}>
                                <Msym name="lock" size="1.4rem" fill={false} />
                              </span>
                              {station.index === 0 ? (
                                <span className="memo-path-left">{t("exam.path.lessonsLeft", { count: station.left, target })}</span>
                              ) : null}
                            </li>
                          );
                        }

                        const isNext = station.type === "next";
                        const name = `${t(LESSON_KIND_KEY[station.kind])} · ${topic?.title?.trim() || t("note.untitled")}`;
                        const open = () => (topic ? openLesson(topic, station.kind, isNext && station.check) : undefined);

                        if (isNext) {
                          return (
                            <li key="next" ref={markCurrent} className="memo-path-stop" style={place}>
                              <span className="memo-path-halo" aria-hidden="true" />
                              <button type="button" className="memo-path-node next" aria-label={name} onClick={open}>
                                <Emoji symbol={station.check ? "🎯" : LESSON_KIND_EMOJI[station.kind]} size="2rem" />
                              </button>
                              <span className="memo-exam-station-next memo-path-next">
                                <i>{t("exam.path.nextUp")}</i>
                                {station.check ? t("exam.lesson.check") : t(LESSON_KIND_KEY[station.kind])}
                              </span>
                              <span className={`memo-path-buddy ${pathBuddySide(index)}`}>
                                <MemoBuddy mood="wave" size="4.6rem" />
                              </span>
                            </li>
                          );
                        }

                        // A tick, and the score in green, only where the lesson reached the goal.
                        const scored = station.kind !== "summary";
                        const reached = scored && percent(station.score) >= target;

                        return (
                          <li key={station.id} className="memo-path-stop" style={place}>
                            <button type="button" className="memo-path-node done" aria-label={name} onClick={open}>
                              <Emoji symbol={LESSON_KIND_EMOJI[station.kind]} size="1.75rem" />
                              {reached ? (
                                <span className="memo-path-tick" aria-hidden="true">
                                  <Msym name="check" size="0.85rem" weight={700} />
                                </span>
                              ) : null}
                            </button>
                            <span className="memo-path-label">
                              <span>{t(LESSON_KIND_KEY[station.kind])}</span>
                              {scored ? (
                                <b className={reached ? "good" : undefined}>{t("exam.percent", { percent: percent(station.score) })}</b>
                              ) : null}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  ) : null}
                </section>
              );
            })}

            {/* Astra's mock card: the real exam, tried whenever the learner wants (once there is material to ask from). */}
            {studiable && !archived ? (
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
            ) : null}

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
              {t("exam.progress.days", { count: Math.max(0, detail.daysLeft) })}
            </span>
            <span>
              <b>{detail.history.length}</b>
              {t("exam.progress.lessons", { count: detail.history.length })}
            </span>
          </div>

          {/* The topics as a plain list on the page, a hairline between them. */}
          <section className="memo-exam-progress-list">
            <span className="memo-eyebrow">{t("exam.progress.topics")}</span>
            <ul className="memo-exam-progress-topics">
              {modules.map((module) => {
                const value = percent(module.mastery);

                return (
                  <li key={module.topicId} className={module.unlocked ? undefined : "locked"}>
                    <span className="memo-exam-progress-topic-head">
                      <b>{module.title?.trim() || t("note.untitled")}</b>
                      {module.unlocked ? (
                        <span>{t("exam.percent", { percent: value })}</span>
                      ) : (
                        <Msym name="lock" size="1.1rem" fill={false} />
                      )}
                    </span>
                    <div className="memo-exam-mastery-bar">
                      <div className="memo-progress goal">
                        <div style={{ width: `${value}%` }} />
                      </div>
                      <i style={{ "--goal": `${target}%` } as CSSProperties} aria-hidden="true" />
                    </div>
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
                    {item.locked ? <Msym name="lock" size="1.6rem" fill={false} /> : <Emoji symbol={item.emoji} size="1.6rem" />}
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
                      { method: "PATCH", body: JSON.stringify({ archived: !archived }) },
                      // Archived, it goes where the preps are; brought back, it stays here, open again.
                      () =>
                        archived
                          ? menuSheet.dismiss(() => router.refresh(), { force: true })
                          : navigateWithFeedback(EXAM_PREPS_HREF),
                    )
                  }
                >
                  {archived ? t("exam.dash.unarchive") : t("exam.dash.archive")}
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
