"use client";

import * as Sentry from "@sentry/nextjs";
import {
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";

import { CollegeLiveRecording } from "@/components/creator-demo/college-live-recording";
import {
  useCreatorDemoBasePath,
  useIsCollegeCreatorDemo,
} from "@/components/creator-demo/creator-demo-context";
import { useT } from "@/components/i18n-provider";
import { LiveAudioWave } from "@/components/live-audio-wave";
import { useInstantNavigation } from "@/components/navigation-loading";
import { MemoPortal } from "@/components/memo-portal";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { Emoji, Msym } from "@/components/msym";
import { createAudioLectureWithProcessingChunks } from "@/lib/audio-lecture-upload";
import {
  AUDIO_FILE_INPUT_ACCEPT,
  DOCUMENT_FILE_INPUT_ACCEPT,
  SUPPORTED_AUDIO_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  MAX_SCAN_IMAGE_COUNT,
  MAX_SCAN_IMAGE_BYTES,
  SCAN_IMAGE_INPUT_ACCEPT,
} from "@/lib/constants";
import { parseApiResponse, redirectToBillingIfNeeded } from "@/lib/billing-client";
import { mapAppHref } from "@/lib/creator-demo/paths";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";
import {
  createSafeTransportFileName,
  isLegacyPowerPointDocument,
  isSupportedDocumentFile,
} from "@/lib/document-files";
import {
  compressDocumentForUpload,
  compressionErrorMessage,
  compressScanImageForUpload,
} from "@/lib/file-compression-client";
import { prepareAudioSourceForUpload } from "@/lib/audio-source-preparation";
import {
  discardNativeRecording,
  isNativeRecorderAvailable,
  pauseNativeRecording,
  readNativeRecordingState,
  resumeNativeRecording,
  startNativeRecording,
  stopNativeRecording,
  type NativeRecorderSnapshot,
} from "@/lib/mobile/native-recorder";
import { canConvertScanPreview } from "@/lib/scan-preview";
import { uploadToSignedUrlWithRetry } from "@/lib/signed-upload-client";
import {
  getExtensionForMimeType,
  isSupportedScanImageMimeType,
  normalizeMimeType,
  normalizeUploadScanImageMimeType,
} from "@/lib/storage";
import {
  getUnsupportedVideoUrlMessageKey,
  isYoutubeCaptionImportEnabled,
} from "@/lib/link-source-validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { cn, formatTimestamp } from "@/lib/utils";

export type NoteSourceMode = "record" | "link" | "text" | "upload";

type AudioSource = {
  file: File;
  durationSeconds: number;
  previewUrl: string;
  origin: "upload" | "recording";
};

type ScanUploadResponse = {
  uploads: Array<{
    index: number;
    path: string;
    token: string;
  }>;
};

type PhotoSource = {
  id: string;
  file: File;
  previewUrl: string;
  previewObjectUrls: string[];
  previewStatus: "queued" | "converting" | "ready" | "failed";
};

/*
 * Only the emoji is read from this table now (see `modeIcon` below) — the
 * segmented control it once fed was replaced by the sheet title. The label keys
 * stay beside their icons because the two belong together, and the audio-import
 * guide names one of these modes in its instructions.
 */
const MODES: Array<{
  id: NoteSourceMode;
  labelKey: MessageKey;
  icon: string;
}> = [
  { id: "record", labelKey: "capture.mode.record", icon: "🎙️" },
  { id: "upload", labelKey: "capture.mode.upload", icon: "📤" },
  { id: "text", labelKey: "capture.mode.text", icon: "📄" },
  { id: "link", labelKey: "capture.mode.link", icon: "🔗" },
];

function pickRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return null;
  }

  const userAgent = window.navigator.userAgent;
  const prefersMp4Recording =
    /Safari/i.test(userAgent) &&
    !/(Chrome|Chromium|CriOS|EdgiOS|FxiOS)/i.test(userAgent);
  const candidates = prefersMp4Recording
    ? [
        "audio/mp4",
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ]
    : [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function isAudioSourceFile(file: File) {
  if (file.type.startsWith("audio/")) {
    return true;
  }

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";

  return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(extension);
}

/** The tile emoji beside the modal's title, per capture mode. */
function modeEmoji(mode: NoteSourceMode) {
  return MODES.find((item) => item.id === mode)?.icon ?? "📝";
}

function sheetTitleKey(mode: NoteSourceMode): MessageKey {
  if (mode === "record") {
    return "library.quickAction.record";
  }

  if (mode === "upload") {
    return "library.quickAction.audio";
  }

  if (mode === "link") {
    return "library.quickAction.link";
  }

  return "capture.title.text";
}

function sheetDescription() {
  return "";
}

/**
 * Creator demo: each source opens with a file already staged, so a recording
 * can go straight to "Ustvari". These are empty placeholder files — the demo
 * never reads a file's contents, it only shows its name.
 */
const DEMO_STAGED_SOURCES = {
  recording: {
    fileName: "posnetek-predavanje-4.m4a",
    mimeType: "audio/mp4",
    durationSeconds: 2842,
  },
  audio: {
    fileName: "Predavanje-mikroekonomija-5.m4a",
    mimeType: "audio/mp4",
    durationSeconds: 2842,
  },
  document: {
    fileName: "Anatomija-zivcevje-skripta.pdf",
    mimeType: "application/pdf",
  },
  link: "https://www.finance.si/erp-sistemi-v-praksi",
} as const;

function createDemoStagedFile(fileName: string, mimeType: string) {
  return new File([new Uint8Array(0)], fileName, { type: mimeType });
}

/** How long the demo spends on the "processing" stages before the note opens. */
const DEMO_CREATE_TOTAL_MS = 1500;

const DOCUMENT_OR_IMAGE_INPUT_ACCEPT = `${DOCUMENT_FILE_INPUT_ACCEPT},${SCAN_IMAGE_INPUT_ACCEPT}`;
const LOCAL_API_REQUEST_TIMEOUT_MS = 30_000;
const SCAN_PREVIEW_TIMEOUT_MS = 18_000;

/**
 * `timeoutMessage` is required rather than defaulted, because this runs outside
 * the component and has no translator to fall back on. Every caller is inside
 * one and already says which wait timed out, which is the more useful message
 * anyway.
 */
async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit & { timeoutMessage: string; timeoutMs?: number },
) {
  const { timeoutMessage, timeoutMs = LOCAL_API_REQUEST_TIMEOUT_MS, signal, ...fetchInit } = init;
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromParent = () => controller.abort();

  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  try {
    return await fetch(input, {
      ...fetchInit,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

function isHeicPhoto(file: File) {
  const lowerName = file.name.toLowerCase();
  const normalizedMimeType = normalizeMimeType(file.type || "");

  return (
    normalizedMimeType === "image/heic" ||
    normalizedMimeType === "image/heif" ||
    lowerName.endsWith(".heic") ||
    lowerName.endsWith(".heif")
  );
}

function isScanPhotoFile(file: File) {
  return file.type.startsWith("image/") || isSupportedScanImageMimeType(file.type, file.name);
}

function canPreviewHeicNatively() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const userAgent = navigator.userAgent;
  const vendor = navigator.vendor;
  const isSafari =
    /Safari/i.test(userAgent) &&
    /Apple/i.test(vendor) &&
    !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|OPR|SamsungBrowser)/i.test(userAgent);

  return isSafari;
}

function createPhotoSource(file: File, canUseNativeHeicPreview: boolean): PhotoSource {
  const randomId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const needsConvertedPreview = isHeicPhoto(file) && !canUseNativeHeicPreview;
  const previewObjectUrl = needsConvertedPreview ? "" : URL.createObjectURL(file);

  return {
    id: `${file.name}-${file.lastModified}-${file.size}-${randomId}`,
    file,
    previewUrl: previewObjectUrl,
    previewObjectUrls: previewObjectUrl ? [previewObjectUrl] : [],
    previewStatus: needsConvertedPreview ? "queued" : "ready",
  };
}

function revokePhotoSourcePreviewUrls(photoSource: PhotoSource) {
  photoSource.previewObjectUrls.forEach((previewObjectUrl) => {
    URL.revokeObjectURL(previewObjectUrl);
  });
}

export function NoteSourceModal({
  mode,
  open,
  onClose,
  canCreateNotes,
}: {
  mode: NoteSourceMode | null;
  open: boolean;
  onClose: () => void;
  canCreateNotes?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const demoBasePath = useCreatorDemoBasePath();
  const isCreatorDemo = demoBasePath != null;
  const isCollegeCreatorDemo = useIsCollegeCreatorDemo();
  const { navigateWithFeedback, overlay: navigationOverlay } = useInstantNavigation();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  /*
   * The app's own count of the take in progress, and the instant we read it.
   *
   * Nothing on this page ticks while the phone is locked — iOS suspends the web
   * content process, which is the whole reason capture moved native — so the
   * clock is drawn from wall-clock arithmetic on this reading rather than from
   * an interval that counts its own firings. Non-null for exactly as long as
   * audio is sitting on the device: that is what tells a closing modal there is
   * a recording to throw away.
   */
  const nativeSyncRef = useRef<{ elapsed: number; at: number; paused: boolean } | null>(null);
  const requestCloseRef = useRef<() => void>(() => undefined);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const createdLectureIdRef = useRef<string | null>(null);
  /*
   * Set synchronously the instant a submit starts, so a second tap cannot start a second one.
   *
   * The busy state already swaps the create button for a cancel button, but that is React state:
   * two taps inside the same frame both see the old button and both run. That used to cost a
   * stray draft row; now that the server hands a retry the draft it already has, it would cost
   * worse — two attempts uploading different sources onto the same lecture.
   */
  const submitInFlightRef = useRef(false);
  const cancelRequestedRef = useRef(false);
  const sourceSheetDragStartYRef = useRef<number | null>(null);
  const sourceSheetDragOffsetRef = useRef(0);
  const sourceSheetSuppressClickRef = useRef(false);
  const photoSourcesRef = useRef<PhotoSource[]>([]);
  const photoPreviewQueueRef = useRef<Promise<void>>(Promise.resolve());
  const demoStagedModesRef = useRef<Set<NoteSourceMode>>(new Set());

  const recordingMimeType = useMemo(() => pickRecorderMimeType(), []);

  const [selectedMode, setSelectedMode] = useState<NoteSourceMode>(mode ?? "record");
  const [audioSource, setAudioSource] = useState<AudioSource | null>(null);
  const [pdfSource, setPdfSource] = useState<File | null>(null);
  const [photoSources, setPhotoSources] = useState<PhotoSource[]>([]);
  const [activePhotoPreviewId, setActivePhotoPreviewId] = useState<string | null>(null);
  const [linkValue, setLinkValue] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingSupported, setRecordingSupported] = useState<boolean | null>(null);
  const [nativeRecorder, setNativeRecorder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showAudioImportGuide, setShowAudioImportGuide] = useState(false);
  const [sourceSheetDragOffset, setSourceSheetDragOffset] = useState(0);

  /*
   * The sheet keeps its own drag — its close is layered, stepping back out of
   * the photo preview before it leaves — but the exit is the
   * design's shared one rather than a jump off the bottom of the screen.
   */
  const sourceSheet = useSheet(onClose);
  const dismissSourceSheet = sourceSheet.dismiss;

  useEffect(() => {
    if (mode) {
      setSelectedMode(mode);
      setShowAudioImportGuide(false);
    }
  }, [mode]);

  useEffect(() => {
    if (!open || canCreateNotes !== false) {
      return;
    }

    onClose();
    router.replace("/app/start");
  }, [canCreateNotes, onClose, open, router]);

  // Creator demo: stage a file for the visible source, so the creator can hit
  // "Ustvari" immediately. Picking their own file — or recording for real —
  // still wins, and staging never runs mid-recording.
  useEffect(() => {
    if (!open || !isCreatorDemo || isRecording) {
      return;
    }

    // Record and upload share one audio slot, so each stages a clip of its own
    // origin: switching tabs must never leave a mode with a disabled button.
    if (selectedMode === "record" || selectedMode === "upload") {
      const origin = selectedMode === "record" ? "recording" : "upload";
      const staged =
        selectedMode === "record" ? DEMO_STAGED_SOURCES.recording : DEMO_STAGED_SOURCES.audio;

      setAudioSource((current) =>
        current?.origin === origin
          ? current
          : {
              file: createDemoStagedFile(staged.fileName, staged.mimeType),
              durationSeconds: staged.durationSeconds,
              previewUrl: "",
              origin,
            },
      );
      return;
    }

    if (demoStagedModesRef.current.has(selectedMode)) {
      return;
    }

    demoStagedModesRef.current.add(selectedMode);

    if (selectedMode === "text") {
      setPdfSource((current) =>
        current || photoSourcesRef.current.length > 0
          ? current
          : createDemoStagedFile(
              DEMO_STAGED_SOURCES.document.fileName,
              DEMO_STAGED_SOURCES.document.mimeType,
            ),
      );
      return;
    }

    if (selectedMode === "link") {
      setLinkValue((current) => current || DEMO_STAGED_SOURCES.link);
    }
  }, [isCreatorDemo, isRecording, open, selectedMode]);

  const preparedRecording = audioSource?.origin === "recording" ? audioSource : null;
  const preparedUpload = audioSource?.origin === "upload" ? audioSource : null;
  const trimmedLinkValue = linkValue.trim();
  const linkVideoError = useMemo(() => {
    const key = getUnsupportedVideoUrlMessageKey(trimmedLinkValue);

    return key ? t(key) : null;
  }, [t, trimmedLinkValue]);
  // Only advertise YouTube where captions can actually be fetched: the deployment's egress
  // decides that, and promising it elsewhere sends the learner back to paste the same link twice.
  const youtubeImportEnabled = isYoutubeCaptionImportEnabled();
  const hasPhotoSources = photoSources.length > 0;
  const canGenerateText = Boolean(pdfSource) || hasPhotoSources;
  /*
   * One source per note: a document fills the slot on its own, so the picker leaves with it.
   * Photos are the exception — they stack up to MAX_SCAN_IMAGE_COUNT pages of one set of notes.
   */
  const canAddDocumentSource = !pdfSource && photoSources.length < MAX_SCAN_IMAGE_COUNT;
  const canGenerateLink = trimmedLinkValue.length > 0 && !linkVideoError;
  const activePhotoPreview =
    photoSources.find((photoSource) => photoSource.id === activePhotoPreviewId) ?? null;
  const visiblePhotoSources = photoSources;

  useEffect(() => {
    photoSourcesRef.current = photoSources;
  }, [photoSources]);

  function redirectToPaywall() {
    onClose();
    navigateWithFeedback("/app/start");
  }

  const replaceAudioSource = useCallback(async (nextSource: AudioSource) => {
    let preparedSource = nextSource;
    let originalPreviewUrlToRevoke: string | null = null;

    try {
      // Every limit is checked inside prepareAudioSourceForUpload, against the file we would
      // actually upload rather than the one the user picked: a bulky WAV is transcoded first and
      // judged on its mp3, which is the whole point of having a compressor.
      const prepared = await prepareAudioSourceForUpload({
        file: nextSource.file,
        knownDurationSeconds: nextSource.durationSeconds,
        onStageChange: setBusyLabel,
      });

      if (prepared.compressed) {
        originalPreviewUrlToRevoke = nextSource.previewUrl;
      }

      preparedSource = {
        ...nextSource,
        file: prepared.file,
        durationSeconds: prepared.durationSeconds,
        previewUrl: prepared.compressed
          ? URL.createObjectURL(prepared.file)
          : nextSource.previewUrl,
      };

      if (audioSource?.previewUrl) {
        URL.revokeObjectURL(audioSource.previewUrl);
      }

      if (originalPreviewUrlToRevoke) {
        URL.revokeObjectURL(originalPreviewUrlToRevoke);
      }

      setAudioSource(preparedSource);
      setError(null);
    } catch (validationError) {
      URL.revokeObjectURL(nextSource.previewUrl);

      if (preparedSource.previewUrl !== nextSource.previewUrl) {
        URL.revokeObjectURL(preparedSource.previewUrl);
      }

      setAudioSource(null);
      setError(
        compressionErrorMessage(validationError, t) ?? t("api.audioPrepareFailed"),
      );
    } finally {
      setBusyLabel(null);
    }
  }, [audioSource, t]);

  const clearAudioSource = useCallback(() => {
    setAudioSource((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
  }, []);

  /*
   * The app is the authority on how long the take is, and on whether it is
   * running at all: a call, Siri or another app taking the microphone pauses
   * the recorder without this page being told, and while the screen is locked
   * the page is not running to be told anyway.
   */
  const applyNativeSnapshot = useCallback((snapshot: NativeRecorderSnapshot) => {
    if (snapshot.state === "idle") {
      return;
    }

    const paused = snapshot.state === "paused";
    nativeSyncRef.current = { elapsed: snapshot.elapsed, at: Date.now(), paused };
    setIsPaused(paused);
    setElapsedSeconds(() => {
      const seconds = Math.floor(snapshot.elapsed);
      elapsedRef.current = seconds;
      return seconds;
    });
  }, []);

  /** Draws the clock from the last reading and the wall clock since. */
  const startNativeClock = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
    }

    timerRef.current = window.setInterval(() => {
      const sync = nativeSyncRef.current;

      if (!sync) {
        return;
      }

      setElapsedSeconds(() => {
        const seconds = Math.floor(
          sync.paused ? sync.elapsed : sync.elapsed + (Date.now() - sync.at) / 1000,
        );
        elapsedRef.current = seconds;
        return seconds;
      });
    }, 250);
  }, []);

  const resetState = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    recorderRef.current = null;
    // A take still on the device when the modal closes is one nobody asked to
    // keep: the draft it would have belonged to is gone with the modal.
    if (nativeSyncRef.current) {
      nativeSyncRef.current = null;
      void discardNativeRecording().catch(() => null);
    }

    chunksRef.current = [];
    elapsedRef.current = 0;
    clearAudioSource();
    setPdfSource(null);
    setPhotoSources((current) => {
      current.forEach((photoSource) => revokePhotoSourcePreviewUrls(photoSource));
      return [];
    });
    setActivePhotoPreviewId(null);
    setLinkValue("");
    setIsRecording(false);
    setIsPaused(false);
    setElapsedSeconds(0);
    setError(null);
    setBusyLabel(null);
    setIsCancelling(false);
    setShowAudioImportGuide(false);
    activeRequestControllerRef.current = null;
    createdLectureIdRef.current = null;
    cancelRequestedRef.current = false;
    submitInFlightRef.current = false;
    demoStagedModesRef.current.clear();
  }, [clearAudioSource]);

  const deleteCreatedLecture = useCallback(async () => {
    const lectureId = createdLectureIdRef.current;

    if (!lectureId) {
      return;
    }

    await fetch(`/api/lectures/${lectureId}`, {
      method: "DELETE",
    }).catch(() => null);
    createdLectureIdRef.current = null;
  }, []);

  const createManualLecture = useCallback(
    async (sourceType: "text" | "pdf" | "link") => {
      /*
       * The only request in this modal that cancelling does not abort.
       *
       * The server inserts the draft row before it answers, so aborting mid-flight does not
       * un-create anything — it only loses the id, and `deleteCreatedLecture` can delete nothing
       * without one. That is exactly how a learner ends up with an untitled "the upload did not
       * finish" note pinned above their library: they pressed cancel, or the tab went away, in
       * the second this request was open. Every caller re-checks `cancelRequestedRef` the moment
       * it returns and deletes the draft there instead, so the cancel still lands — it just
       * lands on a row we can name. `fetchWithTimeout` keeps its own timeout either way.
       */
      const response = await fetchWithTimeout("/api/lectures/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        timeoutMessage: t("capture.error.notePrepTooLong"),
        body: JSON.stringify({
          sourceType,
        }),
      });

      const payload = await parseApiResponse<{ lectureId: string }>(response, t);

      createdLectureIdRef.current = payload.lectureId;
      return payload.lectureId as string;
    },
    [t],
  );

  const handleCancelBusyAction = useCallback(async () => {
    cancelRequestedRef.current = true;
    activeRequestControllerRef.current?.abort();
    setIsCancelling(true);
    setBusyLabel((current) => current ?? t("capture.busy.cancelling"));
    await deleteCreatedLecture();
    setBusyLabel(null);
    setIsCancelling(false);
    setError(null);
  }, [deleteCreatedLecture, t]);

  useEffect(() => {
    const native = isNativeRecorderAvailable();
    setNativeRecorder(native);
    setRecordingSupported(native || (typeof window !== "undefined" && "MediaRecorder" in window));
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const scrollY = window.scrollY;
    const previousOverflow = document.body.style.overflow;
    const previousPosition = document.body.style.position;
    const previousTop = document.body.style.top;
    const previousWidth = document.body.style.width;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        requestCloseRef.current();
      }
    }

    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.position = previousPosition;
      document.body.style.top = previousTop;
      document.body.style.width = previousWidth;
      window.scrollTo(0, scrollY);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  /*
   * Re-reads the app's own count while a native take runs.
   *
   * Two things this page cannot see make its clock wrong on its own: it stops
   * running altogether while iOS has the app suspended, and the recorder can be
   * paused behind its back by a call or by another app taking the microphone.
   * Coming back to the foreground is the moment that matters most, so the
   * reading is taken then as well as on a slow interval.
   */
  useEffect(() => {
    if (!nativeRecorder || !isRecording) {
      return;
    }

    let cancelled = false;

    const sync = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void readNativeRecordingState()
        .then((snapshot) => {
          if (!cancelled) {
            applyNativeSnapshot(snapshot);
          }
        })
        .catch(() => null);
    };

    const interval = window.setInterval(sync, 2000);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [applyNativeSnapshot, isRecording, nativeRecorder]);

  useEffect(() => {
    return () => {
      if (audioSource?.previewUrl) {
        URL.revokeObjectURL(audioSource.previewUrl);
      }
    };
  }, [audioSource]);

  useEffect(() => {
    return () => {
      photoSourcesRef.current.forEach((photoSource) => {
        revokePhotoSourcePreviewUrls(photoSource);
      });
    };
  }, []);

  async function handleUploadFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      // Duration is resolved during preparation, from the transcoded file when the original is
      // one the browser refuses to decode. Reading it here first is what used to turn a large
      // WAV away before compression had a chance to rescue it.
      await replaceAudioSource({
        file,
        durationSeconds: 0,
        previewUrl: URL.createObjectURL(file),
        origin: "upload",
      });
    } catch (uploadError) {
      setError(
        compressionErrorMessage(uploadError, t) ?? t("capture.error.filePrepFailed"),
      );
    } finally {
      event.target.value = "";
    }
  }

  async function startRecording() {
    if (!canCreateNotes) {
      redirectToPaywall();
      return;
    }

    if (!recordingSupported) {
      setError(t("capture.error.noRecordingSupport"));
      return;
    }

    try {
      if (nativeRecorder) {
        applyNativeSnapshot(await startNativeRecording());
        setIsRecording(true);
        setError(null);
        startNativeClock();
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(
        stream,
        recordingMimeType ? { mimeType: recordingMimeType } : undefined,
      );

      recorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const normalizedMimeType = normalizeMimeType(
          recorder.mimeType || blob.type || "audio/webm",
        );
        const extension = getExtensionForMimeType(normalizedMimeType);
        const file = new File([blob], `recording-${Date.now()}.${extension}`, {
          type: normalizedMimeType,
        });

        await replaceAudioSource({
          file,
          durationSeconds: elapsedRef.current,
          previewUrl: URL.createObjectURL(blob),
          origin: "recording",
        });

        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop());
          streamRef.current = null;
        }
        setIsPaused(false);
      };

      recorder.start();
      setIsRecording(true);
      setIsPaused(false);
      setElapsedSeconds(0);
      elapsedRef.current = 0;
      setError(null);
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((value) => {
          const nextValue = value + 1;
          elapsedRef.current = nextValue;
          return nextValue;
        });
      }, 1000);
    } catch (recordError) {
      setError(
        compressionErrorMessage(recordError, t) ?? t("capture.error.recordStartFailed"),
      );
    }
  }

  const stopRecording = useCallback(async () => {
    if (nativeSyncRef.current) {
      setIsRecording(false);
      setIsPaused(false);

      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }

      // Collecting the audio is a transfer across the bridge, not an instant
      // hand-off: a two-hour lecture is tens of megabytes of base64.
      setBusyLabel(t("capture.busy.preparing"));

      try {
        const recording = await stopNativeRecording();
        nativeSyncRef.current = null;
        setBusyLabel(null);
        await replaceAudioSource({
          file: recording.file,
          durationSeconds: recording.durationSeconds,
          previewUrl: URL.createObjectURL(recording.file),
          origin: "recording",
        });
      } catch (stopError) {
        setBusyLabel(null);
        setError(
          compressionErrorMessage(stopError, t) ?? t("capture.error.recordStartFailed"),
        );
      }

      return;
    }

    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
    setIsPaused(false);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [replaceAudioSource, t]);

  const pauseRecording = useCallback(() => {
    if (nativeSyncRef.current) {
      void pauseNativeRecording().then(applyNativeSnapshot).catch(() => null);
      return;
    }

    if (!recorderRef.current || recorderRef.current.state !== "recording") {
      return;
    }

    recorderRef.current.pause();
    setIsPaused(true);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, [applyNativeSnapshot]);

  const resumeRecording = useCallback(() => {
    if (nativeSyncRef.current) {
      void resumeNativeRecording().then(applyNativeSnapshot).catch(() => null);
      return;
    }

    if (!recorderRef.current || recorderRef.current.state !== "paused") {
      return;
    }

    recorderRef.current.resume();
    setIsPaused(false);

    if (!timerRef.current) {
      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((value) => {
          const nextValue = value + 1;
          elapsedRef.current = nextValue;
          return nextValue;
        });
      }, 1000);
    }
  }, [applyNativeSnapshot]);

  const requestClose = useCallback(() => {
    sourceSheetDragStartYRef.current = null;
    sourceSheetDragOffsetRef.current = 0;

    setSourceSheetDragOffset(0);

    if (activePhotoPreviewId) {
      setActivePhotoPreviewId(null);
      return;
    }

    if (showAudioImportGuide) {
      setShowAudioImportGuide(false);
      return;
    }

    if (isRecording) {
      void stopRecording();
      return;
    }

    if (busyLabel) {
      void handleCancelBusyAction();
      return;
    }

    dismissSourceSheet();
  }, [
    busyLabel,
    dismissSourceSheet,
    handleCancelBusyAction,
    activePhotoPreviewId,
    isRecording,
    showAudioImportGuide,
    stopRecording,
  ]);

  function handleSourceSheetPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    sourceSheetSuppressClickRef.current = false;
    sourceSheetDragStartYRef.current = null;

    const target = event.target;
    if (target instanceof Element && target.closest(".note-source-segmented")) {
      return;
    }

    const interactiveTarget =
      target instanceof Element
        ? target.closest("button, a, input, textarea, select, label, .app-close-button")
        : null;
    const dragHandleTarget =
      target instanceof Element ? target.closest(".note-source-modal-drag-handle") : null;

    if (interactiveTarget && !dragHandleTarget) {
      return;
    }

    sourceSheetDragStartYRef.current = event.clientY;
    if (!interactiveTarget || dragHandleTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateSourceSheetDragOffset(clientY: number) {
    if (sourceSheetDragStartYRef.current === null) {
      return;
    }

    const nextOffset = Math.max(0, clientY - sourceSheetDragStartYRef.current);
    sourceSheetDragOffsetRef.current = nextOffset;
    if (nextOffset > 8) {
      sourceSheetSuppressClickRef.current = true;
    }
    setSourceSheetDragOffset(nextOffset);
  }

  function handleSourceSheetClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!sourceSheetSuppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    sourceSheetSuppressClickRef.current = false;
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      updateSourceSheetDragOffset(event.clientY);
    }

    function handleWindowPointerEnd() {
      if (sourceSheetDragOffsetRef.current > 110) {
        requestCloseRef.current();
        return;
      }

      sourceSheetDragStartYRef.current = null;
      sourceSheetDragOffsetRef.current = 0;
      setSourceSheetDragOffset(0);
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [open]);

  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  /**
   * Creator demo only: nothing is uploaded and the picked file is never read.
   * The stage labels are replayed over roughly `DEMO_CREATE_TOTAL_MS` so the
   * recording shows a believable processing beat, then a ready-made note is
   * added to the demo library.
   */
  async function createDemoNote(
    kind: "record" | "upload" | "pdf" | "photo" | "link",
    stages: string[],
  ) {
    cancelRequestedRef.current = false;
    setError(null);

    // The middle stage carries the upload/read work in the real flow, so it
    // holds longest; the rest split what is left evenly.
    const stageDurations = stages.map((_, index) =>
      stages.length > 2 && index === 1
        ? DEMO_CREATE_TOTAL_MS * 0.44
        : (DEMO_CREATE_TOTAL_MS * (stages.length > 2 ? 0.56 : 1)) /
          Math.max(1, stages.length - (stages.length > 2 ? 1 : 0)),
    );

    const stopProcessing = () => {
      setBusyLabel(null);
      setIsCancelling(false);
    };

    try {
      const { prepareDemoLecture } = await import("@/lib/creator-demo/store");
      const pendingLecture = prepareDemoLecture(kind);
      const href = mapAppHref(`/app/lectures/${pendingLecture.id}`, demoBasePath);

      // Warm the note route while the stages play, so the jump at the end is a
      // single cut with no loading screen in between.
      safeRouterPrefetch(router, href);

      for (const [index, stage] of stages.entries()) {
        if (cancelRequestedRef.current) {
          stopProcessing();
          return;
        }

        setBusyLabel(stage);
        await new Promise((resolve) =>
          window.setTimeout(resolve, Math.round(stageDurations[index])),
        );
      }

      if (cancelRequestedRef.current) {
        stopProcessing();
        return;
      }

      pendingLecture.commit();

      // The sheet stays up — and stays in its processing state — until the
      // route swap unmounts it. Closing it or clearing the busy label here
      // would show the library, or the sheet's idle "Ustvari" state, in the gap
      // before the note renders.
      // When the sheet came from a `?mode=` link, the note replaces that entry
      // so going back lands on the library instead of reopening the sheet.
      const openedFromUrl = new URLSearchParams(window.location.search).has("mode");

      if (openedFromUrl) {
        router.replace(href);
      } else {
        router.push(href);
      }
    } catch (createError) {
      stopProcessing();
      setError(
        compressionErrorMessage(createError, t) ?? t("api.noteCreateFailed"),
      );
    }
  }

  async function createAudioLecture() {
    if (!audioSource) {
      setError(t("capture.error.pickAudioFirst"));
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote(audioSource.origin === "recording" ? "record" : "upload", [
        t("capture.busy.preparing"),
        t("capture.busy.uploadingAudio"),
        t("capture.busy.queueing"),
      ]);
      return;
    }

    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;

    let processingStarted = false;

    try {
      const createController = new AbortController();
      activeRequestControllerRef.current = createController;

      setError(null);
      cancelRequestedRef.current = false;
      const result = await createAudioLectureWithProcessingChunks({
        t,
        file: audioSource.file,
        durationSeconds: Math.max(audioSource.durationSeconds, 1),
        normalizeBeforeUpload: audioSource.origin === "recording",
        signal: createController.signal,
        onLectureCreated: (lectureId) => {
          createdLectureIdRef.current = lectureId;
        },
        onStageChange: (_stage, message) => {
          setBusyLabel(message);
        },
      });

      processingStarted = true;
      createdLectureIdRef.current = null;
      onClose();
      navigateWithFeedback(`/app/lectures/${result.lectureId}`);
      router.refresh();
    } catch (submitError) {
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!processingStarted) {
        await deleteCreatedLecture();
      }

      if (!cancelRequestedRef.current) {
        setError(
          compressionErrorMessage(submitError, t) ?? t("capture.error.audioNoteFailed"),
        );
      }
    } finally {
      submitInFlightRef.current = false;
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function createPhotoLecture() {
    if (photoSources.length === 0) {
      setError(t("capture.error.addPhotoFirst"));
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote("photo", [
        t("capture.busy.preparing"),
        photoSources.length === 1
          ? t("capture.busy.uploadingPhoto")
          : t("capture.busy.uploadingPhotos", { count: photoSources.length }),
        t("capture.busy.queueing"),
      ]);
      return;
    }

    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;

    try {
      setBusyLabel(t("capture.busy.preparing"));
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("text");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const filesForUpload = photoSources.map((photoSource, index) => ({
        file: photoSource.file,
        index,
        mimeType: normalizeUploadScanImageMimeType({
          mimeType: photoSource.file.type || "application/octet-stream",
          fileName: photoSource.file.name,
        }),
      }));
      const controller = new AbortController();
      activeRequestControllerRef.current = controller;

      setBusyLabel(t("capture.busy.preparingPhotoUploads"));
      const uploadTargetsResponse = await fetchWithTimeout(`/api/lectures/${lectureId}/scan-uploads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        timeoutMessage:
          t("capture.error.photoUploadPrepTooLong"),
        body: JSON.stringify({
          files: filesForUpload.map(({ file, index, mimeType }) => ({
            index,
            mimeType,
            fileName: file.name,
            size: file.size,
          })),
        }),
      });
      const uploadTargets = await parseApiResponse<ScanUploadResponse>(uploadTargetsResponse, t);
      const uploadTargetsByIndex = new Map(
        uploadTargets.uploads.map((upload) => [upload.index, upload] as const),
      );
      const supabase = createSupabaseBrowserClient();

      for (const [position, uploadFile] of filesForUpload.entries()) {
        const uploadTarget = uploadTargetsByIndex.get(uploadFile.index);

        if (!uploadTarget) {
          throw new Error(t("capture.error.missingPhotoTarget", { index: position + 1 }));
        }

        setBusyLabel(
          filesForUpload.length === 1
            ? t("capture.busy.uploadingPhoto")
            : t("capture.busy.uploadingPhotoN", {
                index: position + 1,
                total: filesForUpload.length,
              }),
        );

        /*
         * Retried, because this is the one place in the app where a learner can lose real work.
         * Ten photographed pages go up one at a time, and until this call retried, a single
         * dropped PUT anywhere in that sequence threw the whole set away — the note was swept as
         * `upload_incomplete` an hour later and there was nothing left on the row to retry from.
         */
        await uploadToSignedUrlWithRetry({
          supabase,
          path: uploadTarget.path,
          token: uploadTarget.token,
          file: uploadFile.file,
          contentType: uploadFile.mimeType,
          signal: controller.signal,
          onRetry: (attempt, attempts) =>
            setBusyLabel(t("capture.busy.retryingUpload", { attempt, total: attempts })),
        });
      }

      setBusyLabel(t("capture.busy.queueing"));

      const response = await fetchWithTimeout("/api/lectures/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        timeoutMessage:
          t("capture.error.photoQueueTooLong"),
        body: JSON.stringify({
          lectureId,
          // The photos are the whole source now — the sheet no longer takes pasted text.
          text: "",
          images: filesForUpload.map(({ file, index, mimeType }) => {
            const uploadTarget = uploadTargetsByIndex.get(index);

            if (!uploadTarget) {
              throw new Error(`Manjka cilj za fotografijo ${index + 1}.`);
            }

            return {
              index,
              path: uploadTarget.path,
              mimeType,
              fileName: file.name,
              size: file.size,
            };
          }),
        }),
      });

      await parseApiResponse<{ lectureId: string }>(response, t);

      onClose();
      createdLectureIdRef.current = null;
      navigateWithFeedback(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!cancelRequestedRef.current) {
        setError(
          compressionErrorMessage(submitError, t) ?? t("capture.error.photoNoteFailed"),
        );
      }
    } finally {
      submitInFlightRef.current = false;
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function createLinkLecture() {
    if (!trimmedLinkValue) {
      setError(t("capture.error.pasteLinkFirst"));
      return;
    }

    if (linkVideoError) {
      setError(linkVideoError);
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote("link", [t("capture.busy.preparing"), t("capture.busy.readingLink"), t("capture.busy.queueing")]);
      return;
    }

    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;

    try {
      setBusyLabel(t("capture.busy.preparing"));
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("link");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel(t("capture.busy.queueing"));

      const response = await fetch("/api/lectures/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          lectureId,
          url: trimmedLinkValue,
        }),
      });

      await parseApiResponse<{ lectureId: string }>(response, t);

      onClose();
      createdLectureIdRef.current = null;
      navigateWithFeedback(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!cancelRequestedRef.current) {
        setError(
          compressionErrorMessage(submitError, t) ?? t("capture.error.linkNoteFailed"),
        );
      }
    } finally {
      submitInFlightRef.current = false;
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function prepareHeicPhotoPreview(photoSource: PhotoSource) {
    // The photo itself still uploads straight to storage through a signed URL, so a
    // photo too large to convert is only missing its thumbnail, not unusable. Sending
    // it anyway just earns a platform 413, so show "no preview" without the round trip.
    //
    // The creator demo is the same dead end reached a different way: it is offline by
    // construction, so there is no function to convert anything, and `createCreatorDemoFetch`
    // answers the route it does not implement with `json({ ok: true })` — an ok response
    // whose `application/json` body fails the image check below and reported "the preview
    // could not be read" to Sentry from a public marketing page. Skip the round trip here
    // too rather than teach the catch-all a case it cannot honour.
    if (isCreatorDemo || !canConvertScanPreview(photoSource.file.size)) {
      setPhotoSources((current) =>
        current.map((currentPhotoSource) =>
          currentPhotoSource.id === photoSource.id
            ? { ...currentPhotoSource, previewStatus: "failed" }
            : currentPhotoSource,
        ),
      );
      return;
    }

    const formData = new FormData();
    formData.append("file", photoSource.file);

    try {
      setPhotoSources((current) =>
        current.map((currentPhotoSource) =>
          currentPhotoSource.id === photoSource.id
            ? { ...currentPhotoSource, previewStatus: "converting" }
            : currentPhotoSource,
        ),
      );

      const response = await fetchWithTimeout("/api/scan-preview", {
        method: "POST",
        headers: {
          Accept: "image/jpeg",
        },
        timeoutMs: SCAN_PREVIEW_TIMEOUT_MS,
        timeoutMessage: t("capture.error.previewTooLong"),
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          typeof payload?.error === "string" ? payload.error : t("capture.error.previewFailed"),
        );
      }

      const previewBlob = await response.blob();

      if (!previewBlob.type.startsWith("image/")) {
        throw new Error(t("capture.error.previewUnreadable"));
      }

      const previewObjectUrl = URL.createObjectURL(previewBlob);

      setPhotoSources((current) =>
        current.map((currentPhotoSource) => {
          if (currentPhotoSource.id !== photoSource.id) {
            return currentPhotoSource;
          }

          return {
            ...currentPhotoSource,
            previewUrl: previewObjectUrl,
            previewObjectUrls: [...currentPhotoSource.previewObjectUrls, previewObjectUrl],
            previewStatus: "ready",
          };
        }),
      );
    } catch (previewError) {
      setPhotoSources((current) =>
        current.map((currentPhotoSource) =>
          currentPhotoSource.id === photoSource.id
            ? { ...currentPhotoSource, previewStatus: "failed" }
            : currentPhotoSource,
        ),
      );
      Sentry.captureException(previewError, {
        tags: {
          component: "note-source-modal",
          action: "scan-preview",
        },
        extra: {
          fileName: photoSource.file.name,
          fileType: photoSource.file.type,
          fileSize: photoSource.file.size,
        },
      });
    }
  }

  async function prepareHeicPhotoPreviewsSequentially(photoSourcesForPreview: PhotoSource[]) {
    for (const photoSource of photoSourcesForPreview) {
      await prepareHeicPhotoPreview(photoSource);
    }
  }

  async function preparePhotoFiles(files: File[]) {
    if (photoSources.length + files.length > MAX_SCAN_IMAGE_COUNT) {
      throw new Error(t("capture.error.tooManyPhotos", { count: MAX_SCAN_IMAGE_COUNT }));
    }

    const preparedFiles: File[] = [];

    for (const file of files) {
      if (!isScanPhotoFile(file)) {
        throw new Error(t("capture.error.scanNeedsImage"));
      }

      let preparedFile = file;

      if (preparedFile.size > MAX_SCAN_IMAGE_BYTES) {
        setBusyLabel(files.length === 1 ? t("capture.busy.compressingPhoto") : t("capture.busy.compressingPhotos"));
        preparedFile = (await compressScanImageForUpload(preparedFile)).file;
      }

      if (preparedFile.size > MAX_SCAN_IMAGE_BYTES) {
        throw new Error(t("capture.error.imageTooLarge"));
      }

      preparedFiles.push(preparedFile);
    }

    const canUseNativeHeicPreview = canPreviewHeicNatively();
    const nextPhotoSources = preparedFiles.map((file) => createPhotoSource(file, canUseNativeHeicPreview));

    setPhotoSources((current) => [...current, ...nextPhotoSources]);
    setError(null);

    const heicPhotoSources = nextPhotoSources.filter(
      (photoSource) => photoSource.previewStatus === "queued",
    );

    if (heicPhotoSources.length > 0) {
      photoPreviewQueueRef.current = photoPreviewQueueRef.current
        .catch(() => undefined)
        .then(() => prepareHeicPhotoPreviewsSequentially(heicPhotoSources));
    }
  }

  async function prepareDocumentFile(file: File) {
    if (isLegacyPowerPointDocument(file)) {
      throw new Error(t("api.pptNotSupported"));
    }

    if (!isSupportedDocumentFile(file)) {
      throw new Error(t("capture.error.unsupportedDocument"));
    }

    let preparedFile = file;

    if (preparedFile.size > MAX_DOCUMENT_BYTES) {
      setBusyLabel(t("capture.busy.compressingDocument"));
      preparedFile = (await compressDocumentForUpload(preparedFile)).file;
    }

    if (preparedFile.size > MAX_DOCUMENT_BYTES) {
      throw new Error(t("capture.error.docCompressUnreadable"));
    }

    setPdfSource(preparedFile);
    setError(null);
  }

  function removePhotoSource(photoId: string) {
    const nextPhotoSources = photoSources.filter((photoSource) => photoSource.id !== photoId);
    const removedPhotoSource = photoSources.find((photoSource) => photoSource.id === photoId);

    if (removedPhotoSource) {
      revokePhotoSourcePreviewUrls(removedPhotoSource);
    }

    setPhotoSources(nextPhotoSources);
    setActivePhotoPreviewId((current) => (current === photoId ? null : current));
  }

  function handlePhotoPreviewImageError(photoId: string) {
    setPhotoSources((current) =>
      current.map((photoSource) => {
        if (
          photoSource.id !== photoId ||
          photoSource.previewStatus === "ready" ||
          photoSource.previewStatus === "converting"
        ) {
          return photoSource;
        }

        return {
          ...photoSource,
          previewUrl: "",
        };
      }),
    );
  }

  async function handleScanImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canCreateNotes) {
      event.target.value = "";
      redirectToPaywall();
      return;
    }

    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    try {
      await preparePhotoFiles(files);
    } catch (scanError) {
      if (redirectToBillingIfNeeded({ error: scanError, router })) {
        onClose();
        return;
      }

      setError(
        compressionErrorMessage(scanError, t) ?? t("api.scanFailed"),
      );
    } finally {
      setBusyLabel(null);
      event.target.value = "";
    }
  }

  /**
   * Shared by the file picker and by dropping onto the sheet. Dropping is worth supporting on its
   * own, but it also has to be handled somewhere: a file dropped on a page that ignores it makes
   * the browser navigate to it, and macOS opens a .wav in Music, so the app vanishes behind a
   * music player with nothing uploaded.
   */
  async function acceptDocumentOrPhotoFiles(files: File[]) {
    if (files.length === 0) {
      return;
    }

    // One source per note: a staged document is replaced only by removing it first, and a
    // document never lands on top of staged photos.
    if (pdfSource) {
      setError(t("capture.error.oneDocumentOnly"));
      return;
    }

    const allImages = files.every((file) => isScanPhotoFile(file));

    if (!allImages && photoSources.length > 0) {
      setError(t("capture.error.removePhotosFirst"));
      return;
    }

    try {
      if (allImages) {
        await preparePhotoFiles(files);
        return;
      }

      if (files.length > 1) {
        throw new Error(t("capture.error.tooManyFiles"));
      }

      await prepareDocumentFile(files[0]);
    } catch (submitError) {
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      setError(
        compressionErrorMessage(submitError, t) ?? t("capture.error.filePrepFailed"),
      );
    }
  }

  function handleFileDragOver(event: React.DragEvent<HTMLElement>) {
    if (Array.from(event.dataTransfer.types).includes("Files")) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleSheetDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();

    const files = Array.from(event.dataTransfer.files ?? []);

    if (files.length === 0) {
      return;
    }

    if (!canCreateNotes) {
      redirectToPaywall();
      return;
    }

    // The sheet accepts whatever it can handle, whichever tab happens to be open: an audio file
    // switches to the upload tab, anything else is treated as a document or photos.
    if (files.length === 1 && isAudioSourceFile(files[0])) {
      setSelectedMode("upload");
      void replaceAudioSource({
        file: files[0],
        durationSeconds: 0,
        previewUrl: URL.createObjectURL(files[0]),
        origin: "upload",
      });
      return;
    }

    setSelectedMode("text");
    void acceptDocumentOrPhotoFiles(files);
  }

  async function handlePdfPick(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canCreateNotes) {
      event.target.value = "";
      redirectToPaywall();
      return;
    }

    try {
      await acceptDocumentOrPhotoFiles(Array.from(event.target.files ?? []));
    } finally {
      setBusyLabel(null);
      // Cleared so picking the same file twice in a row still fires a change event.
      event.target.value = "";
    }
  }

  async function createPdfLecture() {
    if (!pdfSource) {
      setError(t("capture.error.pickDocumentFirst"));
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote("pdf", [t("capture.busy.preparing"), t("capture.busy.uploadingDocument"), t("capture.busy.queueing")]);
      return;
    }

    if (submitInFlightRef.current) {
      return;
    }

    submitInFlightRef.current = true;

    try {
      setBusyLabel(t("capture.busy.preparing"));
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("pdf");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const uploadFileName = createSafeTransportFileName(pdfSource.name);
      const uploadFile =
        uploadFileName === pdfSource.name
          ? pdfSource
          : new File([pdfSource], uploadFileName, {
              type: pdfSource.type,
              lastModified: pdfSource.lastModified,
            });

      const formData = new FormData();
      formData.append("lectureId", lectureId);
      formData.append("file", uploadFile);
      formData.append("originalFileName", pdfSource.name);

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel(t("capture.busy.uploadingDocument"));

      const response = await fetch("/api/lectures/pdf", {
        method: "POST",
        signal: controller.signal,
        body: formData,
      });

      await parseApiResponse<{ lectureId: string }>(response, t);

      onClose();
      createdLectureIdRef.current = null;
      navigateWithFeedback(`/app/lectures/${lectureId}`);
      router.refresh();
    } catch (submitError) {
      await deleteCreatedLecture();
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      if (!cancelRequestedRef.current) {
        setError(
          compressionErrorMessage(submitError, t) ?? t("capture.error.docNoteFailed"),
        );
      }
    } finally {
      submitInFlightRef.current = false;
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  /**
   * The redesign's action row: a cancel beside the primary call to action.
   * While a request is in flight the row collapses to a single cancel, which
   * cancels that request rather than closing the sheet — the existing
   * behaviour, and the more useful one at that moment.
   */
  function renderModalActions(primary: React.ReactNode) {
    if (busyLabel) {
      return (
        <div className="memo-modal-actions">
          <button
            type="button"
            className="ios-secondary-button wide"
            disabled={isCancelling}
            onClick={() => void handleCancelBusyAction()}
          >
            {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {/* Wrapped so Chrome's page translation cannot carry the label out from
                under React — see the note on the recording buttons below. */}
            <span>{t("common.cancel")}</span>
          </button>
        </div>
      );
    }

    return (
      <div className="memo-modal-actions">
        <button type="button" className="ios-secondary-button" onClick={requestClose}>
          {t("common.cancel")}
        </button>
        {primary}
      </div>
    );
  }

  function renderBusyOrGenerateButton(params: {
    canGenerate: boolean;
    onGenerate: () => void;
    generateIcon: string;
  }) {
    return renderModalActions(
      <button
        type="button"
        className="ios-primary-button"
        disabled={!params.canGenerate}
        onClick={() => {
          if (!canCreateNotes) {
            redirectToPaywall();
            return;
          }

          params.onGenerate();
        }}
      >
        {t("capture.createNote")}
      </button>,
    );
  }

  /**
   * Whatever source is already staged for this mode, drawn as one card.
   *
   * It heads the screen rather than sitting among the options, because it is
   * the answer to what the screen is asking: everything below it — the audio
   * switch, the picker, the actions — is about that file.
   */
  function renderPreparedSourceCard() {
    if (selectedMode === "record" && preparedRecording) {
      return (
        <div className="ios-card note-source-prepared-card">
          <p className="note-source-card-label">{t("capture.preparedRecording")}</p>
          <p className="ios-row-title mt-3">{preparedRecording.file.name}</p>
          <p className="ios-row-subtitle">
            {formatTimestamp(preparedRecording.durationSeconds * 1000)}
          </p>
        </div>
      );
    }

    if (selectedMode === "upload" && preparedUpload) {
      return (
        <div className="ios-card note-source-prepared-card">
          <p className="note-source-card-label">{t("capture.selectedFile")}</p>
          <p className="ios-row-title mt-3">{preparedUpload.file.name}</p>
          <p className="ios-row-subtitle">
            {formatTimestamp(preparedUpload.durationSeconds * 1000)}
          </p>
          {isCreatorDemo ? null : (
            <button
              type="button"
              className="note-source-prepared-remove"
              disabled={Boolean(busyLabel)}
              onClick={clearAudioSource}
              aria-label={t("capture.removeSelectedFile")}
              title={t("capture.removeSelectedFile")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      );
    }

    if (selectedMode === "text" && pdfSource) {
      return (
        <div className="ios-card note-source-docs-file-card note-source-prepared-card">
          <p className="note-source-card-label">{t("capture.selectedDocument")}</p>
          <p className="ios-row-title note-source-docs-file-name">{pdfSource.name}</p>
          <p className="ios-row-subtitle note-source-docs-file-copy">
            {t("capture.documentReplaceHint")}
          </p>
          {isCreatorDemo ? null : (
            <button
              type="button"
              className="note-source-prepared-remove"
              disabled={Boolean(busyLabel)}
              onClick={() => {
                setPdfSource(null);
                setError(null);
              }}
              aria-label={t("capture.removeSelectedDocument")}
              title={t("capture.removeSelectedDocument")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      );
    }

    return null;
  }

  function renderLoadingState() {
    if (!busyLabel) {
      return null;
    }

    /*
     * The same stage caption and bar the note screen uses while the pipeline
     * runs, so uploading a source and generating from it read as one wait
     * rather than as two unrelated screens. The blue spinner this replaced was
     * the last of the pre-redesign palette left in the sheet.
     */
    return (
      <div
        className="note-source-loading-state memo-gen-head"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <p className="memo-gen-stage">{busyLabel}</p>
        <p className="memo-gen-copy">
          {t("capture.dontCloseScreen")}
        </p>
        <span className="memo-gen-track" aria-hidden="true">
          <span />
        </span>
        <button
          type="button"
          className="ios-secondary-button note-source-busy-cancel"
          disabled={isCancelling}
          onClick={() => void handleCancelBusyAction()}
        >
          {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {/* Wrapped so Chrome's page translation cannot carry the label out from
              under React — see the note on the recording buttons below. */}
          <span>{t("common.cancel")}</span>
        </button>
      </div>
    );
  }

  if (!open || !mode) {
    return null;
  }

  // `/creator/college` only: the record sheet is replaced by the live-writing
  // takeover. Every other source keeps the normal sheet, and no other tree —
  // `/creator`, `/app` — ever reaches this branch.
  if (isCollegeCreatorDemo && selectedMode === "record") {
    return <CollegeLiveRecording basePath={demoBasePath} onClose={onClose} />;
  }

  const modalContent = (
    <>
      <div
        className={sheetClass("ios-sheet-backdrop note-source-modal-backdrop", sourceSheet.closing)}
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        className="ios-sheet-wrap note-source-modal-wrap"
        role="dialog"
        aria-modal="true"
        aria-label={t("library.newNote")}
      >
        <div className="ios-sheet-stack note-source-modal-stack">
          <section
            className={sheetClass(
              "ios-sheet note-source-sheet note-source-modal mobile-draggable-sheet",
              sourceSheet.closing,
            )}
            onPointerDown={handleSourceSheetPointerDown}
            onClickCapture={handleSourceSheetClickCapture}
            onDragOver={handleFileDragOver}
            onDrop={handleSheetDrop}
            data-dragging={
              sourceSheetDragOffset > 0 && !sourceSheet.closing ? "true" : undefined
            }
            style={
              sourceSheetDragOffset > 0 && !sourceSheet.closing
                ? { transform: `translateY(${sourceSheetDragOffset}px)`, transition: "none" }
                : undefined
            }
          >
            <button
              type="button"
              className="mobile-sheet-drag-handle note-source-modal-drag-handle"
              aria-label={t("folders.dragToClose")}
              data-drag-handle
            />
            <div className="ios-sheet-header note-source-header">
              <span className="memo-modal-tile">
                <Emoji
                  symbol={showAudioImportGuide ? "📱" : modeEmoji(selectedMode)}
                  size="1.3rem"
                />
              </span>
              {/* No back button: the close button and the drag-down gesture
                  both route through requestClose, which steps back out of the
                  guide to the audio options rather than closing the sheet. */}
              <h2 className="ios-sheet-title">
                {t(
                  showAudioImportGuide
                    ? "capture.importAudioTitle"
                    : sheetTitleKey(selectedMode),
                )}
              </h2>
              <button
                type="button"
                onClick={requestClose}
                disabled={isCancelling}
                className="app-close-button ios-sheet-header-close"
                aria-label={t("common.close")}
              >
                <Msym name="close" size="1.45rem" fill={false} weight={500} />
              </button>
            </div>

            {sheetDescription() ? (
              <p className="note-source-description">{sheetDescription()}</p>
            ) : null}

            {busyLabel ? (
              <div className="mt-6 note-source-modal-body note-source-modal-body-loading">
                {renderLoadingState()}
              </div>
            ) : showAudioImportGuide ? (
              <div className="mt-6 space-y-4 note-source-modal-body">
                <section className="ios-card note-source-guide-hero">
                  <p className="note-source-card-label">{t("capture.guide.whyLabel")}</p>
                  <p className="note-source-guide-title">{t("capture.guide.whyTitle")}</p>
                  <p className="note-source-guide-copy">{t("capture.guide.whyCopy")}</p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">{t("capture.guide.step1Label")}</p>
                  <p className="note-source-guide-step-title">{t("capture.guide.step1Title")}</p>
                  <p className="note-source-guide-copy">{t("capture.guide.step1Copy1")}</p>
                  <p className="note-source-guide-copy">{t("capture.guide.step1Copy2")}</p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">{t("capture.guide.step2Label")}</p>
                  <p className="note-source-guide-step-title">{t("capture.guide.step2Title")}</p>
                  <p className="note-source-guide-copy">{t("capture.guide.step2Copy1")}</p>
                  <p className="note-source-guide-copy">{t("capture.guide.step2Copy2")}</p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">{t("capture.guide.step3Label")}</p>
                  <p className="note-source-guide-step-title">{t("capture.guide.step3Title")}</p>
                  {/* The bolded words are the app's own controls, so they come
                      from the same keys those controls render — a translated
                      instruction that names an untranslated button is worse
                      than no instruction. */}
                  <p className="note-source-guide-copy">
                    {t("capture.guide.step3Copy1a")}
                    <strong>{t("capture.mode.upload")}</strong>
                    {t("capture.guide.step3Copy1b")}
                    <strong>{t("capture.pickAudioFile")}</strong>
                    {t("capture.guide.step3Copy1c")}
                  </p>
                  <p className="note-source-guide-copy">
                    {t("capture.guide.step3Copy2a")}
                    <strong>{t("capture.create")}</strong>
                    {t("capture.guide.step3Copy2b")}
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">{t("capture.guide.summaryLabel")}</p>
                  <p className="note-source-guide-copy">{t("capture.guide.summaryCopy")}</p>
                </section>

                <div className="memo-modal-actions">
                  <button
                    type="button"
                    className="ios-secondary-button wide"
                    onClick={() => setShowAudioImportGuide(false)}
                  >
                    {t("common.back")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className={cn(
                    "mt-6 space-y-4 note-source-modal-body",
                    selectedMode === "text" && "note-source-modal-body-text",
                    selectedMode === "text" &&
                      photoSources.length > 0 &&
                      "note-source-modal-body-photos",
                  )}
                >
                  {renderPreparedSourceCard()}

                  {selectedMode === "record" && !isRecording && !nativeRecorder ? (
                    <button
                      type="button"
                      className="memo-capture-row"
                      onClick={() => setShowAudioImportGuide(true)}
                    >
                      <span className="memo-capture-row-tile">
                        <Emoji symbol="📱" size="1.15rem" />
                      </span>
                      <span className="memo-capture-row-copy">
                        <span>{t("capture.recordOffscreenTitle")}</span>
                        <span>{t("capture.recordOffscreenDetail")}</span>
                      </span>
                      <Msym name="chevron_right" size="1.5rem" fill={false} weight={400} />
                    </button>
                  ) : null}

                  {selectedMode === "record" ? (
                    <>
                      {/* The design draws the orb, the clock and the hint for
                          the whole of the record screen — it has no separate
                          "before you start" state, because its timer runs from
                          the moment the screen opens. Here the microphone has
                          to be asked for first, so the same screen sits at
                          0:00 until it is. */}
                      {preparedRecording ? null : (
                        <div className="memo-record">
                          <div className={`memo-record-orb ${isPaused ? "paused" : ""}`.trim()}>
                            <span className="ring" />
                            <span className="halo" />
                            <span className="core">
                              <Msym name="mic" className="memo-record-orb-mic" fill />
                            </span>
                          </div>
                          <span className="memo-record-clock">
                            {formatTimestamp(elapsedSeconds * 1000)}
                          </span>
                          {/* The real input level, rather than the artboard's
                              decorative bars. */}
                          {isRecording ? <LiveAudioWave active={!isPaused} /> : null}
                          <span className="memo-record-hint">
                            {!isRecording
                              ? t("capture.recordHintIdle")
                              : isPaused
                                ? t("capture.recordPaused")
                                : nativeRecorder
                                  ? t("capture.recordLockScreenHint")
                                  : t("capture.recordActive")}
                          </span>
                          {isRecording ? (
                          <button
                            type="button"
                            disabled={Boolean(busyLabel)}
                            className="memo-record-pause"
                            onClick={() => {
                              if (busyLabel) {
                                return;
                              }

                              if (isPaused) {
                                resumeRecording();
                                return;
                              }

                              pauseRecording();
                            }}
                          >
                            <Msym name={isPaused ? "play_arrow" : "pause"} size="1.15rem" />
                            {isPaused ? t("capture.resumeRecording") : t("capture.pauseRecording")}
                          </button>
                          ) : null}
                        </div>
                      )}

                      {isRecording ? (
                        <div className="memo-modal-actions">
                          {/* The design pairs the cancel with the call to action.
                              Pausing has no counterpart there, so it keeps its
                              own round control beside the orb. */}
                          <button
                            type="button"
                            className="ios-secondary-button"
                            onClick={requestClose}
                          >
                            {t("common.cancel")}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyLabel)}
                            className="ios-primary-button"
                            onClick={() => {
                              if (busyLabel) {
                                return;
                              }

                              void stopRecording();
                            }}
                          >
                            {busyLabel ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {/*
                             * The label is wrapped rather than written as bare text. The
                             * spinner appears beside it the moment recording stops, and
                             * React places it by inserting before the host sibling it
                             * remembers — the label. Chrome's page translation, which
                             * every learner outside our five locales is offered, rewrites
                             * a bare text node into a pair of <font> wrappers and so takes
                             * it out of the button; the insert then throws NotFoundError
                             * and drops the whole capture flow onto the error screen, the
                             * way it did on onboarding (Sentry MEMOAI-WEB-3A). Translation
                             * rewrites the inside of an element and never moves the
                             * element itself, so a <span> stays where React left it.
                             */}
                            <span>{busyLabel ?? t("capture.stopAndCreate")}</span>
                          </button>
                        </div>
                      ) : null}

                      {!isRecording && preparedRecording ? (
                        <>
                          {renderBusyOrGenerateButton({
                            canGenerate: true,
                            onGenerate: () => void createAudioLecture(),
                            generateIcon: "📄",
                          })}

                          {isCreatorDemo ? null : (
                            <button
                              type="button"
                              className="ios-secondary-button"
                              disabled={Boolean(busyLabel)}
                              onClick={() => {
                                clearAudioSource();
                                void startRecording();
                              }}
                            >
                              {t("capture.recordAgain")}
                            </button>
                          )}
                        </>
                      ) : null}

                      {!isRecording && !preparedRecording ? (
                        <div className="memo-modal-actions">
                          <button
                            type="button"
                            className="ios-secondary-button"
                            onClick={requestClose}
                          >
                            {t("common.cancel")}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyLabel)}
                            className="ios-primary-button"
                            onClick={() => void startRecording()}
                          >
                            {busyLabel ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            {/* Wrapped for the same reason as the stop button above. */}
                            <span>{busyLabel ?? t("capture.startRecording")}</span>
                          </button>
                        </div>
                      ) : null}
                    </>
                  ) : null}

                  {selectedMode === "upload" ? (
                    <>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept={AUDIO_FILE_INPUT_ACCEPT}
                        onChange={handleUploadFileChange}
                        className="hidden"
                      />

                      {isCreatorDemo || preparedUpload ? null : (
                        <button
                          type="button"
                          disabled={Boolean(busyLabel)}
                          className="memo-dropzone"
                          onClick={() => {
                            if (!canCreateNotes) {
                              redirectToPaywall();
                              return;
                            }

                            uploadInputRef.current?.click();
                          }}
                        >
                          <Msym name="cloud_upload" className="memo-dropzone-icon" />
                          <span className="memo-dropzone-lead">{t("capture.pickFile")}</span>
                          <span className="memo-dropzone-title">{t("capture.audioFormats")}</span>
                          <span className="memo-dropzone-hint">
                            {t("capture.dropHint", { action: t("capture.pickFile") })}
                          </span>
                        </button>
                      )}

                      {renderBusyOrGenerateButton({
                        canGenerate: Boolean(preparedUpload),
                        onGenerate: () => void createAudioLecture(),
                        generateIcon: "📄",
                      })}
                    </>
                  ) : null}

                  {selectedMode === "link" ? (
                    <>
                      <div>
                        <label className="note-source-field-label">
                          {t("capture.linkLabel")}
                        </label>
                        <div className="ios-search note-source-link-field">
                          <input
                            value={linkValue}
                            readOnly={isCreatorDemo}
                            onChange={(event) => {
                              setLinkValue(event.target.value);
                              setError(null);
                            }}
                            placeholder={
                              youtubeImportEnabled
                                ? "https://www.youtube.com/watch?v=..."
                                : "https://example.com"
                            }
                          />
                        </div>
                        {linkVideoError ? (
                          <p className="ios-info ios-danger mt-2">{linkVideoError}</p>
                        ) : (
                          <p className="ios-info mt-2">
                            {youtubeImportEnabled
                              ? t("capture.linkHintYoutube")
                              : t("capture.linkHint")}
                          </p>
                        )}
                      </div>

                      {renderBusyOrGenerateButton({
                        canGenerate: canGenerateLink,
                        onGenerate: () => void createLinkLecture(),
                        generateIcon: "🔗",
                      })}
                    </>
                  ) : null}

                  {selectedMode === "text" ? (
                    <>
                      {photoSources.length > 0 ? (
                        <div className="note-source-photo-previews" aria-label={t("capture.uploadedPhotos")}>
                          <p className="ios-row-subtitle note-source-docs-file-copy note-source-docs-status-copy">
                            {t("capture.uploadedPhotoCount", { count: photoSources.length })}
                          </p>
                          <div className="note-source-photo-grid">
                            {visiblePhotoSources.map((photoSource) => {
                              const originalIndex = photoSources.findIndex(
                                (source) => source.id === photoSource.id,
                              );

                              return (
                                <div key={photoSource.id} className="note-source-photo-preview">
                                  <button
                                    type="button"
                                    className="note-source-photo-open"
                                    onClick={() => setActivePhotoPreviewId(photoSource.id)}
                                    aria-label={t("capture.openPhoto", {
                                      index: originalIndex + 1,
                                    })}
                                  >
                                    {photoSource.previewUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={photoSource.previewUrl}
                                        alt={
                                          photoSource.file.name ||
                                          t("capture.photoAlt", { index: originalIndex + 1 })
                                        }
                                        className="note-source-photo-image"
                                        onError={() => handlePhotoPreviewImageError(photoSource.id)}
                                      />
                                    ) : (
                                      <span className="note-source-photo-preview-status">
                                        {photoSource.previewStatus === "failed"
                                          ? t("capture.noPreview")
                                          : photoSource.previewStatus === "queued"
                                            ? t("capture.waiting")
                                            : t("capture.previewing")}
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="note-source-photo-remove"
                                    onClick={() => removePhotoSource(photoSource.id)}
                                    aria-label={t("capture.removePhotoIndexed", {
                                      index: originalIndex + 1,
                                    })}
                                    title={t("capture.removePhoto")}
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <input
                        ref={pdfInputRef}
                        type="file"
                        accept={
                          hasPhotoSources ? SCAN_IMAGE_INPUT_ACCEPT : DOCUMENT_OR_IMAGE_INPUT_ACCEPT
                        }
                        multiple
                        onChange={handlePdfPick}
                        className="hidden"
                      />

                      <input
                        ref={scanInputRef}
                        type="file"
                        accept={SCAN_IMAGE_INPUT_ACCEPT}
                        multiple
                        capture="environment"
                        onChange={handleScanImageChange}
                        className="hidden"
                      />

                      {isCreatorDemo || !canAddDocumentSource ? null : (
                        <div className="note-source-docs-actions note-source-docs-actions-bottom">
                          <button
                            type="button"
                            className="memo-dropzone"
                            disabled={Boolean(busyLabel)}
                            onClick={() => {
                              if (!canCreateNotes) {
                                redirectToPaywall();
                                return;
                              }

                              pdfInputRef.current?.click();
                            }}
                          >
                            <Msym name="cloud_upload" className="memo-dropzone-icon" />
                            <span className="memo-dropzone-lead">
                              {t(hasPhotoSources ? "capture.addPhotos" : "capture.pickFile")}
                            </span>
                            <span className="memo-dropzone-title">
                              {hasPhotoSources
                                ? t("capture.photoLimit", { count: MAX_SCAN_IMAGE_COUNT })
                                : t("capture.documentFormats")}
                            </span>
                            <span className="memo-dropzone-hint">
                              {t("capture.dropHint", {
                                action: t(
                                  hasPhotoSources ? "capture.addPhotos" : "capture.pickFile",
                                ),
                              })}
                            </span>
                          </button>

                          <button
                            type="button"
                            className="ios-secondary-button note-source-docs-action-button"
                            disabled={Boolean(busyLabel)}
                            onClick={() => {
                              if (!canCreateNotes) {
                                redirectToPaywall();
                                return;
                              }

                              scanInputRef.current?.click();
                            }}
                          >
                            <Msym name="photo_camera" />
                            {t("capture.scan")}
                          </button>
                        </div>
                      )}

                      {renderBusyOrGenerateButton({
                        canGenerate: canGenerateText,
                        onGenerate: () => {
                          if (pdfSource) {
                            void createPdfLecture();
                            return;
                          }

                          void createPhotoLecture();
                        },
                        generateIcon: "📄",
                      })}
                    </>
                  ) : null}

                  {error ? <p className="ios-info ios-danger">{error}</p> : null}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {activePhotoPreview ? (
        <div
          className="note-source-photo-viewer"
          role="dialog"
          aria-modal="true"
          aria-label={t("capture.photoPreview")}
        >
          <button
            type="button"
            className="note-source-photo-viewer-backdrop"
            onClick={() => setActivePhotoPreviewId(null)}
            aria-label={t("capture.closePhotoPreview")}
          />
          <div className="note-source-photo-viewer-stage">
            {activePhotoPreview.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activePhotoPreview.previewUrl}
                alt={activePhotoPreview.file.name || t("capture.photoPreview")}
                className="note-source-photo-viewer-image"
              />
            ) : (
              <p className="note-source-photo-viewer-status">
                {activePhotoPreview.previewStatus === "failed"
                  ? t("capture.previewUnavailable")
                  : t("capture.previewPreparing")}
              </p>
            )}
          </div>
          <div className="note-source-photo-viewer-actions">
            <button
              type="button"
              className="note-source-photo-viewer-icon-button"
              onClick={() => removePhotoSource(activePhotoPreview.id)}
              aria-label={t("capture.removePhoto")}
              title={t("capture.removePhoto")}
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="note-source-photo-viewer-icon-button"
              onClick={() => setActivePhotoPreviewId(null)}
              aria-label={t("capture.closePhotoPreview")}
              title={t("common.close")}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      {navigationOverlay}
      <MemoPortal>{modalContent}</MemoPortal>
    </>
  );
}
