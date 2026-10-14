"use client";

import { useCallback, useMemo, useState } from "react";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { ExamScreen } from "@/components/exams/exam-screen";
import {
  formatExamDay,
  formatMonth,
  formatWeekdayShort,
} from "@/components/exams/exam-format";
import { LESSON_KIND_KEY, lessonHref } from "@/components/exams/exam-links";
import { MemoBuddy, type BuddyMood } from "@/components/exams/memo-buddy";
import {
  EXAM_LESSON_KINDS,
  monthGrid,
  percent,
  type ExamLessonKind,
} from "@/lib/exams/exam-model";
import type { ExamDetail, ExamModuleView } from "@/lib/exams/exams-server";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { noteEmoji } from "@/lib/note-emoji";

const FORMAT_KEY = { written: "exam.format.written", oral: "exam.format.oral", both: "exam.format.both" } as const;
const KIND_KEY = { midterm: "exam.kind.midterm", exam: "exam.kind.exam", matura: "exam.kind.matura" } as const;

type View = "modules" | "path" | "plan";

const VIEW_KEY: Record<View, MessageKey> = {
  modules: "exam.dash.view.modules",
  path: "exam.dash.view.path",
  plan: "exam.dash.view.plan",
};

/** The next lessons in path order, for "continue" and for today's list. */
function upcomingLessons(modules: ExamModuleView[], count: number) {
  const out: { module: ExamModuleView; kind: ExamLessonKind }[] = [];

  for (const entry of modules) {
    if (!entry.unlocked || !entry.ready || entry.completed) {
      continue;
    }

    for (const kind of EXAM_LESSON_KINDS) {
      if (!entry.done[kind]) {
        out.push({ module: entry, kind });
      }

      if (out.length >= count) {
        return out;
      }
    }
  }

  if (out.length === 0) {
    const review = [...modules]
      .filter((entry) => entry.unlocked && entry.ready)
      .sort((left, right) => left.mastery - right.mastery);

    for (const entry of review.slice(0, count)) {
      out.push({ module: entry, kind: entry.nextKind });
    }
  }

  return out.slice(0, count);
}

