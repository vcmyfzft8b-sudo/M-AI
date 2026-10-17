"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { ExamOral } from "@/components/exams/exam-oral";
import { ExamVoicePicker } from "@/components/exams/exam-voice-picker";
import { storedTutorVoice } from "@/components/exams/use-exam-voice";
import { ExamScreen } from "@/components/exams/exam-screen";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { GaugeDial } from "@/components/exams/target-dial";
import {
  MOCK_MINUTES,
  MOCK_QUESTION_MINUTES,
  mockQuestionCounts,
  ORAL_MINUTES,
  oralQuestionCount,
  wholePercent,
} from "@/lib/exams/exam-model";
import type { MockQuestionForLearner, MockResult } from "@/lib/exams/exams-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { DEFAULT_NOTE_TTS_VOICE, type NoteTtsVoice } from "@/lib/note-tts-settings";
import { currentPaywallBack, paywallPath } from "@/lib/paywall-reasons";

type Attempt = {
  id: string;
  startedAt: string;
  durationMinutes: number;
  mode: "written" | "oral";
  questions: MockQuestionForLearner[];
  /** The note the oral examiner's talking time is counted on. */
  lectureId: string;
};

type Vibe = "strict" | "friendly" | "encouraging";

/* Astra's examiner manners, the strict one recommended. */
const VIBES: { value: Vibe; labelKey: MessageKey; bodyKey: MessageKey }[] = [
  { value: "strict", labelKey: "exam.oral.vibe.strict", bodyKey: "exam.oral.vibe.strictBody" },
  { value: "friendly", labelKey: "exam.oral.vibe.friendly", bodyKey: "exam.oral.vibe.friendlyBody" },
  { value: "encouraging", labelKey: "exam.oral.vibe.encouraging", bodyKey: "exam.oral.vibe.encouragingBody" },
];

type Answer = { selected?: number | null; text?: string; unknown?: boolean };

type Phase =
  | { name: "setup" }
  | { name: "sitting"; attempt: Attempt }
  | { name: "oral"; attempt: Attempt }
  /*
   * Handed in. The answers ride along so that a failed grading can be sent again as they were:
   * `failed` keeps the learner here, with a retry, whenever going back to the questions would not
   * help (an oral mock, or a written one whose clock has already run out).
   */
  | {
      name: "grading";
      attempt: Attempt;
      answers: Record<string, Answer>;
      failed?: boolean;
      closed?: string;
      /* Refused because the prep is archived: back to it, not a new mock it would refuse too. */
      archived?: boolean;
    }
  | { name: "result"; result: MockResult };

function answered(question: MockQuestionForLearner, answer: Answer | undefined) {
  if (!answer) {
    return false;
  }

  if (answer.unknown) {
    return true;
  }

  return question.kind === "choice" ? typeof answer.selected === "number" : Boolean(answer.text?.trim());
}

