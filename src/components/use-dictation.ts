"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The browser's own speech recognition, which every engine still ships behind
 * a vendor prefix on the platform that matters most here (Safari).
 */
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }

  const candidate = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

/** Support never changes for the life of a page, so there is nothing to watch. */
function subscribeToNothing() {
  return () => {};
}

/**
 * Dictation for a chat composer: hold the microphone open and append what it
 * hears to whatever is already typed.
 *
 * This is the browser's recogniser rather than the app's own transcription
 * pipeline on purpose. A chat question is one sentence that the user watches
 * appear and can correct before sending, so the round trip, the upload and the
 * per-minute cost of the real pipeline all buy nothing here.
 *
 * `supported` is false wherever the API is missing, and the caller is expected
 * to hide the control rather than offer a button that cannot work. Permission
 * is asked for by the browser on the first `start()`; a refusal arrives as an
 * error and simply stops the session.
 *
 * Only final results are appended. Interim results rewrite themselves as the
 * recogniser changes its mind, and appending those makes the field flicker
 * through half-words.
 */
export function useDictation({
  lang = "sl-SI",
  onText,
}: {
  lang?: string;
  onText: (text: string) => void;
}) {
  /*
   * Read through `useSyncExternalStore` rather than an effect: the server has
   * no `window`, so the first paint must say "unsupported" and the client must
   * be free to disagree without a hydration mismatch.
   */
  const supported = useSyncExternalStore(
    subscribeToNothing,
    () => getRecognitionConstructor() !== null,
    () => false,
  );
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Read through a ref so restarting does not need a new recogniser.
  const onTextRef = useRef(onText);

  useEffect(() => {
    onTextRef.current = onText;
  });

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [],
  );

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Recognition = getRecognitionConstructor();

    if (!Recognition) {
      return;
    }

    recognitionRef.current?.abort();

    const recognition = new Recognition();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = "";

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];

        if (result?.isFinal) {
          finalText += result[0].transcript;
        }
      }

      const trimmed = finalText.trim();

      if (trimmed) {
        onTextRef.current(trimmed);
      }
    };

    recognition.onerror = (event) => {
      // "aborted" and "no-speech" are the ordinary ends of a session, not
      // failures worth putting in front of anyone.
      if (event.error && event.error !== "aborted" && event.error !== "no-speech") {
        setError(
          event.error === "not-allowed"
            ? "Za narekovanje dovoli dostop do mikrofona."
            : "Narekovanje ni na voljo.",
        );
      }

      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;
    setError(null);

    try {
      recognition.start();
      setListening(true);
    } catch {
      // Calling start() twice throws; the session already running is fine.
      setListening(true);
    }
  }, [lang]);

  const toggle = useCallback(() => {
    if (listening) {
      stop();
      return;
    }

    start();
  }, [listening, start, stop]);

  return { supported, listening, error, start, stop, toggle };
}
