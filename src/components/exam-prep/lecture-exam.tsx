"use client";

import { useCallback, useEffect, useState } from "react";

import { EXAM_TYPE_LABEL, noteHref, useExamFormat } from "@/components/exam-prep/exam-format";
import { ExamHero } from "@/components/exam-prep/exam-hero";
import { ExamOnboarding } from "@/components/exam-prep/exam-onboarding";
import { ExamReadinessCard } from "@/components/exam-prep/exam-readiness-card";
import { ExamTimeline } from "@/components/exam-prep/exam-timeline";
import { ExamTodayTasks } from "@/components/exam-prep/exam-today";
import { InstantLink } from "@/components/instant-link";
import { Emoji, Msym } from "@/components/msym";
import type { GradeScaleId } from "@/lib/exam-prep/grade-scales";
import type {
  ExamNoteOption,
  ExamPlanPayload,
  ExamPlanSummary,
  JourneyDay,
  JourneyTask,
} from "@/lib/exam-prep/model";

type Overview = { plans: ExamPlanSummary[]; notes: ExamNoteOption[] };

/** True when the last planned study day before today went by without study. */
function cameBackAfterABreak(days: JourneyDay[]) {
  const todayIndex = days.findIndex((day) => day.isToday);

  for (let index = todayIndex - 1; index >= 0; index -= 1) {
    const day = days[index];

    if (day.kind !== "study") {
      continue;
    }

    const activity = day.activity;
    return !activity || activity.cards + activity.questions + activity.tests === 0;
  }

  return false;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(String(response.status));
  }

  return (await response.json()) as T;
}

/**
 * The note's Exam tab: exam prep as one of the note's tools.
 *
 * With no exam planned it is the same start screen the other tools have, and
 * its button opens the planning flow — drawn as the app's onboarding draws its
 * questions. With an exam it is that exam's journey: the countdown, today's
 * tasks (which open this note's other tabs), how close the learner is to their
 * grade, and the plan day by day. See docs/exam-prep.md.
 */
