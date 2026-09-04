"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { parseNoteTtsDocument } from "@/lib/note-tts-text";
import {
  SPEED_READER_DEFAULT_WPM,
  SPEED_READER_MAX_WPM,
  SPEED_READER_MIN_WPM,
  SPEED_READER_WPM_STEP,
  buildSpeedReadWords,
  clampWpm,
  nextSentenceStart,
  sentenceStart,
  splitAtFocus,
  totalDurationMs,
  wordDurationMs,
  wpmAtProgress,
} from "@/lib/speed-reader";

/**
 * The speed reader: the note, one word at a time, pinned so the eye never moves.
 *
 * A screen of its own rather than a mode of the note, because it is a different
 * way of taking the note in — you read it, you have it explained, or you take it
 * at speed — and because nothing else may be on screen for it to work. The
 * timing lives in `@/lib/speed-reader`; this file is the stage and the controls.
 */

const SETTINGS_STORAGE_KEY = "memo.speed-reader.settings";
const POSITION_STORAGE_PREFIX = "memo.speed-reader.at:";

/**
 * Past this many letters the word is set smaller so its ends stay on the stage.
 * The pivot never moves, so only the tails are at risk.
 */
const COMFORTABLE_WORD_LENGTH = 13;
const MIN_WORD_SCALE = 0.5;

type SpeedReaderSettings = {
  wpm: number;
  gradual: boolean;
};

function readSettings(): SpeedReaderSettings {
  const fallback = { wpm: SPEED_READER_DEFAULT_WPM, gradual: false };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw) as Partial<SpeedReaderSettings>;

    return {
      wpm: clampWpm(typeof parsed.wpm === "number" ? parsed.wpm : SPEED_READER_DEFAULT_WPM),
      gradual: parsed.gradual === true,
    };
  } catch {
    return fallback;
  }
}

function writeSettings(settings: SpeedReaderSettings) {
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

function readPosition(lectureId: string, wordCount: number) {
  if (typeof window === "undefined") {
    return 0;
  }

  try {
    const raw = window.localStorage.getItem(`${POSITION_STORAGE_PREFIX}${lectureId}`);
    const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);

    /*
     * A note can be re-generated under a saved position, so anything past the
     * end is dropped rather than clamped — resuming one word before a shorter
     * note's end would be a worse lie than starting over.
     */
    return Number.isInteger(parsed) && parsed > 0 && parsed < wordCount ? parsed : 0;
  } catch {
    return 0;
  }
}

function writePosition(lectureId: string, index: number) {
  try {
    if (index <= 0) {
      window.localStorage.removeItem(`${POSITION_STORAGE_PREFIX}${lectureId}`);
      return;
    }

    window.localStorage.setItem(`${POSITION_STORAGE_PREFIX}${lectureId}`, String(index));
  } catch {}
}

/** "4 min", the way the rest of the app writes a duration. */
function formatMinutes(milliseconds: number) {
  return Math.max(1, Math.round(milliseconds / 60000));
}

