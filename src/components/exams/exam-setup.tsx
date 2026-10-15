"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { EXAM_PREPS_HREF } from "@/components/exams/exam-links";
import { ExamScreen } from "@/components/exams/exam-screen";
import { formatExamDay, formatExamDayLong, formatMonth, formatWeekdayShort } from "@/components/exams/exam-format";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { MemoSays } from "@/components/exams/memo-says";
import { TargetDial } from "@/components/exams/target-dial";
import type { NoteSourceMode } from "@/components/note-source-modal";
import { useOfflineGuard } from "@/components/offline/offline-notice";
import { cameFromAppPath } from "@/lib/app-history";
import {
  addDays,
  daysBetween,
  isValidDay,
  LESSON_MINUTES,
  LESSONS_TO_LEARN,
  MAX_EXAM_MODULES,
  MAX_SETUP_UPLOADS,
  monthGrid,
} from "@/lib/exams/exam-model";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { noteEmoji } from "@/lib/note-emoji";
import { getOnboardingYearOptions, SCHOOL_OPTIONS } from "@/lib/onboarding-options";
import { currentPaywallBack, paywallPath } from "@/lib/paywall-reasons";

export type ExamSetupNote = {
  id: string;
  title: string | null;
  emoji: string | null;
  ready: boolean;
};

export type ExamSetupFolder = { id: string; name: string; lectureIds: string[] };

export type ExamSetupSchool = { level: string | null; year: string | null };

/** A topic on the plan review, as the learner leaves it: kept or not, renamed, or added. */
type PlanTopic = {
  key: string;
  lectureId: string;
  title: string;
  summary: string;
  keyPoints: string[];
  source: "material" | "added" | "ai";
  kept: boolean;
};

type PlanNote = { lectureId: string; status: "planned" | "pending" };

type PlanState =
  | { status: "idle" }
  | { status: "loading"; key: string }
  | { status: "done"; key: string; notes: PlanNote[] }
  | { status: "failed"; key: string };

/* Onboarding's school levels map onto its year lists through the learner's role. */
const ROLE_FOR_LEVEL: Record<string, string> = {
  elementary_school: "elementary_student",
  high_school: "high_school_student",
  university: "university_student",
};

/* The app's own capture sheet, loaded only when material is being added. */
const NoteSourceModal = dynamic(() =>
  import("@/components/note-source-modal").then((module) => module.NoteSourceModal),
);

/* The capture sources, in the "Novo" sheet's order and with its labels. */
const SOURCE_OPTIONS: { mode: NoteSourceMode; emoji: string; labelKey: MessageKey }[] = [
  { mode: "text", emoji: "📚", labelKey: "library.create.text" },
  { mode: "record", emoji: "🎙️", labelKey: "library.create.record" },
  { mode: "upload", emoji: "🔊", labelKey: "library.quickAction.audio" },
  { mode: "link", emoji: "🔗", labelKey: "library.create.link" },
];

/*
 * The setup is built like the app's onboarding: one question per screen, asked by Memo, with a
 * few screens between them that only encourage — what the plan will look like, then the plan
 * being put together. Grading is a percentage; format and exam kind keep their defaults, since
 * nothing in the product reads them differently yet.
 */
const STEPS = [
  "intro",
  "material",
  "ai",
  "subject",
  "date",
  "motivate",
  "target",
  "school",
  "minutes",
  "building",
  "review",
] as const;
type Step = (typeof STEPS)[number];

const PASS_MARK = 50;
/* The "Creating your study path" screen stays at least this long, even when the plan is ready. */
const BUILDING_MS = 2400;

const MINUTE_OPTIONS: { minutes: number; emoji: string; labelKey: MessageKey }[] = [
  { minutes: 15, emoji: "🍃", labelKey: "exam.setup.minutes.light" },
  { minutes: 30, emoji: "🌱", labelKey: "exam.setup.minutes.regular" },
  { minutes: 45, emoji: "🌿", labelKey: "exam.setup.minutes.serious" },
  { minutes: 60, emoji: "🌳", labelKey: "exam.setup.minutes.intense" },
];

function monthOf(day: string) {
  return `${day.slice(0, 7)}-01`;
}

function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split("-").map(Number);
  return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** A plain month calendar: past days cannot be picked, today is ringed, the exam day is coral. */
