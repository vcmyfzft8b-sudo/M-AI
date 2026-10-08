"use client";

import { useMemo, useState } from "react";

import {
  EXAM_TYPE_HINT,
  EXAM_TYPE_ICON,
  EXAM_TYPE_LABEL,
  SCALE_LABEL,
  useExamFormat,
} from "@/components/exam-prep/exam-format";
import { InstantLink } from "@/components/instant-link";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { addDays, dayKeyAt, diffDays, isDayKey } from "@/lib/exam-prep/dates";
import {
  defaultTargetPercent,
  GRADE_SCALE_IDS,
  targetGradeOptions,
  type GradeScaleId,
} from "@/lib/exam-prep/grade-scales";
import { EXAM_TYPE_IDS, type ExamPlanPayload, type ExamTypeId } from "@/lib/exam-prep/model";
import { EXAM_DAILY_MINUTES, EXAM_MAX_DAYS_AHEAD, EXAM_MAX_NOTES, EXAM_TITLE_MAX } from "@/lib/exam-prep/schema";
import { noteEmoji } from "@/lib/note-emoji";
import type { AppLectureListItem } from "@/lib/types";

type Step = "notes" | "when" | "type" | "goal" | "time";

const STEPS: Step[] = ["notes", "when", "type", "goal", "time"];

/** What most learners aim for on each scale, as the starting point. */
const DEFAULT_TARGET: Record<GradeScaleId, string> = {
  ten_point: "8",
  five_point: "4",
  letter: "B",
  percent: "70",
  pass_fail: "pass",
};

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Ljubljana";
  } catch {
    return "Europe/Ljubljana";
  }
}

export interface ExamBuilderProps {
  mode: "create" | "edit";
  lectures: AppLectureListItem[];
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  defaultScale?: GradeScaleId;
  initialPlan?: ExamPlanPayload["plan"] | null;
  /** Pre-selects a note, when the builder is opened from one. */
  preselectLectureId?: string | null;
}