export function LectureExam({
  lectureId,
  lectureTitle,
  isReady,
  hasPaidAccess,
  onOpenTab,
}: {
  lectureId: string;
  lectureTitle: string;
  isReady: boolean;
  hasPaidAccess: boolean;
  /** Opens one of this note's tabs, for today's tasks on this note. */
  onOpenTab: (tab: JourneyTask["tab"]) => void;
}) {
  const format = useExamFormat();
  const { t, longDate, grade } = format;
  const [overview, setOverview] = useState<Overview | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [payload, setPayload] = useState<ExamPlanPayload | null>(null);
  const [setup, setSetup] = useState<"create" | "edit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resultPercent, setResultPercent] = useState("");

  const loadPlan = useCallback(
    async (id: string) => {
      try {
        setPayload(await readJson<ExamPlanPayload>(await fetch(`/api/exams/${id}`, { cache: "no-store" })));
        setError(null);
      } catch {
        setError(t("exam.error.load"));
      }
    },
    [t],
  );

  const loadOverview = useCallback(
    async (preferId?: string | null) => {
      try {
        const next = await readJson<Overview>(
          await fetch(`/api/exams?lectureId=${encodeURIComponent(lectureId)}`, { cache: "no-store" }),
        );
        setOverview(next);
        setError(null);
        const chosen =
          next.plans.find((plan) => plan.id === preferId) ??
          next.plans.find((plan) => plan.status !== "finished") ??
          next.plans[0] ??
          null;
        setPlanId(chosen?.id ?? null);
        setPayload(null);

        if (chosen) {
          await loadPlan(chosen.id);
        }
      } catch {
        setError(t("exam.error.load"));
      }
    },
    [lectureId, loadPlan, t],
  );

  // The tab mounts each time it is opened, which is when the plan may have moved.
  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  async function toggleTask(task: JourneyTask) {
    if (!payload || !planId) {
      return;
    }

    setPendingKey(task.key);

    try {
      await readJson(
        await fetch(`/api/exams/${planId}/checks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ day: payload.journey.today, taskKey: task.key, done: !task.done }),
        }),
      );
      await loadPlan(planId);
    } catch {
      setError(t("exam.error.save"));
    } finally {
      setPendingKey(null);
    }
  }

  async function patchPlan(body: Record<string, unknown>) {
    if (!planId) {
      return;
    }

    setIsSaving(true);

    try {
      await readJson(
        await fetch(`/api/exams/${planId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      await loadPlan(planId);
    } catch {
      setError(t("exam.error.save"));
    } finally {
      setIsSaving(false);
    }
  }

  async function deletePlan() {
    if (!planId) {
      return;
    }

    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setIsSaving(true);

    try {
      await readJson(await fetch(`/api/exams/${planId}`, { method: "DELETE" }));
      setConfirmDelete(false);
      await loadOverview();
    } catch {
      setError(t("exam.error.save"));
    } finally {
      setIsSaving(false);
    }
  }

  const onboarding = setup ? (
    <ExamOnboarding
      lectureId={lectureId}
      lectureTitle={lectureTitle}
      notes={overview?.notes ?? []}
      hasPaidAccess={hasPaidAccess}
      initialPlan={setup === "edit" ? payload?.plan ?? null : null}
      onClose={() => setSetup(null)}
      onSaved={(id) => {
        setSetup(null);
        void loadOverview(id);
      }}
    />
  ) : null;

  if (!overview) {
    return (
      <div className="memo-exam-tab" aria-busy={!error}>
        {error ? (
          <div className="memo-study-empty">
            <p className="memo-inline-error" role="alert">{error}</p>
            <button type="button" className="memo-study-empty-cta" onClick={() => void loadOverview()}>
              {t("common.retry")}
            </button>
          </div>
        ) : (
          <div className="memo-study-empty">
            <Msym name="progress_activity" className="memo-spin" size="1.6rem" />
          </div>
        )}
      </div>
    );
  }

  if (overview.plans.length === 0) {
    return (
      <div className="memo-exam-tab">
        <div className="memo-study-empty">
          <div className="memo-study-empty-orb">
            <Emoji symbol="🎯" size="4.4rem" />
          </div>
          <p className="memo-study-empty-title">{t("exam.tab.emptyTitle")}</p>
          <p className="memo-study-empty-copy">{t("exam.tab.emptyCopy")}</p>
          <button
            type="button"
            className="memo-study-empty-cta"
            disabled={!isReady}
            onClick={() => setSetup("create")}
          >
            <Msym name="event" size="1.2rem" fill={false} />
            {t("exam.tab.plan")}
          </button>
          {!isReady ? <p className="memo-study-empty-copy">{t("exam.tab.notReady")}</p> : null}
        </div>
        {onboarding}
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="memo-exam-tab" aria-busy="true">
        <div className="memo-study-empty">
          <Msym name="progress_activity" className="memo-spin" size="1.6rem" />
        </div>
      </div>
    );
  }

  const { plan, journey } = payload;
  const todayPlan = journey.todayPlan;
  const doneCount = todayPlan ? todayPlan.tasks.filter((task) => task.done).length : 0;
  const allDone = Boolean(todayPlan && todayPlan.tasks.length > 0 && doneCount === todayPlan.tasks.length);
  const restToday = journey.status === "upcoming" && todayPlan?.kind === "rest";
  const welcomeBack = journey.status === "upcoming" && cameBackAfterABreak(journey.days);

  return (
    <div className="memo-exam-tab">
      <div className="memo-exam-tab-head">
        <div>
          <span className="memo-eyebrow">
            {t(EXAM_TYPE_LABEL[plan.examType])} · {longDate(plan.examDate)}
          </span>
          <h2>{plan.title}</h2>
        </div>
        <button type="button" className="memo-button-outline small" onClick={() => setSetup("edit")}>
          <Msym name="edit" size="1.1rem" fill={false} />
          {t("common.edit")}
        </button>
      </div>

      {overview.plans.length > 1 ? (
        <div className="memo-exam-chips" role="tablist" aria-label={t("exam.tab.switch")}>
          {overview.plans.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === planId}
              className={`memo-chip ${item.id === planId ? "active" : ""}`.trim()}
              onClick={() => {
                setPlanId(item.id);
                setPayload(null);
                void loadPlan(item.id);
              }}
            >
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="memo-inline-error">{error}</p> : null}

      <ExamHero journey={journey} />

      {journey.materialPending > 0 ? (
        <p className="memo-exam-note">{t("exam.pending", { count: journey.materialPending })}</p>
      ) : null}

      {journey.status === "upcoming" ? (
        <section className="memo-exam-section" aria-labelledby="exam-today-title">
          <h2 id="exam-today-title">
            <span>{t("exam.today.title")}</span>
            {todayPlan && todayPlan.kind === "study" ? (
              <small>
                {t("exam.today.summary", {
                  done: doneCount,
                  total: todayPlan.tasks.length,
                  minutes: todayPlan.minutes,
                })}
              </small>
            ) : null}
          </h2>

          {welcomeBack && !allDone ? (
            <div className="memo-exam-calm memo-exam-welcome">
              <Emoji symbol="👋" size="1.6rem" />
              <div>
                <p>{t("exam.today.welcomeBack")}</p>
                <p>{t("exam.today.welcomeBackBody")}</p>
              </div>
            </div>
          ) : null}

          {restToday ? (
            <div className="memo-exam-calm">
              <Emoji symbol="🌿" size="1.6rem" />
              <div>
                <p>{t("exam.today.rest")}</p>
                <p>{t("exam.today.restBody")}</p>
              </div>
            </div>
          ) : todayPlan ? (
            <>
              {allDone ? (
                <div className="memo-exam-calm memo-exam-welcome">
                  <Emoji symbol="🎉" size="1.6rem" />
                  <div>
                    <p>{t("exam.today.allDone")}</p>
                    <p>{t("exam.today.allDoneBody")}</p>
                  </div>
                </div>
              ) : null}
              <ExamTodayTasks
                day={todayPlan}
                onToggle={toggleTask}
                pendingKey={pendingKey}
                currentLectureId={lectureId}
                onOpenTab={onOpenTab}
              />
            </>
          ) : null}

          {!journey.feasibility.fits ? (
            <div className="memo-exam-panel memo-exam-fit">
              <strong>{t("exam.fit.title")}</strong>
              <p>
                {t("exam.fit.body", {
                  count: journey.feasibility.unscheduledSections,
                  minutes: journey.feasibility.recommendedMinutes,
                })}
              </p>
              {journey.feasibility.recommendedMinutes > plan.dailyMinutes ? (
                <button
                  type="button"
                  className="memo-button-outline small"
                  disabled={isSaving}
                  onClick={() => void patchPlan({ dailyMinutes: journey.feasibility.recommendedMinutes })}
                >
                  {t("exam.fit.action", { minutes: journey.feasibility.recommendedMinutes })}
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {journey.status === "finished" ? (
        <section className="memo-exam-section">
          <div className="memo-exam-card memo-exam-result">
            <h2>{t("exam.result.title")}</h2>
            {plan.resultPercent != null ? (
              <p>
                {t("exam.result.saved", {
                  result: Math.round(plan.resultPercent),
                  forecast: journey.readiness.unlocked
                    ? t("exam.ready.range", {
                        low: journey.readiness.today.low,
                        high: journey.readiness.today.high,
                      })
                    : "–",
                })}
              </p>
            ) : (
              <>
                <p>{t("exam.result.body")}</p>
                <form
                  className="memo-exam-result-row"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = Number(resultPercent.replace(",", "."));

                    if (!Number.isFinite(value) || value < 0 || value > 100) {
                      setError(t("exam.result.invalid"));
                      return;
                    }

                    void patchPlan({ resultPercent: value });
                  }}
                >
                  <input
                    className="memo-field"
                    inputMode="decimal"
                    placeholder={t("exam.result.placeholder")}
                    aria-label={t("exam.result.placeholder")}
                    value={resultPercent}
                    onChange={(event) => setResultPercent(event.target.value)}
                  />
                  <button type="submit" className="memo-primary-pill" disabled={isSaving}>
                    {t("common.save")}
                  </button>
                </form>
              </>
            )}
          </div>
        </section>
      ) : null}

      <section className="memo-exam-section">
        <ExamReadinessCard
          readiness={journey.readiness}
          gradeScale={plan.gradeScale as GradeScaleId}
          targetGrade={plan.targetGrade}
          targetPercent={plan.targetPercent}
          finished={journey.status !== "upcoming"}
        />
      </section>

      <section className="memo-exam-section" aria-labelledby="exam-path-title">
        <h2 id="exam-path-title">
          <span>{t("exam.timeline.title")}</span>
          {journey.week.planned > 0 ? (
            <small>
              {t("exam.timeline.week", { studied: journey.week.studied, planned: journey.week.planned })}
            </small>
          ) : null}
        </h2>
        <ExamTimeline days={journey.days} />
      </section>

      {journey.readiness.notes.length > 1 ? (
        <section className="memo-exam-section" aria-labelledby="exam-notes-title">
          <h2 id="exam-notes-title">{t("exam.notes.title")}</h2>
          <div className="memo-exam-notes">
            {journey.readiness.notes.map((note) => (
              <div key={note.lectureId} className="memo-exam-card memo-exam-note-card">
                {note.lectureId === lectureId ? (
                  <div className="memo-exam-note-head">
                    <span className="memo-note-emoji">
                      <Emoji symbol={note.emoji ?? "📘"} size="1.3rem" />
                    </span>
                    <span className="memo-note-title">{note.title}</span>
                  </div>
                ) : (
                  <InstantLink href={noteHref(note.lectureId, "exam")} className="memo-exam-note-head">
                    <span className="memo-note-emoji">
                      <Emoji symbol={note.emoji ?? "📘"} size="1.3rem" />
                    </span>
                    <span className="memo-note-title">{note.title}</span>
                    <Msym name="chevron_right" size="1.4rem" fill={false} weight={400} />
                  </InstantLink>
                )}
                <div className="memo-exam-note-grid">
                  <div className="memo-exam-stat">
                    <strong>{format.percent(note.coverage * 100)}</strong>
                    <span>{t("exam.ready.coverage")}</span>
                  </div>
                  <div className="memo-exam-stat">
                    <strong>{format.percent(Math.min(99, note.memoryAtExam * 100))}</strong>
                    <span>{t("exam.notes.memory")}</span>
                  </div>
                  <div className="memo-exam-stat">
                    <strong>{note.accuracy == null ? "–" : format.percent(note.accuracy * 100)}</strong>
                    <span>{t("exam.notes.accuracy")}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="memo-exam-tab-foot">
        <p className="memo-exam-note">
          {plan.gradeScale === "percent"
            ? t("exam.goalPercent", { percent: Math.round(plan.targetPercent) })
            : t("exam.goal", {
                grade: grade(plan.gradeScale as GradeScaleId, plan.targetGrade),
                percent: Math.round(plan.targetPercent),
              })}
        </p>
        <button
          type="button"
          className="memo-button-outline small danger"
          disabled={isSaving}
          onClick={() => void deletePlan()}
        >
          {confirmDelete ? t("exam.delete.confirm") : t("exam.delete.title")}
        </button>
        {confirmDelete ? <p className="memo-exam-note">{t("exam.delete.body")}</p> : null}
      </div>

      {onboarding}
    </div>
  );
}
