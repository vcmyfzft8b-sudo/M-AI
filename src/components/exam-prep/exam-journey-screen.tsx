"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  EXAM_TYPE_LABEL,
  noteHref,
  useExamFormat,
} from "@/components/exam-prep/exam-format";
import { ExamHero } from "@/components/exam-prep/exam-hero";
import { ExamReadinessCard } from "@/components/exam-prep/exam-readiness-card";
import { ExamTimeline } from "@/components/exam-prep/exam-timeline";
import { ExamTodayTasks } from "@/components/exam-prep/exam-today";
import { InstantLink } from "@/components/instant-link";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { defaultTargetPercent } from "@/lib/exam-prep/grade-scales";
import type { ExamPlanPayload, JourneyDay, JourneyTask } from "@/lib/exam-prep/model";

async function fetchPlan(planId: string): Promise<ExamPlanPayload | null> {
  const response = await fetch(`/api/exams/${planId}`, { cache: "no-store" });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(String(response.status));
  }

  return (await response.json()) as ExamPlanPayload;
}

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

function ExamJourneySkeleton() {
  return (
    <div className="memo-page" aria-busy="true">
      <div className="memo-exam-head">
        <div>
          <span className="memo-eyebrow">&nbsp;</span>
          <h1>&nbsp;</h1>
        </div>
      </div>
      <div className="memo-exam-card memo-exam-hero">
        <div className="memo-exam-strip">
          <span />
        </div>
      </div>
    </div>
  );
}

