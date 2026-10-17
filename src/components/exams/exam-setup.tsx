"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { useInstantNavigation } from "@/components/navigation-loading";
import { EXAM_PREPS_HREF, LESSON_KIND_EMOJI } from "@/components/exams/exam-links";
import { ExamScreen } from "@/components/exams/exam-screen";
import { formatExamDay, formatExamDayLong, formatMonth, formatWeekdayShort } from "@/components/exams/exam-format";
import { MemoBuddy } from "@/components/exams/memo-buddy";
import { MemoSays } from "@/components/exams/memo-says";
import { TargetDial } from "@/components/exams/target-dial";
import { useOfflineGuard } from "@/components/offline/offline-notice";
import { cameFromAppPath } from "@/lib/app-history";
import {
  AUDIO_FILE_INPUT_ACCEPT,
  DOCUMENT_FILE_INPUT_ACCEPT,
  MAX_SCAN_IMAGE_COUNT,
  SCAN_IMAGE_INPUT_ACCEPT,
  SUPPORTED_AUDIO_EXTENSIONS,
} from "@/lib/constants";
import {
  addDays,
  daysBetween,
  EXAM_LESSON_KINDS,
  isValidDay,
  LESSON_MINUTES,
  lessonsToTarget,
  MAX_EXAM_MODULES,
  MAX_SETUP_PHOTOS,
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

/* How many uploads run at once. */
const PARALLEL_UPLOADS = 3;

/*
 * The app's upload pipeline, run without its sheet: material is the prep's, never a note being
 * made. Fetched as soon as the setup opens, and rendered under its own empty Suspense boundary:
 * left to suspend on the first upload, it reached the route's loading screen and swapped the whole
 * setup for the notes list's skeleton until its code had arrived.
 */
const loadUploadPipeline = () => import("@/components/note-source-modal").then((module) => module.NoteSourceModal);
const NoteSourceModal = dynamic(loadUploadPipeline, { loading: () => null });

/* The one upload field takes anything a note can be made from: documents, photos (or the camera), audio. */
const ANY_MATERIAL_ACCEPT = [DOCUMENT_FILE_INPUT_ACCEPT, SCAN_IMAGE_INPUT_ACCEPT, AUDIO_FILE_INPUT_ACCEPT].join(",");

type MaterialKind = "document" | "photos" | "audio";

/* One piece of material on its way into the prep: a document, a set of photos, or a recording. */
type MaterialUpload = {
  key: string;
  files: File[];
  kind: MaterialKind;
  name: string;
  status: "waiting" | "uploading" | "ready" | "failed";
  /* What the upload is doing now, in the pipeline's own words. */
  busy: string | null;
  message: string | null;
  lectureId: string | null;
  /* Bumped by "try again", so the upload starts afresh. */
  attempt: number;
};

const MATERIAL_EMOJI: Record<MaterialKind, string> = { document: "📄", photos: "🖼️", audio: "🎧" };

function isAudioFile(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return file.type.startsWith("audio/") || (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extension);
}

function isPhotoFile(file: File) {
  return file.type.startsWith("image/") || /\.(heic|heif)$/i.test(file.name);
}

/*
 * A pick split the way the pipeline takes it: each document and recording alone, photos in sets of
 * MAX_SCAN_IMAGE_COUNT, within what the setup still has room for.
 */
function materialGroups(
  files: File[],
  room: { documents: number; photos: number },
): { kind: MaterialKind; files: File[] }[] {
  const photos = files.filter(isPhotoFile).slice(0, Math.max(0, room.photos));
  const rest = files.filter((file) => !isPhotoFile(file)).slice(0, Math.max(0, room.documents));
  const photoSets: File[][] = [];

  for (let index = 0; index < photos.length; index += MAX_SCAN_IMAGE_COUNT) {
    photoSets.push(photos.slice(index, index + MAX_SCAN_IMAGE_COUNT));
  }

  return [
    ...rest.map((file) => ({ kind: isAudioFile(file) ? ("audio" as const) : ("document" as const), files: [file] })),
    ...photoSets.map((set) => ({ kind: "photos" as const, files: set })),
  ];
}

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
   * Material uploaded in the setup, in the order it was picked. Each is read right here, one at a
   * time, as a card on this step; the learner can keep adding or go on while it is read. It joins
   * the prep as the prep's own material (`materialLectureIds`), not as a note in the library.
   */
  const [uploads, setUploads] = useState<MaterialUpload[]>([]);
  const [dragging, setDragging] = useState(false);
  const materialInputRef = useRef<HTMLInputElement | null>(null);
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
  /*
   * "Next" and "Start my plan" sit in the same place, so a quick double tap on the last question
   * would otherwise create the exam before its review has been seen: the review arms its button
   * a moment after it appears.
   */
  const reviewArmed = useRef(false);
  /* Which plan request is the latest: an older one's answer, arriving late, is dropped whole. */
  const planRequest = useRef(0);

  const stepIndex = STEPS.indexOf(step);
  const notesById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const days = daysBetween(today, examDate);
  const documentsLeft = MAX_SETUP_UPLOADS - uploads.filter((upload) => upload.kind !== "photos").length;
  const photosLeft =
    MAX_SETUP_PHOTOS -
    uploads.filter((upload) => upload.kind === "photos").reduce((sum, upload) => sum + upload.files.length, 0);
  const uploadsLeft = documentsLeft + photosLeft;
  /*
   * The uploads being read now: the first few not yet done. A few at a time is what makes ten files
   * quick; more would only split the learner's uplink, and each still counts against the upload limit.
   */
  const activeUploads = uploads
    .filter((upload) => upload.status === "uploading" || upload.status === "waiting")
    .slice(0, PARALLEL_UPLOADS);
  const activeKeys = new Set(activeUploads.map((upload) => upload.key));
  /* Uploads still on their way hold their place: a note ticked meanwhile cannot take it from them. */
  const uploadsPending = uploads.filter((upload) => upload.status === "uploading" || upload.status === "waiting").length;
  const examFull = selected.length + uploadsPending >= MAX_EXAM_MODULES;
  const planKey = `${selected.join(",")}|${aiExpand ? 1 : 0}`;
  const keptTopics = planTopics.filter((topic) => topic.kept);
  const moduleCount = plan.status === "done" ? Math.max(1, keptTopics.length) : selected.length;
  // What it takes to bring every topic from nothing to the target, a lesson at a time (as Astra counts).
  const lessons = moduleCount * lessonsToTarget(0, target / 100);
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

  // The upload pipeline's code, fetched now so the first pick starts uploading at once.
  useEffect(() => {
    void loadUploadPipeline();
  }, []);

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

  /* The upload field: whatever was picked or dropped becomes the prep's material, read right here. */
  function openFiles(files: File[]) {
    if (files.length === 0 || blockedOffline("create")) {
      return;
    }

    if (!canCreateNotes) {
      navigateWithFeedback(paywallPath("note", currentPaywallBack()));
      return;
    }

    const groups = materialGroups(files, { documents: documentsLeft, photos: photosLeft }).slice(
      0,
      Math.max(0, MAX_EXAM_MODULES - selected.length - uploadsPending),
    );

    setUploads((current) => [
      ...current,
      ...groups.map((group, index) => ({
        key: `${Date.now()}-${index}`,
        files: group.files,
        kind: group.kind,
        name:
          group.kind === "photos"
            ? t("exam.setup.material.photos", { count: group.files.length })
            : group.files[0].name.replace(/\.[a-z0-9]+$/i, ""),
        status: "waiting" as const,
        busy: null,
        message: null,
        lectureId: null,
        attempt: 0,
      })),
    ]);
  }

  function updateUpload(key: string, change: Partial<MaterialUpload>) {
    setUploads((current) => current.map((upload) => (upload.key === key ? { ...upload, ...change } : upload)));
  }

  /* Only an upload still on its way takes news from the pipeline; a finished or failed one keeps its state. */
  function updatePendingUpload(key: string, change: Partial<MaterialUpload>) {
    setUploads((current) =>
      current.some((upload) => upload.key === key && (upload.status === "waiting" || upload.status === "uploading"))
        ? current.map((upload) => (upload.key === key ? { ...upload, ...change } : upload))
        : current,
    );
  }

  function uploadReady(key: string, lectureId: string) {
    updateUpload(key, { status: "ready", busy: null, message: null, lectureId });
    setSelected((current) =>
      current.includes(lectureId) || current.length >= MAX_EXAM_MODULES ? current : [...current, lectureId],
    );
  }

  /* Taken out of the prep: the note made from it goes too, since it was only ever this prep's material. */
  function removeUpload(upload: MaterialUpload) {
    setUploads((current) => current.filter((entry) => entry.key !== upload.key));

    if (upload.lectureId) {
      const lectureId = upload.lectureId;
      setSelected((current) => current.filter((entry) => entry !== lectureId));
      void fetch(`/api/lectures/${lectureId}`, { method: "DELETE" }).catch(() => null);
    }
  }

  function toggleNote(id: string) {
    setFolderId(null);
    setSelected((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : current.length + uploadsPending >= MAX_EXAM_MODULES
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
          // Uploaded here: the prep's own material, kept out of the notes library.
          materialLectureIds: uploads.flatMap((upload) => (upload.lectureId && selected.includes(upload.lectureId) ? [upload.lectureId] : [])),
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
        className="memo-exam-step-back"
        aria-label={stepIndex === 0 ? t("common.close") : t("common.back")}
        disabled={creating}
        onClick={goBack}
      >
        {stepIndex === 0 ? (
          <Msym name="close" size="1.2rem" fill={false} weight={600} />
        ) : (
          <span className="memo-exam-step-back-chevron" aria-hidden="true" />
        )}
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

          {/* First: the material for this exam, in one field. Only a reached limit adds a line. */}
          <div className="memo-exam-upload">
            {uploadsLeft <= 0 || examFull ? (
              <span className="memo-exam-upload-limit">
                {uploadsLeft <= 0
                  ? t("exam.setup.material.uploadLimit", { count: MAX_SETUP_UPLOADS, photos: MAX_SETUP_PHOTOS })
                  : t("exam.setup.material.examFull", { count: MAX_EXAM_MODULES })}
              </span>
            ) : null}
            {/* One field for any material: tap to pick files, photos or the camera, or drop files on it. */}
            <input
              ref={materialInputRef}
              type="file"
              accept={ANY_MATERIAL_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                openFiles(files);
              }}
            />
            <button
              type="button"
              className={`memo-dropzone memo-exam-dropzone ${dragging ? "dragging" : ""}`.trim()}
              disabled={uploadsLeft <= 0 || examFull}
              onClick={() => materialInputRef.current?.click()}
              onDragOver={(event) => {
                if (Array.from(event.dataTransfer.types).includes("Files")) {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  setDragging(true);
                }
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                openFiles(Array.from(event.dataTransfer.files ?? []));
              }}
            >
              <Msym name="cloud_upload" className="memo-dropzone-icon" />
              <span className="memo-exam-dropzone-lead">
                {t(uploads.length > 0 ? "exam.setup.material.addMore" : "exam.setup.material.pick")}

              </span>
              <span className="memo-dropzone-title">{t("exam.setup.material.pickHint")}</span>
            </button>
          </div>

          {uploads.length > 0 ? (
            <div className="memo-exam-list">
              {uploads.map((upload) => (
                <div
                  key={upload.key}
                  className={`memo-exam-pick memo-exam-material ${upload.status}`.trim()}
                  aria-live="polite"
                >
                  <span className="memo-exam-pick-emoji">
                    <Emoji symbol={MATERIAL_EMOJI[upload.kind]} size="1.2rem" />
                  </span>
                  <span className="memo-exam-pick-copy">
                    <b>{upload.name}</b>
                    <span>
                      {upload.status === "ready"
                        ? t("exam.setup.material.ready")
                        : upload.status === "failed"
                          ? (upload.message ?? t("exam.setup.material.failed"))
                          : upload.status === "waiting" && !activeKeys.has(upload.key)
                            ? t("exam.setup.material.waiting")
                            : (upload.busy ?? t("exam.setup.material.uploading"))}
                    </span>
                    {upload.status === "uploading" || upload.status === "waiting" ? (
                      <span className="memo-gen-track memo-exam-material-track" aria-hidden="true">
                        <span />
                      </span>
                    ) : null}
                  </span>
                  {upload.status === "failed" ? (
                    <button
                      type="button"
                      className="memo-exam-material-retry"
                      onClick={() =>
                        updateUpload(upload.key, { status: "waiting", message: null, attempt: upload.attempt + 1 })
                      }
                    >
                      {t("common.retry")}
                    </button>
                  ) : upload.status === "ready" ? (
                    <Msym name="check_circle" size="1.5rem" fill className="memo-exam-pick-mark" />
                  ) : null}
                  {upload.status !== "uploading" ? (
                    <button
                      type="button"
                      className="memo-exam-material-remove"
                      aria-label={t("exam.setup.material.remove")}
                      onClick={() => removeUpload(upload)}
                    >
                      <Msym name="close" size="1.1rem" fill={false} weight={600} />
                    </button>
                  ) : null}
                </div>
              ))}
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
            The plan the AI made, to look forward to rather than to edit: each topic is a module on
            a path, in order, with what it holds, then the mock exam and the goal at the end.
          */}
          <div className="memo-exam-route-head">
            <span>
              <b>{t("exam.setup.review.pathTitle")}</b>
              <span>{t("exam.setup.review.topicsTitle", { count: keptTopics.length })}</span>
            </span>
          </div>
          <ol className="memo-exam-plan">
            {selected.flatMap((lectureId) => {
              const note = notesById.get(lectureId);
              const upload = uploads.find((entry) => entry.lectureId === lectureId);
              const noteLabel = note
                ? note.title?.trim() || t("note.untitled")
                : (upload?.name ?? t("exam.setup.material.newMaterial"));
              const emoji = note?.emoji || noteEmoji({ id: lectureId, title: note?.title ?? null });
              const pending =
                plan.status === "done" && plan.notes.find((entry) => entry.lectureId === lectureId)?.status === "pending";

              if (pending) {
                return [
                  <li key={lectureId} className="memo-exam-plan-step pending">
                    <span className="memo-exam-plan-node">
                      <Emoji symbol={emoji} size="1.1rem" />
                    </span>
                    <span className="memo-exam-plan-card">
                      <span className="memo-exam-plan-note">{noteLabel}</span>
                      <span className="memo-exam-plan-meta">{t("exam.setup.review.pending")}</span>
                    </span>
                  </li>,
                ];
              }

              return planTopics
                .filter((topic) => topic.lectureId === lectureId)
                .map((topic) => (
                  <li key={topic.key} className="memo-exam-plan-step">
                    <span className="memo-exam-plan-node">{keptTopics.indexOf(topic) + 1}</span>
                    <span className="memo-exam-plan-card">
                      <span className="memo-exam-plan-note">
                        <Emoji symbol={emoji} size="0.9rem" />
                        {noteLabel}
                      </span>
                      <b>
                        {topic.title}
                        {topic.source === "ai" ? <span className="memo-exam-trail-source">{t("exam.path.source.ai")}</span> : null}
                      </b>
                      {/* What the module holds: the summary, then the practice formats to choose from. */}
                      <span className="memo-exam-plan-kinds" aria-hidden="true">
                        {EXAM_LESSON_KINDS.map((kind) => (
                          <Emoji key={kind} symbol={LESSON_KIND_EMOJI[kind]} size="0.95rem" />
                        ))}
                      </span>
                    </span>
                  </li>
                ));
            })}
            <li className="memo-exam-plan-step finale">
              <span className="memo-exam-plan-node">
                <Emoji symbol="🏆" size="1.1rem" />
              </span>
              <span className="memo-exam-plan-card">
                <b>{t("exam.mock.title")}</b>
                <span className="memo-exam-plan-meta">{t("exam.setup.review.mockMeta")}</span>
              </span>
            </li>
            <li className="memo-exam-plan-step finale goal">
              <span className="memo-exam-plan-node">
                <Emoji symbol="🎯" size="1.1rem" />
              </span>
              <span className="memo-exam-plan-card">
                <b>{t("exam.setup.review.goalNode", { percent: target })}</b>
                <span className="memo-exam-plan-meta">{formatExamDayLong(examDate, locale)}</span>
              </span>
            </li>
          </ol>
          {error ? <p className="memo-inline-error">{error}</p> : null}
        </section>
      )}

      {/*
       * The material being read: the app's own upload pipeline, without its sheet. It stays mounted
       * whichever step the learner is on, so going on does not stop it.
       */}
      <Suspense fallback={null}>
        {activeUploads.map((upload) => (
          <NoteSourceModal
            key={`${upload.key}:${upload.attempt}`}
            mode={upload.kind === "audio" ? "upload" : "text"}
            open
            headless
            canCreateNotes={canCreateNotes}
            onClose={() => undefined}
            initialFiles={upload.files}
            paywallBack="/app/exams/new"
            onBusy={(label) => updatePendingUpload(upload.key, { status: "uploading", busy: label })}
            onFailed={(message) => updatePendingUpload(upload.key, { status: "failed", busy: null, message })}
            onCreated={(lectureId) => uploadReady(upload.key, lectureId)}
          />
        ))}
      </Suspense>
    </ExamScreen>
  );
}
