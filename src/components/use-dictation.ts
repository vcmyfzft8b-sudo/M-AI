"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * A dictation session is a chat question, not a lecture. Anything longer than
 * this is somebody who forgot the microphone was open, so it stops itself and
 * transcribes what it has rather than recording until the tab is closed.
 */
const MAX_DICTATION_MS = 60_000;

/** Below this there is no speech to find, only the tap that opened and closed it. */
const MIN_DICTATION_BYTES = 1_200;

const GENERIC_ERROR = "Narekovanje trenutno ne deluje. Poskusi znova.";
const PERMISSION_ERROR = "Za narekovanje dovoli dostop do mikrofona.";
const NO_MICROPHONE_ERROR = "Mikrofona ni bilo mogoče najti.";

type DictationStatus = "idle" | "starting" | "listening" | "transcribing";

/**
 * The container `MediaRecorder` will actually produce. Safari records MP4 and
 * nothing else; everywhere else Opus in WebM is both supported and the smallest
 * thing to upload.
 */
function pickRecorderMimeType() {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return "";
  }

  const userAgent = window.navigator.userAgent;
  const prefersMp4 =
    /Safari/i.test(userAgent) && !/(Chrome|Chromium|CriOS|EdgiOS|FxiOS)/i.test(userAgent);
  const candidates = prefersMp4
    ? ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    : ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];

  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
}

function getExtensionForRecorderMimeType(mimeType: string) {
  const base = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";

  if (base === "audio/mp4") {
    return "m4a";
  }

  if (base === "audio/ogg") {
    return "ogg";
  }

  return "webm";
}

function canRecord() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/** Support never changes for the life of a page, so there is nothing to watch. */
function subscribeToNothing() {
  return () => {};
}

function describeGetUserMediaError(error: unknown) {
  const name = error instanceof Error ? error.name : "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return PERMISSION_ERROR;
  }

  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return NO_MICROPHONE_ERROR;
  }

  return GENERIC_ERROR;
}

/**
 * Dictation for a chat composer: hold the microphone open and append what it
 * hears to whatever is already typed.
 *
 * The recording is transcribed by `/api/dictation` — the app's own provider —
 * rather than by the browser's `SpeechRecognition`. That API is missing outright
 * in Firefox and in the iOS WKWebView the app ships in, needs Google's servers
 * in Chrome (where an unreachable one surfaces as a bare `network` error), and
 * in Safari ends the session after every utterance. Recording locally and
 * transcribing on the server works in every browser that can open a microphone,
 * and it hears Slovenian far better than the browsers do.
 *
 * The cost is a short wait after the user stops talking, which is what
 * `transcribing` is for: the caller is expected to show the control as busy so
 * nobody taps it twice.
 *
 * `supported` is false wherever recording is impossible, and the caller is
 * expected to hide the control rather than offer a button that cannot work.
 */
