"use client";

import { Nunito } from "next/font/google";
import { useEffect, useMemo, useRef, useState } from "react";

import { SCALE_LABEL, useExamFormat } from "@/components/exam-prep/exam-format";
import {
  MascotFigure,
  MascotPedestal,
  MascotSparkles,
  SpeechBubble,
} from "@/components/onboarding-mascot";
import { ViewportPortal } from "@/components/viewport-portal";
import { addDays, dayKeyAt, diffDays, isDayKey } from "@/lib/exam-prep/dates";
import {
  defaultTargetPercent,
  GRADE_SCALE_IDS,
  targetGradeOptions,
  type GradeScaleId,
} from "@/lib/exam-prep/grade-scales";
import type {
  ExamNoteOption,
  ExamPlanPayload,
  ExamTypeId,
} from "@/lib/exam-prep/model";
import { EXAM_MAX_DAYS_AHEAD, EXAM_MAX_NOTES, EXAM_TITLE_MAX } from "@/lib/exam-prep/schema";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { noteEmoji } from "@/lib/note-emoji";

const NUNITO = Nunito({ subsets: ["latin", "latin-ext"], display: "swap" });

type StepId = "welcome" | "date" | "notes" | "type" | "grade" | "time" | "making";

const DATE_CHOICES = [7, 14, 21, 30] as const;

const TYPE_CHOICES: Array<{ id: ExamTypeId; icon: string; label: MessageKey; desc: MessageKey }> = [
  { id: "written", icon: "✍️", label: "exam.type.written", desc: "exam.type.written.hint" },
  { id: "multiple_choice", icon: "🔘", label: "exam.type.multiple_choice", desc: "exam.type.multiple_choice.hint" },
  { id: "problem_solving", icon: "🧮", label: "exam.type.problem_solving", desc: "exam.type.problem_solving.hint" },
  { id: "oral", icon: "🗣️", label: "exam.type.oral", desc: "exam.type.oral.hint" },
  { id: "mixed", icon: "🧩", label: "exam.type.mixed", desc: "exam.type.mixed.hint" },
];

const TIME_CHOICES: Array<{ minutes: number; icon: string; desc: MessageKey }> = [
  { minutes: 15, icon: "🌱", desc: "exam.ob.time15" },
  { minutes: 30, icon: "📘", desc: "exam.ob.time30" },
  { minutes: 45, icon: "🔥", desc: "exam.ob.time45" },
  { minutes: 60, icon: "🚀", desc: "exam.ob.time60" },
  { minutes: 90, icon: "🏆", desc: "exam.ob.time90" },
];

/** What most learners aim for on each scale, as the starting point. */
const DEFAULT_TARGET: Record<GradeScaleId, string> = {
  ten_point: "8",
  five_point: "4",
  letter: "B",
  percent: "70",
  pass_fail: "pass",
};

/** How long the "making your plan" rows take to tick, so the moment reads. */
const MAKING_ROW_MS = 650;
const TYPE_MS = 18;

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Ljubljana";
  } catch {
    return "Europe/Ljubljana";
  }
}

function prefersCalm() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export interface ExamOnboardingProps {
  lectureId: string;
  lectureTitle: string;
  notes: ExamNoteOption[];
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  defaultScale?: GradeScaleId;
  /** Editing an existing plan: no welcome, every answer filled in. */
  initialPlan?: ExamPlanPayload["plan"] | null;
  onClose: () => void;
  onSaved: (planId: string) => void;
}

/**
 * Planning an exam from a note, as the app's onboarding asks things: Memo on
 * his pedestal asks one question at a time in a speech bubble, the answers are
 * the onboarding's 3D chips, and the coral button with its lip moves on.
 */
