"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { ExamScreen } from "@/components/exams/exam-screen";
import { formatExamDay, formatExamDayLong } from "@/components/exams/exam-format";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { useOfflineGuard } from "@/components/offline/offline-notice";
import {
  addDays,
  daysBetween,
  isValidDay,
  targetGrade,
  type ExamFormat,
  type ExamGradingScale,
  type ExamKind,
} from "@/lib/exams/exam-model";
import { noteEmoji } from "@/lib/note-emoji";

export type ExamSetupNote = {
  id: string;
  title: string | null;
  emoji: string | null;
  ready: boolean;
};

export type ExamSetupFolder = { id: string; name: string; lectureIds: string[] };

const STEPS = ["material", "subject", "date", "target", "type", "review"] as const;
type Step = (typeof STEPS)[number];

const TARGETS = [75, 90, 100] as const;
const MINUTES = [15, 30, 45, 60] as const;
const PASS_MARKS = [50, 55, 60] as const;
const KINDS: ExamKind[] = ["midterm", "exam", "matura"];
const FORMATS: ExamFormat[] = ["written", "oral", "both"];
const SCALES: ExamGradingScale[] = ["uni_5_10", "school_1_5", "percent"];

const KIND_KEY = { midterm: "exam.kind.midterm", exam: "exam.kind.exam", matura: "exam.kind.matura" } as const;
const FORMAT_KEY = { written: "exam.format.written", oral: "exam.format.oral", both: "exam.format.both" } as const;
const FORMAT_BODY_KEY = {
  written: "exam.format.writtenBody",
  oral: "exam.format.oralBody",
  both: "exam.format.bothBody",
} as const;
const SCALE_KEY = { uni_5_10: "exam.scale.uni", school_1_5: "exam.scale.school", percent: "exam.scale.percent" } as const;

/** The dial's knob position for a target, as a point on the ring (0 % at the top, clockwise). */
function dialKnob(percent: number) {
  const angle = (percent / 100) * Math.PI * 2;
  return { left: `${50 + 45 * Math.sin(angle)}%`, top: `${50 - 45 * Math.cos(angle)}%` };
}