export function ExamJourneyScreen({
  planId,
  initialPayload,
}: {
  planId: string;
  initialPayload: ExamPlanPayload | null;
}) {
  const format = useExamFormat();
  const { t, longDate, grade } = format;
  const { navigateWithFeedback, overlay: navigationOverlay, isNavigating } = useInstantNavigation();
  const [payload, setPayload] = useState<ExamPlanPayload | null>(initialPayload);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [resultPercent, setResultPercent] = useState("");
  const loadedRef = useRef(Boolean(initialPayload));

  const refresh = useCallback(async () => {
    try {
      const next = await fetchPlan(planId);

      if (!next) {
        setMissing(true);
        return;
      }

      setPayload(next);
      setError(null);
    } catch {
      setError(t("exam.error.load"));
    }
  }, [planId, t]);

  // Coming back from a study session is the moment the plan has moved.
  useEffect(() => {
    if (!loadedRef.current) {
      loadedRef.current = true;
      void refresh();
    }

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onVisible);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
  }, [refresh]);

  async function toggleTask(task: JourneyTask) {
    if (!payload) {
      return;
    }

    const done = !task.done;
    setPendingKey(task.key);
    setPayload((current) => {
      if (!current?.journey.todayPlan) {
        return current;
      }

      const tasks = current.journey.todayPlan.tasks.map((item) =>
        item.key === task.key ? { ...item, done, progress: done ? 1 : 0 } : item,
      );
      const todayPlan = { ...current.journey.todayPlan, tasks };

      return {
        ...current,
        journey: {
          ...current.journey,
          todayPlan,
          days: current.journey.days.map((day) => (day.isToday ? todayPlan : day)),
        },
      };
    });

    try {
      const response = await fetch(`/api/exams/${planId}/checks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: payload.journey.today, taskKey: task.key, done }),
      });

      if (!response.ok) {
        throw new Error(String(response.status));
      }

      await refresh();
    } catch {
      setError(t("exam.error.save"));
      await refresh();
    } finally {
      setPendingKey(null);
    }
  }

  async function patchPlan(body: Record<string, unknown>) {
    setIsSaving(true);

    try {
      const response = await fetch(`/api/exams/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(String(response.status));
      }

      await refresh();
    } catch {
      setError(t("exam.error.save"));
    } finally {
      setIsSaving(false);
    }
  }

  const topbar = (
    <div className="memo-settings-topbar memo-exam-topbar memo-only-mobile flex">
      <button
        type="button"
        aria-label={t("common.back")}
        className="memo-m-round"
        aria-busy={isNavigating}
        onClick={() => navigateWithFeedback("/app/exams")}
      >
        <Msym name="arrow_back" size="1.5rem" fill={false} weight={500} />
      </button>
      {payload ? (
        <div>
          <InstantLink
            href={`/app/exams/${planId}/edit`}
            className="memo-m-round"
            aria-label={t("exam.menu.edit")}
          >
            <Msym name="edit" size="1.4rem" fill={false} weight={500} />
          </InstantLink>
        </div>
      ) : null}
    </div>
  );

  if (missing) {
    return (
      <div className="memo-support-screen memo-exam-screen">
        {navigationOverlay}
        {topbar}
        <div className="memo-screen-scroll">
          <div className="memo-page">
            <div className="memo-empty">
              <Emoji symbol="🗓️" size="2rem" />
              <p>{t("exam.error.missing")}</p>
              <InstantLink href="/app/exams" className="memo-button-outline small">
                {t("exam.list.title")}
              </InstantLink>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="memo-support-screen memo-exam-screen">
        {navigationOverlay}
        {topbar}
        <div className="memo-screen-scroll">
          {error ? (
            <div className="memo-page">
              <p className="memo-inline-error">{error}</p>
              <button type="button" className="memo-button-outline small" onClick={() => void refresh()}>
                {t("common.retry")}
              </button>
            </div>
          ) : (
            <ExamJourneySkeleton />
          )}
        </div>
      </div>
    );
  }

  const { plan, journey } = payload;
  const todayPlan = journey.todayPlan;
  const allDone = Boolean(todayPlan && todayPlan.tasks.length > 0 && todayPlan.tasks.every((task) => task.done));
  const restToday = journey.status === "upcoming" && todayPlan?.kind === "rest";
  const welcomeBack = journey.status === "upcoming" && cameBackAfterABreak(journey.days);
  const doneCount = todayPlan ? todayPlan.tasks.filter((task) => task.done).length : 0;

  return (
    <div className="memo-support-screen memo-exam-screen">
      {navigationOverlay}
      {topbar}
      <div className="memo-screen-scroll">
        <div className="memo-page">
          <div className="memo-exam-head">
            <div>
              <span className="memo-eyebrow">
                {t(EXAM_TYPE_LABEL[plan.examType])} · {longDate(plan.examDate)}
              </span>
              <h1>{plan.title}</h1>
            </div>
            <div className="memo-exam-head-actions memo-only-desktop">
              <InstantLink href={`/app/exams/${planId}/edit`} className="memo-button-outline small">
                {t("exam.menu.edit")}
              </InstantLink>
            </div>
          </div>

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
                  <ExamTodayTasks day={todayPlan} onToggle={toggleTask} pendingKey={pendingKey} />
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
                      onClick={() =>
                        void patchPlan({ dailyMinutes: journey.feasibility.recommendedMinutes })
                      }
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
              gradeScale={plan.gradeScale}
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
                  {t("exam.timeline.week", {
                    studied: journey.week.studied,
                    planned: journey.week.planned,
                  })}
                </small>
              ) : null}
            </h2>
            <ExamTimeline days={journey.days} />
          </section>

          {journey.readiness.notes.length > 0 ? (
            <section className="memo-exam-section" aria-labelledby="exam-notes-title">
              <h2 id="exam-notes-title">{t("exam.notes.title")}</h2>
              <div className="memo-exam-notes">
                {journey.readiness.notes.map((note) => (
                  <div key={note.lectureId} className="memo-exam-card memo-exam-note-card">
                    <InstantLink href={noteHref(note.lectureId, null)} className="memo-exam-note-head">
                      <span className="memo-note-emoji">
                        <Emoji symbol={note.emoji ?? "📘"} size="1.3rem" />
                      </span>
                      <span className="memo-note-title">{note.title}</span>
                      <Msym name="chevron_right" size="1.4rem" fill={false} weight={400} />
                    </InstantLink>
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

          <p className="memo-exam-note">
            {t("exam.goal", {
              grade: grade(plan.gradeScale, plan.targetGrade),
              percent: Math.round(plan.targetPercent),
            })}
            {defaultTargetPercent(plan.gradeScale, plan.targetGrade, format.locale) !== plan.targetPercent
              ? ` ${t("exam.goalCustom")}`
              : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
