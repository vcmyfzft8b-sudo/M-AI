"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { EXAM_TYPE_LABEL, noteHref, useExamFormat } from "@/components/exam-prep/exam-format";
import {
  ExamGoals,
  ExamMasteryHero,
  ExamTopicList,
  ExamTopicLadder,
} from "@/components/exam-prep/exam-mastery";
import { ExamOnboarding } from "@/components/exam-prep/exam-onboarding";
import { Emoji, Msym } from "@/components/msym";
import { mapAppHrefForClient } from "@/lib/creator-demo/paths";
import type { GradeScaleId } from "@/lib/exam-prep/grade-scales";
import type {
  ExamNoteOption,
  ExamPlanPayload,
  ExamPlanSummary,
  JourneyTask,
} from "@/lib/exam-prep/model";
import { topicStepKey, type ExamTopic, type ExamTopicStep } from "@/lib/exam-prep/topics";

type Overview = { plans: ExamPlanSummary[]; notes: ExamNoteOption[] };

/** Ladder steps the app sees on its own when the topic has cards to measure. */
const MEASURED_STEPS = new Set(["flashcards", "repetition", "gaps"]);

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
 * questions. With an exam it is laid out as Astra AI lays out exam prep: Memo
 * saying where the plan gets the learner and by when, a mastery ring, today's
 * goals with one Continue, and the material as topics, each a ladder of this
 * note's tools ending in mock exams. See docs/exam-prep.md.
 */
/** How often the tab looks again while material is being prepared, and for how long (30 min). */
const PENDING_CHECK_MS = 20_000;
const PENDING_CHECKS_MAX = 90;

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
  const { t, grade } = format;
  const router = useRouter();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);
  const [payload, setPayload] = useState<ExamPlanPayload | null>(null);
  const [setup, setSetup] = useState<"create" | "edit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [resultPercent, setResultPercent] = useState("");
  const [topicKey, setTopicKey] = useState<string | null>(null);

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

  // Material still turning into notes and cards (an upload from the setup): look again now
  // and then, so its days join the plan without the learner leaving the tab.
  const materialPending = payload?.journey.materialPending ?? 0;
  useEffect(() => {
    if (!planId || materialPending === 0) {
      return;
    }

    let checks = 0;
    const id = window.setInterval(() => {
      checks += 1;

      if (checks > PENDING_CHECKS_MAX) {
        window.clearInterval(id);
      } else if (document.visibilityState === "visible") {
        void loadPlan(planId);
      }
    }, PENDING_CHECK_MS);

    return () => window.clearInterval(id);
  }, [loadPlan, materialPending, planId]);

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

  /**
   * Opens a ladder step's tool. A step the app cannot see happen (the lesson,
   * the podcast, the tutor, a mock exam) counts as done once opened; the rest
   * tick themselves from study.
   */
  function openStep(topic: ExamTopic, step: ExamTopicStep) {
    if (planId && payload && !step.done && !(MEASURED_STEPS.has(step.id) && topic.items > 0)) {
      void fetch(`/api/exams/${planId}/checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: payload.journey.today, taskKey: topicStepKey(topic.key, step.id), done: true }),
      }).catch(() => undefined);
    }

    if (topic.lectureId === lectureId) {
      onOpenTab(step.tab);
    } else {
      router.push(mapAppHrefForClient(noteHref(topic.lectureId, step.tab)));
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
  const openTopic = journey.topics.find((topic) => topic.key === topicKey) ?? null;
  const showNotes = new Set(journey.topics.map((topic) => topic.lectureId)).size > 1;

  if (openTopic) {
    return (
      <div className="memo-exam-tab">
        <ExamTopicLadder
          topic={openTopic}
          examTitle={plan.title}
          index={journey.topics.indexOf(openTopic)}
          total={journey.topics.length}
          onBack={() => setTopicKey(null)}
          onOpenStep={openStep}
        />
      </div>
    );
  }

  return (
    <div className="memo-exam-tab">
      <div className="memo-exam-tab-head">
        <div>
          <span className="memo-eyebrow">{t("exam.astra.eyebrow")}</span>
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
                setTopicKey(null);
                void loadPlan(item.id);
              }}
            >
              {item.title}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="memo-inline-error">{error}</p> : null}

      <ExamMasteryHero
        journey={journey}
        targetPercent={plan.targetPercent}
        examDate={plan.examDate}
        examLabel={t(EXAM_TYPE_LABEL[plan.examType])}
      />

      {journey.materialPending > 0 ? (
        <p className="memo-exam-note">{t("exam.pending", { count: journey.materialPending })}</p>
      ) : null}

      {journey.status === "upcoming" && todayPlan && todayPlan.kind === "study" && todayPlan.tasks.length > 0 ? (
        <ExamGoals
          day={todayPlan}
          onToggle={toggleTask}
          pendingKey={pendingKey}
          currentLectureId={lectureId}
          onOpenTab={onOpenTab}
        />
      ) : null}

      {journey.status === "upcoming" && !journey.feasibility.fits ? (
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

      {journey.status === "finished" ? (
        <section className="memo-exam-block">
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

      {journey.topics.length > 0 ? (
        <ExamTopicList topics={journey.topics} showNotes={showNotes} onOpenTopic={(topic) => setTopicKey(topic.key)} />
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