export function ExamBuilderScreen({
  mode,
  lectures,
  hasPaidAccess,
  trialLectureId,
  defaultScale = "ten_point",
  initialPlan = null,
  preselectLectureId = null,
}: ExamBuilderProps) {
  const format = useExamFormat();
  const { t, locale, longDate, grade } = format;
  const { navigateWithFeedback, overlay: navigationOverlay, isNavigating } = useInstantNavigation();
  const today = useMemo(() => dayKeyAt(Date.now(), browserTimeZone()), []);

  const [stepIndex, setStepIndex] = useState(0);
  const [lectureIds, setLectureIds] = useState<string[]>(
    initialPlan?.lectureIds ?? (preselectLectureId ? [preselectLectureId] : []),
  );
  const [title, setTitle] = useState(initialPlan?.title ?? "");
  const [examDate, setExamDate] = useState(initialPlan?.examDate ?? addDays(today, 14));
  const [examType, setExamType] = useState<ExamTypeId>(initialPlan?.examType ?? "written");
  const [gradeScale, setGradeScale] = useState<GradeScaleId>(initialPlan?.gradeScale ?? defaultScale);
  const [targetGrade, setTargetGrade] = useState(
    initialPlan?.targetGrade ?? DEFAULT_TARGET[initialPlan?.gradeScale ?? defaultScale],
  );
  const [targetPercent, setTargetPercent] = useState<number>(
    initialPlan?.targetPercent ??
      defaultTargetPercent(defaultScale, DEFAULT_TARGET[defaultScale], locale) ??
      70,
  );
  const [dailyMinutes, setDailyMinutes] = useState(initialPlan?.dailyMinutes ?? 30);
  const [restDays, setRestDays] = useState(initialPlan?.restDays ?? 0);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = STEPS[stepIndex];
  const usable = lectures.filter((lecture) => lecture.status !== "failed");
  const canUse = (lectureId: string) => hasPaidAccess || lectureId === trialLectureId;
  const hasLocked = usable.some((lecture) => !canUse(lecture.id));
  const daysUntil = isDayKey(examDate) ? diffDays(today, examDate) : -1;
  const dateValid = daysUntil >= 1 && daysUntil <= EXAM_MAX_DAYS_AHEAD;
  const weekdayNames = format.weekdayNames();

  const stepValid: Record<Step, boolean> = {
    notes: lectureIds.length > 0,
    when: title.trim().length > 0 && dateValid,
    type: true,
    goal: targetGrade.length > 0 && targetPercent > 0 && targetPercent <= 100,
    time: dailyMinutes >= 10,
  };

  function toggleLecture(lecture: AppLectureListItem) {
    if (!canUse(lecture.id)) {
      return;
    }

    setLectureIds((current) => {
      if (current.includes(lecture.id)) {
        return current.filter((id) => id !== lecture.id);
      }

      if (current.length >= EXAM_MAX_NOTES) {
        return current;
      }

      // The first note picked names the exam, until the learner names it.
      if (current.length === 0 && !title.trim() && lecture.title) {
        setTitle(lecture.title.slice(0, EXAM_TITLE_MAX));
      }

      return [...current, lecture.id];
    });
  }

  function chooseScale(scale: GradeScaleId) {
    setGradeScale(scale);
    const label = DEFAULT_TARGET[scale];
    setTargetGrade(label);
    setTargetPercent(defaultTargetPercent(scale, label, locale) ?? 70);
  }

  function chooseGrade(label: string) {
    setTargetGrade(label);
    setTargetPercent(defaultTargetPercent(gradeScale, label, locale) ?? targetPercent);
  }

  async function submit() {
    setIsSaving(true);
    setError(null);

    const body = {
      title: title.trim(),
      examDate,
      examType,
      gradeScale,
      targetGrade,
      targetPercent,
      dailyMinutes,
      restDays,
      lectureIds,
    };

    try {
      const response = await fetch(mode === "create" ? "/api/exams" : `/api/exams/${initialPlan?.id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "create" ? { ...body, timeZone: browserTimeZone() } : body),
      });
      const json = (await response.json().catch(() => ({}))) as { id?: string; error?: string };

      if (!response.ok) {
        throw new Error(json.error ?? t("exam.error.save"));
      }

      const id = mode === "create" ? json.id : initialPlan?.id;
      navigateWithFeedback(id ? `/app/exams/${id}` : "/app/exams");
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : t("exam.error.save"));
      setIsSaving(false);
    }
  }

  async function remove() {
    if (!initialPlan) {
      return;
    }

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setIsSaving(true);

    try {
      const response = await fetch(`/api/exams/${initialPlan.id}`, { method: "DELETE" });

      if (!response.ok) {
        throw new Error(String(response.status));
      }

      navigateWithFeedback("/app/exams");
    } catch {
      setError(t("exam.error.save"));
      setIsSaving(false);
    }
  }

  const backHref = mode === "edit" && initialPlan ? `/app/exams/${initialPlan.id}` : "/app/exams";
  const isLast = stepIndex === STEPS.length - 1;

  return (
    <div className="memo-support-screen memo-exam-screen memo-exam-builder">
      {navigationOverlay}
      <div className="memo-settings-topbar memo-exam-topbar memo-only-mobile flex">
        <button
          type="button"
          aria-label={t("common.back")}
          className="memo-m-round"
          aria-busy={isNavigating}
          onClick={() =>
            stepIndex > 0 ? setStepIndex(stepIndex - 1) : navigateWithFeedback(backHref)
          }
        >
          <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
        </button>
      </div>

      <div className="memo-screen-scroll">
        <div className="memo-page">
          <div className="memo-exam-head">
            <div>
              <span className="memo-eyebrow">
                {t("exam.create.step", { step: stepIndex + 1, total: STEPS.length })}
              </span>
              <h1>{mode === "create" ? t("exam.create.title") : t("exam.edit.title")}</h1>
            </div>
          </div>

          <div className="memo-exam-steps" aria-hidden="true">
            {STEPS.map((item, index) => (
              <span key={item} className={index <= stepIndex ? "on" : undefined} />
            ))}
          </div>

          {step === "notes" ? (
            <div className="memo-exam-step">
              <h2>{t("exam.create.notesTitle")}</h2>
              <p>{t("exam.create.notesBody")}</p>

              {usable.length === 0 ? (
                <div className="memo-exam-card memo-empty">
                  <Emoji symbol="📝" size="2rem" />
                  <p>{t("exam.create.notesEmpty")}</p>
                  <InstantLink href="/app" className="memo-button-outline small">
                    {t("exam.create.notesEmptyAction")}
                  </InstantLink>
                </div>
              ) : (
                <div className="memo-exam-options" role="group" aria-label={t("exam.create.notesTitle")}>
                  {usable.map((lecture) => {
                    const selected = lectureIds.includes(lecture.id);
                    const locked = !canUse(lecture.id);

                    return (
                      <button
                        key={lecture.id}
                        type="button"
                        className={`memo-exam-option ${selected ? "active" : ""}`.trim()}
                        aria-pressed={selected}
                        disabled={locked}
                        onClick={() => toggleLecture(lecture)}
                      >
                        <span className="memo-note-emoji">
                          <Emoji symbol={noteEmoji(lecture)} size="1.25rem" />
                        </span>
                        <span className="memo-exam-option-copy">
                          <strong>{lecture.title ?? t("note.untitled")}</strong>
                          <span>
                            {locked
                              ? t("exam.create.noteLocked")
                              : lecture.status === "ready"
                                ? longDate(lecture.created_at.slice(0, 10))
                                : t("exam.create.notePending")}
                          </span>
                        </span>
                        <span className="memo-exam-tick">
                          <Msym name={locked ? "lock" : "check"} size="1.05rem" weight={700} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {hasLocked ? (
                <div className="memo-exam-upsell">
                  <span>{t("exam.create.notesLocked")}</span>
                  <InstantLink href="/app/start">{t("exam.create.unlock")}</InstantLink>
                </div>
              ) : null}
            </div>
          ) : null}

          {step === "when" ? (
            <div className="memo-exam-step">
              <h2>{t("exam.create.whenTitle")}</h2>
              <label className="memo-exam-label">
                <span>{t("exam.create.nameLabel")}</span>
                <input
                  className="memo-field"
                  value={title}
                  maxLength={EXAM_TITLE_MAX}
                  placeholder={t("exam.create.namePlaceholder")}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <label className="memo-exam-label">
                <span>{t("exam.create.dateLabel")}</span>
                <input
                  className="memo-field"
                  type="date"
                  value={examDate}
                  min={addDays(today, 1)}
                  max={addDays(today, EXAM_MAX_DAYS_AHEAD)}
                  onChange={(event) => setExamDate(event.target.value)}
                />
                <small>
                  {dateValid
                    ? t("exam.create.daysUntil", { count: daysUntil, date: longDate(examDate) })
                    : t("exam.create.dateInvalid")}
                </small>
              </label>
              <div className="memo-exam-chips">
                {[7, 14, 30].map((days) => {
                  const day = addDays(today, days);
                  return (
                    <button
                      key={days}
                      type="button"
                      className={`memo-chip ${examDate === day ? "active" : ""}`.trim()}
                      onClick={() => setExamDate(day)}
                    >
                      {days === 30
                        ? t("exam.create.inMonth")
                        : t("exam.create.inWeeks", { count: days / 7 })}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {step === "type" ? (
            <div className="memo-exam-step">
              <h2>{t("exam.create.typeTitle")}</h2>
              <p>{t("exam.create.typeBody")}</p>
              <div className="memo-exam-options" role="radiogroup" aria-label={t("exam.create.typeTitle")}>
                {EXAM_TYPE_IDS.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="radio"
                    aria-checked={examType === type}
                    className={`memo-exam-option ${examType === type ? "active" : ""}`.trim()}
                    onClick={() => setExamType(type)}
                  >
                    <span className="memo-note-emoji">
                      <Msym name={EXAM_TYPE_ICON[type]} size="1.3rem" fill={false} />
                    </span>
                    <span className="memo-exam-option-copy">
                      <strong>{t(EXAM_TYPE_LABEL[type])}</strong>
                      <span>{t(EXAM_TYPE_HINT[type])}</span>
                    </span>
                    <span className="memo-exam-tick">
                      <Msym name="check" size="1.05rem" weight={700} />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {step === "goal" ? (
            <div className="memo-exam-step">
              <h2>{t("exam.create.goalTitle")}</h2>
              <div className="memo-exam-label">
                <span>{t("exam.create.scaleLabel")}</span>
                <div className="memo-exam-chips" role="radiogroup" aria-label={t("exam.create.scaleLabel")}>
                  {GRADE_SCALE_IDS.map((scale) => (
                    <button
                      key={scale}
                      type="button"
                      role="radio"
                      aria-checked={gradeScale === scale}
                      className={`memo-chip ${gradeScale === scale ? "active" : ""}`.trim()}
                      onClick={() => chooseScale(scale)}
                    >
                      {t(SCALE_LABEL[scale])}
                    </button>
                  ))}
                </div>
              </div>
              <div className="memo-exam-label">
                <span>{t("exam.create.gradeLabel")}</span>
                <div className="memo-exam-chips" role="radiogroup" aria-label={t("exam.create.gradeLabel")}>
                  {targetGradeOptions(gradeScale, locale).map((step) => (
                    <button
                      key={step.label}
                      type="button"
                      role="radio"
                      aria-checked={targetGrade === step.label}
                      className={`memo-chip ${targetGrade === step.label ? "active" : ""}`.trim()}
                      onClick={() => chooseGrade(step.label)}
                    >
                      {grade(gradeScale, step.label)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="memo-exam-card">
                <div className="memo-exam-label">
                  <span>
                    {t("exam.create.needs", { grade: grade(gradeScale, targetGrade) })}
                  </span>
                  <div className="memo-exam-stepper">
                    <button
                      type="button"
                      aria-label={t("exam.create.lower")}
                      disabled={targetPercent <= 1}
                      onClick={() => setTargetPercent((value) => Math.max(1, value - 1))}
                    >
                      <Msym name="remove" size="1.3rem" />
                    </button>
                    <strong>{format.percent(targetPercent)}</strong>
                    <button
                      type="button"
                      aria-label={t("exam.create.raise")}
                      disabled={targetPercent >= 100}
                      onClick={() => setTargetPercent((value) => Math.min(100, value + 1))}
                    >
                      <Msym name="add" size="1.3rem" />
                    </button>
                  </div>
                  <small>{t("exam.create.needsHint")}</small>
                </div>
              </div>
            </div>
          ) : null}

          {step === "time" ? (
            <div className="memo-exam-step">
              <h2>{t("exam.create.timeTitle")}</h2>
              <p>{t("exam.create.timeBody")}</p>
              <div className="memo-exam-chips" role="radiogroup" aria-label={t("exam.create.timeTitle")}>
                {EXAM_DAILY_MINUTES.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    role="radio"
                    aria-checked={dailyMinutes === minutes}
                    className={`memo-chip ${dailyMinutes === minutes ? "active" : ""}`.trim()}
                    onClick={() => setDailyMinutes(minutes)}
                  >
                    {t("exam.minutes", { count: minutes })}
                  </button>
                ))}
              </div>
              <div className="memo-exam-label">
                <span>{t("exam.create.restLabel")}</span>
                <div className="memo-exam-weekdays">
                  {weekdayNames.map((name, index) => {
                    const bit = 1 << index;
                    const rest = (restDays & bit) !== 0;
                    return (
                      <button
                        key={index}
                        type="button"
                        aria-pressed={rest}
                        className={rest ? "rest" : undefined}
                        // Never every day: a plan needs at least one study day.
                        disabled={!rest && (restDays | bit) === 127}
                        onClick={() => setRestDays((value) => value ^ bit)}
                      >
                        {name}
                      </button>
                    );
                  })}
                </div>
                <small>{t("exam.create.restHint")}</small>
              </div>
            </div>
          ) : null}

          {error ? <p className="memo-inline-error">{error}</p> : null}

          {mode === "edit" && step === "notes" ? (
            <div className="memo-exam-section">
              <button
                type="button"
                className="memo-button-outline small danger"
                disabled={isSaving}
                onClick={() => void remove()}
              >
                {confirmDelete ? t("exam.delete.confirm") : t("exam.delete.title")}
              </button>
              {confirmDelete ? <p className="memo-exam-note">{t("exam.delete.body")}</p> : null}
            </div>
          ) : null}

          <div className="memo-exam-footer">
            {stepIndex > 0 ? (
              <button
                type="button"
                className="memo-button-outline memo-only-desktop"
                onClick={() => setStepIndex(stepIndex - 1)}
              >
                {t("common.back")}
              </button>
            ) : null}
            <button
              type="button"
              className="memo-button-coral"
              disabled={!stepValid[step] || isSaving}
              onClick={() => {
                if (isLast) {
                  void submit();
                } else {
                  setStepIndex(stepIndex + 1);
                }
              }}
            >
              {isLast
                ? mode === "create"
                  ? t("exam.create.submit")
                  : t("common.save")
                : t("common.continue")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
