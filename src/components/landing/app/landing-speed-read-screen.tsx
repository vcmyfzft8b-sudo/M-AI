"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";

import { useT } from "@/components/i18n-provider";
import { LandingAppScope, type LandingAppTheme } from "@/components/landing/app/landing-app-scope";
import {
  useLandingAutoplay,
  useLandingAutoplayStep,
  type LandingAutoplayStep,
} from "@/components/landing/app/landing-study-content";
import { Msym } from "@/components/msym";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
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
  stageWidthInLetters,
  totalDurationMs,
  wordDurationMs,
  wpmAtProgress,
} from "@/lib/speed-reader";

/*
 * The speed reader, as the app draws it (`note-speed-reader.tsx`).
 *
 * The app's component is not rendered directly because it cannot sit on a public page as it
 * is: it binds Space, Escape and the arrow keys on the whole window (Space would stop scrolling
 * the landing page), measures the viewport to size itself, and keeps its place and speed in
 * localStorage. So this is its JSX, transcribed class for class, driven by the same timing
 * library (`@/lib/speed-reader`) over the same markdown parser — which is what makes the words,
 * the pivot letter, the pauses at full stops and the minutes left the app's own numbers.
 *
 * What it reads is the landing's sample lecture (the flow demo's note, `flowDemo.note.*`), so
 * every demo on the page is studying the same thing.
 */

/** From the app: how many stage letters fit at full size, and the smallest the type may get. */
const COMFORTABLE_STAGE_LETTERS = 13;
const LONGEST_FITTED_STAGE = 31;
const MIN_WORD_SCALE = COMFORTABLE_STAGE_LETTERS / LONGEST_FITTED_STAGE;

/** The walkthrough's pause before it presses play, and between one read-through and the next. */
const AUTOPLAY_START_MS = 1_200;
const AUTOPLAY_REPLAY_MS = 2_400;

/** "4 min", the way the rest of the app writes a duration. */
function formatMinutes(milliseconds: number) {
  return Math.max(1, Math.round(milliseconds / 60000));
}

/** The flow demo's note, written out as the markdown the app's reader is handed. */
export function landingSpeedReadMarkdown(t: Translate<MessageKey>) {
  return [
    `## ${t("flowDemo.note.overview")}`,
    `${t("flowDemo.note.leadA")} ${t("flowDemo.note.leadMid")} ${t("flowDemo.note.leadB")}.`,
    `## ${t("flowDemo.note.typesHeading")}`,
    [
      `- **${t("flowDemo.note.bullet1Term")}** ${t("flowDemo.note.bullet1Rest")}`,
      `- **${t("flowDemo.note.bullet2Term")}** ${t("flowDemo.note.bullet2Rest")}`,
      `- **${t("flowDemo.note.bullet3Term")}** ${t("flowDemo.note.bullet3Rest")}`,
    ].join("\n"),
    `**${t("flowDemo.note.keyLabel")}:** ${t("flowDemo.note.keyBody")}`,
  ].join("\n\n");
}

