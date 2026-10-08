"use client";

/* Memo's portrait is the mascot PNG at a fixed small size, as on the onboarding. */
/* eslint-disable @next/next/no-img-element */

import type { CSSProperties } from "react";

import { noteHref, useExamFormat } from "@/components/exam-prep/exam-format";
import { InstantLink } from "@/components/instant-link";
import { Emoji, Msym } from "@/components/msym";
import type { ExamJourney, JourneyDay, JourneyTask, JourneyTaskTab } from "@/lib/exam-prep/model";
import type { ExamTopic, TopicStepId } from "@/lib/exam-prep/topics";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { NOTE_TABS } from "@/lib/note-tabs";

/*
 * Exam prep as Astra AI lays it out, in MemoAI's design: Memo saying where the
 * plan will get the learner and by when, a mastery ring with the goal marked
 * on it, today's goals with one Continue, and the material as topics, each a
 * ladder of the note's own tools that ends in mock exams.
 */

function tabMeta(tab: JourneyTaskTab | null) {
  const note = NOTE_TABS.find((item) => item.id === tab);
  return note ? { icon: note.icon, tint: note.tint } : { icon: "bedtime", tint: null };
}

/** A note tool's glyph on its own tint, as the note's tab pills draw it. */
export function ExamToolTile({ tab, icon }: { tab: JourneyTaskTab | null; icon?: string }) {
  const meta = tabMeta(tab);
  return (
    <span
      className={`memo-exam-tile ${meta.tint ? "" : "plain"}`.trim()}
      style={meta.tint ? ({ "--tile-tint": meta.tint } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      <Msym name={icon ?? meta.icon} size="1.25rem" />
    </span>
  );
}

const RING_R = 52;
const RING_C = 2 * Math.PI * RING_R;

export function ExamMasteryRing({ mastery, target, compact = false }: { mastery: number; target: number; compact?: boolean }) {
  const { t } = useExamFormat();
  const value = Math.max(0, Math.min(100, mastery));
  return (
    <div
      className={`memo-exam-ring ${compact ? "compact" : ""}`.trim()}
      role="img"
      aria-label={t("exam.astra.ringLabel", { mastery: Math.round(value), target: Math.round(target) })}
    >
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="track" cx="60" cy="60" r={RING_R} />
        <circle className="fill" cx="60" cy="60" r={RING_R} strokeDasharray={`${(value / 100) * RING_C} ${RING_C}`} />
        <g transform={`rotate(${(target / 100) * 360} 60 60)`}>
          <rect className="goal" x="104" y="57" width="16" height="6" rx="3" />
        </g>
      </svg>
      <span className="memo-exam-ring-value">
        <strong>{t("exam.percent", { value: Math.round(value) })}</strong>
        {compact ? null : <small>{t("exam.astra.mastery")}</small>}
      </span>
    </div>
  );
}

/** Study days in a row up to today, rest days skipped; today counts once studied. */
export function studyStreak(days: JourneyDay[]) {
  const todayIndex = days.findIndex((day) => day.isToday);
  const studied = (day: JourneyDay) =>
    Boolean(day.activity && day.activity.cards + day.activity.questions + day.activity.tests > 0);
  let streak = todayIndex >= 0 && studied(days[todayIndex]) ? 1 : 0;

  for (let index = (todayIndex >= 0 ? todayIndex : days.length) - 1; index >= 0; index -= 1) {
    const day = days[index];

    if (day.kind === "rest" && !studied(day)) {
      continue;
    }

    if (!studied(day)) {
      break;
    }

    streak += 1;
  }

  return streak;
}

export function ExamMasteryHero({
  journey,
  targetPercent,
  examDate,
  examLabel,
}: {
  journey: ExamJourney;
  targetPercent: number;
  examDate: string;
  /** "Written exam" and the like. */
  examLabel: string;
}) {
  const { t, longDate, taskTitle } = useExamFormat();
  const todayPlan = journey.todayPlan;
  const nextTask = todayPlan?.tasks.find((task) => !task.done) ?? null;
  const streak = studyStreak(journey.days);
  const target = Math.round(targetPercent);

  const said = (() => {
    if (journey.status === "exam_day") {
      return t("exam.astra.bubbleExamDay");
    }

    if (journey.status === "finished") {
      return t("exam.astra.bubbleFinished");
    }

    const promise = t("exam.astra.bubble", { target, date: longDate(examDate) });

    if (todayPlan?.kind === "rest") {
      return `${promise} ${t("exam.astra.bubbleRest")}`;
    }

    if (todayPlan && todayPlan.tasks.length > 0 && !nextTask) {
      return `${promise} ${t("exam.astra.bubbleDone")}`;
    }

    return nextTask ? `${promise} ${t("exam.astra.bubbleToday", { task: taskTitle(nextTask) })}` : promise;
  })();

  return (
    <section className="memo-exam-mastery" aria-label={t("exam.astra.mastery")}>
      <div className="memo-exam-say">
        <img src="/memo-mascot.png" alt="" width={64} height={58} />
        <p className="memo-exam-bubble">{said}</p>
      </div>
      <div className="memo-exam-mastery-row">
        <ExamMasteryRing mastery={journey.mastery} target={target} />
        <div className="memo-exam-facts">
          <div className="memo-exam-fact">
            <span aria-hidden="true"><Emoji symbol="🎯" size="1rem" /></span>
            <p>
              {t("exam.astra.goal", { percent: target })}
              <small>{t("exam.astra.goalSub")}</small>
            </p>
          </div>
          <div className="memo-exam-fact">
            <span aria-hidden="true"><Emoji symbol="⏳" size="1rem" /></span>
            <p>
              {journey.status === "upcoming"
                ? t("exam.astra.daysLeft", { count: journey.daysLeft })
                : journey.status === "exam_day"
                  ? t("exam.astra.today")
                  : t("exam.astra.over")}
              <small>
                {examLabel} · {longDate(examDate)}
              </small>
            </p>
          </div>
          {journey.readiness.unlocked ? (
            <div className="memo-exam-fact">
              <span aria-hidden="true"><Emoji symbol="📈" size="1rem" /></span>
              <p>
                {t("exam.astra.likely", { low: journey.readiness.today.low, high: journey.readiness.today.high })}
                <small>{t("exam.astra.likelySub")}</small>
              </p>
            </div>
          ) : (
            <div className="memo-exam-fact">
              <span aria-hidden="true"><Emoji symbol="🔥" size="1rem" /></span>
              <p>
                {streak > 0 ? t("exam.astra.streak", { count: streak }) : t("exam.astra.streakNone")}
                <small>{streak > 0 ? t("exam.astra.streakSub") : t("exam.astra.streakStart")}</small>
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Today's goals: the planner's tasks for today with their tool, ticked from
 * real study (or by hand where the app cannot see it), and one Continue that
 * opens the first one still open.
 */
export function ExamGoals({
  day,
  onToggle,
  pendingKey = null,
  linkTasks = true,
  currentLectureId = null,
  onOpenTab,
}: {
  day: JourneyDay;
  onToggle?: (task: JourneyTask) => void;
  pendingKey?: string | null;
  /** False on the landing page, where nothing navigates. */
  linkTasks?: boolean;
  currentLectureId?: string | null;
  onOpenTab?: (tab: JourneyTask["tab"]) => void;
}) {
  const { t, taskTitle, taskMeta } = useExamFormat();
  const done = day.tasks.filter((task) => task.done).length;
  const next = day.tasks.find((task) => !task.done) ?? null;

  const open = (task: JourneyTask) => {
    if (task.lectureId === currentLectureId && onOpenTab) {
      onOpenTab(task.tab);
    }
  };
  const hrefFor = (task: JourneyTask) =>
    linkTasks && task.lectureId && task.lectureId !== currentLectureId ? noteHref(task.lectureId, task.tab) : null;

  const continueButton = (() => {
    if (!next) {
      return (
        <p className="memo-exam-goals-done">
          <Emoji symbol="🎉" size="1.2rem" /> {t("exam.astra.allDone")}
        </p>
      );
    }

    const label = (
      <>
        <Msym name="play_arrow" size="1.3rem" />
        {t("exam.astra.continue")}
      </>
    );
    const href = hrefFor(next);

    return href ? (
      <InstantLink href={href} className="memo-exam-continue">
        {label}
      </InstantLink>
    ) : (
      <button
        type="button"
        className="memo-exam-continue"
        disabled={!linkTasks || !next.tab}
        onClick={() => open(next)}
      >
        {label}
      </button>
    );
  })();

  return (
    <section className="memo-exam-block" aria-labelledby="exam-goals-title">
      <div className="memo-exam-block-head">
        <h2 id="exam-goals-title">{t("exam.astra.goals")}</h2>
        <span>{t("exam.astra.goalsCount", { done, total: day.tasks.length, minutes: day.minutes })}</span>
      </div>
      <div className="memo-exam-panel-list">
        {day.tasks.map((task) => {
          const href = hrefFor(task);
          const body = (
            <>
              <ExamToolTile tab={task.tab} icon={task.kind === "wind_down" ? "bedtime" : undefined} />
              <span className="memo-exam-goal-copy">
                <strong>{taskTitle(task)}</strong>
                <small>
                  {/* On this note its title says nothing new; the time does. */}
                  {task.lectureId && task.lectureId === currentLectureId
                    ? t("exam.minutes", { count: task.minutes })
                    : taskMeta(task)}
                </small>
              </span>
            </>
          );
          const tick = task.manual ? (
            <button
              type="button"
              className="memo-exam-tick"
              aria-pressed={task.done}
              aria-label={task.done ? t("exam.today.unmark") : t("exam.today.mark")}
              disabled={!onToggle || pendingKey === task.key}
              onClick={() => onToggle?.(task)}
            >
              {task.done ? <Msym name="check" size="1rem" weight={700} /> : null}
            </button>
          ) : (
            <span className={`memo-exam-tick ${task.done ? "on" : ""}`.trim()} aria-hidden="true">
              {task.done ? <Msym name="check" size="1rem" weight={700} /> : null}
            </span>
          );

          return (
            <div key={task.key} className={`memo-exam-goal ${task.done ? "done" : ""}`.trim()}>
              {href ? (
                <InstantLink href={href} className="memo-exam-goal-main">
                  {body}
                </InstantLink>
              ) : task.tab && linkTasks && task.lectureId === currentLectureId && onOpenTab ? (
                <button type="button" className="memo-exam-goal-main" onClick={() => open(task)}>
                  {body}
                </button>
              ) : (
                <span className="memo-exam-goal-main">{body}</span>
              )}
              {tick}
            </div>
          );
        })}
        {continueButton}
      </div>
    </section>
  );
}

export const STEP_LABEL: Record<TopicStepId, { title: MessageKey; sub: MessageKey }> = {
  lesson: { title: "exam.astra.step.lesson", sub: "exam.astra.step.lessonSub" },
  podcast: { title: "exam.astra.step.podcast", sub: "exam.astra.step.podcastSub" },
  flashcards: { title: "exam.astra.step.flashcards", sub: "exam.astra.step.flashcardsSub" },
  quiz: { title: "exam.astra.step.quiz", sub: "exam.astra.step.quizSub" },
  mindmap: { title: "exam.astra.step.mindmap", sub: "exam.astra.step.mindmapSub" },
  explain: { title: "exam.astra.step.explain", sub: "exam.astra.step.explainSub" },
  repetition: { title: "exam.astra.step.repetition", sub: "exam.astra.step.repetitionSub" },
  gaps: { title: "exam.astra.step.gaps", sub: "exam.astra.step.gapsSub" },
  oral: { title: "exam.astra.step.oral", sub: "exam.astra.step.oralSub" },
  written: { title: "exam.astra.step.written", sub: "exam.astra.step.writtenSub" },
};

const STEP_ICON: Partial<Record<TopicStepId, string>> = {
  repetition: "replay",
  gaps: "flag",
  oral: "record_voice_over",
};

function TopicBar({ value }: { value: number }) {
  return (
    <span className={`memo-exam-bar ${value >= 100 ? "full" : ""}`.trim()} aria-hidden="true">
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

export function ExamTopicList({
  topics,
  showNotes,
  onOpenTopic,
}: {
  topics: ExamTopic[];
  /** The exam covers several notes: say which one each topic comes from. */
  showNotes: boolean;
  onOpenTopic?: (topic: ExamTopic) => void;
}) {
  const { t } = useExamFormat();
  const mastered = topics.filter((topic) => topic.state === "mastered").length;
  const current = topics.find((topic) => topic.state === "current") ?? null;

  return (
    <section className="memo-exam-block" aria-labelledby="exam-topics-title">
      <div className="memo-exam-block-head">
        <h2 id="exam-topics-title">{t("exam.astra.topics")}</h2>
        <span>{t("exam.astra.topicsCount", { done: mastered, total: topics.length })}</span>
      </div>
      <div className="memo-exam-panel-list">
        {topics.map((topic, index) => {
          const stepIndex = topic.steps.findIndex((step) => step.id === topic.currentStep);
          const sub =
            topic.state === "mastered"
              ? t("exam.astra.topicMastered")
              : topic.state === "current" && topic.currentStep
                ? t("exam.astra.topicStep", {
                    step: stepIndex + 1,
                    total: topic.steps.length,
                    name: t(STEP_LABEL[topic.currentStep].title),
                  })
                : current && index > topics.indexOf(current)
                  ? t("exam.astra.topicAfter", { topic: topics[index - 1]?.title ?? "" })
                  : t("exam.astra.topicSoon");
          const body = (
            <>
              <span className={`memo-exam-topic-num ${topic.state}`} aria-hidden="true">
                {topic.state === "mastered" ? <Msym name="check" size="1.1rem" weight={700} /> : index + 1}
              </span>
              <span className="memo-exam-topic-copy">
                <strong>{topic.title}</strong>
                <small>
                  {showNotes ? (
                    <>
                      <Emoji symbol={topic.noteEmoji ?? "📘"} size="0.85rem" />{" "}
                    </>
                  ) : null}
                  {sub}
                </small>
                {topic.state === "later" && topic.mastery === 0 ? null : <TopicBar value={topic.mastery} />}
              </span>
              <span className="memo-exam-topic-pct">
                {topic.state === "later" && topic.mastery === 0 ? (
                  <Msym name={index > 0 && current && index > topics.indexOf(current) ? "lock" : "chevron_right"} size="1.15rem" fill={false} />
                ) : (
                  t("exam.percent", { value: topic.mastery })
                )}
              </span>
            </>
          );

          return onOpenTopic ? (
            <button
              key={topic.key}
              type="button"
              className={`memo-exam-topic ${topic.state}`}
              onClick={() => onOpenTopic(topic)}
            >
              {body}
            </button>
          ) : (
            <div key={topic.key} className={`memo-exam-topic ${topic.state}`}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const STAGES: Array<{ from: number; label: MessageKey }> = [
  { from: 0, label: "exam.astra.stage.learn" },
  { from: 3, label: "exam.astra.stage.practise" },
  { from: 8, label: "exam.astra.stage.mock" },
];

/** One topic's ladder: the note's tools in Astra's order, ending in mock exams. */
export function ExamTopicLadder({
  topic,
  examTitle,
  index,
  total,
  onBack,
  onOpenStep,
}: {
  topic: ExamTopic;
  examTitle: string;
  index: number;
  total: number;
  onBack: () => void;
  onOpenStep: (topic: ExamTopic, step: ExamTopic["steps"][number]) => void;
}) {
  const { t } = useExamFormat();

  return (
    <div className="memo-exam-ladder">
      <button type="button" className="memo-exam-ladder-back" onClick={onBack}>
        <Msym name="arrow_back" size="1.2rem" />
        {t("exam.astra.back")}
      </button>
      <div className="memo-exam-ladder-head">
        <span className="memo-eyebrow">
          {examTitle} · {t("exam.astra.topicOf", { index: index + 1, total })}
        </span>
        <h2>{topic.title}</h2>
        <div className="memo-exam-ladder-mastery">
          <TopicBar value={topic.mastery} />
          <strong>{t("exam.astra.masteryValue", { percent: topic.mastery })}</strong>
        </div>
      </div>
      <ol className="memo-exam-steps">
        {topic.steps.map((step, stepIndex) => {
          const stage = STAGES.find((item) => item.from === stepIndex);
          const state = step.done ? "done" : step.id === topic.currentStep ? "now" : "later";
          return (
            <li key={step.id}>
              {stage ? <p className="memo-exam-stage">{t(stage.label)}</p> : null}
              <button
                type="button"
                className={`memo-exam-step ${state}`}
                onClick={() => onOpenStep(topic, step)}
              >
                <span className="memo-exam-step-dot" aria-hidden="true">
                  {step.done ? <Msym name="check" size="1.05rem" weight={700} /> : stepIndex + 1}
                </span>
                <span className="memo-exam-step-card">
                  <ExamToolTile tab={step.tab} icon={STEP_ICON[step.id]} />
                  <span className="memo-exam-goal-copy">
                    <strong>{t(STEP_LABEL[step.id].title)}</strong>
                    <small>
                      {step.progress > 0 && !step.done
                        ? t("exam.astra.stepProgress", { percent: Math.round(step.progress * 100) })
                        : t(STEP_LABEL[step.id].sub)}
                    </small>
                  </span>
                  {state === "now" ? <span className="memo-exam-step-go">{t("exam.astra.start")}</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
