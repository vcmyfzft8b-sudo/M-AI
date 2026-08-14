"use client";

import * as Sentry from "@sentry/nextjs";
import {
  ChevronLeft,
  ChevronDown,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";

import { useCreatorDemoBasePath } from "@/components/creator-demo/creator-demo-context";
import { EmojiIcon } from "@/components/emoji-icon";
import { LiveAudioWave } from "@/components/live-audio-wave";
import { useInstantNavigation } from "@/components/navigation-loading";
import { ViewportPortal } from "@/components/viewport-portal";
import { createAudioLectureWithProcessingChunks } from "@/lib/audio-lecture-upload";
import {
  AUDIO_FILE_INPUT_ACCEPT,
  DOCUMENT_FILE_INPUT_ACCEPT,
  MAX_AUDIO_BYTES,
  MAX_AUDIO_SECONDS,
  MAX_DOCUMENT_BYTES,
  MAX_SCAN_IMAGE_COUNT,
  MAX_SCAN_IMAGE_BYTES,
  SCAN_IMAGE_INPUT_ACCEPT,
  STORAGE_BUCKET,
} from "@/lib/constants";
import { parseApiResponse, redirectToBillingIfNeeded } from "@/lib/billing-client";
import { mapAppHref } from "@/lib/creator-demo/paths";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";
import {
  createSafeTransportFileName,
  getLowercaseExtension,
  isLegacyPowerPointDocument,
  isSupportedDocumentFile,
} from "@/lib/document-files";
import {
  compressAudioForUpload,
  compressDocumentForUpload,
  compressScanImageForUpload,
} from "@/lib/file-compression-client";
import { NOTE_LANGUAGE_OPTIONS } from "@/lib/languages";
import {
  getExtensionForMimeType,
  isSupportedScanImageMimeType,
  normalizeMimeType,
  normalizeUploadScanImageMimeType,
} from "@/lib/storage";
import { getUnsupportedVideoUrlMessage } from "@/lib/link-source-validation";
import {
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_VOICE_STORAGE_KEY,
  NOTE_TTS_VOICES,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";
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

function getInitialAudioVoice(): NoteTtsVoice {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_VOICE;
  }

  const storedVoice = window.localStorage.getItem(NOTE_TTS_VOICE_STORAGE_KEY);

  return NOTE_TTS_VOICES.find((voice) => voice === storedVoice) ?? DEFAULT_NOTE_TTS_VOICE;
}

type PhotoSource = {
  id: string;
  file: File;
  previewUrl: string;
  previewObjectUrls: string[];
  previewStatus: "queued" | "converting" | "ready" | "failed";
};

const MODES: Array<{
  id: NoteSourceMode;
  label: string;
  icon: string;
}> = [
  { id: "record", label: "Snemaj", icon: "🎙️" },
  { id: "upload", label: "Naloži", icon: "📤" },
  { id: "text", label: "Dokumenti", icon: "📄" },
  { id: "link", label: "Povezava", icon: "🔗" },
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

function readAudioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const audio = document.createElement("audio");
    const objectUrl = URL.createObjectURL(file);

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      audio.remove();
    };

    audio.preload = "metadata";
    audio.src = objectUrl;

    audio.onloadedmetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(duration);
    };

    audio.onerror = () => {
      cleanup();
      reject(new Error("Dolžine zvočne datoteke ni bilo mogoče prebrati."));
    };
  });
}

function validateAudio(file: File, durationSeconds: number) {
  if (file.size > MAX_AUDIO_BYTES) {
    throw new Error("Zvočna datoteka je prevelika. Omejitev je 300 MB.");
  }

  if (durationSeconds > MAX_AUDIO_SECONDS) {
    throw new Error("Zvočna datoteka je predolga. Omejitev je 3 ure.");
  }
}

function sheetTitle(mode: NoteSourceMode) {
  if (mode === "record") {
    return "Posnemi predavanje";
  }

  if (mode === "upload") {
    return "Naloži zvok";
  }

  if (mode === "link") {
    return "Dodaj povezavo";
  }

  return "Prilepi besedilo ali dokument";
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
const DEMO_CREATE_TOTAL_MS = 3000;

const DOCUMENT_OR_IMAGE_INPUT_ACCEPT = `${DOCUMENT_FILE_INPUT_ACCEPT},${SCAN_IMAGE_INPUT_ACCEPT}`;
const LOCAL_API_REQUEST_TIMEOUT_MS = 30_000;
const SCAN_PREVIEW_TIMEOUT_MS = 18_000;

async function fetchWithTimeout(
  input: Parameters<typeof fetch>[0],
  init: RequestInit & { timeoutMessage?: string; timeoutMs?: number } = {},
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
      throw new Error(
        timeoutMessage ??
          "Lokalni strežnik se ni odzval dovolj hitro. Osveži stran in poskusi znova.",
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromParent);
  }
}

