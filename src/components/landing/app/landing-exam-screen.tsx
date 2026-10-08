"use client";

import { useMemo, useState } from "react";

import { ExamHero } from "@/components/exam-prep/exam-hero";
import { ExamReadinessCard } from "@/components/exam-prep/exam-readiness-card";
import { ExamTodayTasks } from "@/components/exam-prep/exam-today";
import { useT } from "@/components/i18n-provider";
import { addDays, dayKeyAt } from "@/lib/exam-prep/dates";
import { buildExamJourney } from "@/lib/exam-prep/journey";
import type {
  ExamJourney,
  ExamMaterialNote,
  ExamPlanSettings,
  StudyEvent,
} from "@/lib/exam-prep/model";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

import { LandingAppScope, type LandingAppTheme } from "./landing-app-scope";

const DAY_MS = 86_400_000;
const ZONE = "Europe/Ljubljana";

/**
 * The landing's sample lecture as exam material, and a week of study on it.
 *
 * The journey is computed by the app's own planner and forecast
 * (`src/lib/exam-prep/journey.ts`) from that history, exactly as the app would
 * compute it, so what the landing shows is what a learner would see.
 */
function buildLandingJourney(t: Translate<MessageKey>, now: number) {
  const sectionTitles: MessageKey[] = [
    "flowDemo.note.overview",
    "flowDemo.note.typesHeading",
    "flowDemo.note.bullet1Term",
    "flowDemo.note.bullet2Term",
    "flowDemo.note.bullet3Term",
  ];
  const note: ExamMaterialNote = {
    lectureId: "landing-exam-note",
    title: t("flowDemo.note.leadA"),
    emoji: "💼",
    sections: sectionTitles.map((key, s) => ({
      id: `s${s}`,
      title: t(key),
      cardIds: Array.from({ length: 8 }, (_, c) => `c${s}-${c}`),
      words: 500,
    })),
    quizQuestionIds: Array.from({ length: 16 }, (_, q) => `q${q}`),
    practiceQuestionIds: Array.from({ length: 10 }, (_, q) => `p${q}`),
    words: 2500,
    ready: true,
  };
  const today = dayKeyAt(now, ZONE);
  const settings: ExamPlanSettings = {
    id: "landing-exam",
    title: t("flowDemo.note.leadA"),
    examDate: addDays(today, 11),
    examType: "written",
    gradeScale: "ten_point",
    targetGrade: "9",
    targetPercent: 81,
    dailyMinutes: 30,
    restDays: 1 << 6,
    timeZone: ZONE,
    startDay: addDays(today, -7),
    resultPercent: null,
    resultGrade: null,
  };

  // Seven days in: three sections learned and reviewed, two quizzes taken.
  const events: StudyEvent[] = [];
  const start = now - 7 * DAY_MS;

  note.sections.slice(0, 3).forEach((section, s) => {
    section.cardIds.forEach((itemId, c) => {
      const learned = start + s * 2 * DAY_MS + c * 60_000;
      events.push({ lectureId: note.lectureId, kind: "flashcard", itemId, outcome: c % 4 === 1 ? 1 : 3, atMs: learned });
      events.push({ lectureId: note.lectureId, kind: "flashcard", itemId, outcome: c % 5 === 2 ? 1 : 3, atMs: learned + 2 * DAY_MS });
    });
  });

  note.quizQuestionIds.slice(0, 14).forEach((itemId, q) => {
    events.push({ lectureId: note.lectureId, kind: "quiz", itemId, outcome: q % 4 === 3 ? 1 : 3, atMs: start + (q < 7 ? 3 : 5) * DAY_MS + q * 30_000 });
  });

  return buildExamJourney({
    settings,
    notes: [note],
    evidence: { events, practiceAnswers: [], checks: [] },
    nowMs: now,
  });
}

/**
 * Exam prep, as the journey screen draws it: the countdown, how close the
 * learner is to their grade, and today's tasks. Local state only; nothing
 * navigates.
 */
export function LandingExamScreen({
  theme,
  className,
}: {
  theme?: LandingAppTheme;
  className?: string;
}) {
  const t = useT();
  // Dates are relative to now, so nothing is built on the server, where "today"
  // could be a different day. The showcase only mounts this in the browser.
  const [now] = useState(() => (typeof window === "undefined" ? null : Date.now()));
  const journey: ExamJourney | null = useMemo(
    () => (now == null ? null : buildLandingJourney(t, now)),
    [now, t],
  );

  return (
    <LandingAppScope theme={theme} className={["landing-study-screen", className].filter(Boolean).join(" ")}>
      <div className="landing-study-frame memo-exam-tab">
        {journey ? (
          <>
            <ExamHero journey={journey} />
            <div className="memo-exam-section">
              <ExamReadinessCard
                readiness={journey.readiness}
                gradeScale="ten_point"
                targetGrade="9"
                targetPercent={81}
              />
            </div>
            {journey.todayPlan ? (
              <div className="memo-exam-section">
                <ExamTodayTasks day={journey.todayPlan} linkTasks={false} />
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </LandingAppScope>
  );
}