function clock(seconds: number | null) {
  if (seconds === null) {
    return "--:--";
  }

  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function ExamMock({
  examId,
  examTitle,
  moduleCount,
  passPercentage,
  hasPaidAccess,
  moduleTitles,
  lastResult,
  openAttempt = null,
}: {
  examId: string;
  examTitle: string;
  moduleCount: number;
  passPercentage: number;
  hasPaidAccess: boolean;
  moduleTitles: Record<string, string>;
  lastResult: MockResult | null;
  /** A written mock left mid-way, carried on with; its answers come back from this browser. */
  openAttempt?: Attempt | null;
}) {
  const { t, locale } = useTranslations();
  const { navigateWithFeedback } = useInstantNavigation();
  /* A new function every render; `submit` (and the clock keyed on it) must not change with it. */
  const navigateRef = useRef(navigateWithFeedback);

  useEffect(() => {
    navigateRef.current = navigateWithFeedback;
  });
  const [phase, setPhase] = useState<Phase>(openAttempt ? { name: "sitting", attempt: openAttempt } : { name: "setup" });
  const [mode, setMode] = useState<"written" | "oral">("written");
  const [duration, setDuration] = useState<number>(MOCK_MINUTES.initial);
  const [oralMinutes, setOralMinutes] = useState<number>(ORAL_MINUTES.initial);
  const [voice, setVoice] = useState<NoteTtsVoice>(DEFAULT_NOTE_TTS_VOICE);
  const [vibe, setVibe] = useState<Vibe>("strict");
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  /* Unknown until mounted: a resumed mock renders on the server too, whose clock is not the browser's. */
  const [now, setNow] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [tab, setTab] = useState<"ai" | "answers">("ai");
  const submitting = useRef(false);
  const answersRef = useRef(answers);
  const examHref = `/app/exams/${examId}`;
  const closeConfirm = useCallback(() => setConfirmOpen(false), []);
  const confirmSheet = useSheet(closeConfirm);
  const closeBriefing = useCallback(() => setBriefingOpen(false), []);
  const briefingSheet = useSheet(closeBriefing);
  const counts = mockQuestionCounts(duration);
  const minutes = mode === "oral" ? oralMinutes : duration;
  const minutesFormat = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  /*
   * A written mock's answers are kept in this browser while it is sat, so a reload carries on with
   * them (the page reopens the attempt). Restored once, after mount: the server cannot know them.
   */
  const storageKey = phase.name === "sitting" ? `memo-exam-mock:${phase.attempt.id}` : null;

  useEffect(() => {
    if (!openAttempt) {
      return;
    }

    let saved: Record<string, Answer> | null = null;

    try {
      saved = JSON.parse(window.localStorage.getItem(`memo-exam-mock:${openAttempt.id}`) ?? "null");
    } catch {
      saved = null;
    }

    if (saved) {
      const restored = saved;
      // Back where the learner was: the first question not yet answered.
      const resumeAt = openAttempt.questions.findIndex((question) => !answered(question, restored[question.id]));
      void Promise.resolve().then(() => {
        setAnswers((current) => ({ ...restored, ...current }));
        setIndex(resumeAt >= 0 ? resumeAt : openAttempt.questions.length - 1);
      });
    }
  }, [openAttempt]);

  useEffect(() => {
    if (!storageKey) {
      return;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(answers));
    } catch {
      /* Private mode or a full disk: the answers are still held in memory. */
    }
  }, [answers, storageKey]);



  async function start() {
    if (!hasPaidAccess) {
      navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
      return;
    }

    setStarting(true);
    setError(null);
    setBriefingOpen(false);

    const response = await fetch(`/api/exams/${examId}/mock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        mode === "oral" ? { durationMinutes: oralMinutes, mode, voice, vibe } : { durationMinutes: duration, mode },
      ),
    }).catch(() => null);

    if (response?.status === 402) {
      navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
      return;
    }

    const payload = response?.ok ? ((await response.json()) as { attempt: Attempt }) : null;
    setStarting(false);

    if (!payload) {
      const message = response ? ((await response.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setError(message ?? t("exam.mock.error.start"));
      return;
    }

    setAnswers({});
    setFlags({});
    setIndex(0);
    setNow(Date.now());
    setPhase(
      payload.attempt.mode === "oral"
        ? { name: "oral", attempt: payload.attempt }
        : { name: "sitting", attempt: payload.attempt },
    );
  }

  const submit = useCallback(
    async (attempt: Attempt, current: Record<string, Answer>) => {
      if (submitting.current) {
        return;
      }

      submitting.current = true;
      setConfirmOpen(false);
      setError(null);
      setPhase({ name: "grading", attempt, answers: current });

      const response = await fetch(`/api/exams/${examId}/mock/${attempt.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: attempt.questions.map((question) => ({ questionId: question.id, ...current[question.id] })),
        }),
      }).catch(() => null);
      const payload = response?.ok ? ((await response.json()) as { result: MockResult | null }) : null;
      submitting.current = false;

      // The plan lapsed mid-mock: the paywall, not a retry that can only be refused again.
      if (response?.status === 402) {
        navigateRef.current(paywallPath("exam", examHref));
        return;
      }

      // Too long past its clock (or the prep was archived): this attempt is closed for good, so its
      // saved answers go and the learner starts a new one rather than retrying.
      if (response?.status === 409) {
        const refusal = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
        const expired = refusal?.code === "expired";

        // Only an attempt past its clock is gone for good; an archived prep's keeps its answers, for
        // when the prep is restored while the clock still runs.
        if (expired) {
          try {
            window.localStorage.removeItem(`memo-exam-mock:${attempt.id}`);
          } catch {
            /* Nothing to clean up. */
          }
        }

        setPhase({
          name: "grading",
          attempt,
          answers: current,
          failed: true,
          closed: refusal?.error ?? t("api.exam.mockExpired"),
          archived: !expired,
        });
        return;
      }

      if (!payload?.result) {
        const clockOut = Date.now() >= new Date(attempt.startedAt).getTime() + attempt.durationMinutes * 60_000;

        // Back to the questions only while there is time to use them: the written mock's clock
        // would hand in again at once, and an oral mock's answers exist only here.
        if (attempt.mode === "oral" || clockOut) {
          setPhase({ name: "grading", attempt, answers: current, failed: true });
          return;
        }

        setError(t("exam.mock.error.submit"));
        setPhase({ name: "sitting", attempt });
        return;
      }

      try {
        window.localStorage.removeItem(`memo-exam-mock:${attempt.id}`);
      } catch {
        /* Nothing to clean up. */
      }

      setTab("ai");
      setPhase({ name: "result", result: payload.result });
    },
    [examHref, examId, t],
  );

  const secondsLeft =
    phase.name !== "sitting"
      ? 0
      : now === null
        ? null
        : phase.attempt.durationMinutes * 60 - (now - new Date(phase.attempt.startedAt).getTime()) / 1000;

  /* The clock, and handing in on its own when it runs out. */
  useEffect(() => {
    if (phase.name !== "sitting") {
      return;
    }

    const attempt = phase.attempt;
    const endsAt = new Date(attempt.startedAt).getTime() + attempt.durationMinutes * 60_000;
    const tick = () => {
      const current = Date.now();
      setNow(current);

      if (current >= endsAt) {
        void submit(attempt, answersRef.current);
      }
    };
    // At once, then every second: the clock has no reading until the first tick.
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);

    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [phase, submit]);

  if (phase.name === "setup") {
    /* The last Generalka's score, a way back to its review: under the details on the phone, and
       opposite the way back in the desktop bar, where it does not cost the setup a row. */
    const lastResultLink = lastResult ? (
      <button type="button" className="memo-exam-link" onClick={() => setPhase({ name: "result", result: lastResult })}>
        <Msym name="history" size="1.2rem" fill={false} />
        {/* A percentage grade is the score itself, so it is said once. */}
        {lastResult.grade.endsWith("%")
          ? t("exam.mock.lastPercent", { percent: wholePercent(lastResult.percentage) })
          : t("exam.mock.lastResult", { grade: lastResult.grade, percent: wholePercent(lastResult.percentage) })}
      </button>
    ) : null;

    return (
      <ExamScreen
        className="memo-exam-mock-setup"
        refreshOnBack
        backHref={examHref}
        backLabel={examTitle}
        backIcon="close"
        title={t("exam.mock.title")}
        trailing={lastResultLink}
        cta={
          <button
            type="button"
            className="memo-button-coral"
            disabled={starting}
            onClick={() => (hasPaidAccess && mode === "oral" ? setBriefingOpen(true) : void start())}
          >
            {starting ? t("exam.mock.starting") : hasPaidAccess ? t("exam.mock.start") : t("exam.mock.paid.cta")}
          </button>
        }
      >
        {/* Two columns on desktop (the exam and its length, then its details); one column on the phone. */}
        <div className="memo-exam-mock-main">
          <div className="memo-exam-center">
            <MemoBuddy mood="wave" size="4.5rem" thought={mode === "oral" ? "🗣️" : "📝"} sparkles />
            <h1 className="memo-exam-step-title">{t("exam.mock.setup.title")}</h1>
            <p className="memo-exam-fine">{t("exam.mock.setup.body", { count: moduleCount })}</p>
          </div>

          {/* Astra's two kinds of mock exam. */}
          <div className="memo-segment memo-exam-segment" role="group" aria-label={t("exam.mock.mode.label")}>
            {(["written", "oral"] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={mode === value ? "active" : ""}
                aria-pressed={mode === value}
                onClick={() => {
                  setMode(value);

                  // The tutor's voice is remembered on the device; the examiner starts from it.
                  if (value === "oral") {
                    setVoice(storedTutorVoice());
                  }
                }}
              >
                {t(value === "oral" ? "exam.mock.mode.oral" : "exam.mock.mode.written")}
              </button>
            ))}
          </div>

          {!hasPaidAccess ? (
            <div className="memo-exam-card memo-exam-upsell">
              <b>{t("exam.mock.paid.title")}</b>
              <p>{t("exam.mock.paid.body")}</p>
            </div>
          ) : null}

          {/* The length, on a circular timer. */}
          <GaugeDial
            value={minutes}
            onChange={mode === "oral" ? setOralMinutes : setDuration}
            range={mode === "oral" ? ORAL_MINUTES : MOCK_MINUTES}
            label={t("exam.mock.duration")}
            valueText={t("exam.minutes", { minutes })}
            unit={t("exam.minutesUnit")}
            caption={
              mode === "oral"
                ? t("exam.oral.questions", { count: oralQuestionCount(oralMinutes) })
                : t("exam.mock.questions", { count: counts.choice + counts.written })
            }
          />
        </div>

        <div className="memo-exam-mock-side">
          {mode === "oral" ? (
            <>
              <span className="memo-exam-label">{t("exam.oral.vibe.label")}</span>
              <div className="memo-exam-list">
                {VIBES.map((option) => {
                  const isOn = vibe === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      className={`memo-exam-pick ${isOn ? "on" : ""}`.trim()}
                      aria-pressed={isOn}
                      onClick={() => setVibe(option.value)}
                    >
                      <span className="memo-exam-pick-copy">
                        <b>
                          {t(option.labelKey)}
                          {option.value === "strict" ? (
                            <span className="memo-exam-recommended">{t("exam.oral.recommended")}</span>
                          ) : null}
                        </b>
                        <span>{t(option.bodyKey)}</span>
                      </span>
                      <Msym
                        name={isOn ? "radio_button_checked" : "radio_button_unchecked"}
                        size="1.5rem"
                        fill={isOn}
                        className="memo-exam-pick-mark"
                      />
                    </button>
                  );
                })}
              </div>
              {/* The tutor's own voice picker: each voice in its colour, and a tap plays it. */}
              <span className="memo-exam-label">{t("exam.oral.voice")}</span>
              <ExamVoicePicker voice={voice} onChange={setVoice} label={t("exam.oral.voice")} />
            </>
          ) : (
            <div className="memo-exam-card memo-exam-facts">
              {/* The questions fill the time set: how long each kind takes, as the timer counts it. */}
              <div>
                <Msym name="quiz" size="1.3rem" fill={false} />
                <span>
                  {t("exam.mock.choice")}
                  <small>{t("exam.mock.perQuestion", { minutes: minutesFormat.format(MOCK_QUESTION_MINUTES.choice) })}</small>
                </span>
                <b>{counts.choice}</b>
              </div>
              <div>
                <Msym name="edit" size="1.3rem" fill={false} />
                <span>
                  {t("exam.mock.written")}
                  <small>{t("exam.mock.perQuestion", { minutes: minutesFormat.format(MOCK_QUESTION_MINUTES.written) })}</small>
                </span>
                <b>{counts.written}</b>
              </div>
              <div>
                <Msym name="flag" size="1.3rem" fill={false} />
                <span>{t("exam.mock.pass")}</span>
                <b>{t("exam.percent", { percent: passPercentage })}</b>
              </div>
            </div>
          )}

          {error ? <p className="memo-inline-error">{error}</p> : null}

          {lastResultLink}
        </div>

        {/* Astra's instructions before an oral exam, ending in "I'm ready". */}
        {briefingOpen ? (
          <MemoPortal>
            <button
              type="button"
              aria-label={t("common.close")}
              className={sheetClass("memo-scrim", briefingSheet.closing)}
              onClick={() => briefingSheet.dismiss()}
            />
            <div
              className={sheetClass("memo-sheet memo-dialog", briefingSheet.closing)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="exam-oral-briefing"
              {...briefingSheet.dragProps}
            >
              <div className="memo-grab" data-drag-handle />
              <div className="memo-sheet-title">
                <span id="exam-oral-briefing">{t("exam.oral.briefing.title")}</span>
                <button type="button" className="memo-sheet-close" aria-label={t("common.close")} onClick={() => briefingSheet.dismiss()}>
                  <Msym name="close" size="1.45rem" fill={false} weight={500} />
                </button>
              </div>
              <ul className="memo-exam-briefing">
                <li>
                  <Msym name="mic" size="1.3rem" fill={false} /> {t("exam.oral.briefing.mic")}
                </li>
                <li>
                  <Msym name="record_voice_over" size="1.3rem" fill={false} /> {t("exam.oral.briefing.turns")}
                </li>
                <li>
                  <Msym name="timer" size="1.3rem" fill={false} /> {t("exam.oral.briefing.time", { minutes: oralMinutes })}
                </li>
                <li>
                  <Msym name="school" size="1.3rem" fill={false} /> {t("exam.oral.briefing.grade")}
                </li>
              </ul>
              <div className="memo-sheet-actions">
                <button type="button" className="memo-sheet-coral" disabled={starting} onClick={() => void start()}>
                  {starting ? t("exam.mock.starting") : t("exam.oral.ready")}
                </button>
              </div>
            </div>
          </MemoPortal>
        ) : null}
      </ExamScreen>
    );
  }

  if (phase.name === "oral") {
    const { attempt } = phase;

    return (
      <ExamScreen refreshOnBack backHref={examHref} backLabel={examTitle} backIcon="close" title={t("exam.mock.mode.oral")}>
        <ExamOral
          examId={examId}
          attemptId={attempt.id}
          lectureId={attempt.lectureId}
          questions={attempt.questions.map((question) => ({ id: question.id, prompt: question.prompt }))}
          durationMinutes={attempt.durationMinutes}
          voice={voice}
          onDone={(spoken) =>
            void submit(
              attempt,
              Object.fromEntries(
                attempt.questions.map((question) => [
                  question.id,
                  spoken[question.id]?.trim() ? { text: spoken[question.id] } : { unknown: true },
                ]),
              ),
            )
          }
          onQuit={() => setPhase({ name: "setup" })}
        />
      </ExamScreen>
    );
  }

  if (phase.name === "grading") {
    const { attempt, answers: handedIn } = phase;

    if (phase.failed) {
      return (
        <ExamScreen
          refreshOnBack
          backHref={examHref}
          backLabel={examTitle}
          backIcon="close"
          title={t("exam.mock.title")}
          cta={
            phase.closed && phase.archived ? (
              <button
                type="button"
                className="memo-button-coral"
                onClick={() => navigateWithFeedback(examHref, { refresh: true })}
              >
                {t("exam.zone.continue")}
              </button>
            ) : phase.closed ? (
              <button type="button" className="memo-button-coral" onClick={() => setPhase({ name: "setup" })}>
                {t("exam.mock.start")}
              </button>
            ) : (
              <button type="button" className="memo-button-coral" onClick={() => void submit(attempt, handedIn)}>
                {t("common.retry")}
              </button>
            )
          }
        >
          <div className="memo-exam-center memo-exam-loading memo-exam-grading" role="alert">
            <MemoBuddy mood="sad" size="6.5rem" />
            <h2>{t("exam.mock.gradingFailed.title")}</h2>
            <p className="memo-exam-loading-line">{phase.closed ?? t("exam.mock.gradingFailed.body")}</p>
          </div>
        </ExamScreen>
      );
    }

    return (
      <ExamScreen
        refreshOnBack
        backHref={examHref}
        backLabel={examTitle}
        backIcon="close"
        title={t("exam.mock.title")}
      >
        {/* The lesson's loader, word for word in its layout: Memo, what he is doing, a line, a bar. */}
        <div className="memo-exam-center memo-exam-loading memo-exam-grading" role="status" aria-live="polite">
          <MemoBuddy mood="think" size="6.5rem" thought="📝" />
          <h2>{t("exam.mock.grading.title")}</h2>
          <p className="memo-exam-loading-line">{t("exam.mock.grading.body")}</p>
          <span className="memo-gen-track memo-exam-loading-track" aria-hidden="true">
            <span />
          </span>
        </div>
      </ExamScreen>
    );
  }

  if (phase.name === "result") {
    const { result } = phase;
    const weakTitle = result.weakestLectureId ? moduleTitles[result.weakestLectureId] : null;

    return (
      <ExamScreen
        refreshOnBack
        backHref={examHref}
        backLabel={examTitle}
        backIcon="close"
        title={t("exam.mock.result.title")}
        cta={
          <div className="memo-exam-cta-row">
            <button type="button" className="memo-button-ghost" onClick={() => setPhase({ name: "setup" })}>
              {t("exam.mock.result.retry")}
            </button>
            {/* Astra's "Continue": back to the path, which now shows what the mock found weak. */}
            <button type="button" className="memo-button-coral" onClick={() => navigateWithFeedback(examHref, { refresh: true })}>
              {t("exam.mock.result.continue")}
            </button>
          </div>
        }
      >
        <div className="memo-exam-result-head">
          <MemoBuddy mood={result.passed ? "cheer" : "sad"} size="6rem" sparkles={result.passed} />
          <div>
            <span className="memo-eyebrow">{t("exam.mock.title")}</span>
            <h1>{t("exam.mock.result.grade", { grade: result.grade })}</h1>
            <p>
              {/*
               * Floored, as every score shown beside a pass mark is: 89.6 % must not read as 90 %. On a
               * percent grading scale the grade above already is the percentage: the points alone here.
               */}
              {result.grade.trim().endsWith("%")
                ? null
                : `${t("exam.percent", { percent: wholePercent(result.percentage) })} · `}
              {t("exam.mock.result.points", { score: Math.round(result.totalScore * 10) / 10, count: result.maxScore })}
            </p>
          </div>
        </div>

        <div className="memo-exam-card memo-exam-facts">
          <div>
            <Msym name="timer" size="1.3rem" fill={false} />
            <span>{t("exam.mock.duration")}</span>
            <b>{t("exam.mock.result.time", { used: result.minutesUsed, total: result.durationMinutes })}</b>
          </div>
          <div>
            <Msym name="flag" size="1.3rem" fill={false} />
            <span>{t("exam.mock.pass")}</span>
            {/* The mark itself, and whether this mock reached it ("50 % · še ne"). */}
            <b>
              {t(result.passed ? "exam.mock.result.passed" : "exam.mock.result.failed", {
                percent: wholePercent(passPercentage),
              })}
            </b>
          </div>
        </div>

        <div className="memo-segment memo-exam-segment">
          <button type="button" className={tab === "ai" ? "active" : ""} aria-pressed={tab === "ai"} onClick={() => setTab("ai")}>
            {t("exam.mock.result.aiReview")}
          </button>
          <button type="button" className={tab === "answers" ? "active" : ""} aria-pressed={tab === "answers"} onClick={() => setTab("answers")}>
            {t("exam.mock.result.answers")}
          </button>
        </div>

        {tab === "ai" ? (
          <div className="memo-exam-feedback">
            <div className="memo-exam-feedback-block good">
              <b>
                <Msym name="thumb_up" size="1.1rem" /> {t("exam.mock.result.strengths")}
              </b>
              {result.strengths.length > 0 ? (
                result.strengths.map((line) => <p key={line}>{line}</p>)
              ) : (
                <p>{t("exam.mock.result.noStrengths")}</p>
              )}
            </div>
            <div className="memo-exam-feedback-block weak">
              <b>
                <Msym name="error" size="1.1rem" /> {t("exam.mock.result.weak")}
              </b>
              {result.weakPoints.length > 0 ? (
                result.weakPoints.map((line) => <p key={line}>{line}</p>)
              ) : (
                <p>{t("exam.mock.result.noWeak")}</p>
              )}
            </div>
            <div className="memo-exam-feedback-block tip">
              <b>
                <Msym name="lightbulb" size="1.1rem" /> {t("exam.mock.result.recs")}
              </b>
              <p>{weakTitle ? t("exam.mock.result.recsBody", { title: weakTitle }) : t("exam.mock.result.recsDone")}</p>
            </div>
          </div>
        ) : (
          <ol className="memo-exam-answers">
            {result.items.map((item, itemIndex) => {
              const right = item.answer.maxScore > 0 && item.answer.score >= item.answer.maxScore * 0.6;
              const yourAnswer =
                item.question.kind === "choice"
                  ? typeof item.answer.selected === "number"
                    ? item.question.options[item.answer.selected]
                    : null
                  : item.answer.text?.trim() || null;

              return (
                <li key={item.question.id} className={right ? "right" : "wrong"}>
                  <div className="memo-exam-answers-head">
                    <span>{t("exam.mock.question", { index: itemIndex + 1, total: result.items.length })}</span>
                    <b>
                      {item.answer.marked
                        ? t("exam.mock.result.points", { score: item.answer.score, count: item.answer.maxScore })
                        : t("test.notMarked")}
                    </b>
                  </div>
                  <p className="memo-exam-answers-q">{item.question.prompt}</p>
                  <p>
                    <span className="memo-palace-model-label">{t("exam.mock.result.yourAnswer")}</span>
                    {item.answer.unknown ? t("test.dontKnow") : (yourAnswer ?? t("exam.mock.result.noAnswer"))}
                  </p>
                  {item.question.kind === "choice" && item.correctIndex !== null ? (
                    <p>
                      <span className="memo-palace-model-label">{t("exam.mock.result.correct")}</span>
                      {item.question.options[item.correctIndex]}
                    </p>
                  ) : item.answer.expectedAnswer ? (
                    <p>
                      <span className="memo-palace-model-label">{t("test.expectedAnswer")}</span>
                      {item.answer.expectedAnswer}
                    </p>
                  ) : null}
                  {item.answer.missingPoints ? (
                    <p>
                      <span className="memo-palace-model-label">{t("test.missing")}</span>
                      {item.answer.missingPoints}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </ExamScreen>
    );
  }

  const { attempt } = phase;
  const question = attempt.questions[index];
  const current = answers[question.id] ?? {};
  const answeredCount = attempt.questions.filter((entry) => answered(entry, answers[entry.id])).length;
  const unanswered = attempt.questions.length - answeredCount;
  const flagged = attempt.questions.filter((entry) => flags[entry.id]).length;
  const isLast = index === attempt.questions.length - 1;
  const setAnswer = (patch: Answer) =>
    setAnswers((existing) => ({ ...existing, [question.id]: { ...existing[question.id], ...patch } }));

  return (
    <ExamScreen
      refreshOnBack
      backHref={examHref}
      backLabel={examTitle}
      backIcon="close"
      title={clock(secondsLeft)}
      trailing={
        <button
          type="button"
          className={`memo-close-button ${flags[question.id] ? "memo-exam-flagged" : ""}`.trim()}
          aria-pressed={Boolean(flags[question.id])}
          aria-label={t("exam.mock.flag")}
          onClick={() => setFlags((existing) => ({ ...existing, [question.id]: !existing[question.id] }))}
        >
          <Msym name="flag" size="1.35rem" fill={Boolean(flags[question.id])} weight={500} />
        </button>
      }
      cta={
        <div className="memo-exam-cta-row">
          <button type="button" className="memo-button-ghost" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            {t("common.back")}
          </button>
          {isLast ? (
            <button type="button" className="memo-button-coral" onClick={() => setConfirmOpen(true)}>
              {t("exam.mock.submit")}
            </button>
          ) : (
            <button type="button" className="memo-primary-pill memo-exam-next" onClick={() => setIndex(index + 1)}>
              {t("exam.mock.next")}
            </button>
          )}
        </div>
      }
    >
      <div className="memo-panel study memo-exam-lesson">
        {/* Where the learner is, headed and counted as the lessons' questions are, over one bar. */}
        <div className="memo-quiz-head">
          <span className="memo-quiz-count">
            {t("quiz.questionN", { index: index + 1 })}
            <span className="memo-exam-mock-points">
              {" · "}
              {question.kind === "choice" ? t("exam.mock.points", { count: 1 }) : t("exam.mock.points", { count: 5 })}
            </span>
          </span>
          <span className="memo-quiz-total">
            {index + 1} / {attempt.questions.length}
          </span>
        </div>
        <div
          className="memo-progress quiz"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={attempt.questions.length}
          aria-valuenow={index + 1}
          aria-label={t("exam.mock.question", { index: index + 1, total: attempt.questions.length })}
        >
          <div style={{ width: `${Math.round(((index + 1) / attempt.questions.length) * 100)}%` }} />
        </div>

        {question.kind === "choice" ? (
          <div className="lecture-quiz-card">
            <span className="memo-quiz-eyebrow">{t("quiz.chooseOne")}</span>
            <p className="lecture-quiz-prompt">{question.prompt}</p>
            <div className="lecture-quiz-options">
              {question.options.map((option, optionIndex) => (
                <button
                  key={`${question.id}-${optionIndex}`}
                  type="button"
                  className={`lecture-quiz-option ${current.selected === optionIndex ? "selected" : ""}`}
                  aria-pressed={current.selected === optionIndex}
                  onClick={() => setAnswer({ selected: optionIndex, unknown: false })}
                >
                  <span className="lecture-quiz-option-label">{String.fromCharCode(65 + optionIndex)}</span>
                  <span className="lecture-quiz-option-copy">{option}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="lecture-practice-stage">
            <p className="lecture-practice-prompt">{question.prompt}</p>
            <textarea
              id={`exam-mock-answer-${question.id}`}
              value={current.text ?? ""}
              disabled={Boolean(current.unknown)}
              onChange={(event) => setAnswer({ text: event.target.value })}
              aria-label={t("test.yourAnswer")}
              className="ios-textarea lecture-practice-textarea"
              placeholder={t("test.answerPlaceholder")}
            />
            <div className="lecture-practice-controls">
              <label className="lecture-practice-unknown">
                <input
                  type="checkbox"
                  checked={Boolean(current.unknown)}
                  onChange={(event) => setAnswer({ unknown: event.target.checked })}
                />
                {t("test.dontKnow")}
              </label>
            </div>
          </div>
        )}
        {error ? <p className="memo-inline-error">{error}</p> : null}
      </div>

      {confirmOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", confirmSheet.closing)}
            onClick={() => confirmSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet memo-dialog", confirmSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="exam-submit-title"
            {...confirmSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <div className="memo-sheet-title">
              <span id="exam-submit-title">{t("exam.mock.submitSheet.title")}</span>
              <button type="button" className="memo-sheet-close" aria-label={t("common.close")} onClick={() => confirmSheet.dismiss()}>
                <Msym name="close" size="1.45rem" fill={false} weight={500} />
              </button>
            </div>
            <div className="memo-exam-card memo-exam-facts">
              <div>
                <Msym name="check_circle" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.answered")}</span>
                <b>
                  {answeredCount} / {attempt.questions.length}
                </b>
              </div>
              <div>
                <Msym name="radio_button_unchecked" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.unanswered")}</span>
                <b>{unanswered}</b>
              </div>
              <div>
                <Msym name="flag" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.flagged")}</span>
                <b>{flagged}</b>
              </div>
              <div>
                <Msym name="timer" size="1.3rem" fill={false} />
                <span>{t("exam.mock.submitSheet.left")}</span>
                <b>{clock(secondsLeft)}</b>
              </div>
            </div>
            <div className="memo-sheet-actions">
              <button type="button" className="memo-sheet-coral" onClick={() => void submit(attempt, answers)}>
                {t("exam.mock.submit")}
              </button>
              <button type="button" className="memo-sheet-ghost" onClick={() => confirmSheet.dismiss()}>
                {t("exam.mock.submitSheet.back")}
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      <p className="memo-exam-fine memo-exam-sitting-note">
        <Emoji symbol="⏱️" size="1rem" /> {t("exam.mock.sittingNote")}
      </p>
    </ExamScreen>
  );
}