function MasteryRing({ value, size = 5.2 }: { value: number; size?: number }) {
  const circumference = 2 * Math.PI * 44;
  const filled = circumference * Math.min(1, Math.max(0, value));

  return (
    <span className="memo-exam-ring" style={{ width: `${size}rem`, height: `${size}rem` }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="44" className="memo-exam-ring-track" />
        <circle
          cx="50"
          cy="50"
          r="44"
          className="memo-exam-ring-fill"
          strokeDasharray={`${filled} ${circumference}`}
        />
      </svg>
      <b>{percent(value)}</b>
    </span>
  );
}

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
  const { exam, modules, plan } = detail;
  const [view, setView] = useState<View>("modules");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [grade, setGrade] = useState(exam.actual_grade ?? "");
  const [gradeSaved, setGradeSaved] = useState(Boolean(exam.actual_grade));
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setConfirmDelete(false);
  }, []);
  const menuSheet = useSheet(closeMenu, { locked: busy });

  const canOpen = (lectureId: string) => hasPaidAccess || trialLectureId === lectureId;
  const next = upcomingLessons(modules, 1)[0] ?? null;
  const todayList = upcomingLessons(modules, Math.max(1, plan.goal - plan.doneToday));
  const examPassed = detail.daysLeft < 0;
  const examToday = detail.daysLeft === 0;
  const goalMet = plan.doneToday >= plan.goal;
  const activeDays = useMemo(() => new Set(detail.activeDays), [detail.activeDays]);

  const buddy: { mood: BuddyMood; line: string } = examPassed
    ? { mood: "wave", line: t("exam.buddy.examPassed") }
    : examToday
      ? { mood: "cheer", line: t("exam.buddy.examToday") }
      : goalMet
        ? { mood: "happy", line: t("exam.buddy.doneToday") }
        : plan.doneToday === 0 && next
          ? { mood: "wave", line: t("exam.buddy.start", { title: next.module.title?.trim() || t("note.untitled") }) }
          : { mood: "idle", line: t("exam.buddy.keepGoing", { count: Math.max(0, plan.goal - plan.doneToday) }) };

  async function mutate(init: RequestInit, after: () => void) {
    setBusy(true);

    try {
      const response = await fetch(`/api/exams/${exam.id}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });

      if (response.ok) {
        after();
      }
    } finally {
      setBusy(false);
    }
  }

  function openModule(module: ExamModuleView, kind: ExamLessonKind) {
    if (!canOpen(module.lectureId)) {
      navigateWithFeedback("/app/start");
      return;
    }

    navigateWithFeedback(lessonHref(exam.id, module.lectureId, kind));
  }

  function moduleSubtitle(module: ExamModuleView) {
    if (!module.ready) {
      return t("exam.dash.notReady");
    }

    if (!canOpen(module.lectureId)) {
      return t("exam.dash.paid");
    }

    if (!module.unlocked) {
      return t("exam.dash.testOut");
    }

    if (module.completed) {
      return t("exam.dash.mastered", { percent: percent(module.mastery) });
    }

    return t("exam.dash.lessonsDone", { done: module.lessonsDone, total: EXAM_LESSON_KINDS.length });
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

  const cta = examPassed ? null : next ? (
    <button
      type="button"
      className="memo-button-coral"
      onClick={() => openModule(next.module, next.kind)}
    >
      {t(next.module.completed ? "exam.dash.review" : "exam.dash.continue", {
        title: next.module.title?.trim() || t("note.untitled"),
        lesson: t(LESSON_KIND_KEY[next.kind]),
      })}
    </button>
  ) : null;

  return (
    <ExamScreen backHref="/app/exams" trailing={trailing} cta={cta}>
      <header className="memo-exam-dash-head">
        <div className="memo-exam-dash-title">
          <h1>{exam.title}</h1>
          <span>
            {t(FORMAT_KEY[exam.exam_format])} · {t("exam.dash.target", { percent: exam.target_mastery })}
          </span>
        </div>
        <MasteryRing value={detail.mastery} />
      </header>

      <div className="memo-exam-countdown">
        <b>
          {examPassed
            ? t("exam.list.past")
            : examToday
              ? t("exam.dash.countdownToday")
              : t("exam.days", { count: detail.daysLeft })}
        </b>
        <span>
          {formatExamDay(exam.exam_date, locale)}
          <br />
          {t(KIND_KEY[exam.exam_kind])}
        </span>
      </div>

      <div className="memo-exam-strip" role="list">
        {detail.strip.map((day) => (
          <span
            key={day.day}
            role="listitem"
            className={[
              "memo-exam-strip-day",
              day.isToday ? "today" : "",
              day.isExam ? "exam" : "",
              day.active ? "active" : "",
              day.isPast && !day.active ? "missed" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <i>{formatWeekdayShort(day.day, locale)}</i>
            <b>{Number(day.day.slice(8))}</b>
          </span>
        ))}
      </div>

      <div className="memo-exam-buddy-line">
        <MemoBuddy mood={buddy.mood} moodKey={buddy.line} size="4.2rem" />
        <p>{buddy.line}</p>
      </div>

      <div className="memo-exam-quota">
        <div>
          <b>{t("exam.dash.todayGoal")}</b>
          <span>
            {plan.doneToday} / {plan.goal}
          </span>
        </div>
        <div className="memo-progress">
          <div style={{ width: `${Math.min(100, Math.round((plan.doneToday / Math.max(1, plan.goal)) * 100))}%` }} />
        </div>
      </div>

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
          </div>
        </div>
      ) : null}

      <div className="memo-segment memo-exam-segment memo-exam-views">
        {(["modules", "path", "plan"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={view === value ? "active" : ""}
            aria-pressed={view === value}
            onClick={() => setView(value)}
          >
            {t(VIEW_KEY[value])}
          </button>
        ))}
      </div>

      {view === "modules" ? (
        <div className="memo-exam-list">
          {modules.map((module) => {
            const locked = !module.unlocked;
            const blocked = !module.ready;

            return (
              <button
                key={module.lectureId}
                type="button"
                className={[
                  "memo-exam-module",
                  module.completed ? "done" : "",
                  next?.module.lectureId === module.lectureId ? "current" : "",
                  locked ? "locked" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                disabled={blocked}
                onClick={() => openModule(module, locked ? "quiz" : module.nextKind)}
              >
                <span className="memo-exam-module-n">
                  {module.completed ? (
                    <Msym name="check" size="1.2rem" />
                  ) : locked ? (
                    <Msym name="lock" size="1.1rem" fill={false} />
                  ) : (
                    module.position + 1
                  )}
                </span>
                <span className="memo-exam-pick-copy">
                  <b>{`${module.emoji || noteEmoji({ id: module.lectureId, title: module.title })} ${module.title?.trim() || t("note.untitled")}`}</b>
                  <span>{moduleSubtitle(module)}</span>
                </span>
                <MasteryRing value={module.mastery} size={2.2} />
              </button>
            );
          })}
        </div>
      ) : view === "path" ? (
        <ol className="memo-exam-path">
          {modules.map((module) => (
            <li
              key={module.lectureId}
              className={[
                module.completed ? "done" : "",
                next?.module.lectureId === module.lectureId ? "current" : "",
                !module.unlocked ? "locked" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                type="button"
                disabled={!module.ready}
                onClick={() => openModule(module, module.unlocked ? module.nextKind : "quiz")}
              >
                <span className="memo-exam-path-dot">
                  {module.completed ? (
                    <Msym name="check" size="1.2rem" />
                  ) : !module.unlocked ? (
                    <Msym name="lock" size="1.1rem" fill={false} />
                  ) : (
                    module.position + 1
                  )}
                </span>
                <span className="memo-exam-pick-copy">
                  <b>{module.title?.trim() || t("note.untitled")}</b>
                  <span>{moduleSubtitle(module)}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="mock">
            <InstantLink href={`/app/exams/${exam.id}/mock`}>
              <span className="memo-exam-path-dot">
                <Emoji symbol="🏆" size="1.1rem" />
              </span>
              <span className="memo-exam-pick-copy">
                <b>{t("exam.mock.title")}</b>
                <span>{t("exam.dash.mock.body")}</span>
              </span>
            </InstantLink>
          </li>
          <li className="flag">
            <span className="memo-exam-path-dot">
              <Emoji symbol="🏁" size="1.1rem" />
            </span>
            <span className="memo-exam-pick-copy">
              <b>{formatExamDay(exam.exam_date, locale)}</b>
            </span>
          </li>
        </ol>
      ) : (
        <div className="memo-exam-plan">
          <div className="memo-exam-calendar">
            <div className="memo-exam-calendar-head">{formatMonth(detail.today, locale)}</div>
            {monthGrid(detail.today).map((cell) => (
              <span
                key={cell.day}
                className={[
                  cell.inMonth ? "" : "out",
                  cell.day === detail.today ? "today" : "",
                  cell.day === exam.exam_date ? "exam" : "",
                  activeDays.has(cell.day) ? "active" : "",
                  cell.day > detail.today && cell.day < exam.exam_date ? "planned" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                {Number(cell.day.slice(8))}
              </span>
            ))}
          </div>
          <span className="memo-eyebrow">{t("exam.dash.todayList")}</span>
          <div className="memo-exam-list">
            {todayList.map(({ module, kind }) => (
              <button
                key={`${module.lectureId}:${kind}`}
                type="button"
                className="memo-exam-module"
                onClick={() => openModule(module, kind)}
              >
                <span className="memo-exam-module-n">{module.position + 1}</span>
                <span className="memo-exam-pick-copy">
                  <b>{t(LESSON_KIND_KEY[kind])}</b>
                  <span>{module.title?.trim() || t("note.untitled")}</span>
                </span>
                <Msym name="chevron_right" size="1.3rem" fill={false} />
              </button>
            ))}
          </div>
        </div>
      )}

      <InstantLink href={`/app/exams/${exam.id}/mock`} className="memo-exam-card memo-exam-mock-card">
        <span className="memo-exam-mock-emoji">
          <Emoji symbol="🏆" size="1.6rem" />
        </span>
        <span className="memo-exam-pick-copy">
          <b>{t("exam.mock.title")}</b>
          <span>
            {detail.latestMock
              ? t("exam.dash.mock.last", {
                  grade: detail.latestMock.grade,
                  percent: Math.round(detail.latestMock.percentage),
                })
              : t("exam.dash.mock.body")}
          </span>
        </span>
        <Msym name="chevron_right" size="1.3rem" fill={false} />
      </InstantLink>

      {menuOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", menuSheet.closing)}
            onClick={() => menuSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet", menuSheet.closing)}
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
            {confirmDelete ? (
              <>
                <p className="memo-sheet-copy">{t("exam.dash.delete.body")}</p>
                <div className="memo-sheet-actions">
                  <button
                    type="button"
                    className="memo-sheet-danger"
                    disabled={busy}
                    onClick={() =>
                      void mutate({ method: "DELETE" }, () => navigateWithFeedback("/app/exams"))
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
                      { method: "PATCH", body: JSON.stringify({ archived: !exam.archived_at }) },
                      () => navigateWithFeedback("/app/exams"),
                    )
                  }
                >
                  {exam.archived_at ? t("exam.dash.unarchive") : t("exam.dash.archive")}
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
