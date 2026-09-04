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

/** Breathing room under the last control, so it never sits on the edge. */
const BOTTOM_GAP = 12;
/**
 * How much room the reader has to have before it stops giving things up. A
 * viewport height cannot answer this — a desktop window can be 720px tall and
 * still leave the reader 270px of it, once the header, the card and the pill
 * row have taken theirs.
 */
const COMPACT_BELOW = 430;
const TIGHT_BELOW = 330;
/**
 * Below this the reader is not usable however hard it squeezes, so it stops
 * squeezing and lets the page scroll rather than folding the controls into
 * each other. Roughly what the fixed parts need on the shortest phone in
 * landscape.
 */
const MIN_AVAILABLE_HEIGHT = 210;

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
  /*
   * How much room the reader actually has, measured rather than guessed.
   *
   * "Fits on one screen" cannot be written as a subtraction per breakpoint:
   * what sits above this screen is a phone navbar on one device and a header,
   * a card and a pill row on another, and on iOS the browser's own toolbar
   * changes height as you scroll. So the reader asks where it starts and takes
   * the rest, and the stage inside it absorbs whatever that turns out to be.
   */
  const sectionRef = useRef<HTMLElement | null>(null);
  const [available, setAvailable] = useState<number | null>(null);

  useEffect(() => {
    const measure = () => {
      const section = sectionRef.current;
      if (!section) {
        return;
      }

      /* `visualViewport` is the one that shrinks under an iOS toolbar. */
      const viewport = window.visualViewport?.height ?? window.innerHeight;

      /*
       * Let go of the height first, so what follows measures the page as it
       * would be without this screen holding it to a size. Measuring while the
       * previous answer is still applied would feed the next answer its own
       * output, and the two would chase each other down to nothing. React puts
       * the property back on the next render.
       */
      section.style.removeProperty("--speedread-available");

      const box = section.getBoundingClientRect();
      const documentElement = document.documentElement;

      /*
       * What the page keeps below the reader, in two parts.
       *
       * Inside the grid it is content — the note card's padding and the dock —
       * so a rectangle answers it. Outside the grid it is the shell's own
       * padding, and a rectangle does not: `.memo` carries `min-height: 100vh`,
       * so on a short page its bottom edge is the window's, not its content's.
       * Reading the box model instead gives the same number either way.
       */
      const grid = section.closest(".memo-grid") ?? section.closest(".memo-note-screen");
      const inGrid = grid ? Math.max(0, grid.getBoundingClientRect().bottom - box.bottom) : 0;

      let outsideGrid = 0;
      for (let node = grid; node && node !== documentElement; node = node.parentElement) {
        const own = window.getComputedStyle(node);
        outsideGrid += Number.parseFloat(own.marginBottom) || 0;

        const parent = node.parentElement;
        if (parent) {
          const around = window.getComputedStyle(parent);
          outsideGrid +=
            (Number.parseFloat(around.paddingBottom) || 0) +
            (Number.parseFloat(around.borderBottomWidth) || 0);
        }
      }

      const below = inGrid + outsideGrid;
      const next = Math.max(MIN_AVAILABLE_HEIGHT, viewport - box.top - below - BOTTOM_GAP);

      /*
       * Written straight back onto the element rather than through the render.
       * The height was just taken off to measure, and a render is not
       * guaranteed to put it back: a resize that lands on the same answer — and
       * on iOS the toolbar animating produces a stream of them — leaves the
       * state unchanged, React with nothing to do, and the reader stuck at its
       * natural height. The state below is for the density attribute, which
       * does need a render.
       */
      section.style.setProperty("--speedread-available", `${next}px`);
      setAvailable((current) => (current !== null && Math.abs(current - next) < 2 ? current : next));
    };

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    window.visualViewport?.addEventListener("resize", measure);

    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, []);

  const words = useMemo(
    () => (content ? buildSpeedReadWords(parseNoteTtsDocument(content)) : []),
    [content],
  );
  const wordCount = words.length;

  /* What the screen is allowed to give up, given the room it measured. */
  const density =
    available === null
      ? undefined
      : available < TIGHT_BELOW
        ? "tight"
        : available < COMPACT_BELOW
          ? "compact"
          : undefined;

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
  const saveRef = useRef({ index: 0, hasWords: false });

  useEffect(() => {
    indexRef.current = index;
    saveRef.current = { index: isFinished ? 0 : index, hasWords: wordCount > 0 };
  }, [index, isFinished, wordCount]);

  /*
   * Nothing to read is not the same as nowhere to resume. A note whose artifact
   * has not arrived yet — still generating, or a refresh that briefly answered
   * without one — parses to no words, and writing that state out would erase a
   * place saved from an earlier sitting.
   */
  useEffect(() => {
    if (isPlaying || wordCount === 0) {
      return;
    }

    writePosition(lectureId, isFinished ? 0 : index);
  }, [index, isFinished, isPlaying, lectureId, wordCount]);

  useEffect(
    () => () => {
      if (saveRef.current.hasWords) {
        writePosition(lectureId, saveRef.current.index);
      }
    },
    [lectureId],
  );

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
      <section
        ref={sectionRef}
        className="memo-speedread"
        data-density={density}
        aria-label={t("speedRead.title")}
      >
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
    <section
      ref={sectionRef}
      className="memo-speedread"
      data-density={density}
      aria-label={t("speedRead.title")}
    >
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