export function useDictation({ onText }: { onText: (text: string) => void }) {
  /*
   * Read through `useSyncExternalStore` rather than an effect: the server has
   * no `window`, so the first paint must say "unsupported" and the client must
   * be free to disagree without a hydration mismatch.
   */
  const supported = useSyncExternalStore(subscribeToNothing, canRecord, () => false);
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopTimerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  /*
   * Bumped by every `start()` and by every `stop()`. A start that comes back
   * from the permission prompt holding a stale token was stopped while it
   * waited — there is no recorder yet for `stop()` to reach, so this is the only
   * way it can say so.
   */
  const startTokenRef = useRef(0);
  /** True from the tap until the permission prompt answers, so one tap opens one prompt. */
  const startingRef = useRef(false);
  // Read through a ref so a re-render mid-session does not need a new recorder.
  const onTextRef = useRef(onText);

  useEffect(() => {
    onTextRef.current = onText;
  });

  const releaseStream = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;

      const recorder = recorderRef.current;

      if (recorder && recorder.state !== "inactive") {
        // Drop the result: there is no composer left to put it in.
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.stop();
      }

      releaseStream();
    };
  }, [releaseStream]);

  const transcribe = useCallback(async (blob: Blob, mimeType: string) => {
    if (blob.size < MIN_DICTATION_BYTES) {
      if (mountedRef.current) {
        setStatus("idle");
      }

      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    const extension = getExtensionForRecorderMimeType(mimeType);
    const formData = new FormData();
    formData.append(
      "audio",
      new File([blob], `dictation.${extension}`, {
        type: mimeType.split(";")[0]?.trim() || "audio/webm",
      }),
    );

    try {
      const response = await fetch("/api/dictation", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | { text?: string; error?: string }
        | null;

      if (!mountedRef.current) {
        return;
      }

      if (!response.ok) {
        setStatus("idle");
        setError(payload?.error?.trim() || GENERIC_ERROR);
        return;
      }

      const text = payload?.text?.trim() ?? "";

      setStatus("idle");

      if (text) {
        onTextRef.current(text);
      }
    } catch (fetchError) {
      if (!mountedRef.current || (fetchError instanceof Error && fetchError.name === "AbortError")) {
        return;
      }

      setStatus("idle");
      setError(GENERIC_ERROR);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;

    // Cancels a `start()` still waiting on the permission prompt.
    startTokenRef.current += 1;

    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }

    if (!recorder || recorder.state === "inactive") {
      setStatus((current) => (current === "transcribing" ? current : "idle"));
      releaseStream();
      return;
    }

    // `onstop` uploads and moves the status on from here.
    setStatus("transcribing");
    recorder.stop();
  }, [releaseStream]);

  const start = useCallback(async () => {
    if (!canRecord() || recorderRef.current || startingRef.current) {
      return;
    }

    const token = (startTokenRef.current += 1);
    startingRef.current = true;

    setError(null);
    setStatus("starting");

    let stream: MediaStream;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (mediaError) {
      startingRef.current = false;

      // Nobody is waiting for this answer any more, so it is not worth an error.
      if (mountedRef.current && startTokenRef.current === token) {
        setStatus("idle");
        setError(describeGetUserMediaError(mediaError));
      }

      return;
    }

    startingRef.current = false;

    // Unmounted, or stopped, while the permission prompt was up.
    if (!mountedRef.current || startTokenRef.current !== token) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const mimeType = pickRecorderMimeType();
    let recorder: MediaRecorder;

    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      releaseStream();
      setStatus("idle");
      setError(GENERIC_ERROR);
      return;
    }

    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onerror = () => {
      releaseStream();
      chunksRef.current = [];

      if (mountedRef.current) {
        setStatus("idle");
        setError(GENERIC_ERROR);
      }
    };

    recorder.onstop = () => {
      const recordedType = recorder.mimeType || mimeType || "audio/webm";
      const blob = new Blob(chunksRef.current, { type: recordedType });

      chunksRef.current = [];
      releaseStream();

      void transcribe(blob, recordedType);
    };

    try {
      recorder.start();
    } catch {
      releaseStream();
      setStatus("idle");
      setError(GENERIC_ERROR);
      return;
    }

    setStatus("listening");

    stopTimerRef.current = window.setTimeout(() => {
      stopTimerRef.current = null;

      if (recorderRef.current?.state === "recording") {
        setStatus("transcribing");
        recorderRef.current.stop();
      }
    }, MAX_DICTATION_MS);
  }, [releaseStream, transcribe]);

  const toggle = useCallback(() => {
    if (status === "listening" || status === "starting") {
      stop();
      return;
    }

    if (status === "transcribing") {
      return;
    }

    void start();
  }, [start, status, stop]);

  return {
    supported,
    /** True from the tap until the recording is handed off, so the control can show Stop. */
    listening: status === "starting" || status === "listening",
    /** The upload and the transcription, during which the control is busy. */
    transcribing: status === "transcribing",
    error,
    start,
    stop,
    toggle,
  };
}