export function ExamOnboarding({
  lectureId,
  lectureTitle,
  notes,
  hasPaidAccess,
  trialLectureId,
  defaultScale = "ten_point",
  initialPlan = null,
  onClose,
  onSaved,
}: ExamOnboardingProps) {
  const format = useExamFormat();
  const { t, locale, longDate, grade, weekdayNames } = format;
  const editing = Boolean(initialPlan);
  const today = useMemo(() => dayKeyAt(Date.now(), browserTimeZone()), []);

  const otherNotes = notes.filter(
    (note) => note.id !== lectureId && (hasPaidAccess || note.id === trialLectureId),
  );
  const steps: StepId[] = [
    ...(editing ? [] : (["welcome"] as StepId[])),
    "date",
    ...(otherNotes.length > 0 ? (["notes"] as StepId[]) : []),
    "type",
    "grade",
    "time",
    "making",
  ];

  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [examDate, setExamDate] = useState(initialPlan?.examDate ?? "");
  const [customDate, setCustomDate] = useState(
    Boolean(initialPlan && !DATE_CHOICES.some((days) => addDays(today, days) === initialPlan.examDate)),
  );
  const [lectureIds, setLectureIds] = useState<string[]>(initialPlan?.lectureIds ?? [lectureId]);
  const [examType, setExamType] = useState<ExamTypeId | null>(initialPlan?.examType ?? null);
  const [gradeScale, setGradeScale] = useState<GradeScaleId>(initialPlan?.gradeScale ?? defaultScale);
  const [targetGrade, setTargetGrade] = useState(
    initialPlan?.targetGrade ?? DEFAULT_TARGET[initialPlan?.gradeScale ?? defaultScale],
  );
  const [targetPercent, setTargetPercent] = useState<number>(
    initialPlan?.targetPercent ??
      defaultTargetPercent(defaultScale, DEFAULT_TARGET[defaultScale], locale) ??
      70,
  );
  const [dailyMinutes, setDailyMinutes] = useState<number | null>(initialPlan?.dailyMinutes ?? null);
  const [restDays, setRestDays] = useState(initialPlan?.restDays ?? 0);
  const [made, setMade] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const step = steps[index];
  const daysUntil = isDayKey(examDate) ? diffDays(today, examDate) : -1;
  const dateValid = daysUntil >= 1 && daysUntil <= EXAM_MAX_DAYS_AHEAD;
  const gradeOptions = targetGradeOptions(gradeScale, locale);
  const gradeIndex = Math.max(0, gradeOptions.findIndex((option) => option.label === targetGrade));

  const bubble = (() => {
    switch (step) {
      case "welcome":
        return t("exam.ob.welcome");
      case "date":
        return t("exam.ob.qDate");
      case "notes":
        return t("exam.ob.qNotes");
      case "type":
        return t("exam.ob.qType");
      case "grade":
        return t("exam.ob.qGrade");
      case "time":
        return t("exam.ob.qTime");
      case "making":
        return savedId ? t("exam.ob.ready") : t("exam.ob.making");
    }
  })();

  // Memo types his line out, as he does in the onboarding.
  useEffect(() => {
    if (typed >= bubble.length) {
      return;
    }

    const id = window.setTimeout(
      () => setTyped((value) => (prefersCalm() ? bubble.length : Math.min(bubble.length, value + 1))),
      TYPE_MS,
    );

    return () => window.clearTimeout(id);
  }, [bubble, typed]);

  // The plan is saved while the rows tick; the last one waits for the server.
  useEffect(() => {
    if (step !== "making" || made >= 3 || (made === 2 && !savedId)) {
      return;
    }

    const id = window.setTimeout(() => setMade((value) => value + 1), MAKING_ROW_MS);
    return () => window.clearTimeout(id);
  }, [made, savedId, step]);

  function go(next: number) {
    setTyped(0);
    setError(null);
    setIndex(next);
  }

  async function save() {
    if (savingRef.current) {
      return;
    }

    savingRef.current = true;
    setError(null);
    const body = {
      title: (initialPlan?.title ?? lectureTitle).slice(0, EXAM_TITLE_MAX),
      examDate,
      examType: examType ?? "written",
      gradeScale,
      targetGrade,
      targetPercent,
      dailyMinutes: dailyMinutes ?? 30,
      restDays,
      lectureIds,
    };

    try {
      const response = await fetch(editing ? `/api/exams/${initialPlan?.id}` : "/api/exams", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? body : { ...body, timeZone: browserTimeZone() }),
      });
      const json = (await response.json().catch(() => ({}))) as { id?: string; error?: string };

      if (!response.ok) {
        throw new Error(json.error ?? t("exam.error.save"));
      }

      setTyped(0);
      setSavedId(editing ? (initialPlan?.id ?? null) : (json.id ?? null));
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("exam.error.save"));
    } finally {
      savingRef.current = false;
    }
  }

  function next() {
    if (step === "making") {
      if (savedId && made >= 3) {
        onSaved(savedId);
      } else if (error) {
        void save();
      }

      return;
    }

    const nextIndex = index + 1;
    go(nextIndex);

    if (steps[nextIndex] === "making") {
      setMade(0);
      void save();
    }
  }

  function back() {
    if (step === "making" && !error) {
      return;
    }

    if (index === 0) {
      onClose();
      return;
    }

    go(index - 1);
  }

  function chooseScale(scale: GradeScaleId) {
    setGradeScale(scale);
    const label = DEFAULT_TARGET[scale];
    setTargetGrade(label);
    setTargetPercent(defaultTargetPercent(scale, label, locale) ?? 70);
  }

  function stepGrade(delta: number) {
    const option = gradeOptions[Math.min(gradeOptions.length - 1, Math.max(0, gradeIndex + delta))];

    if (option) {
      setTargetGrade(option.label);
      setTargetPercent(defaultTargetPercent(gradeScale, option.label, locale) ?? targetPercent);
    }
  }

  const ready: Record<StepId, boolean> = {
    welcome: true,
    date: dateValid,
    notes: lectureIds.length > 0,
    type: examType !== null,
    grade: targetPercent > 0 && targetPercent <= 100,
    time: dailyMinutes !== null,
    making: Boolean(error) || (Boolean(savedId) && made >= 3),
  };

  const ctaLabel =
    step === "welcome"
      ? t("exam.ob.start")
      : step === "time"
        ? editing
          ? t("common.save")
          : t("exam.ob.makePlan")
        : step === "making"
          ? error
            ? t("common.retry")
            : t("exam.ob.open")
          : t("common.continue");

  const progress = Math.round(((index + 1) / steps.length) * 100);
  const isHero = step === "welcome" || step === "making";
  const makingRows = [t("exam.ob.makingRow1"), t("exam.ob.makingRow2"), t("exam.ob.makingRow3")];

  const mascot = (
    <>
      <MascotPedestal hero={isHero} />
      {isHero ? <MascotSparkles /> : null}
    </>
  );

  return (
    <ViewportPortal>
      <div
        className={`memo-onboarding-v2 memo-exam-ob ${NUNITO.className}`}
        role="dialog"
        aria-modal="true"
        aria-label={t("exam.ob.dialogLabel")}
      >
        <div className="memo-exam-ob-shell">
          <div className="memo-exam-ob-mesh" aria-hidden="true" />
          <header className="memo-exam-ob-head">
            <button
              type="button"
              className="memo-exam-ob-back"
              onClick={back}
              aria-label={index === 0 ? t("common.close") : t("onboarding.previousStep")}
            >
              <span aria-hidden="true" />
            </button>
            <div
              className="memo-exam-ob-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t("onboarding.progressLabel")}
            >
              <div style={{ width: `${progress}%` }} />
            </div>
          </header>

          <div className="memo-exam-ob-body">
            <div className="memo-exam-ob-col">
              {isHero ? (
                <div className="memo-exam-ob-hero memo-exam-ob-step" key={step}>
                  <SpeechBubble
                    text={bubble}
                    typed={typed}
                    tail="down"
                    style={{ maxWidth: "min(26rem, 100%)", margin: "0 0 0.6rem", padding: "clamp(0.85rem, 2.2vh, 1.1rem) clamp(1.1rem, 4vw, 1.5rem)" }}
                    textStyle={{ fontSize: "clamp(1.2rem, min(5.4vw, 3.4vh), 1.65rem)", lineHeight: "1.3", textWrap: "balance" }}
                  />
                  <div className="memo-exam-ob-hero-figure">
                    {mascot}
                    <div className="memo-exam-ob-bob">
                      <div className="memo-exam-ob-breathe">
                        <MascotFigure lash={3} />
                      </div>
                    </div>
                  </div>
                  {step === "welcome" ? (
                    <p className="memo-exam-ob-lead">{t("exam.ob.welcomeSub", { note: lectureTitle })}</p>
                  ) : (
                    <div className="memo-exam-ob-rows" aria-live="polite">
                      {makingRows.map((label, row) => (
                        <div
                          key={label}
                          className={`memo-exam-ob-row ${made > row ? "done" : made < row ? "waiting" : ""}`.trim()}
                        >
                          <span aria-hidden="true">{made > row ? "✓" : ""}</span>
                          <span>{label}</span>
                        </div>
                      ))}
                      {error ? <p className="memo-exam-ob-error" role="alert">{error}</p> : null}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="memo-exam-ob-ask">
                    <div className="memo-exam-ob-rider">
                      {mascot}
                      <div className="memo-exam-ob-figure">
                        <div className="memo-exam-ob-breathe">
                          <MascotFigure />
                        </div>
                      </div>
                    </div>
                    <SpeechBubble
                      text={bubble}
                      typed={typed}
                      tail="left"
                      style={{ zIndex: 1, flex: "1 1 auto", minWidth: 0, padding: "clamp(0.8rem, 2.2vh, 1.15rem) clamp(1rem, 3.4vw, 1.4rem)" }}
                      textStyle={{ fontSize: "clamp(1.05rem, min(4.6vw, 3vh), 1.45rem)", lineHeight: "1.38", textWrap: "pretty" }}
                    />
                  </div>

                  <div className="memo-exam-ob-step" key={step}>
                    {step === "date" ? (
                      <>
                        <p className="memo-exam-ob-sub">{t("exam.ob.subDate")}</p>
                        <div className="memo-exam-ob-options" role="radiogroup" aria-label={t("exam.ob.qDate")}>
                          {DATE_CHOICES.map((days, option) => {
                            const day = addDays(today, days);
                            const on = !customDate && examDate === day;
                            return (
                              <button
                                key={days}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                className="memo-exam-ob-option"
                                style={{ animationDelay: `${40 + option * 55}ms` }}
                                onClick={() => {
                                  setCustomDate(false);
                                  setExamDate(day);
                                }}
                              >
                                <span className="memo-exam-ob-icon" aria-hidden="true">
                                  {days === 7 ? "⚡" : days === 14 ? "📅" : days === 21 ? "🗓️" : "🌙"}
                                </span>
                                <span className="memo-exam-ob-copy">
                                  <strong>
                                    {days === 30
                                      ? t("exam.create.inMonth")
                                      : t("exam.create.inWeeks", { count: days / 7 })}
                                  </strong>
                                  <span>{longDate(day)}</span>
                                </span>
                                {on ? <span className="memo-exam-ob-check" aria-hidden="true">✓</span> : null}
                              </button>
                            );
                          })}
                          <button
                            type="button"
                            role="radio"
                            aria-checked={customDate}
                            className="memo-exam-ob-option"
                            style={{ animationDelay: "260ms" }}
                            onClick={() => {
                              setCustomDate(true);

                              if (!dateValid) {
                                setExamDate(addDays(today, 10));
                              }
                            }}
                          >
                            <span className="memo-exam-ob-icon" aria-hidden="true">✏️</span>
                            <span className="memo-exam-ob-copy">
                              <strong>{t("exam.ob.pickDate")}</strong>
                              <span>
                                {customDate && dateValid ? longDate(examDate) : t("exam.ob.pickDateSub")}
                              </span>
                            </span>
                            {customDate ? <span className="memo-exam-ob-check" aria-hidden="true">✓</span> : null}
                          </button>
                        </div>
                        {customDate ? (
                          <input
                            className="memo-exam-ob-date"
                            type="date"
                            value={examDate}
                            min={addDays(today, 1)}
                            max={addDays(today, EXAM_MAX_DAYS_AHEAD)}
                            aria-label={t("exam.create.dateLabel")}
                            onChange={(event) => setExamDate(event.target.value)}
                          />
                        ) : null}
                      </>
                    ) : null}

                    {step === "notes" ? (
                      <>
                        <p className="memo-exam-ob-sub">{t("exam.ob.subNotes")}</p>
                        <div className="memo-exam-ob-options" role="group" aria-label={t("exam.ob.qNotes")}>
                          {[
                            notes.find((note) => note.id === lectureId) ?? {
                              id: lectureId,
                              title: lectureTitle,
                              sourceType: null,
                              status: "ready",
                            },
                            ...otherNotes,
                          ].map((note, option) => {
                            const isThis = note.id === lectureId;
                            const on = lectureIds.includes(note.id);
                            return (
                              <button
                                key={note.id}
                                type="button"
                                aria-pressed={on}
                                disabled={isThis}
                                className="memo-exam-ob-option"
                                style={{ animationDelay: `${40 + Math.min(option, 8) * 55}ms` }}
                                onClick={() =>
                                  setLectureIds((current) =>
                                    current.includes(note.id)
                                      ? current.filter((id) => id !== note.id)
                                      : current.length >= EXAM_MAX_NOTES
                                        ? current
                                        : [...current, note.id],
                                  )
                                }
                              >
                                <span className="memo-exam-ob-icon" aria-hidden="true">
                                  {noteEmoji({ id: note.id, title: note.title, source_type: note.sourceType })}
                                </span>
                                <span className="memo-exam-ob-copy">
                                  <strong>{note.title || t("note.untitled")}</strong>
                                  {isThis ? <span>{t("exam.ob.thisNote")}</span> : null}
                                </span>
                                {on ? <span className="memo-exam-ob-check" aria-hidden="true">✓</span> : null}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : null}

                    {step === "type" ? (
                      <>
                        <p className="memo-exam-ob-sub">{t("exam.ob.subType")}</p>
                        <div className="memo-exam-ob-options" role="radiogroup" aria-label={t("exam.ob.qType")}>
                          {TYPE_CHOICES.map((choice, option) => (
                            <button
                              key={choice.id}
                              type="button"
                              role="radio"
                              aria-checked={examType === choice.id}
                              className="memo-exam-ob-option"
                              style={{ animationDelay: `${40 + option * 55}ms` }}
                              onClick={() => setExamType(choice.id)}
                            >
                              <span className="memo-exam-ob-icon" aria-hidden="true">{choice.icon}</span>
                              <span className="memo-exam-ob-copy">
                                <strong>{t(choice.label)}</strong>
                                <span>{t(choice.desc)}</span>
                              </span>
                              {examType === choice.id ? (
                                <span className="memo-exam-ob-check" aria-hidden="true">✓</span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : null}

                    {step === "grade" ? (
                      <>
                        <div className="memo-exam-ob-chips" role="radiogroup" aria-label={t("exam.create.scaleLabel")}>
                          {GRADE_SCALE_IDS.map((scale) => (
                            <button
                              key={scale}
                              type="button"
                              role="radio"
                              aria-checked={gradeScale === scale}
                              className="memo-exam-ob-chip"
                              onClick={() => chooseScale(scale)}
                            >
                              {t(SCALE_LABEL[scale])}
                            </button>
                          ))}
                        </div>
                        <div className="memo-exam-ob-grade">
                          <p className="memo-exam-ob-sub flush">{t("exam.ob.subGrade")}</p>
                          <div className="memo-exam-ob-stepper">
                            <button
                              type="button"
                              className="memo-exam-ob-round"
                              aria-label={t("onboarding.lowerGrade")}
                              disabled={gradeIndex <= 0}
                              onClick={() => stepGrade(-1)}
                            >
                              −
                            </button>
                            <span className="memo-exam-ob-value" key={targetGrade} aria-live="polite">
                              {grade(gradeScale, targetGrade)}
                            </span>
                            <button
                              type="button"
                              className="memo-exam-ob-round"
                              aria-label={t("onboarding.raiseGrade")}
                              disabled={gradeIndex >= gradeOptions.length - 1}
                              onClick={() => stepGrade(1)}
                            >
                              +
                            </button>
                          </div>
                          <div>
                            <div className="memo-exam-ob-track">
                              <div
                                style={{
                                  width: `${gradeOptions.length > 1 ? (gradeIndex / (gradeOptions.length - 1)) * 100 : 100}%`,
                                }}
                              />
                            </div>
                            <div className="memo-exam-ob-scale">
                              <span>{grade(gradeScale, gradeOptions[0]?.label ?? "")}</span>
                              <span>{grade(gradeScale, gradeOptions.at(-1)?.label ?? "")}</span>
                            </div>
                          </div>
                          <div className="memo-exam-ob-need">
                            <span>{t("exam.create.needs", { grade: grade(gradeScale, targetGrade) })}</span>
                            <button
                              type="button"
                              className="memo-exam-ob-round small"
                              aria-label={t("exam.create.lower")}
                              disabled={targetPercent <= 1}
                              onClick={() => setTargetPercent((value) => Math.max(1, value - 1))}
                            >
                              −
                            </button>
                            <strong>{format.percent(targetPercent)}</strong>
                            <button
                              type="button"
                              className="memo-exam-ob-round small"
                              aria-label={t("exam.create.raise")}
                              disabled={targetPercent >= 100}
                              onClick={() => setTargetPercent((value) => Math.min(100, value + 1))}
                            >
                              +
                            </button>
                          </div>
                          <p className="memo-exam-ob-note">{t("exam.create.needsHint")}</p>
                        </div>
                      </>
                    ) : null}

                    {step === "time" ? (
                      <>
                        <p className="memo-exam-ob-sub">{t("exam.ob.subTime")}</p>
                        <div className="memo-exam-ob-options" role="radiogroup" aria-label={t("exam.ob.qTime")}>
                          {TIME_CHOICES.map((choice, option) => (
                            <button
                              key={choice.minutes}
                              type="button"
                              role="radio"
                              aria-checked={dailyMinutes === choice.minutes}
                              className="memo-exam-ob-option"
                              style={{ animationDelay: `${40 + option * 55}ms` }}
                              onClick={() => setDailyMinutes(choice.minutes)}
                            >
                              <span className="memo-exam-ob-icon" aria-hidden="true">{choice.icon}</span>
                              <span className="memo-exam-ob-copy">
                                <strong>{t("exam.minutes", { count: choice.minutes })}</strong>
                                <span>{t(choice.desc)}</span>
                              </span>
                              {dailyMinutes === choice.minutes ? (
                                <span className="memo-exam-ob-check" aria-hidden="true">✓</span>
                              ) : null}
                            </button>
                          ))}
                        </div>
                        <p className="memo-exam-ob-label-row">{t("exam.create.restLabel")}</p>
                        <div className="memo-exam-ob-weekdays">
                          {weekdayNames().map((name, day) => {
                            const bit = 1 << day;
                            const rest = (restDays & bit) !== 0;
                            return (
                              <button
                                key={day}
                                type="button"
                                aria-pressed={rest}
                                className="memo-exam-ob-chip"
                                // Never every day: a plan needs at least one study day.
                                disabled={!rest && (restDays | bit) === 127}
                                onClick={() => setRestDays((value) => value ^ bit)}
                              >
                                {name}
                              </button>
                            );
                          })}
                        </div>
                        <p className="memo-exam-ob-note spaced">
                          {t("exam.create.restHint")}
                        </p>
                      </>
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>

          <footer className="memo-exam-ob-foot">
            <button type="button" className="memo-exam-ob-cta" disabled={!ready[step]} onClick={next}>
              {ctaLabel}
            </button>
            <span className="memo-exam-ob-note">
              {step === "date" && dateValid
                ? t("exam.create.daysUntil", { count: daysUntil, date: longDate(examDate) })
                : step === "making"
                  ? t("exam.ob.makingNote")
                  : " "}
            </span>
          </footer>
        </div>
      </div>
    </ViewportPortal>
  );
}