function ExamCalendar({
  today,
  value,
  onChange,
}: {
  today: string;
  value: string;
  onChange: (day: string) => void;
}) {
  const { t, locale } = useTranslations();
  const [month, setMonth] = useState(() => monthOf(value || today));
  const cells = monthGrid(month);
  const canGoBack = month > monthOf(today);

  return (
    <div className="memo-exam-cal">
      <div className="memo-exam-cal-head">
        <button
          type="button"
          className="memo-icon-button"
          aria-label={t("exam.setup.date.previousMonth")}
          disabled={!canGoBack}
          onClick={() => setMonth(shiftMonth(month, -1))}
        >
          <Msym name="chevron_left" size="1.3rem" fill={false} />
        </button>
        <b>{formatMonth(month, locale)}</b>
        <button
          type="button"
          className="memo-icon-button"
          aria-label={t("exam.setup.date.nextMonth")}
          onClick={() => setMonth(shiftMonth(month, 1))}
        >
          <Msym name="chevron_right" size="1.3rem" fill={false} />
        </button>
      </div>
      <div className="memo-exam-cal-grid" role="grid">
        {cells.slice(0, 7).map((cell) => (
          <span key={`head-${cell.day}`} className="memo-exam-cal-weekday" aria-hidden="true">
            {formatWeekdayShort(cell.day, locale).slice(0, 3)}
          </span>
        ))}
        {cells.map((cell) => {
          const selected = cell.day === value;

          return (
            <button
              key={cell.day}
              type="button"
              role="gridcell"
              disabled={cell.day < today || !cell.inMonth}
              aria-selected={selected}
              aria-label={formatExamDay(cell.day, locale)}
              className={[
                "memo-exam-cal-day",
                cell.inMonth ? "" : "out",
                cell.day === today ? "today" : "",
                selected ? "selected" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => onChange(cell.day)}
            >
              {Number(cell.day.slice(8))}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ExamSetup({
  notes,
  folders,
  today,
  initialFolderId,
  defaultMinutes,
  lockedCount = 0,
  canCreateNotes = false,
  school = { level: null, year: null },
}: {
  notes: ExamSetupNote[];
  folders: ExamSetupFolder[];
  today: string;
  initialFolderId: string | null;
  defaultMinutes: number;
  /** Notes the learner has but cannot study without a plan. */
  lockedCount?: number;
  /** Whether new material can be turned into notes from here. */
  canCreateNotes?: boolean;
  /** The learner's school and year from onboarding, the school step's starting point. */
  school?: ExamSetupSchool;
}) {
  const { t, locale } = useTranslations();
  const router = useRouter();
  const { navigateWithFeedback } = useInstantNavigation();
  const { blockedOffline, offlineToast } = useOfflineGuard();
  const initialFolder = folders.find((folder) => folder.id === initialFolderId) ?? null;
  const readyIds = useMemo(() => new Set(notes.filter((note) => note.ready).map((note) => note.id)), [notes]);

  const [step, setStep] = useState<Step>("intro");
  const [selected, setSelected] = useState<string[]>(() =>
    initialFolder ? initialFolder.lectureIds.filter((id) => readyIds.has(id)) : [],
  );
  const [folderId, setFolderId] = useState<string | null>(initialFolder?.id ?? null);
  const [title, setTitle] = useState(initialFolder?.name ?? "");
  const [examDate, setExamDate] = useState(addDays(today, 14));
  const [target, setTarget] = useState<number>(90);
  const [minutes, setMinutes] = useState<number>(
    MINUTE_OPTIONS.reduce(
      (best, option) => (Math.abs(option.minutes - defaultMinutes) < Math.abs(best - defaultMinutes) ? option.minutes : best),
      30,
    ),
  );
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * Material added during setup, in the order it was added: notes still being made, already part
   * of this exam. Adding one closes the capture sheet and stays on this step, so the learner can
   * keep adding until they press "Next".
   */
  const [added, setAdded] = useState<{ id: string; mode: NoteSourceMode }[]>([]);
  const [sourceMode, setSourceMode] = useState<NoteSourceMode | null>(null);
  const [showExisting, setShowExisting] = useState(Boolean(initialFolder));
  /* Astra's switch: may the AI add topics the material leaves out? Off, as Astra recommends. */
  const [aiExpand, setAiExpand] = useState(false);
  const [schoolLevel, setSchoolLevel] = useState<string | null>(school.level);
  const [schoolYear, setSchoolYear] = useState<string | null>(school.year);
  /*
   * The study path is planned in the background as soon as the material is chosen, the way Astra
   * reviews the uploads while the learner answers the rest; "building" only waits for it.
   */
  const [plan, setPlan] = useState<PlanState>({ status: "idle" });
  const [planTopics, setPlanTopics] = useState<PlanTopic[]>([]);
  const [editingTopic, setEditingTopic] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newTopic, setNewTopic] = useState("");
  /*
   * "Next" and "Start my plan" sit in the same place, so a quick double tap on the last question
   * would otherwise create the exam before its review has been seen: the review arms its button
   * a moment after it appears.
   */
  const reviewArmed = useRef(false);
  const addedTopics = useRef(0);
  /* Which plan request is the latest: an older one's answer, arriving late, is dropped whole. */
  const planRequest = useRef(0);

  const stepIndex = STEPS.indexOf(step);
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const days = daysBetween(today, examDate);
  const uploadsLeft = MAX_SETUP_UPLOADS - added.length;
  const examFull = selected.length >= MAX_EXAM_MODULES;
  const planKey = `${selected.join(",")}|${aiExpand ? 1 : 0}`;
  const keptTopics = planTopics.filter((topic) => topic.kept);
  const moduleCount = plan.status === "done" ? Math.max(1, keptTopics.length) : selected.length;
  // What it takes to learn every topic: its summary and two formats of the learner's choice.
  const lessons = moduleCount * LESSONS_TO_LEARN;
  const yearOptions =
    schoolLevel && ROLE_FOR_LEVEL[schoolLevel]
      ? getOnboardingYearOptions(locale, ROLE_FOR_LEVEL[schoolLevel], schoolLevel)
      : [];

  async function startPlan() {
    if ((plan.status === "loading" || plan.status === "done") && plan.key === planKey) {
      return;
    }

    const key = planKey;
    const request = ++planRequest.current;
    const stale = () => request !== planRequest.current;
    setPlan({ status: "loading", key });

    try {
      const response = await fetch("/api/exams/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lectureIds: selected, aiExpand, schoolLevel, schoolYear }),
      });

      if (stale()) {
        return;
      }

      if (response.status === 402) {
        navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
        return;
      }

      const payload = (await response.json().catch(() => null)) as {
        notes?: (PlanNote & { topics: Omit<PlanTopic, "key" | "lectureId" | "kept">[] })[];
      } | null;

      if (stale()) {
        return;
      }

      if (!response.ok || !payload?.notes) {
        setPlan((current) => (current.status === "loading" && current.key === key ? { status: "failed", key } : current));
        return;
      }

      const notesPlan = payload.notes;
      setPlan((current) =>
        current.status === "loading" && current.key === key
          ? { status: "done", key, notes: notesPlan.map(({ lectureId, status }) => ({ lectureId, status })) }
          : current,
      );
      setPlanTopics(
        notesPlan.flatMap((note) =>
          note.topics.map((topic, index) => ({
            ...topic,
            key: `${note.lectureId}:${index}`,
            lectureId: note.lectureId,
            kept: true,
          })),
        ),
      );
    } catch {
      if (!stale()) {
        setPlan((current) => (current.status === "loading" && current.key === key ? { status: "failed", key } : current));
      }
    }
  }

  /* The building screen waits for the plan (and at least a moment), then shows it. */
  const planReady = plan.status === "done" && plan.key === planKey;

  useEffect(() => {
    if (step !== "building" || !planReady) {
      return;
    }

    const timer = window.setTimeout(() => setStep("review"), BUILDING_MS);

    return () => window.clearTimeout(timer);
  }, [planReady, step]);

  useEffect(() => {
    reviewArmed.current = false;

    if (step !== "review") {
      return;
    }

    const timer = window.setTimeout(() => {
      reviewArmed.current = true;
    }, 600);

    return () => window.clearTimeout(timer);
  }, [step]);

  const canContinue =
    step === "material"
      ? selected.length > 0
      : step === "subject"
        ? title.trim().length > 0
        : step === "date"
          ? isValidDay(examDate) && days >= 0
          : step === "review"
            ? keptTopics.length > 0 || (plan.status === "done" && plan.notes.some((note) => note.status === "pending"))
            : true;

  function openSource(mode: NoteSourceMode) {
    if (blockedOffline("create")) {
      return;
    }

    if (!canCreateNotes) {
      navigateWithFeedback(paywallPath("note", currentPaywallBack()));
      return;
    }

    if (uploadsLeft <= 0 || examFull) {
      return;
    }

    setSourceMode(mode);
  }

  function addCreated(lectureId: string) {
    const mode = sourceMode ?? "text";
    setSourceMode(null);
    setAdded((current) => (current.some((entry) => entry.id === lectureId) ? current : [...current, { id: lectureId, mode }]));
    setSelected((current) =>
      current.includes(lectureId) || current.length >= MAX_EXAM_MODULES ? current : [...current, lectureId],
    );
  }

  function toggleNote(id: string) {
    setFolderId(null);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length >= MAX_EXAM_MODULES
          ? current
          : [...current, id],
    );
  }

  function chooseFolder(folder: ExamSetupFolder) {
    if (folderId === folder.id) {
      setFolderId(null);
      setSelected([]);
      return;
    }

    setFolderId(folder.id);
    setSelected(folder.lectureIds.filter((id) => readyIds.has(id)).slice(0, MAX_EXAM_MODULES));

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

    // Planning starts as soon as the material and the AI switch are settled.
    if (step === "ai") {
      void startPlan();
    }

    // A plan that failed, or one for an earlier choice of material, is made again before building.
    if (step === "minutes") {
      void startPlan();
    }

    if (stepIndex < STEPS.length - 1) {
      setStep(STEPS[stepIndex + 1]);
    }
  }

  function goBack() {
    setError(null);

    if (step === "review") {
      // Back from the plan goes to the last question, not into the building pause.
      setStep("minutes");
      return;
    }

    if (stepIndex > 0) {
      setStep(STEPS[stepIndex - 1]);
      return;
    }

    // The first screen's button leaves setup: a step back when it was opened from the app's home
    // (where "Novo" lives), otherwise to the preps folder, never back out of the app.
    if (cameFromAppPath(EXAM_PREPS_HREF)) {
      router.back();
    } else {
      navigateWithFeedback(EXAM_PREPS_HREF);
    }
  }

  function updateTopic(key: string, patch: Partial<PlanTopic>) {
    setPlanTopics((current) => current.map((topic) => (topic.key === key ? { ...topic, ...patch } : topic)));
  }

  function addTopic(lectureId: string) {
    const title = newTopic.trim();

    if (!title) {
      setAddingTo(null);
      return;
    }

    setPlanTopics((current) => [
      ...current,
      {
        key: `${lectureId}:added:${(addedTopics.current += 1)}`,
        lectureId,
        title: title.slice(0, 160),
        summary: "",
        keyPoints: [],
        source: "added",
        kept: true,
      },
    ]);
    setNewTopic("");
    setAddingTo(null);
  }

  async function create() {
    if (creating || !reviewArmed.current || blockedOffline("create")) {
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
          examFormat: "written",
          examKind: "exam",
          gradingScale: "percent",
          passPercentage: PASS_MARK,
          lectureIds: selected,
          schoolLevel,
          schoolYear,
          aiExpand,
          topics: keptTopics.map(({ lectureId, title: topicTitle, summary, keyPoints, source }) => ({
            lectureId,
            title: topicTitle.trim() || t("note.untitled"),
            summary,
            keyPoints,
            source,
          })),
        }),
      });
      if (response.status === 402) {
        navigateWithFeedback(paywallPath("exam", currentPaywallBack()));
        return;
      }

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

  /* As the onboarding draws it: the way back on the left of the progress bar, never at the bottom. */
  const header = (
    <>
      <button
        type="button"
        className="memo-close-button memo-exam-step-back"
        aria-label={stepIndex === 0 ? t("common.close") : t("common.back")}
        disabled={creating}
        onClick={goBack}
      >
        <Msym name={stepIndex === 0 ? "close" : "arrow_back"} size="1.45rem" fill={false} weight={500} />
      </button>
      <div
        className="memo-progress memo-exam-steps"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={STEPS.length}
        aria-valuenow={stepIndex + 1}
        aria-label={t("exam.setup.stepOf", { step: stepIndex + 1, total: STEPS.length })}
      >
        <div style={{ width: `${Math.round(((stepIndex + 1) / STEPS.length) * 100)}%` }} />
      </div>
    </>
  );

  const ctaLabel =
    step === "intro"
      ? t("exam.setup.intro.start")
      : step === "review"
        ? creating
          ? t("exam.setup.creating")
          : t("exam.setup.review.start", { count: Math.max(1, days) })
        : step === "date" && canContinue
          ? t("exam.setup.nextWithDate", { date: formatExamDay(examDate, locale) })
          : t("exam.setup.next");

  const cta =
    step === "building" || (notes.length === 0 && lockedCount > 0) ? null : (
      <div className="memo-exam-cta-row">
        <button
          type="button"
          className="memo-button-coral"
          disabled={!canContinue || creating}
          onClick={step === "review" ? () => void create() : goNext}
        >
          {ctaLabel}
        </button>
      </div>
    );

  return (
    <ExamScreen backHref={EXAM_PREPS_HREF} backIcon="close" historyBack header={header} cta={cta}>
      {offlineToast}

      {notes.length === 0 && lockedCount > 0 ? (
        <div className="memo-exam-empty">
          <MemoBuddy mood="wave" size="7rem" thought="🎓" />
          <h1>{t("exam.setup.material.locked.title")}</h1>
          <p>{t("exam.setup.material.locked.body")}</p>
          <button type="button" className="memo-button-coral" onClick={() => navigateWithFeedback(paywallPath("exam", currentPaywallBack()))}>
            {t("exam.mock.paid.cta")}
          </button>
        </div>
      ) : step === "intro" ? (
        <section className="memo-exam-step">
          <MemoSays key="intro" hero mood="wave" size="8.5rem" text={t("exam.setup.intro.say")} />
        </section>
      ) : step === "material" ? (
        <section className="memo-exam-step">
          <MemoSays key="material" mood="happy" text={t("exam.setup.material.title")} />

          {/* First: bring the material for this exam — files, photos, a recording, a link. */}
          <div className="memo-exam-upload">
            <span className="memo-exam-upload-head">
              <b>{t(added.length > 0 ? "exam.setup.material.addMore" : "exam.setup.material.uploadTitle")}</b>
              {added.length > 0 ? (
                <span className="memo-exam-upload-count">
                  {added.length}/{MAX_SETUP_UPLOADS}
                </span>
              ) : null}
            </span>
            <span>
              {uploadsLeft <= 0
                ? t("exam.setup.material.uploadLimit", { count: MAX_SETUP_UPLOADS })
                : examFull
                  ? t("exam.setup.material.examFull", { count: MAX_EXAM_MODULES })
                  : t("exam.setup.material.uploadBody")}
            </span>
            <div className="memo-exam-upload-grid">
              {SOURCE_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  className="memo-exam-upload-option"
                  disabled={uploadsLeft <= 0 || examFull}
                  onClick={() => openSource(option.mode)}
                >
                  <span className="memo-exam-pick-emoji">
                    <Emoji symbol={option.emoji} size="1.2rem" />
                  </span>
                  <span>{t(option.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>

          {added.length > 0 ? (
            <div className="memo-exam-list">
              {added.map(({ id, mode }) => {
                const isOn = selected.includes(id);
                const source = SOURCE_OPTIONS.find((option) => option.mode === mode) ?? SOURCE_OPTIONS[0];

                return (
                  <button
                    key={id}
                    type="button"
                    className={`memo-exam-pick ${isOn ? "on" : ""}`.trim()}
                    aria-pressed={isOn}
                    onClick={() => toggleNote(id)}
                  >
                    <span className="memo-exam-pick-emoji">
                      <Emoji symbol={source.emoji} size="1.2rem" />
                    </span>
                    <span className="memo-exam-pick-copy">
                      <b>{t(source.labelKey)}</b>
                      <span>{t("exam.setup.material.uploading")}</span>
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
          ) : null}

          {/* Then, second: notes already in the app. */}
          {notes.length > 0 ? (
            <button
              type="button"
              className="memo-exam-existing"
              aria-expanded={showExisting}
              onClick={() => setShowExisting((current) => !current)}
            >
              <span>{t("exam.setup.material.existing", { count: notes.length })}</span>
              <Msym name={showExisting ? "expand_less" : "expand_more"} size="1.3rem" fill={false} />
            </button>
          ) : null}

          {showExisting && notes.length > 0 ? (
            <>
              {folders.length > 0 ? (
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
              ) : null}

              <div className="memo-exam-list">
                {notes.map((note) => {
                  const isOn = selected.includes(note.id);

                  return (
                    <button
                      key={note.id}
                      type="button"
                      className={`memo-exam-pick ${isOn ? "on" : ""}`.trim()}
                      aria-pressed={isOn}
                      onClick={() => toggleNote(note.id)}
                    >
                      <span className="memo-exam-pick-emoji">
                        <Emoji symbol={note.emoji || noteEmoji({ id: note.id, title: note.title })} size="1.2rem" />
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
            </>
          ) : null}
        </section>
      ) : step === "ai" ? (
        <section className="memo-exam-step">
          <MemoSays key="ai" mood="idle" thought="✨" text={t("exam.setup.ai.title")} />
          <div className="memo-exam-list">
            {[false, true].map((value) => {
              const isOn = aiExpand === value;

              return (
                <button
                  key={String(value)}
                  type="button"
                  className={`memo-exam-pick ${isOn ? "on" : ""}`.trim()}
                  aria-pressed={isOn}
                  onClick={() => setAiExpand(value)}
                >
                  <span className="memo-exam-pick-emoji">
                    <Emoji symbol={value ? "✨" : "📚"} size="1.2rem" />
                  </span>
                  <span className="memo-exam-pick-copy">
                    <b>{t(value ? "exam.setup.ai.on" : "exam.setup.ai.off")}</b>
                    <span>{t(value ? "exam.setup.ai.onBody" : "exam.setup.ai.offBody")}</span>
                  </span>
                  <Msym
                    name={isOn ? "radio_button_checked" : "radio_button_unchecked"}
                    size="1.5rem"
                    fill={isOn}
                    className="memo-exam-pick-mark"
                  />
                </button>
              );
            })}
          </div>
          {aiExpand ? (
            <p className="memo-exam-warning" role="note">
              <Msym name="error" size="1.15rem" fill={false} />
              {t("exam.setup.ai.warning")}
            </p>
          ) : null}
        </section>
      ) : step === "subject" ? (
        <section className="memo-exam-step">
          <MemoSays key="subject" mood="idle" thought="🎓" text={t("exam.setup.subject.title")} />
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
          <MemoSays key="date" mood="idle" thought="📅" text={t("exam.setup.date.title")} />
          <ExamCalendar today={today} value={examDate} onChange={setExamDate} />
        </section>
      ) : step === "motivate" ? (
        <section className="memo-exam-step">
          <MemoSays
            key="motivate"
            hero
            mood="cheer"
            size="7.5rem"
            text={t(days >= 3 ? "exam.setup.motivate.plenty" : "exam.setup.motivate.tight")}
          />
          <div className="memo-exam-stats">
            <div>
              <b>{Math.max(0, days)}</b>
              <span>{t("exam.setup.motivate.days", { count: Math.max(0, days) })}</span>
            </div>
            <div>
              <b>{selected.length}</b>
              <span>{t("exam.setup.motivate.modules", { count: selected.length })}</span>
            </div>
            <div>
              <b>{lessons}</b>
              <span>{t("exam.setup.motivate.lessons", { count: lessons })}</span>
            </div>
          </div>
        </section>
      ) : step === "target" ? (
        <section className="memo-exam-step">
          <MemoSays
            key="target"
            mood={target >= 100 ? "happy" : "idle"}
            thought="🎯"
            text={t("exam.setup.target.title")}
          />
          <TargetDial value={target} onChange={setTarget} />
        </section>
      ) : step === "school" ? (
        <section className="memo-exam-step">
          <MemoSays key="school" mood="idle" thought="🏫" text={t("exam.setup.school.title")} />
          <div className="memo-chip-row memo-exam-chips" role="group" aria-label={t("exam.setup.school.level")}>
            {SCHOOL_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`memo-chip ${schoolLevel === option.value ? "active" : ""}`.trim()}
                aria-pressed={schoolLevel === option.value}
                onClick={() => {
                  setSchoolLevel(option.value);
                  setSchoolYear(null);
                }}
              >
                <Emoji symbol={option.icon} size="1rem" /> {t(option.labelKey)}
              </button>
            ))}
          </div>
          {yearOptions.length > 0 ? (
            <div className="memo-chip-row memo-exam-chips" role="group" aria-label={t("exam.setup.school.year")}>
              {yearOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`memo-chip ${schoolYear === option.value ? "active" : ""}`.trim()}
                  aria-pressed={schoolYear === option.value}
                  onClick={() => setSchoolYear(option.value)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          ) : null}
        </section>
      ) : step === "minutes" ? (
        <section className="memo-exam-step">
          <MemoSays key="minutes" mood="idle" thought="⏱️" text={t("exam.setup.target.minutes")} />
          <div className="memo-exam-list">
            {MINUTE_OPTIONS.map((option) => {
              const isOn = minutes === option.minutes;
              const perDay = Math.max(1, Math.round(option.minutes / LESSON_MINUTES));

              return (
                <button
                  key={option.minutes}
                  type="button"
                  className={`memo-exam-pick ${isOn ? "on" : ""}`.trim()}
                  aria-pressed={isOn}
                  onClick={() => setMinutes(option.minutes)}
                >
                  <span className="memo-exam-pick-emoji">
                    <Emoji symbol={option.emoji} size="1.2rem" />
                  </span>
                  <span className="memo-exam-pick-copy">
                    <b>
                      {t(option.labelKey)} · {t("exam.minutes", { minutes: option.minutes })}
                    </b>
                    <span>{t("exam.setup.minutes.lessons", { count: perDay })}</span>
                  </span>
                  <Msym
                    name={isOn ? "radio_button_checked" : "radio_button_unchecked"}
                    size="1.5rem"
                    fill={isOn}
                    className="memo-exam-pick-mark"
                  />
                </button>
              );
            })}
          </div>
        </section>
      ) : step === "building" ? (
        <section className="memo-exam-step" role="status" aria-live="polite">
          {plan.status === "failed" ? (
            <>
              <MemoSays key="building-failed" hero mood="sad" size="7.5rem" text={t("exam.setup.building.failed")} />
              <button type="button" className="memo-button-ghost memo-exam-retry" onClick={() => void startPlan()}>
                {t("common.retry")}
              </button>
            </>
          ) : (
            <>
              <MemoSays key="building" hero mood="think" size="7.5rem" text={t("exam.setup.creating")} />
              <ul className="memo-exam-checks">
                <li style={{ animationDelay: "300ms" }}>
                  <Msym name="check_circle" size="1.3rem" /> {t("exam.setup.building.notes")}
                </li>
                <li style={{ animationDelay: "1000ms" }} className={planReady ? "" : "waiting"}>
                  <Msym name={planReady ? "check_circle" : "progress_activity"} size="1.3rem" />{" "}
                  {t("exam.setup.building.topics")}
                </li>
                <li style={{ animationDelay: "1700ms" }} className={planReady ? "" : "waiting"}>
                  <Msym name={planReady ? "check_circle" : "progress_activity"} size="1.3rem" />{" "}
                  {t("exam.setup.building.days")}
                </li>
              </ul>
            </>
          )}
        </section>
      ) : (
        <section className="memo-exam-step">
          <MemoSays key="review" mood="cheer" text={t("exam.setup.review.say")} />
          <p className="memo-exam-review-sub">
            <b>{title.trim()}</b> · {formatExamDayLong(examDate, locale)}
          </p>

          {/* The plan in three numbers: how long, how well, how much a day. */}
          <div className="memo-exam-stats">
            <div>
              <b>{Math.max(0, days)}</b>
              <span>{t("exam.setup.motivate.days", { count: Math.max(0, days) })}</span>
            </div>
            <div>
              <b>{target} %</b>
              <span>{t("exam.setup.review.goal")}</span>
            </div>
            <div>
              <b>{t("exam.minutes", { minutes })}</b>
              <span>{t("exam.setup.review.perDay")}</span>
            </div>
          </div>

          {/*
            Astra's plan review: the topics the material was split into, per note, to keep, rename
            or drop, and a topic of one's own to add. Each kept topic is a module on the path.
          */}
          <div className="memo-exam-route-head">
            <span>
              <b>{t("exam.setup.review.topicsTitle", { count: keptTopics.length })}</b>
              <span>{t("exam.setup.review.topicsBody")}</span>
            </span>
          </div>
          {selected.map((lectureId) => {
            const note = notesById.get(lectureId);
            const source = added.find((entry) => entry.id === lectureId);
            const noteLabel = note
              ? note.title?.trim() || t("note.untitled")
              : t(SOURCE_OPTIONS.find((option) => option.mode === source?.mode)?.labelKey ?? "exam.setup.material.newMaterial");
            const pending = plan.status === "done" && plan.notes.find((entry) => entry.lectureId === lectureId)?.status === "pending";
            const topics = planTopics.filter((topic) => topic.lectureId === lectureId);

            return (
              <div key={lectureId} className="memo-exam-topics">
                <span className="memo-exam-topics-note">
                  <Emoji symbol={note?.emoji || noteEmoji({ id: lectureId, title: note?.title ?? null })} size="1rem" />
                  {noteLabel}
                </span>
                {pending ? (
                  <p className="memo-exam-topics-pending">{t("exam.setup.review.pending")}</p>
                ) : (
                  <ul>
                    {topics.map((topic) => (
                      <li key={topic.key} className={topic.kept ? "" : "dropped"}>
                        <button
                          type="button"
                          className="memo-exam-topic-check"
                          aria-pressed={topic.kept}
                          aria-label={topic.kept ? t("exam.setup.review.dropTopic") : t("exam.setup.review.keepTopic")}
                          onClick={() => updateTopic(topic.key, { kept: !topic.kept })}
                        >
                          <Msym name={topic.kept ? "check_circle" : "radio_button_unchecked"} size="1.4rem" fill={topic.kept} />
                        </button>
                        {editingTopic === topic.key ? (
                          <input
                            id={`exam-topic-${topic.key}`}
                            className="memo-field memo-exam-topic-input"
                            value={topic.title}
                            maxLength={160}
                            autoFocus
                            onChange={(event) => updateTopic(topic.key, { title: event.target.value })}
                            onBlur={() => setEditingTopic(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                setEditingTopic(null);
                              }
                            }}
                          />
                        ) : (
                          <span className="memo-exam-topic-title">
                            {topic.title}
                            {topic.source !== "material" ? (
                              <span className="memo-exam-trail-source">
                                {t(topic.source === "ai" ? "exam.path.source.ai" : "exam.path.source.added")}
                              </span>
                            ) : null}
                          </span>
                        )}
                        <button
                          type="button"
                          className="memo-icon-button"
                          aria-label={t("exam.setup.review.renameTopic")}
                          onClick={() => setEditingTopic(editingTopic === topic.key ? null : topic.key)}
                        >
                          <Msym name="edit" size="1.1rem" fill={false} />
                        </button>
                      </li>
                    ))}
                    <li className="add">
                      {addingTo === lectureId ? (
                        <form
                          className="memo-exam-topic-add"
                          onSubmit={(event) => {
                            event.preventDefault();
                            addTopic(lectureId);
                          }}
                        >
                          <input
                            id={`exam-topic-add-${lectureId}`}
                            className="memo-field memo-exam-topic-input"
                            value={newTopic}
                            maxLength={160}
                            autoFocus
                            placeholder={t("exam.setup.review.addPlaceholder")}
                            onChange={(event) => setNewTopic(event.target.value)}
                          />
                          <button type="submit" className="memo-primary-pill" disabled={!newTopic.trim()}>
                            {t("exam.setup.review.add")}
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          className="memo-exam-topic-addlink"
                          onClick={() => {
                            setNewTopic("");
                            setAddingTo(lectureId);
                          }}
                        >
                          <Msym name="add" size="1.2rem" fill={false} /> {t("exam.setup.review.addTopic")}
                        </button>
                      )}
                    </li>
                  </ul>
                )}
              </div>
            );
          })}
          <div className="memo-exam-topics-mock">
            <Emoji symbol="🏆" size="1rem" />
            <span>
              <b>{t("exam.mock.title")}</b> · {t("exam.setup.review.mockMeta")}
            </span>
          </div>
          {error ? <p className="memo-inline-error">{error}</p> : null}
        </section>
      )}

      {sourceMode ? (
        <NoteSourceModal
          mode={sourceMode}
          open
          canCreateNotes={canCreateNotes}
          onClose={() => setSourceMode(null)}
          onCreated={addCreated}
          paywallBack="/app/exams/new"
        />
      ) : null}
    </ExamScreen>
  );
}