export function NoteSpeedReader({
  lectureId,
  content,
  onClose,
}: {
  lectureId: string;
  /** The note's markdown, or null while it is still being written. */
  content: string | null;
  /** Back to the note. */
  onClose: () => void;
}) {
  const t = useT();
  const words = useMemo(
    () => (content ? buildSpeedReadWords(parseNoteTtsDocument(content)) : []),
    [content],
  );
  const wordCount = words.length;

  /*
   * Storage is read as the initial state rather than in an effect after mount.
   * That is only safe because this screen is never server-rendered — it mounts
   * when the reader picks its tab, long after hydration — so there is no first
   * paint for a stored setting to disagree with.
   */
  const [settings, setSettings] = useState<SpeedReaderSettings>(readSettings);
  const [index, setIndex] = useState(() => readPosition(lectureId, wordCount));
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  /*
   * The place is written when the reader settles rather than on every word —
   * at 800 words a minute that would be a localStorage write every 75ms. A
   * note that was read to its end saves no place at all: coming back to a note
   * you finished should start it over, not park you on its last word.
   */
  const indexRef = useRef(index);
  const savedIndexRef = useRef(0);

  useEffect(() => {
    indexRef.current = index;
    savedIndexRef.current = isFinished ? 0 : index;
  }, [index, isFinished]);

  useEffect(() => {
    if (isPlaying) {
      return;
    }

    writePosition(lectureId, isFinished ? 0 : index);
  }, [index, isFinished, isPlaying, lectureId]);

  useEffect(() => () => writePosition(lectureId, savedIndexRef.current), [lectureId]);

  /*
   * Each word schedules the one after it, so the rate is read fresh every time
   * and a change to the slider takes effect on the word in front of you rather
   * than at the end of a tick that was booked at the old rate. A repeating
   * interval could not do that, and would drift besides.
   */
  useEffect(() => {
    if (!isPlaying || wordCount === 0) {
      return;
    }

    const lastIndex = Math.max(1, wordCount - 1);
    /* The note can be rewritten under a reader that is already past its new end. */
    const at = Math.min(index, wordCount - 1);
    const rate = wpmAtProgress(settings.wpm, at / lastIndex, settings.gradual);
    const timer = window.setTimeout(() => {
      if (at >= wordCount - 1) {
        setIsPlaying(false);
        setIsFinished(true);
        return;
      }

      setIndex(at + 1);
    }, wordDurationMs(words[at], rate));

    return () => window.clearTimeout(timer);
  }, [index, isPlaying, settings.gradual, settings.wpm, wordCount, words]);

  /*
   * A backgrounded tab is not being read. Without this the note runs to its end
   * behind a locked phone and the reader comes back to a finished screen.
   */
  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        setIsPlaying(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const seek = useCallback(
    (next: number) => {
      if (wordCount === 0) {
        return;
      }

      setIndex(Math.min(wordCount - 1, Math.max(0, next)));
      setIsFinished(false);
    },
    [wordCount],
  );

  const togglePlay = useCallback(() => {
    if (wordCount === 0) {
      return;
    }

    setIsPlaying((playing) => {
      if (playing) {
        return false;
      }

      /* Finishing leaves the last word up; pressing play again starts over. */
      if (isFinished) {
        setIndex(0);
        setIsFinished(false);
      }

      return true;
    });
  }, [isFinished, wordCount]);

  const changeWpm = useCallback((next: number) => {
    setSettings((current) => {
      const updated = { ...current, wpm: clampWpm(next) };
      writeSettings(updated);
      return updated;
    });
  }, []);

  const toggleGradual = useCallback(() => {
    setSettings((current) => {
      const updated = { ...current, gradual: !current.gradual };
      writeSettings(updated);
      return updated;
    });
  }, []);

  /*
   * The keyboard shortcuts the screen names. Bound to the window because the
   * stage is not the only thing that can hold focus — the slider takes the
   * arrow keys itself, which is why it is left out of the handler below.
   */
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      switch (event.key) {
        case " ":
        case "k":
          event.preventDefault();
          togglePlay();
          return;
        case "Escape":
          event.preventDefault();
          onClose();
          return;
        case "ArrowLeft":
          event.preventDefault();
          seek(sentenceStart(words, indexRef.current));
          return;
        case "ArrowRight":
          event.preventDefault();
          seek(nextSentenceStart(words, indexRef.current));
          return;
        case "ArrowUp":
          event.preventDefault();
          changeWpm(settings.wpm + SPEED_READER_WPM_STEP);
          return;
        case "ArrowDown":
          event.preventDefault();
          changeWpm(settings.wpm - SPEED_READER_WPM_STEP);
          return;
        default:
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [changeWpm, onClose, seek, settings.wpm, togglePlay, words]);

  if (wordCount === 0) {
    return (
      <section className="memo-speedread" aria-label={t("speedRead.title")}>
        <SpeedReaderHead onClose={onClose} title={t("speedRead.title")} />
        <p className="memo-speedread-empty">{t("speedRead.empty")}</p>
      </section>
    );
  }

  const word = words[Math.min(index, wordCount - 1)];
  const { before, focus, after } = splitAtFocus(word.text);
  const progress = wordCount > 1 ? index / (wordCount - 1) : 1;
  const liveWpm = wpmAtProgress(settings.wpm, progress, settings.gradual);
  const remaining = formatMinutes(totalDurationMs(words.slice(index), settings.wpm, settings.gradual));
  const scale = Math.max(
    MIN_WORD_SCALE,
    Math.min(1, COMFORTABLE_WORD_LENGTH / Math.max(1, word.text.length)),
  );

  return (
    <section className="memo-speedread" aria-label={t("speedRead.title")}>
      <SpeedReaderHead onClose={onClose} title={t("speedRead.title")} />

      <button
        type="button"
        className="memo-speedread-stage"
        onClick={togglePlay}
        aria-label={t(isPlaying ? "speedRead.pause" : "speedRead.play")}
      >
        <span className="memo-speedread-rail top" aria-hidden="true" />
        <span
          className="memo-speedread-word"
          style={{ "--speedread-word-scale": scale } as CSSProperties}
        >
          <span className="memo-speedread-lead">{before}</span>
          <span className="memo-speedread-pivot">{focus}</span>
          <span className="memo-speedread-tail">{after}</span>
        </span>
        <span className="memo-speedread-rail bottom" aria-hidden="true" />
      </button>

      {/* The word is announced only when the reader is stopped: a live region
          firing eight times a second would flood a screen reader, and someone
          using one is reading the note itself rather than this. */}
      <p className="sr-only" role="status">
        {isPlaying ? "" : word.text}
      </p>

      <p className="memo-speedread-hint">
        {isFinished ? t("speedRead.finished") : t("speedRead.tapHint")}
      </p>

      <div className="memo-speedread-progress">
        {/*
         * The transport control. The stage stays tappable — at 600 words a
         * minute someone who wants to stop wants to stop now, and the whole
         * screen is the easiest target there is — but a reader arriving at this
         * tab should not have to be told in words that the words are a button.
         */}
        <button
          type="button"
          className="memo-speedread-play"
          onClick={togglePlay}
          aria-label={t(isPlaying ? "speedRead.pause" : "speedRead.play")}
        >
          <Msym
            name={isFinished ? "replay" : isPlaying ? "pause" : "play_arrow"}
            size="1.5rem"
            fill
          />
        </button>
        <input
          type="range"
          className="memo-speedread-seek"
          min={0}
          max={wordCount - 1}
          step={1}
          value={index}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={t("speedRead.position")}
          aria-valuetext={t("speedRead.positionValue", {
            current: index + 1,
            total: wordCount,
          })}
          style={{ "--speedread-progress": `${progress * 100}%` } as CSSProperties}
        />
      </div>

      <div className="memo-speedread-controls">
        <div className="memo-speedread-rate">
          <strong>{t("speedRead.wpm", { wpm: settings.wpm })}</strong>
          <span>{t("speedRead.remaining", { minutes: remaining })}</span>
        </div>

        <input
          type="range"
          className="memo-speedread-slider"
          min={SPEED_READER_MIN_WPM}
          max={SPEED_READER_MAX_WPM}
          step={SPEED_READER_WPM_STEP}
          value={settings.wpm}
          onChange={(event) => changeWpm(Number(event.target.value))}
          aria-label={t("speedRead.speed")}
          style={
            {
              "--speedread-slider-fill": `${
                ((settings.wpm - SPEED_READER_MIN_WPM) /
                  (SPEED_READER_MAX_WPM - SPEED_READER_MIN_WPM)) *
                100
              }%`,
            } as CSSProperties
          }
        />

        <div className="memo-speedread-scale" aria-hidden="true">
          <span>{SPEED_READER_MIN_WPM}</span>
          <span>{(SPEED_READER_MIN_WPM + SPEED_READER_MAX_WPM) / 2}</span>
          <span>{SPEED_READER_MAX_WPM}</span>
        </div>

        <label className="memo-speedread-gradual">
          <input type="checkbox" checked={settings.gradual} onChange={toggleGradual} />
          <span>{t("speedRead.gradual")}</span>
          {settings.gradual && isPlaying ? (
            <em>{t("speedRead.wpm", { wpm: liveWpm })}</em>
          ) : null}
        </label>
      </div>
    </section>
  );
}

function SpeedReaderHead({ title, onClose }: { title: string; onClose: () => void }) {
  const t = useT();

  return (
    <header className="memo-speedread-head">
      <h2 className="memo-speedread-title">{title}</h2>

      <div className="memo-speedread-exit">
        <button
          type="button"
          className="memo-speedread-close"
          onClick={onClose}
          aria-label={t("speedRead.close")}
        >
          <Msym name="expand_more" size="1.5rem" fill={false} weight={500} />
        </button>
        <span aria-hidden="true">esc</span>
      </div>
    </header>
  );
}
