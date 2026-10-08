"use client";

import dynamic from "next/dynamic";
import { Nunito } from "next/font/google";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { useExamFormat } from "@/components/exam-prep/exam-format";
import {
  MascotFigure,
  MascotPedestal,
  MascotSparkles,
  SpeechBubble,
} from "@/components/onboarding-mascot";
import type { NoteSourceMode } from "@/components/note-source-modal";
import { ViewportPortal } from "@/components/viewport-portal";
import { addDays, addMonths, dayKeyAt, diffDays, isDayKey, monthGrid, monthOf } from "@/lib/exam-prep/dates";
import type {
  ExamNoteOption,
  ExamPlanPayload,
  ExamTypeId,
} from "@/lib/exam-prep/model";
import { EXAM_MAX_DAYS_AHEAD, EXAM_MAX_NOTES, EXAM_TITLE_MAX } from "@/lib/exam-prep/schema";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { noteEmoji } from "@/lib/note-emoji";

const NUNITO = Nunito({ subsets: ["latin", "latin-ext"], display: "swap" });

type StepId = "welcome" | "date" | "material" | "type" | "grade" | "time" | "making";

/** The app's own upload sheet, loaded only when the learner adds material. */
const NoteSourceModal = dynamic(
  () => import("@/components/note-source-modal").then((module) => module.NoteSourceModal),
  { ssr: false },
);

/** What else an exam can be on, as Home's "new note" sheet offers it. */
const MATERIAL_SOURCES: Array<{ mode: NoteSourceMode; icon: string; label: MessageKey }> = [
  { mode: "text", icon: "📄", label: "exam.ob.source.file" },
  { mode: "record", icon: "🎙️", label: "exam.ob.source.record" },
  { mode: "upload", icon: "🎧", label: "exam.ob.source.audio" },
  { mode: "link", icon: "🔗", label: "exam.ob.source.link" },
];

/** Other notes shown before "+N": enough to find this term's, short enough to stay one glance. */
const NOTES_SHOWN = 6;

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

/**
 * The target is a share of the exam's points. Below 30 % no exam passes, and
 * 75 % is where most learners start when asked for a good result.
 */