function formatUploadedPhotoCount(count: number) {
  const remainder100 = count % 100;

  if (remainder100 === 1) {
    return `${count} fotografija naložena`;
  }

  if (remainder100 === 2) {
    return `${count} fotografiji naloženi`;
  }

  if (remainder100 === 3 || remainder100 === 4) {
    return `${count} fotografije naložene`;
  }

  return `${count} fotografij naloženih`;
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
  const router = useRouter();
  const demoBasePath = useCreatorDemoBasePath();
  const isCreatorDemo = demoBasePath != null;
  const { navigateWithFeedback, overlay: navigationOverlay } = useInstantNavigation();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const inlineTextAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  const requestCloseRef = useRef<() => void>(() => undefined);
  const activeRequestControllerRef = useRef<AbortController | null>(null);
  const createdLectureIdRef = useRef<string | null>(null);
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
  const [textValue, setTextValue] = useState("");
  const [linkValue, setLinkValue] = useState("");
  const [languageHint, setLanguageHint] = useState("sl");
  const [createInitialAudio, setCreateInitialAudio] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordingSupported, setRecordingSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);
  const [textEditorKeyboardOffset, setTextEditorKeyboardOffset] = useState(0);
  const [visualizerStream, setVisualizerStream] = useState<MediaStream | null>(null);
  const [showAudioImportGuide, setShowAudioImportGuide] = useState(false);
  const [sourceSheetDragOffset, setSourceSheetDragOffset] = useState(0);

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

  useEffect(() => {
    if (selectedMode !== "text" && isTextEditorOpen) {
      setIsTextEditorOpen(false);
    }
  }, [isTextEditorOpen, selectedMode]);

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

  useEffect(() => {
    if (!isTextEditorOpen || typeof window === "undefined") {
      setTextEditorKeyboardOffset(0);
      return;
    }

    const viewport = window.visualViewport;

    if (!viewport) {
      setTextEditorKeyboardOffset(0);
      return;
    }

    const updateKeyboardOffset = () => {
      const keyboardOffset = Math.max(
        0,
        Math.round(window.innerHeight - viewport.height - viewport.offsetTop),
      );

      setTextEditorKeyboardOffset(keyboardOffset > 120 ? keyboardOffset : 0);
    };

    updateKeyboardOffset();
    viewport.addEventListener("resize", updateKeyboardOffset);
    viewport.addEventListener("scroll", updateKeyboardOffset);
    window.addEventListener("orientationchange", updateKeyboardOffset);

    return () => {
      viewport.removeEventListener("resize", updateKeyboardOffset);
      viewport.removeEventListener("scroll", updateKeyboardOffset);
      window.removeEventListener("orientationchange", updateKeyboardOffset);
    };
  }, [isTextEditorOpen]);

  const preparedRecording = audioSource?.origin === "recording" ? audioSource : null;
  const preparedUpload = audioSource?.origin === "upload" ? audioSource : null;
  const trimmedTextValue = textValue.trim();
  const combinedTextSource = trimmedTextValue;
  const trimmedLinkValue = linkValue.trim();
  const linkVideoError = useMemo(
    () => getUnsupportedVideoUrlMessage(trimmedLinkValue),
    [trimmedLinkValue],
  );
  const canGenerateText =
    Boolean(pdfSource) || photoSources.length > 0 || combinedTextSource.length >= 120;
  const canGenerateLink = trimmedLinkValue.length > 0 && !linkVideoError;
  const activePhotoPreview =
    photoSources.find((photoSource) => photoSource.id === activePhotoPreviewId) ?? null;
  const visiblePhotoSources = photoSources;

  useEffect(() => {
    photoSourcesRef.current = photoSources;
  }, [photoSources]);

  useEffect(() => {
    if (!open || selectedMode !== "text") {
      return;
    }

    const textarea = inlineTextAreaRef.current;

    if (!textarea) {
      return;
    }

    const rootFontSize =
      Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16;
    const compactHeight = 4.5 * rootFontSize;
    const emptyHeight = 6.25 * rootFontSize;
    const filledMinHeight = 7.25 * rootFontSize;
    const maxHeight = Math.min(
      9.5 * rootFontSize,
      Math.max(filledMinHeight, window.innerHeight * 0.18),
    );
    const minHeight = pdfSource ? compactHeight : trimmedTextValue ? filledMinHeight : emptyHeight;

    textarea.style.height = `${minHeight}px`;
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight + 1 ? "auto" : "hidden";
  }, [open, pdfSource, selectedMode, textValue, trimmedTextValue]);

  function redirectToPaywall() {
    onClose();
    router.push("/app/start");
  }

  const replaceAudioSource = useCallback(async (nextSource: AudioSource) => {
    let preparedSource = nextSource;
    let originalPreviewUrlToRevoke: string | null = null;

    try {
      if (nextSource.durationSeconds > MAX_AUDIO_SECONDS) {
        throw new Error("Zvočna datoteka je predolga. Omejitev je 3 ure.");
      }

      if (nextSource.file.size > MAX_AUDIO_BYTES) {
        setBusyLabel("Stiskam zvok...");
        const compressedAudio = await compressAudioForUpload(nextSource.file);

        if (compressedAudio.compressed) {
          originalPreviewUrlToRevoke = nextSource.previewUrl;
          preparedSource = {
            ...nextSource,
            file: compressedAudio.file,
            previewUrl: URL.createObjectURL(compressedAudio.file),
          };
        }
      }

      validateAudio(preparedSource.file, preparedSource.durationSeconds);

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
        validationError instanceof Error
          ? validationError.message
          : "Zvoka ni bilo mogoče pripraviti.",
      );
    } finally {
      setBusyLabel(null);
    }
  }, [audioSource]);

  const clearAudioSource = useCallback(() => {
    setAudioSource((current) => {
      if (current?.previewUrl) {
        URL.revokeObjectURL(current.previewUrl);
      }

      return null;
    });
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
    setVisualizerStream(null);
    chunksRef.current = [];
    elapsedRef.current = 0;
    clearAudioSource();
    setPdfSource(null);
    setPhotoSources((current) => {
      current.forEach((photoSource) => revokePhotoSourcePreviewUrls(photoSource));
      return [];
    });
    setActivePhotoPreviewId(null);
    setTextValue("");
    setLinkValue("");
    setLanguageHint("sl");
    setCreateInitialAudio(false);
    setIsRecording(false);
    setIsPaused(false);
    setElapsedSeconds(0);
    setError(null);
    setBusyLabel(null);
    setIsCancelling(false);
    setIsTextEditorOpen(false);
    setShowAudioImportGuide(false);
    activeRequestControllerRef.current = null;
    createdLectureIdRef.current = null;
    cancelRequestedRef.current = false;
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
      const controller = new AbortController();
      activeRequestControllerRef.current = controller;

      const response = await fetchWithTimeout("/api/lectures/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        timeoutMessage: "Priprava zapiska traja predolgo. Osveži stran in poskusi znova.",
        body: JSON.stringify({
          sourceType,
          languageHint,
        }),
      });

      const payload = await parseApiResponse<{ lectureId: string }>(response);

      createdLectureIdRef.current = payload.lectureId;
      return payload.lectureId as string;
    },
    [languageHint],
  );

  const handleCancelBusyAction = useCallback(async () => {
    cancelRequestedRef.current = true;
    activeRequestControllerRef.current?.abort();
    setIsCancelling(true);
    setBusyLabel((current) => current ?? "Preklicujem...");
    await deleteCreatedLecture();
    setBusyLabel(null);
    setIsCancelling(false);
    setError(null);
  }, [deleteCreatedLecture]);

  useEffect(() => {
    setRecordingSupported(typeof window !== "undefined" && "MediaRecorder" in window);
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
      const durationSeconds = await readAudioDuration(file);
      await replaceAudioSource({
        file,
        durationSeconds,
        previewUrl: URL.createObjectURL(file),
        origin: "upload",
      });
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Datoteke ni bilo mogoče pripraviti.",
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
      setError("Ta brskalnik ne podpira snemanja znotraj aplikacije.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setVisualizerStream(stream);
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
        setVisualizerStream(null);
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
        recordError instanceof Error
          ? recordError.message
          : "Snemanja ni bilo mogoče začeti.",
      );
    }
  }

  const stopRecording = useCallback(async () => {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setIsRecording(false);
    setIsPaused(false);
    setVisualizerStream(null);
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const pauseRecording = useCallback(() => {
    if (!recorderRef.current || recorderRef.current.state !== "recording") {
      return;
    }

    recorderRef.current.pause();
    setIsPaused(true);

    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const resumeRecording = useCallback(() => {
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
  }, []);

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

    if (isTextEditorOpen) {
      setIsTextEditorOpen(false);
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

    onClose();
  }, [
    busyLabel,
    handleCancelBusyAction,
    activePhotoPreviewId,
    isRecording,
    isTextEditorOpen,
    onClose,
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
      if (sourceSheetDragOffsetRef.current > 80) {
        sourceSheetDragStartYRef.current = null;
        sourceSheetDragOffsetRef.current = window.innerHeight;
        setSourceSheetDragOffset(window.innerHeight);
        window.setTimeout(() => {
          requestCloseRef.current();
        }, 180);
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
    kind: "record" | "upload" | "text" | "pdf" | "photo" | "link",
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
        createError instanceof Error
          ? createError.message
          : "Zapiska ni bilo mogoče ustvariti.",
      );
    }
  }

  async function createAudioLecture() {
    if (!audioSource) {
      setError("Najprej izberi ali posnemi zvok.");
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote(audioSource.origin === "recording" ? "record" : "upload", [
        "Pripravljam...",
        "Nalagam zvok...",
        "Dodajam v vrsto...",
      ]);
      return;
    }

    let processingStarted = false;

    try {
      const createController = new AbortController();
      activeRequestControllerRef.current = createController;

      setError(null);
      cancelRequestedRef.current = false;
      const result = await createAudioLectureWithProcessingChunks({
        file: audioSource.file,
        durationSeconds: Math.max(audioSource.durationSeconds, 1),
        languageHint,
        createInitialAudio,
        initialAudioVoice: getInitialAudioVoice(),
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
          submitError instanceof Error
            ? submitError.message
            : "Zvočnega zapiska ni bilo mogoče ustvariti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function createTextLecture() {
    if (combinedTextSource.length < 120) {
      setError("Prilepi vsaj krajši vzorec besedila.");
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote("text", ["Pripravljam...", "Dodajam v vrsto..."]);
      return;
    }

    try {
      setBusyLabel("Pripravljam...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("text");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Dodajam v vrsto...");

      const response = await fetch("/api/lectures/text", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          lectureId,
          text: combinedTextSource,
          languageHint,
          createInitialAudio,
          initialAudioVoice: getInitialAudioVoice(),
        }),
      });

      await parseApiResponse<{ lectureId: string }>(response);

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
          submitError instanceof Error
            ? submitError.message
            : "Besedilnega zapiska ni bilo mogoče ustvariti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function createPhotoLecture() {
    if (photoSources.length === 0) {
      setError("Najprej dodaj fotografijo.");
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote("photo", [
        "Pripravljam...",
        photoSources.length === 1
          ? "Nalagam fotografijo..."
          : `Nalagam fotografije (${photoSources.length})...`,
        "Dodajam v vrsto...",
      ]);
      return;
    }

    try {
      setBusyLabel("Pripravljam...");
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

      setBusyLabel("Pripravljam nalaganje fotografij...");
      const uploadTargetsResponse = await fetchWithTimeout(`/api/lectures/${lectureId}/scan-uploads`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        timeoutMessage:
          "Priprava nalaganja fotografij traja predolgo. Preveri povezavo in poskusi znova.",
        body: JSON.stringify({
          files: filesForUpload.map(({ file, index, mimeType }) => ({
            index,
            mimeType,
            fileName: file.name,
            size: file.size,
          })),
        }),
      });
      const uploadTargets = await parseApiResponse<ScanUploadResponse>(uploadTargetsResponse);
      const uploadTargetsByIndex = new Map(
        uploadTargets.uploads.map((upload) => [upload.index, upload] as const),
      );
      const supabase = createSupabaseBrowserClient();

      for (const [position, uploadFile] of filesForUpload.entries()) {
        const uploadTarget = uploadTargetsByIndex.get(uploadFile.index);

        if (!uploadTarget) {
          throw new Error(`Manjka cilj za fotografijo ${position + 1}.`);
        }

        setBusyLabel(
          filesForUpload.length === 1
            ? "Nalagam fotografijo..."
            : `Nalagam fotografijo ${position + 1} od ${filesForUpload.length}...`,
        );

        const uploadResult = await supabase.storage
          .from(STORAGE_BUCKET)
          .uploadToSignedUrl(uploadTarget.path, uploadTarget.token, uploadFile.file, {
            contentType: uploadFile.mimeType,
            upsert: true,
          });

        if (uploadResult.error) {
          throw new Error(uploadResult.error.message);
        }
      }

      setBusyLabel("Dodajam v vrsto...");

      const response = await fetchWithTimeout("/api/lectures/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        timeoutMessage:
          "Dodajanje fotografij v obdelavo traja predolgo. Osveži stran in poskusi znova.",
        body: JSON.stringify({
          lectureId,
          languageHint,
          createInitialAudio,
          initialAudioVoice: getInitialAudioVoice(),
          text: combinedTextSource,
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

      await parseApiResponse<{ lectureId: string }>(response);

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
          submitError instanceof Error
            ? submitError.message
            : "Zapiska iz fotografij ni bilo mogoče ustvariti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function createLinkLecture() {
    if (!trimmedLinkValue) {
      setError("Najprej prilepi povezavo.");
      return;
    }

    if (linkVideoError) {
      setError(linkVideoError);
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote("link", ["Pripravljam...", "Berem povezavo...", "Dodajam v vrsto..."]);
      return;
    }

    try {
      setBusyLabel("Pripravljam...");
      setError(null);
      cancelRequestedRef.current = false;
      const lectureId = await createManualLecture("link");

      if (cancelRequestedRef.current) {
        await deleteCreatedLecture();
        return;
      }

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Dodajam v vrsto...");

      const response = await fetch("/api/lectures/link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          lectureId,
          url: trimmedLinkValue,
          languageHint,
          createInitialAudio,
          initialAudioVoice: getInitialAudioVoice(),
        }),
      });

      await parseApiResponse<{ lectureId: string }>(response);

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
          submitError instanceof Error
            ? submitError.message
            : "Spletnega zapiska ni bilo mogoče ustvariti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  async function prepareHeicPhotoPreview(photoSource: PhotoSource) {
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
        timeoutMessage: "Predogled fotografije traja predolgo.",
        body: formData,
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(
          typeof payload?.error === "string" ? payload.error : "Predogleda ni bilo mogoče ustvariti.",
        );
      }

      const previewBlob = await response.blob();

      if (!previewBlob.type.startsWith("image/")) {
        throw new Error("Predogleda ni bilo mogoče prebrati.");
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
      throw new Error(`Dosegel si največ ${MAX_SCAN_IMAGE_COUNT} fotografij.`);
    }

    const preparedFiles: File[] = [];

    for (const file of files) {
      if (!isScanPhotoFile(file)) {
        throw new Error("Za skeniranje uporabi fotografijo ali sliko.");
      }

      let preparedFile = file;

      if (preparedFile.size > MAX_SCAN_IMAGE_BYTES) {
        setBusyLabel(files.length === 1 ? "Stiskam fotografijo..." : "Stiskam fotografije...");
        preparedFile = (await compressScanImageForUpload(preparedFile)).file;
      }

      if (preparedFile.size > MAX_SCAN_IMAGE_BYTES) {
        throw new Error("Slika je tudi po stiskanju prevelika. Omejitev je 10 MB.");
      }

      preparedFiles.push(preparedFile);
    }

    const canUseNativeHeicPreview = canPreviewHeicNatively();
    const nextPhotoSources = preparedFiles.map((file) => createPhotoSource(file, canUseNativeHeicPreview));

    setPdfSource(null);
    setPhotoSources((current) => [...current, ...nextPhotoSources]);
    setError(null);
    setIsTextEditorOpen(false);

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
      throw new Error("Stare PowerPoint datoteke .ppt še niso podprte. Shrani jo kot .pptx ali PDF in poskusi znova.");
    }

    if (!isSupportedDocumentFile(file)) {
      throw new Error("Uporabi PDF, TXT, Markdown, HTML, RTF, DOCX ali PPTX.");
    }

    let preparedFile = file;

    if (preparedFile.size > MAX_DOCUMENT_BYTES) {
      setBusyLabel("Stiskam dokument...");
      preparedFile = (await compressDocumentForUpload(preparedFile)).file;
    }

    if (preparedFile.size > MAX_DOCUMENT_BYTES) {
      throw new Error("Dokumenta po stiskanju ni bilo mogoče pripraviti v dovolj berljivi obliki za obdelavo.");
    }

    setPdfSource(preparedFile);
    setPhotoSources((current) => {
      current.forEach((photoSource) => revokePhotoSourcePreviewUrls(photoSource));
      return [];
    });
    setActivePhotoPreviewId(null);
    setTextValue("");
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
        scanError instanceof Error ? scanError.message : "Fotografije ni bilo mogoče skenirati.",
      );
    } finally {
      setBusyLabel(null);
      event.target.value = "";
    }
  }

  async function handlePdfPick(event: React.ChangeEvent<HTMLInputElement>) {
    if (!canCreateNotes) {
      event.target.value = "";
      redirectToPaywall();
      return;
    }

    const files = Array.from(event.target.files ?? []);

    if (files.length === 0) {
      return;
    }

    const allImages = files.every((file) => isScanPhotoFile(file));

    try {
      if (allImages) {
        await preparePhotoFiles(files);
        return;
      }

      if (files.length > 1) {
        throw new Error("Izberi en dokument ali do 10 fotografij.");
      }

      await prepareDocumentFile(files[0]);
    } catch (submitError) {
      if (redirectToBillingIfNeeded({ error: submitError, router })) {
        onClose();
        return;
      }

      setError(
        submitError instanceof Error
          ? submitError.message
          : "Datoteke ni bilo mogoče pripraviti.",
      );
    } finally {
      setBusyLabel(null);
      event.target.value = "";
    }
  }

  async function createPdfLecture() {
    if (!pdfSource) {
      setError("Najprej izberi dokument.");
      return;
    }

    if (isCreatorDemo) {
      await createDemoNote("pdf", ["Pripravljam...", "Nalagam dokument...", "Dodajam v vrsto..."]);
      return;
    }

    try {
      setBusyLabel("Pripravljam...");
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
      formData.append("languageHint", languageHint);
      formData.append("createInitialAudio", String(createInitialAudio));
      formData.append("initialAudioVoice", getInitialAudioVoice());

      const controller = new AbortController();
      activeRequestControllerRef.current = controller;
      setBusyLabel("Nalagam dokument...");

      const response = await fetch("/api/lectures/pdf", {
        method: "POST",
        signal: controller.signal,
        body: formData,
      });

      await parseApiResponse<{ lectureId: string }>(response);

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
          submitError instanceof Error
            ? submitError.message
            : "Zapiska iz dokumenta ni bilo mogoče ustvariti.",
        );
      }
    } finally {
      activeRequestControllerRef.current = null;
      setBusyLabel(null);
      setIsCancelling(false);
    }
  }

  function renderBusyOrGenerateButton(params: {
    canGenerate: boolean;
    onGenerate: () => void;
    generateIcon: string;
  }) {
    if (busyLabel) {
      return (
        <button
          type="button"
          className="ios-secondary-button"
          disabled={isCancelling}
          onClick={() => void handleCancelBusyAction()}
        >
          {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Prekliči
        </button>
      );
    }

    return (
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
        <EmojiIcon symbol={params.generateIcon} size="1rem" />
        Ustvari
      </button>
    );
  }

  function renderInitialAudioOption() {
    return (
      <label className="note-source-audio-option">
        <input
          type="checkbox"
          checked={createInitialAudio}
          onChange={(event) => setCreateInitialAudio(event.target.checked)}
        />
        <span>Ustvari zvok</span>
      </label>
    );
  }

  function renderLoadingState() {
    if (!busyLabel) {
      return null;
    }

    return (
      <div className="note-source-loading-state" aria-live="polite">
        <div className="note-source-busy-row">
          <Loader2 className="h-4 w-4 animate-spin note-source-loading-spinner" />
          <p className="note-source-busy-title">{busyLabel}</p>
        </div>
        <p className="note-source-busy-copy">
          Ne zapiraj tega zaslona. Ko bo vse pripravljeno, se bo zaprl samodejno.
        </p>
        <button
          type="button"
          className="ios-secondary-button"
          disabled={isCancelling}
          onClick={() => void handleCancelBusyAction()}
        >
          {isCancelling ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Prekliči
        </button>
      </div>
    );
  }

  if (!open || !mode) {
    return null;
  }

  const modalContent = (
    <>
      <div
        className="ios-sheet-backdrop note-source-modal-backdrop"
        onClick={requestClose}
        aria-hidden="true"
      />
      <div
        className="ios-sheet-wrap note-source-modal-wrap"
        role="dialog"
        aria-modal="true"
        aria-label="Nov zapisek"
      >
        <div className="ios-sheet-stack note-source-modal-stack">
          <section
            className="ios-sheet note-source-sheet note-source-modal mobile-draggable-sheet"
            onPointerDown={handleSourceSheetPointerDown}
            onClickCapture={handleSourceSheetClickCapture}
            style={
              sourceSheetDragOffset > 0
                ? { transform: `translateY(${sourceSheetDragOffset}px)` }
                : undefined
            }
          >
            <button
              type="button"
              className="mobile-sheet-drag-handle note-source-modal-drag-handle"
              aria-label="Povleci navzdol za zapiranje"
            />
            <div className="ios-sheet-header note-source-header">
              <div className="note-source-header-main">
                {showAudioImportGuide ? (
                  <button
                    type="button"
                    className="note-source-back-button"
                    onClick={() => setShowAudioImportGuide(false)}
                    disabled={Boolean(busyLabel) || isCancelling}
                    aria-label="Nazaj na možnosti zvoka"
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Nazaj
                  </button>
                ) : null}
                <h2 className="ios-sheet-title">
                  {showAudioImportGuide ? "Uvozi zvok iz telefona" : sheetTitle(selectedMode)}
                </h2>
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={isCancelling}
                className="app-close-button ios-sheet-header-close"
                aria-label="Zapri"
              >
                <EmojiIcon symbol="✖️" size="1rem" />
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
                  <p className="note-source-card-label">Zakaj to obstaja</p>
                  <p className="note-source-guide-title">
                    Posnemi predavanje, tudi ko je zaslon telefona ugasnjen, nato pa posnetek naloži kasneje.
                  </p>
                  <p className="note-source-guide-copy">
                    Snemanje znotraj aplikacije deluje le, dokler je ta aplikacija odprta. Pri daljših predavanjih je lažje, da najprej snemaš v privzeti aplikaciji telefona, nato posnetek premakneš v aplikacijo Datoteke in ga tukaj naložiš.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Korak 1</p>
                  <p className="note-source-guide-step-title">Posnemi v običajni aplikaciji za zvok na telefonu</p>
                  <p className="note-source-guide-copy">
                    Na iPhonu uporabi Voice Memos. Na Androidu uporabi Recorder ali katerokoli vgrajeno aplikacijo za snemanje, ki shrani datoteko na napravo.
                  </p>
                  <p className="note-source-guide-copy">
                    Snemanje tam zaženi pred začetkom predavanja. Telefon lahko zakleneš, ugasneš zaslon ali popolnoma zapreš to aplikacijo. Snemanje bo teklo v sistemski aplikaciji, ne v tej aplikaciji.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Korak 2</p>
                  <p className="note-source-guide-step-title">Premakni posnetek v aplikacijo Datoteke</p>
                  <p className="note-source-guide-copy">
                    Po predavanju odpri posnetek v aplikaciji za snemanje in poišči možnosti, kot so Deli, Izvozi, Shrani v Datoteke, Prenesi ali Kopiraj v Datoteke.
                  </p>
                  <p className="note-source-guide-copy">
                    Zvok shrani na mesto, ki ga boš hitro našel, na primer Prenosi, Na mojem iPhonu, iCloud Drive ali mapo Datoteke na Androidu. Če tvoj telefon ta korak poimenuje drugače, uporabi možnost, ki posnetek shrani kot datoteko.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Korak 3</p>
                  <p className="note-source-guide-step-title">Tukaj ga naloži prek izbirnika datotek</p>
                  <p className="note-source-guide-copy">
                    Vrni se v to aplikacijo, odpri potek za zvočni zapisek, preklopi na <strong>Naloži</strong>, pritisni <strong>Izberi zvočno datoteko</strong> in izberi posnetek, ki si ga shranil v Datoteke.
                  </p>
                  <p className="note-source-guide-copy">
                    Ko je datoteka izbrana, pritisni <strong>Ustvari</strong>. Aplikacija bo ta zvok predavanja pretvorila v zapiske in ostalo učno gradivo.
                  </p>
                </section>

                <section className="ios-card note-source-guide-section">
                  <p className="note-source-card-label">Na kratko</p>
                  <p className="note-source-guide-copy">
                    Za predavanje uporabi sistemski snemalnik. Zvok shrani v Datoteke. Nato ga tukaj v zavihku za nalaganje pretvori v zapiske.
                  </p>
                </section>
              </div>
            ) : (
              <>
                {!isRecording ? (
                  <div className="mt-6 ios-segmented note-source-segmented">
                    {MODES.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedMode(item.id)}
                        className={`ios-segment ${selectedMode === item.id ? "active" : ""}`}
                        aria-label={item.label}
                        title={item.label}
                      >
                        <EmojiIcon symbol={item.icon} size="1.05rem" />
                      </button>
                    ))}
                  </div>
                ) : null}
                <div
                  className={cn(
                    "mt-6 space-y-4 note-source-modal-body",
                    selectedMode === "text" && "note-source-modal-body-text",
                    selectedMode === "text" &&
                      photoSources.length > 0 &&
                      "note-source-modal-body-photos",
                  )}
                >
                  {selectedMode === "record" && !isRecording ? (
                    <button
                      type="button"
                      className="ios-card note-source-guide-entry"
                      onClick={() => setShowAudioImportGuide(true)}
                    >
                      <div className="note-source-guide-entry-copy">
                        <p className="note-source-guide-entry-title">
                          Kako lahko snemaš tudi z ugasnjenim telefonom?
                        </p>
                        <p className="note-source-guide-entry-text">
                          Shrani posnetek in ga tukaj naloži kasneje.
                        </p>
                      </div>
                      <span className="note-source-guide-entry-arrow" aria-hidden="true">
                        ›
                      </span>
                    </button>
                  ) : null}

                  {!isRecording ? (
                    <div>
                      <label className="note-source-field-label">
                        Jezik
                      </label>
                      <div className="relative note-source-select-wrap">
                        <select
                          value={languageHint}
                          onChange={(event) => setLanguageHint(event.target.value)}
                          className="ios-select appearance-none pr-10"
                        >
                          {NOTE_LANGUAGE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--secondary-label)]" />
                      </div>
                    </div>
                  ) : null}

                  {!isRecording ? renderInitialAudioOption() : null}

                  {selectedMode === "record" ? (
                    <>
                      {preparedRecording ? (
                        <div className="ios-card">
                          <p className="note-source-card-label">Pripravljen posnetek</p>
                          <p className="ios-row-title mt-3">{preparedRecording.file.name}</p>
                          <p className="ios-row-subtitle">
                            {formatTimestamp(preparedRecording.durationSeconds * 1000)}
                          </p>
                        </div>
                      ) : null}

                      {isRecording ? (
                        <div className="ios-card">
                          <p className="note-source-card-label">Snemanje</p>
                          <p className="ios-row-title mt-3">
                            {isPaused ? "Snemanje je začasno ustavljeno" : "Snemanje poteka"}
                          </p>
                          <p className="ios-row-subtitle">
                            {formatTimestamp(elapsedSeconds * 1000)}
                          </p>
                          <div className="mt-4 px-4 py-4 text-[var(--label)]">
                            <LiveAudioWave
                              stream={visualizerStream}
                              active={isRecording && !isPaused}
                              className="mx-auto max-w-[14rem]"
                            />
                          </div>
                        </div>
                      ) : null}

                      {isRecording ? (
                        <div className="note-source-recording-actions">
                          <button
                            type="button"
                            disabled={Boolean(busyLabel)}
                            className="ios-secondary-button"
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
                            <EmojiIcon symbol={isPaused ? "▶️" : "⏸️"} size="1rem" />
                            {isPaused ? "Nadaljuj snemanje" : "Začasno ustavi snemanje"}
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
                            {busyLabel ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <EmojiIcon symbol="🎙️" size="1rem" />
                            )}
                            {busyLabel ?? "Ustavi snemanje"}
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
                              Posnemi znova
                            </button>
                          )}
                        </>
                      ) : null}

                      {!isRecording && !preparedRecording ? (
                        <button
                          type="button"
                          disabled={Boolean(busyLabel)}
                          className="ios-primary-button"
                          onClick={() => void startRecording()}
                        >
                          {busyLabel ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <EmojiIcon symbol="🎙️" size="1rem" />
                          )}
                          {busyLabel ?? "Začni snemanje"}
                        </button>
                      ) : null}
                    </>
                  ) : null}

                  {selectedMode === "upload" ? (
                    <>
                      {preparedUpload ? (
                        <div className="ios-card">
                          <p className="note-source-card-label">Izbrana datoteka</p>
                          <p className="ios-row-title mt-3">{preparedUpload.file.name}</p>
                          <p className="ios-row-subtitle">
                            {formatTimestamp(preparedUpload.durationSeconds * 1000)}
                          </p>
                        </div>
                      ) : null}

                      <input
                        ref={uploadInputRef}
                        type="file"
                        accept={AUDIO_FILE_INPUT_ACCEPT}
                        onChange={handleUploadFileChange}
                        className="hidden"
                      />

                      {isCreatorDemo ? null : (
                        <button
                          type="button"
                          disabled={Boolean(busyLabel)}
                          className="ios-secondary-button"
                          onClick={() => {
                            if (!canCreateNotes) {
                              redirectToPaywall();
                              return;
                            }

                            uploadInputRef.current?.click();
                          }}
                        >
                          <EmojiIcon symbol="📤" size="1rem" />
                          {preparedUpload ? "Izberi drugo zvočno datoteko" : "Izberi zvočno datoteko"}
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
                          Povezava
                        </label>
                        <div className="ios-search">
                          <EmojiIcon symbol="🔎" size="0.95rem" />
                          <input
                            value={linkValue}
                            readOnly={isCreatorDemo}
                            onChange={(event) => {
                              setLinkValue(event.target.value);
                              setError(null);
                            }}
                            placeholder="https://example.com"
                          />
                        </div>
                        {linkVideoError ? (
                          <p className="ios-info ios-danger mt-2">{linkVideoError}</p>
                        ) : null}
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
                      {pdfSource ? (
                        <div className="ios-card note-source-docs-file-card">
                          <p className="note-source-card-label">Izbran dokument</p>
                          <p className="ios-row-title note-source-docs-file-name">{pdfSource.name}</p>
                          <p className="ios-row-subtitle note-source-docs-file-copy">
                            Uporabljen bo, dokler ponovno ne začneš tipkati.
                          </p>
                        </div>
                      ) : null}

                      {!pdfSource && photoSources.length === 0 ? (
                        <div className="note-source-docs-textarea-wrap">
                          <textarea
                            ref={inlineTextAreaRef}
                            value={textValue}
                            readOnly={isCreatorDemo}
                            onChange={(event) => {
                              setTextValue(event.target.value);
                            }}
                            className="ios-textarea note-source-inline-textarea"
                            placeholder="Sem prilepi zapiske ali besedilo..."
                          />
                        </div>
                      ) : null}

                      {!pdfSource && photoSources.length > 0 ? (
                        <div className="note-source-photo-previews" aria-label="Naložene fotografije">
                          <p className="ios-row-subtitle note-source-docs-file-copy note-source-docs-status-copy">
                            {formatUploadedPhotoCount(photoSources.length)}
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
                                    aria-label={`Odpri fotografijo ${originalIndex + 1}`}
                                  >
                                    {photoSource.previewUrl ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img
                                        src={photoSource.previewUrl}
                                        alt={
                                          photoSource.file.name ||
                                          `Fotografija ${originalIndex + 1}`
                                        }
                                        className="note-source-photo-image"
                                        onError={() => handlePhotoPreviewImageError(photoSource.id)}
                                      />
                                    ) : (
                                      <span className="note-source-photo-preview-status">
                                        {photoSource.previewStatus === "failed"
                                          ? "Ni predogleda"
                                          : photoSource.previewStatus === "queued"
                                            ? "Čaka..."
                                            : "Predogled..."}
                                      </span>
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    className="note-source-photo-remove"
                                    onClick={() => removePhotoSource(photoSource.id)}
                                    aria-label={`Odstrani fotografijo ${originalIndex + 1}`}
                                    title="Odstrani fotografijo"
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
                        accept={DOCUMENT_OR_IMAGE_INPUT_ACCEPT}
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

                      {isCreatorDemo ? null : (
                        <div className="note-source-docs-actions note-source-docs-actions-bottom">
                          <button
                            type="button"
                            className="ios-secondary-button note-source-docs-action-button"
                            disabled={Boolean(busyLabel)}
                            onClick={() => {
                              if (!canCreateNotes) {
                                redirectToPaywall();
                                return;
                              }

                              pdfInputRef.current?.click();
                            }}
                          >
                            <EmojiIcon symbol="📤" size="1rem" />
                            Datoteka
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
                            <EmojiIcon symbol="📷" size="1rem" />
                            Skeniraj
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

                          if (photoSources.length > 0) {
                            void createPhotoLecture();
                            return;
                          }

                          void createTextLecture();
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
          aria-label="Predogled fotografije"
        >
          <button
            type="button"
            className="note-source-photo-viewer-backdrop"
            onClick={() => setActivePhotoPreviewId(null)}
            aria-label="Zapri predogled fotografije"
          />
          <div className="note-source-photo-viewer-stage">
            {activePhotoPreview.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={activePhotoPreview.previewUrl}
                alt={activePhotoPreview.file.name || "Predogled fotografije"}
                className="note-source-photo-viewer-image"
              />
            ) : (
              <p className="note-source-photo-viewer-status">
                {activePhotoPreview.previewStatus === "failed"
                  ? "Predogleda te fotografije ni bilo mogoče prikazati."
                  : "Predogled fotografije se pripravlja..."}
              </p>
            )}
          </div>
          <div className="note-source-photo-viewer-actions">
            <button
              type="button"
              className="note-source-photo-viewer-icon-button"
              onClick={() => removePhotoSource(activePhotoPreview.id)}
              aria-label="Odstrani fotografijo"
              title="Odstrani fotografijo"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              className="note-source-photo-viewer-icon-button"
              onClick={() => setActivePhotoPreviewId(null)}
              aria-label="Zapri predogled fotografije"
              title="Zapri"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}

      {selectedMode === "text" && isTextEditorOpen ? (
        <>
          <div
            className="ios-sheet-backdrop note-source-subsheet-backdrop"
            onClick={() => setIsTextEditorOpen(false)}
            aria-hidden="true"
          />
          <div
            className={`ios-sheet-wrap note-source-subsheet-wrap ${
              textEditorKeyboardOffset > 0 ? "keyboard-open" : ""
            }`}
            style={
              {
                "--text-editor-keyboard-offset": `${textEditorKeyboardOffset}px`,
              } as CSSProperties
            }
            role="presentation"
          >
            <div className="ios-sheet-stack note-source-subsheet-stack">
              <section
                className="ios-sheet dashboard-note-dialog note-source-subsheet"
                role="dialog"
                aria-modal="true"
                aria-labelledby="paste-text-title"
              >
                <div className="ios-sheet-header">
                  <h2 id="paste-text-title" className="ios-sheet-title">
                    Prilepi besedilo
                  </h2>
                  <button
                    type="button"
                    className="app-close-button ios-sheet-header-close"
                    onClick={() => setIsTextEditorOpen(false)}
                    aria-label="Zapri okno za lepljenje besedila"
                    disabled={Boolean(busyLabel)}
                  >
                    <EmojiIcon symbol="✖️" size="1rem" />
                  </button>
                </div>

                <div className="dashboard-note-dialog-body">
                  <p className="ios-subtitle dashboard-note-dialog-copy">
                    Sem prilepi zapiske predavanja, prosojnice ali besedilo članka. Fotografije
                    ostanejo naložene ločeno.
                  </p>

                  <textarea
                    value={textValue}
                    readOnly={isCreatorDemo}
                    onChange={(event) => {
                      const nextValue = event.target.value;

                      if (pdfSource && nextValue.trim().length > 0) {
                        setPdfSource(null);
                      }
                      setTextValue(nextValue);
                    }}
                    className="ios-textarea note-source-subsheet-textarea"
                    placeholder="Prilepi vsebino predavanja ali članka..."
                    autoFocus
                  />

                  <div className="dashboard-note-dialog-actions">
                    <button
                      type="button"
                      className="ios-primary-button"
                      disabled={Boolean(busyLabel)}
                      onClick={() => setIsTextEditorOpen(false)}
                    >
                      Končano
                    </button>
                    {textValue.trim().length > 0 ? (
                      <button
                        type="button"
                        className="ios-secondary-button"
                        disabled={Boolean(busyLabel)}
                        onClick={() => {
                          setTextValue("");
                        }}
                      >
                        Počisti besedilo
                      </button>
                    ) : null}
                    {photoSources.length > 0 ? (
                      <button
                        type="button"
                        className="ios-secondary-button"
                        disabled={Boolean(busyLabel)}
                        onClick={() => {
                          setPhotoSources((current) => {
                            current.forEach((photoSource) => {
                              revokePhotoSourcePreviewUrls(photoSource);
                            });
                            return [];
                          });
                          setActivePhotoPreviewId(null);
                        }}
                      >
                        Počisti fotografije
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </>
      ) : null}
    </>
  );

  return (
    <>
      {navigationOverlay}
      <ViewportPortal>{modalContent}</ViewportPortal>
    </>
  );
}
