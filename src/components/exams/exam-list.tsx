"use client";

import { InstantLink } from "@/components/instant-link";
import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { ExamScreen } from "@/components/exams/exam-screen";
import { formatExamDay } from "@/components/exams/exam-format";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { percent } from "@/lib/exams/exam-model";
import type { ExamListItem } from "@/lib/exams/exams-server";

export function ExamList({ items }: { items: ExamListItem[] }) {
  const { t, locale } = useTranslations();
  const { navigateWithFeedback } = useInstantNavigation();
  const upcoming = items.filter((item) => !item.exam.archived_at && item.daysLeft >= 0);
  const past = items.filter((item) => item.exam.archived_at || item.daysLeft < 0);

  const card = (item: ExamListItem) => (
    <InstantLink
      key={item.exam.id}
      href={`/app/exams/${item.exam.id}`}
      className={`memo-exam-card memo-exam-list-card ${item.daysLeft < 0 || item.exam.archived_at ? "past" : ""}`.trim()}
    >
      <span className="memo-exam-pick-copy">
        <span className="memo-eyebrow">
          {item.daysLeft < 0
            ? t("exam.list.past")
            : item.daysLeft === 0
              ? t("exam.list.today")
              : t("exam.list.inDays", { count: item.daysLeft })}{" "}
          · {formatExamDay(item.exam.exam_date, locale)}
        </span>
        <b className="memo-exam-list-title">{item.exam.title}</b>
        <span>
          {item.exam.actual_grade
            ? t("exam.list.grade", { grade: item.exam.actual_grade })
            : `${t("exam.list.mastery", { percent: percent(item.mastery) })} · ${t("exam.dash.today", { done: item.doneToday, goal: item.goal })}`}
        </span>
      </span>
      {item.daysLeft >= 0 && !item.exam.archived_at ? (
        <span className="memo-exam-count-chip">
          <b>{item.daysLeft}</b>
          <i>{t("exam.list.daysShort", { count: item.daysLeft })}</i>
        </span>
      ) : (
        <Msym name="chevron_right" size="1.3rem" fill={false} />
      )}
    </InstantLink>
  );

  return (
    <ExamScreen
      backHref="/app"
      title={t("exam.list.title")}
      cta={
        <button type="button" className="memo-button-coral" onClick={() => navigateWithFeedback("/app/exams/new")}>
          <Msym name="add" size="1.3rem" fill={false} /> {t("exam.list.new")}
        </button>
      }
    >
      <h1 className="memo-exam-step-title memo-only-desktop">{t("exam.list.title")}</h1>

      {items.length === 0 ? (
        <div className="memo-exam-empty">
          <MemoBuddy mood="wave" size="7rem" thought="📅" />
          <h1>{t("exam.list.empty.title")}</h1>
          <p>{t("exam.list.empty.body")}</p>
        </div>
      ) : (
        <>
          <div className="memo-exam-list">{upcoming.map(card)}</div>
          {past.length > 0 ? (
            <>
              <span className="memo-eyebrow">{t("exam.list.pastSection")}</span>
              <div className="memo-exam-list">{past.map(card)}</div>
            </>
          ) : null}
        </>
      )}
    </ExamScreen>
  );
}