export function ExamSetup({
  notes,
  folders,
  today,
  initialFolderId,
  defaultMinutes,
  lockedCount = 0,
}: {
  notes: ExamSetupNote[];
  folders: ExamSetupFolder[];
  today: string;
  initialFolderId: string | null;
  defaultMinutes: number;
  /** Notes the learner has but cannot study without a plan. */
  lockedCount?: number;
}) {
  const { t, locale } = useTranslations();
  const { navigateWithFeedback } = useInstantNavigation();
  const { blockedOffline, offlineToast } = useOfflineGuard();
  const initialFolder = folders.find((folder) => folder.id === initialFolderId) ?? null;
  const readyIds = useMemo(() => new Set(notes.filter((note) => note.ready).map((note) => note.id)), [notes]);

  const [step, setStep] = useState<Step>("material");
  const [selected, setSelected] = useState<string[]>(() =>
    initialFolder ? initialFolder.lectureIds.filter((id) => readyIds.has(id)) : [],
  );
  const [folderId, setFolderId] = useState<string | null>(initialFolder?.id ?? null);
  const [title, setTitle] = useState(initialFolder?.name ?? "");
  const [examDate, setExamDate] = useState(addDays(today, 14));
  const [target, setTarget] = useState<number>(90);
  const [minutes, setMinutes] = useState<number>(
    MINUTES.reduce((best, value) => (Math.abs(value - defaultMinutes) < Math.abs(best - defaultMinutes) ? value : best), 30),
  );
  const [kind, setKind] = useState<ExamKind>("exam");
  const [format, setFormat] = useState<ExamFormat>("written");
  const [scale, setScale] = useState<ExamGradingScale>("uni_5_10");
  const [passMark, setPassMark] = useState<number>(50);
  const [creating, setCreating] = useState(false);
  /*
   * "Next" and "Start my plan" sit in the same place, so a quick double tap on the last question
   * would otherwise create the exam before its review has been seen.
   */
  const stepShownAt = useRef(0);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.indexOf(step);
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const days = daysBetween(today, examDate);

  const canContinue =
    step === "material"
      ? selected.length > 0
      : step === "subject"
        ? title.trim().length > 0
        : step === "date"
          ? isValidDay(examDate) && days >= 0
          : true;

  function toggleNote(id: string) {
    setFolderId(null);
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  function chooseFolder(folder: ExamSetupFolder) {
    if (folderId === folder.id) {
      setFolderId(null);
      setSelected([]);
      return;
    }

    setFolderId(folder.id);
    setSelected(folder.lectureIds.filter((id) => readyIds.has(id)));

    if (!title.trim()) {
      setTitle(folder.name);
    }
  }

  function goNext() {
    setError(null);

    if (step === "material" && !title.trim()) {
      const first = notesById.get(selected[0]);
      setTitle(folderId ? (folders.find((folder) => folder.id === folderId)?.name ?? "") : (first?.title ?? ""));
    }

    if (stepIndex < STEPS.length - 1) {
      stepShownAt.current = Date.now();
      setStep(STEPS[stepIndex + 1]);
    }
  }

  function goBack() {
    setError(null);

    if (stepIndex > 0) {
      setStep(STEPS[stepIndex - 1]);
    }
  }

  function move(index: number, delta: number) {
    setSelected((current) => {
      const next = [...current];
      const target = index + delta;

      if (target < 0 || target >= next.length) {
        return current;
      }

      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function create() {
    if (creating || Date.now() - stepShownAt.current < 600 || blockedOffline("create")) {
      return;
    }

    setCreating(true);
    setError(null);

    try {
      const response = await fetch("/api/exams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          examDate,
          targetMastery: target,
          dailyMinutes: minutes,
          examFormat: format,
          examKind: kind,
          gradingScale: scale,
          passPercentage: passMark,
          lectureIds: selected,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { exam?: { id: string }; error?: string }
        | null;

      if (!response.ok || !payload?.exam) {
        setError(payload?.error ?? t("exam.setup.error"));
        setCreating(false);
        return;
      }

      navigateWithFeedback(`/app/exams/${payload.exam.id}`);
    } catch {
      setError(t("exam.setup.error"));
      setCreating(false);
    }
  }

  const quickDates = [
    { label: t("exam.setup.date.tomorrow"), day: addDays(today, 1) },
    { label: t("exam.setup.date.inDays", { count: 3 }), day: addDays(today, 3) },
    { label: t("exam.setup.date.inWeek"), day: addDays(today, 7) },
    { label: t("exam.setup.date.inTwoWeeks"), day: addDays(today, 14) },
  ];

  const isLast = step === "review";
  const cta = notes.length === 0 ? null : (
    <div className="memo-exam-cta-row">
      {stepIndex > 0 ? (
        <button type="button" className="memo-button-ghost" onClick={goBack} disabled={creating}>
          {t("common.back")}
        </button>
      ) : null}
      <button
        type="button"
        className="memo-button-coral"
        disabled={!canContinue || creating}
        onClick={isLast ? () => void create() : goNext}
      >
        {isLast
          ? creating
            ? t("exam.setup.creating")
            : t("exam.setup.review.start", { count: Math.max(1, days) })
          : step === "date" && canContinue
            ? t("exam.setup.nextWithDate", { date: formatExamDay(examDate, locale) })
            : t("exam.setup.next")}
      </button>
    </div>
  );

  return (
    <ExamScreen
      backHref="/app/exams"
      backIcon="close"
      backLabel={t("common.back")}
      historyBack
      title={t("exam.setup.title")}
      cta={cta}
    >
      {offlineToast}
      <div className="memo-progress memo-exam-steps" aria-label={t("exam.setup.stepOf", { step: stepIndex + 1, total: STEPS.length })}>
        <div style={{ width: `${Math.round(((stepIndex + 1) / STEPS.length) * 100)}%` }} />
      </div>

      {notes.length === 0 && lockedCount > 0 ? (
        <div className="memo-exam-empty">
          <MemoBuddy mood="wave" size="7rem" thought="🎓" />
          <h1>{t("exam.setup.material.locked.title")}</h1>
          <p>{t("exam.setup.material.locked.body")}</p>
          <button type="button" className="memo-button-coral" onClick={() => navigateWithFeedback("/app/start")}>
            {t("exam.mock.paid.cta")}
          </button>
        </div>
      ) : notes.length === 0 ? (
        <div className="memo-exam-empty">
          <MemoBuddy mood="wave" size="7rem" />
          <h1>{t("exam.setup.material.empty.title")}</h1>
          <p>{t("exam.setup.material.empty.body")}</p>
          <button type="button" className="memo-button-coral" onClick={() => navigateWithFeedback("/app?mode=text")}>
            {t("exam.setup.material.empty.cta")}
          </button>
        </div>
      ) : step === "material" ? (
        <section className="memo-exam-step">
          <div className="memo-exam-step-head">
            <MemoBuddy mood="wave" size="4.6rem" thought="📚" />
            <div>
              <h1>{t("exam.setup.material.title")}</h1>
              <p>{t("exam.setup.material.body")}</p>
            </div>
          </div>

          {folders.length > 0 ? (
            <>
              <span className="memo-eyebrow">{t("exam.setup.material.folders")}</span>
              <div className="memo-chip-row memo-exam-chips">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    type="button"
                    className={`memo-chip ${folderId === folder.id ? "active" : ""}`.trim()}
                    aria-pressed={folderId === folder.id}
                    onClick={() => chooseFolder(folder)}
                  >
                    <Emoji symbol="📁" size="1rem" /> {folder.name}
                  </button>
                ))}
              </div>
            </>
          ) : null}

          <span className="memo-eyebrow">{t("exam.setup.material.notes")}</span>
          <div className="memo-exam-list">
            {notes.map((note) => {
              const isOn = selected.includes(note.id);

              return (
                <button
                  key={note.id}
                  type="button"
                  className={`memo-exam-pick ${isOn ? "on" : ""}`.trim()}
                  aria-pressed={isOn}
                  disabled={!note.ready}
                  onClick={() => toggleNote(note.id)}
                >
                  <span className="memo-exam-pick-emoji">
                    <Emoji symbol={note.emoji || noteEmoji({ id: note.id, title: note.title })} size="1.25rem" />
                  </span>
                  <span className="memo-exam-pick-copy">
                    <b>{note.title?.trim() || t("note.untitled")}</b>
                    {!note.ready ? <span>{t("exam.setup.material.notReady")}</span> : null}
                  </span>
                  <Msym
                    name={isOn ? "check_circle" : "radio_button_unchecked"}
                    size="1.5rem"
                    fill={isOn}
                    className="memo-exam-pick-mark"
                  />
                </button>
              );
            })}
          </div>

          <p className="memo-exam-fine">
            {t("exam.setup.selected", { count: selected.length })}
          </p>
          <button type="button" className="memo-exam-link" onClick={() => navigateWithFeedback("/app?mode=text")}>
            <Msym name="add" size="1.2rem" fill={false} /> {t("exam.setup.material.addMore")}
          </button>
        </section>
      ) : step === "subject" ? (
        <section className="memo-exam-step">
          <div className="memo-exam-step-head">
            <MemoBuddy mood="happy" size="4.6rem" thought="🎓" />
            <div>
              <h1>{t("exam.setup.subject.title")}</h1>
              <p>{t("exam.setup.subject.body")}</p>
            </div>
          </div>
          <input
            id="exam-title"
            className="memo-field memo-exam-input"
            value={title}
            maxLength={120}
            autoComplete="off"
            placeholder={t("exam.setup.subject.placeholder")}
            onChange={(event) => setTitle(event.target.value)}
          />
        </section>
      ) : step === "date" ? (
        <section className="memo-exam-step">
          <div className="memo-exam-step-head">
            <MemoBuddy mood="idle" size="4.6rem" thought="📅" />
            <div>
              <h1>{t("exam.setup.date.title")}</h1>
            </div>
          </div>
          <div className="memo-exam-quick">
            {quickDates.map((entry) => (
              <button
                key={entry.day}
                type="button"
                className={`memo-exam-quick-card ${examDate === entry.day ? "on" : ""}`.trim()}
                aria-pressed={examDate === entry.day}
                onClick={() => setExamDate(entry.day)}
              >
                <b>{entry.label}</b>
                <span>{formatExamDay(entry.day, locale)}</span>
              </button>
            ))}
          </div>
          <div className="memo-exam-or">{t("exam.setup.date.or")}</div>
          <label className="memo-exam-date" htmlFor="exam-date">
            <Msym name="event" size="1.35rem" fill={false} />
            <input
              id="exam-date"
              aria-label={t("exam.setup.date.pick")}
              type="date"
              min={today}
              value={examDate}
              onChange={(event) => setExamDate(event.target.value)}
            />
          </label>
          {isValidDay(examDate) && days >= 0 ? (
            <p className="memo-exam-fine">{formatExamDayLong(examDate, locale)} · {t("exam.days", { count: days })}</p>
          ) : null}
        </section>
      ) : step === "target" ? (
        <section className="memo-exam-step">
          <h1 className="memo-exam-step-title">{t("exam.setup.target.title")}</h1>
          <div className="memo-exam-dial" style={{ "--memo-exam-dial": `${target}%` } as CSSProperties}>
            <span className="memo-exam-dial-ring" aria-hidden="true" />
            <span className="memo-exam-dial-knob" aria-hidden="true" style={dialKnob(target)} />
            <span className="memo-exam-dial-center">
              <b>{target} %</b>
              <span>{t("exam.setup.target.grade", { grade: targetGrade(scale, target, passMark) })}</span>
            </span>
          </div>
          <div className="memo-segment memo-exam-segment">
            {TARGETS.map((value) => (
              <button
                key={value}
                type="button"
                className={target === value ? "active" : ""}
                aria-pressed={target === value}
                onClick={() => setTarget(value)}
              >
                {value} %
              </button>
            ))}
          </div>
          <span className="memo-exam-label">{t("exam.setup.target.minutes")}</span>
          <div className="memo-segment memo-exam-segment">
            {MINUTES.map((value) => (
              <button
                key={value}
                type="button"
                className={minutes === value ? "active" : ""}
                aria-pressed={minutes === value}
                onClick={() => setMinutes(value)}
              >
                {t("exam.minutes", { minutes: value })}
              </button>
            ))}
          </div>
        </section>
      ) : step === "type" ? (
        <section className="memo-exam-step">
          <h1 className="memo-exam-step-title">{t("exam.setup.type.title")}</h1>
          <div className="memo-segment memo-exam-segment">
            {KINDS.map((value) => (
              <button
                key={value}
                type="button"
                className={kind === value ? "active" : ""}
                aria-pressed={kind === value}
                onClick={() => {
                  setKind(value);

                  if (value === "matura") {
                    setScale("school_1_5");
                  }
                }}
              >
                {t(KIND_KEY[value])}
              </button>
            ))}
          </div>
          <div className="memo-exam-list">
            {FORMATS.map((value) => (
              <button
                key={value}
                type="button"
                className={`memo-exam-pick ${format === value ? "on" : ""}`.trim()}
                aria-pressed={format === value}
                onClick={() => setFormat(value)}
              >
                <span className="memo-exam-pick-copy">
                  <b>{t(FORMAT_KEY[value])}</b>
                  <span>{t(FORMAT_BODY_KEY[value])}</span>
                </span>
                <Msym
                  name={format === value ? "radio_button_checked" : "radio_button_unchecked"}
                  size="1.5rem"
                  fill={format === value}
                  className="memo-exam-pick-mark"
                />
              </button>
            ))}
          </div>
          <span className="memo-exam-label">{t("exam.setup.type.scale")}</span>
          <div className="memo-segment memo-exam-segment">
            {SCALES.map((value) => (
              <button
                key={value}
                type="button"
                className={scale === value ? "active" : ""}
                aria-pressed={scale === value}
                onClick={() => setScale(value)}
              >
                {t(SCALE_KEY[value])}
              </button>
            ))}
          </div>
          <span className="memo-exam-label">{t("exam.setup.type.pass")}</span>
          <div className="memo-segment memo-exam-segment">
            {PASS_MARKS.map((value) => (
              <button
                key={value}
                type="button"
                className={passMark === value ? "active" : ""}
                aria-pressed={passMark === value}
                onClick={() => setPassMark(value)}
              >
                {value} %
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="memo-exam-step">
          <h1 className="memo-exam-step-title">{t("exam.setup.review.title")}</h1>
          <div className="memo-exam-countdown">
            <b>{t("exam.days", { count: Math.max(0, days) })}</b>
            <span>
              {formatExamDay(examDate, locale)}
              <br />
              {title.trim()} · {t(FORMAT_KEY[format]).toLowerCase()}
            </span>
          </div>
          <span className="memo-eyebrow">{t("exam.setup.review.modules")}</span>
          <ol className="memo-exam-review">
            {selected.map((id, index) => {
              const note = notesById.get(id);

              return (
                <li key={id}>
                  <span className="memo-exam-review-n">{index + 1}</span>
                  <span className="memo-exam-review-title">{note?.title?.trim() || t("note.untitled")}</span>
                  <span className="memo-exam-review-actions">
                    <button type="button" className="memo-icon-button" aria-label={t("exam.setup.review.moveUp")} disabled={index === 0} onClick={() => move(index, -1)}>
                      <Msym name="arrow_upward" size="1.1rem" fill={false} />
                    </button>
                    <button type="button" className="memo-icon-button" aria-label={t("exam.setup.review.moveDown")} disabled={index === selected.length - 1} onClick={() => move(index, 1)}>
                      <Msym name="arrow_downward" size="1.1rem" fill={false} />
                    </button>
                    <button type="button" className="memo-icon-button" aria-label={t("exam.setup.review.remove")} disabled={selected.length === 1} onClick={() => setSelected((current) => current.filter((entry) => entry !== id))}>
                      <Msym name="close" size="1.1rem" fill={false} />
                    </button>
                  </span>
                </li>
              );
            })}
            <li className="memo-exam-review-mock">
              <span className="memo-exam-review-n">
                <Emoji symbol="🏆" size="1rem" />
              </span>
              <span className="memo-exam-review-title">{t("exam.mock.title")}</span>
            </li>
          </ol>
          <p className="memo-exam-fine">{t("exam.setup.review.hint")}</p>
          {error ? <p className="memo-inline-error">{error}</p> : null}
        </section>
      )}
    </ExamScreen>
  );
}