export function LandingSpeedReadScreen({
  theme,
  autoplay = false,
  className,
  markdown,
}: {
  theme?: LandingAppTheme;
  autoplay?: boolean;
  className?: string;
  /** What to read; the landing's sample note when left out. */
  markdown?: string;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const source = markdown ?? landingSpeedReadMarkdown(t);
  const words = useMemo(() => buildSpeedReadWords(parseNoteTtsDocument(source)), [source]);
  const wordCount = words.length;

  const [wpm, setWpm] = useState(SPEED_READER_DEFAULT_WPM);
  const [gradual, setGradual] = useState(false);
  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);

  /*
   * The note can change under the reader (a language switch); start it over rather than run past
   * the end of a shorter one. Adjusted during render, as React recommends for derived resets.
   */
  const [readingSource, setReadingSource] = useState(source);

  if (readingSource !== source) {
    setReadingSource(source);
    setIndex(0);
    setIsFinished(false);
  }

  /* Each word schedules the next, so a change of speed lands on the word in front of you. */
  useEffect(() => {
    if (!isPlaying || wordCount === 0) {
      return;
    }

    const lastIndex = Math.max(1, wordCount - 1);
    const at = Math.min(index, wordCount - 1);
    const rate = wpmAtProgress(wpm, at / lastIndex, gradual);
    const timer = window.setTimeout(() => {
      if (at >= wordCount - 1) {
        setIsPlaying(false);
        setIsFinished(true);
        return;
      }

      setIndex(at + 1);
    }, wordDurationMs(words[at], rate));

    return () => window.clearTimeout(timer);
  }, [gradual, index, isPlaying, wordCount, words, wpm]);

  /* A backgrounded tab is not being read, here as in the app. */
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

  const changeWpm = useCallback((next: number) => setWpm(clampWpm(next)), []);

  /*
   * The app's shortcuts, bound to this screen rather than to the window: the landing page is a
   * page to scroll, and Space belongs to it unless the reader has been clicked into.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target;

    if (
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
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
      case "ArrowLeft":
        event.preventDefault();
        seek(sentenceStart(words, index));
        return;
      case "ArrowRight":
        event.preventDefault();
        seek(nextSentenceStart(words, index));
        return;
      case "ArrowUp":
        event.preventDefault();
        changeWpm(wpm + SPEED_READER_WPM_STEP);
        return;
      case "ArrowDown":
        event.preventDefault();
        changeWpm(wpm - SPEED_READER_WPM_STEP);
        return;
      default:
    }
  }

  /*
   * The walkthrough: press play, and when the note runs out, start it again. It never touches
   * the controls — what it demonstrates is the reading — and the first real input hands the
   * screen over with whatever state it is in.
   */
  const { running } = useLandingAutoplay(autoplay, rootRef);

  /*
   * Scrolled out of view, a read-through already under way simply reaches the end of the note
   * and stops there; only the next one waits for the screen to come back.
   */
  const step: LandingAutoplayStep = isPlaying
    ? null
    : isFinished
      ? {
          key: "replay",
          delay: AUTOPLAY_REPLAY_MS,
          run: () => {
            setIndex(0);
            setIsFinished(false);
            setIsPlaying(true);
          },
        }
      : {
          key: `play-${index}`,
          delay: AUTOPLAY_START_MS,
          run: () => setIsPlaying(true),
        };

  useLandingAutoplayStep(running, step);

  const rootClassName = ["landing-study-screen landing-feature-screen", className]
    .filter(Boolean)
    .join(" ");

  if (wordCount === 0) {
    return (
      <LandingAppScope theme={theme} className={rootClassName}>
        <div className="landing-study-frame" data-note-tab="speed">
          <section className="memo-speedread" aria-label={t("speedRead.title")}>
            <header className="memo-speedread-head">
              <h2 className="memo-speedread-title">{t("speedRead.title")}</h2>
            </header>
            <p className="memo-speedread-empty">{t("speedRead.empty")}</p>
          </section>
        </div>
      </LandingAppScope>
    );
  }

  const word = words[Math.min(index, wordCount - 1)];
  const { before, focus, after } = splitAtFocus(word.text);
  const progress = wordCount > 1 ? index / (wordCount - 1) : 1;
  const liveWpm = wpmAtProgress(wpm, progress, gradual);
  const remaining = formatMinutes(totalDurationMs(words, wpm, gradual, index));
  const scale = Math.max(
    MIN_WORD_SCALE,
    Math.min(1, COMFORTABLE_STAGE_LETTERS / stageWidthInLetters(word.text)),
  );

  return (
    <LandingAppScope theme={theme} className={rootClassName}>
      <div ref={rootRef} className="landing-study-frame" data-note-tab="speed">
        <section
          className="memo-speedread"
          aria-label={t("speedRead.title")}
          onKeyDown={handleKeyDown}
        >
          <header className="memo-speedread-head">
            <h2 className="memo-speedread-title">{t("speedRead.title")}</h2>
          </header>

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

          <p className="sr-only" role="status">
            {isPlaying ? "" : word.text}
          </p>

          <p className="memo-speedread-hint">
            {isFinished ? t("speedRead.finished") : t("speedRead.tapHint")}
          </p>

          <div className="memo-speedread-progress">
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
              <strong>{t("speedRead.wpm", { wpm })}</strong>
              <span>{t("speedRead.remaining", { minutes: remaining })}</span>
            </div>

            <input
              type="range"
              className="memo-speedread-slider"
              min={SPEED_READER_MIN_WPM}
              max={SPEED_READER_MAX_WPM}
              step={SPEED_READER_WPM_STEP}
              value={wpm}
              onChange={(event) => changeWpm(Number(event.target.value))}
              aria-label={t("speedRead.speed")}
              style={
                {
                  "--speedread-slider-fill": `${
                    ((wpm - SPEED_READER_MIN_WPM) / (SPEED_READER_MAX_WPM - SPEED_READER_MIN_WPM)) *
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
              <input type="checkbox" checked={gradual} onChange={() => setGradual((on) => !on)} />
              <span>{t("speedRead.gradual")}</span>
              {gradual && isPlaying ? <em>{t("speedRead.wpm", { wpm: liveWpm })}</em> : null}
            </label>
          </div>
        </section>
      </div>
    </LandingAppScope>
  );
}