const TARGET_MIN = 30;
const TARGET_DEFAULT = 75;
const TARGET_STEP = 5;

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
  initialPlan = null,
  onClose,
  onSaved,
}: ExamOnboardingProps) {
  const format = useExamFormat();
  const { t, longDate, fullDate, monthTitle, weekdayNames } = format;
  const editing = Boolean(initialPlan);
  const today = useMemo(() => dayKeyAt(Date.now(), browserTimeZone()), []);

  const thisNote = notes.find((note) => note.id === lectureId);
  const otherNotes = notes.filter(
    (note) => note.id !== lectureId && (hasPaidAccess || note.id === trialLectureId),
  );
  const steps: StepId[] = [
    ...(editing ? [] : (["welcome"] as StepId[])),
    "date",
    "material",
    "type",
    "grade",
    "time",
    "making",
  ];

  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState(0);
  const [examDate, setExamDate] = useState(initialPlan?.examDate ?? "");
  // The calendar opens on the exam's month when editing, otherwise on this one.
  const [calendarMonth, setCalendarMonth] = useState(() => monthOf(initialPlan?.examDate ?? today));
  const [lectureIds, setLectureIds] = useState<string[]>(initialPlan?.lectureIds ?? [lectureId]);
  // Notes made from material uploaded during this setup: still being written.
  const [uploads, setUploads] = useState<Array<{ id: string; mode: NoteSourceMode }>>([]);
  const [sourceMode, setSourceMode] = useState<NoteSourceMode | null>(null);
  const [showAllNotes, setShowAllNotes] = useState(false);
  const [examType, setExamType] = useState<ExamTypeId | null>(initialPlan?.examType ?? null);
  const [targetPercent, setTargetPercent] = useState<number>(() =>
    Math.max(TARGET_MIN, Math.round(initialPlan?.targetPercent ?? TARGET_DEFAULT)),
  );
  const [dailyMinutes, setDailyMinutes] = useState<number | null>(initialPlan?.dailyMinutes ?? null);
  const [restDays, setRestDays] = useState(initialPlan?.restDays ?? 0);
  const [made, setMade] = useState(0);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const step = steps[index];
  // The first few notes and any picked ones, in library order so nothing moves under a tap.
  const shownNotes = showAllNotes
    ? otherNotes
    : otherNotes.filter((note, position) => position < NOTES_SHOWN || lectureIds.includes(note.id));
  const hiddenNotes = otherNotes.length - shownNotes.length;
  const lastExamDay = addDays(today, EXAM_MAX_DAYS_AHEAD);
  const daysUntil = isDayKey(examDate) ? diffDays(today, examDate) : -1;
  const dateValid = daysUntil >= 1 && daysUntil <= EXAM_MAX_DAYS_AHEAD;

  const bubble = (() => {
    switch (step) {
      case "welcome":
        return t("exam.ob.welcome");
      case "date":
        return t("exam.ob.qDate");
      case "material":
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
      // A plan made here is always a percentage target; older plans on a grade
      // scale become one when they are edited.
      gradeScale: "percent",
      targetGrade: String(targetPercent),
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

  function toggleNote(id: string) {
    setLectureIds((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= EXAM_MAX_NOTES
          ? current
          : [...current, id],
    );
  }

  function stepTarget(delta: number) {
    setTargetPercent((value) => {
      // From an odd value, the first step lands on the next multiple of five.
      const next =
        delta > 0
          ? (Math.floor(value / TARGET_STEP) + 1) * TARGET_STEP
          : (Math.ceil(value / TARGET_STEP) - 1) * TARGET_STEP;
      return Math.min(100, Math.max(TARGET_MIN, next));
    });
  }

  const ready: Record<StepId, boolean> = {
    welcome: true,
    date: dateValid,
    material: lectureIds.length > 0,
    type: examType !== null,
    grade: targetPercent >= TARGET_MIN && targetPercent <= 100,
    time: dailyMinutes !== null,
    making: Boolean(error) || (Boolean(savedId) && made >= 3),
  };

  const ctaLabel = (() => {
    switch (step) {
      case "welcome":
        return t("exam.ob.start");
      case "material":
        // Only this note so far: the button answers Memo's question.
        return lectureIds.length === 1 ? t("exam.ob.noMore") : t("common.continue");
      case "time":
        return editing ? t("common.save") : t("exam.ob.makePlan");
      case "making":
        return error ? t("common.retry") : t("exam.ob.open");
      default:
        return t("common.continue");
    }
  })();

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
                        <div className="memo-exam-ob-cal" role="group" aria-label={t("exam.create.dateLabel")}>
                          <div className="memo-exam-ob-cal-head">
                            <button
                              type="button"
                              className="memo-exam-ob-round small"
                              aria-label={t("exam.ob.prevMonth")}
                              disabled={calendarMonth <= monthOf(today)}
                              onClick={() => setCalendarMonth((month) => addMonths(month, -1))}
                            >
                              ‹
                            </button>
                            <strong aria-live="polite">{monthTitle(calendarMonth)}</strong>
                            <button
                              type="button"
                              className="memo-exam-ob-round small"
                              aria-label={t("exam.ob.nextMonth")}
                              disabled={calendarMonth >= monthOf(lastExamDay)}
                              onClick={() => setCalendarMonth((month) => addMonths(month, 1))}
                            >
                              ›
                            </button>
                          </div>
                          <div className="memo-exam-ob-cal-week" aria-hidden="true">
                            {weekdayNames().map((name, day) => (
                              <span key={day}>{name}</span>
                            ))}
                          </div>
                          <div className="memo-exam-ob-cal-grid" key={calendarMonth}>
                            {monthGrid(calendarMonth).map((day, cell) =>
                              day ? (
                                <button
                                  key={day}
                                  type="button"
                                  aria-pressed={examDate === day}
                                  aria-current={day === today ? "date" : undefined}
                                  aria-label={day === today ? `${fullDate(day)}, ${t("exam.ob.today")}` : fullDate(day)}
                                  className="memo-exam-ob-cal-day"
                                  // The exam is at the earliest tomorrow: today leaves no day to plan.
                                  disabled={day <= today || day > lastExamDay}
                                  onClick={() => setExamDate(day)}
                                >
                                  {Number(day.slice(8))}
                                </button>
                              ) : (
                                <span key={`blank-${cell}`} aria-hidden="true" />
                              ),
                            )}
                          </div>
                        </div>
                      </>
                    ) : null}

                    {step === "material" ? (
                      <>
                        <p className="memo-exam-ob-sub">{t("exam.ob.subNotes")}</p>
                        <div className="memo-exam-ob-upload">
                          <p>{t("exam.ob.addMaterial")}</p>
                          <div className="memo-exam-ob-sources">
                            {MATERIAL_SOURCES.map((source) => (
                              <button
                                key={source.mode}
                                type="button"
                                className="memo-exam-ob-source"
                                disabled={lectureIds.length >= EXAM_MAX_NOTES}
                                onClick={() => setSourceMode(source.mode)}
                              >
                                <span aria-hidden="true">{source.icon}</span>
                                {t(source.label)}
                              </button>
                            ))}
                          </div>
                        </div>

                        <p className="memo-exam-ob-label-row">{t("exam.ob.yourNotes")}</p>
                        <div className="memo-exam-ob-notes" role="group" aria-label={t("exam.ob.yourNotes")}>
                          <button type="button" aria-pressed disabled className="memo-exam-ob-note-chip">
                            <span aria-hidden="true">
                              {noteEmoji({ id: lectureId, title: lectureTitle, source_type: thisNote?.sourceType })}
                            </span>
                            <span className="memo-exam-ob-note-title">
                              {thisNote?.title || lectureTitle || t("note.untitled")}
                            </span>
                          </button>
                          {uploads.map((upload) => (
                            <button
                              key={upload.id}
                              type="button"
                              aria-pressed={lectureIds.includes(upload.id)}
                              className="memo-exam-ob-note-chip"
                              onClick={() => toggleNote(upload.id)}
                            >
                              <span aria-hidden="true">
                                {MATERIAL_SOURCES.find((source) => source.mode === upload.mode)?.icon}
                              </span>
                              <span className="memo-exam-ob-note-title">{t("exam.ob.newMaterial")}</span>
                              <small>{t("exam.ob.preparing")}</small>
                            </button>
                          ))}
                          {shownNotes.map((note) => (
                            <button
                              key={note.id}
                              type="button"
                              aria-pressed={lectureIds.includes(note.id)}
                              className="memo-exam-ob-note-chip"
                              onClick={() => toggleNote(note.id)}
                            >
                              <span aria-hidden="true">
                                {noteEmoji({ id: note.id, title: note.title, source_type: note.sourceType })}
                              </span>
                              <span className="memo-exam-ob-note-title">{note.title || t("note.untitled")}</span>
                              {note.status !== "ready" ? <small>{t("exam.ob.preparing")}</small> : null}
                            </button>
                          ))}
                          {hiddenNotes > 0 ? (
                            <button
                              type="button"
                              className="memo-exam-ob-note-chip more"
                              aria-label={t("exam.ob.allNotes")}
                              onClick={() => setShowAllNotes(true)}
                            >
                              +{hiddenNotes}
                            </button>
                          ) : null}
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
                        <p className="memo-exam-ob-sub">{t("exam.ob.subGrade")}</p>
                        <div className="memo-exam-ob-grade">
                          <div className="memo-exam-ob-stepper">
                            <button
                              type="button"
                              className="memo-exam-ob-round"
                              aria-label={t("exam.create.lower")}
                              disabled={targetPercent <= TARGET_MIN}
                              onClick={() => stepTarget(-1)}
                            >
                              −
                            </button>
                            <span className="memo-exam-ob-value" aria-live="polite">
                              {format.percent(targetPercent)}
                            </span>
                            <button
                              type="button"
                              className="memo-exam-ob-round"
                              aria-label={t("exam.create.raise")}
                              disabled={targetPercent >= 100}
                              onClick={() => stepTarget(1)}
                            >
                              +
                            </button>
                          </div>
                          <div>
                            <input
                              className="memo-exam-ob-range"
                              type="range"
                              min={TARGET_MIN}
                              max={100}
                              step={1}
                              value={targetPercent}
                              aria-label={t("exam.ob.qGrade")}
                              aria-valuetext={format.percent(targetPercent)}
                              style={{ "--fill": `${((targetPercent - TARGET_MIN) / (100 - TARGET_MIN)) * 100}%` } as CSSProperties}
                              onChange={(event) => setTargetPercent(Number(event.target.value))}
                            />
                            <div className="memo-exam-ob-scale">
                              <span>{format.percent(TARGET_MIN)}</span>
                              <span>{format.percent(100)}</span>
                            </div>
                          </div>
                          <p className="memo-exam-ob-note">{t("exam.ob.gradeHint")}</p>
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
      {sourceMode ? (
        // The same sheet Home opens. The note it makes joins this exam and the
        // learner stays in the setup; it is written in the background.
        <NoteSourceModal
          mode={sourceMode}
          open
          canCreateNotes={hasPaidAccess}
          onClose={() => setSourceMode(null)}
          onCreated={(id) => {
            setUploads((current) => [...current, { id, mode: sourceMode }]);
            setLectureIds((current) =>
              current.includes(id) || current.length >= EXAM_MAX_NOTES ? current : [...current, id],
            );
          }}
        />
      ) : null}
    </ViewportPortal>
  );
}
