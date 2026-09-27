"use client";

/*
 * The spoken walkthrough, playing on the marketing page.
 *
 * This is `LectureTutor`'s own markup — `.memo-tutor`, `.memo-orb`, the intro, the
 * collapsed voice row and its picker, the status row, the topic row and the round
 * transport, all from redesign.css — drawn inside `LandingAppScope` so the app's
 * tokens and rules apply out here too. See docs/landing-page-sync.md: the landing
 * never draws its own copy of an app screen.
 *
 * The one thing it cannot have is the session: there is no account, no microphone
 * and no Soniox key on the landing page, so the phases run off a script instead of
 * off a conversation, and the tutor's voice is a recording. Everything a visitor can
 * see and touch is the app's: the same phases in the same order, the same copy from
 * the same catalogue keys, the same eleven voices in the same hue each, and the same
 * controls doing the same things to the walkthrough.
 *
 * Three deliberate differences, all because this is a page rather than a note:
 *
 * - The voice picker opens as the app's desktop popover at every width. On the phone
 *   the app uses a portalled bottom sheet, which the page cannot host inside a
 *   scaled mockup.
 * - The usage meter (`VoiceUsageSheet`) is left out. It is billing chrome about the
 *   visitor's own allowance, and a visitor has none.
 * - The "Check yourself with cards" action only appears when the host passes
 *   `onOpenFlashcards`, exactly as in the app.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { NOTE_TTS_VOICES, type NoteTtsVoice } from "@/lib/note-tts-settings";
import { TutorClipPlayer } from "@/lib/tutor/clip-player";
import { showsHeardLine, type TutorPhase } from "@/lib/tutor/heard-line";
import { LevelEnvelope } from "@/lib/tutor/turn-audio";
import { voiceHue } from "@/lib/tutor/voice-colors";
import { tutorAnswerClip, tutorDemoClip, voiceSampleClip } from "@/lib/tutor/voice-clips";

import { LandingAppScope, type LandingAppTheme } from "./app/landing-app-scope";

/*
 * The walkthrough, as a script. Only the learner's question is written down; the
 * tutor's own words are never printed in the app either — they are in the room —
 * so what it says lives in the recordings rather than here.
 */
type ScriptStep = {
  phase: TutorPhase;
  ms: number;
  heardKey?: MessageKey;
  /** Which recording this turn speaks. */
  clip?: "tutor" | "answer";
  /*
   * The answer runs until the recording runs out rather than for a fixed time, so
   * the demo ends on a finished sentence whatever the voice and whatever the
   * language. `ms` is what it falls back to when there is no sound — a
   * walkthrough nobody started with a tap, or a browser that refused one.
   */
  untilClipEnds?: boolean;
};

/*
 * The exchange, which is the whole thing this feature is: the tutor explaining,
 * the learner cutting in, the tutor answering *that* and not simply carrying on.
 *
 * The first turn is cut off deliberately. Its recording runs about nine seconds
 * and gets five and a half, so the question lands mid-sentence and the voice stops
 * dead — which is what barge-in looks like, and what a turn that politely finished
 * first would not show. The answer is a recording of its own; see voice-clips.ts.
 */
const SCRIPT: ScriptStep[] = [
  { phase: "preparing", ms: 2000 },
  { phase: "speaking", ms: 5500, clip: "tutor" },
  { phase: "listening", ms: 3800, heardKey: "tutorDemo.heard1" },
  { phase: "thinking", ms: 1500 },
  { phase: "speaking", ms: 11000, clip: "answer", untilClipEnds: true },
  { phase: "finished", ms: 0 },
];

/* The first turn the tutor speaks — where "go over this again" takes it back to. */
const FIRST_TURN = SCRIPT.findIndex((spec) => spec.clip === "tutor");

/*
 * The walkthrough covers one topic: the recordings are about how the tutor works,
 * not about any particular lecture, so there is no second topic for them to reach.
 * The topic row and the finished summary both say so, and agree with each other.
 */
const TOPIC_TOTAL = 1;

/* How fast the recognizer appears to arrive at the words. */
const HEARD_WORD_MS = 190;

/* The longest a tapped voice chip stays lit if its clip never reports ending. */
const VOICE_SAMPLE_MS = 8000;

export type LandingTutorDemoProps = {
  /**
   * Where the demo is hosted. Kept for the phone mockup, which passes "phone"; the
   * app's layout needs no bleed any more now the voices sit behind a row, so both
   * values draw the same thing.
   */
  inset?: "page" | "phone";
  /** Inline style for the walkthrough's own box (`.memo-tutor`). */
  style?: CSSProperties;
  className?: string;
  /** Pins light or dark; "os" (the default) follows the operating system. */
  theme?: LandingAppTheme;
  /** Offers the finished screen's "Check yourself with cards", as the app does. */
  onOpenFlashcards?: () => void;
};

export function LandingTutorDemo({
  inset = "page",
  style,
  className,
  theme = "os",
  onOpenFlashcards,
}: LandingTutorDemoProps) {
  const { t, locale } = useTranslations();

  const [step, setStep] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [voice, setVoice] = useState<NoteTtsVoice>(NOTE_TTS_VOICES[0]);
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  const [pickingVoice, setPickingVoice] = useState(false);
  /* How many times the learner cut in, for the finished screen's summary. */
  const [questions, setQuestions] = useState(0);
  /* Bumped to re-run a step that is already current — "go over this again" on the opening turn. */
  const [replays, setReplays] = useState(0);
  /* Counted against the step it belongs to, so the line a previous turn left
     behind cannot flash under the next one before its first word arrives. */
  const [heard, setHeard] = useState({ step: -1, words: 0 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const orbRef = useRef<HTMLDivElement | null>(null);
  const heardRef = useRef<HTMLParagraphElement | null>(null);
  const pickerRef = useRef<HTMLDetailsElement | null>(null);

  /*
   * The voice. One player for the walkthrough's bed and for the chips, since only
   * one of them is ever meant to be heard.
   *
   * Whether it is *allowed* to make a sound is not ours to decide: a browser only
   * lets audio start from something the visitor did. So `audible` is set from the
   * click that started the walkthrough — `isTrusted` separates a real press from
   * the phone mockup's scripted tour, which drives the same button and must stay
   * silent. Everything works either way; without sound the sphere mimes on the
   * keyframe envelope in landing-tutor.css.
   */
  const playerRef = useRef<TutorClipPlayer | null>(null);
  const [audible, setAudible] = useState(false);
  const levelRaf = useRef<number | undefined>(undefined);
  /* The app's own smoothing, so the sphere moves on a recording the way it moves on a live voice. */
  const envelopeRef = useRef(new LevelEnvelope());
  /* Which turn's recording is loaded, so Continue resumes it instead of replaying it. */
  const speakingStep = useRef<number | null>(null);

  const player = () => {
    if (!playerRef.current) {
      playerRef.current = new TutorClipPlayer();
    }

    return playerRef.current;
  };
  const stepTimer = useRef<number | undefined>(undefined);
  const heardTimer = useRef<number | undefined>(undefined);
  const sampleTimer = useRef<number | undefined>(undefined);

  const clearTimers = useCallback(() => {
    window.clearTimeout(stepTimer.current);
    window.clearInterval(heardTimer.current);
    stepTimer.current = undefined;
    heardTimer.current = undefined;
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(stepTimer.current);
      window.clearInterval(heardTimer.current);
      window.clearTimeout(sampleTimer.current);
      if (levelRaf.current !== undefined) window.cancelAnimationFrame(levelRaf.current);
      playerRef.current?.destroy();
    },
    [],
  );

  const current = step === null ? null : SCRIPT[step];
  const phase: TutorPhase = paused ? "paused" : (current?.phase ?? "idle");
  const isRunning = step !== null;
  const isPreparing = phase === "preparing";
  const isPaused = phase === "paused";

  /*
   * The sphere on the real voice.
   *
   * The app writes the smoothed level onto `.memo-orb` as `--orb-level` every frame;
   * this does the same while a recording is playing and readable. The attribute on
   * the root switches the keyframe envelope off, because an animation outranks an
   * inline style on the property it animates. Where there is no analyser — no
   * sound, or a browser that would not give one — the attribute never goes on and
   * the keyframes carry it, which is what they are for.
   */
  const followClipLevel = useCallback(() => {
    if (!rootRef.current || !playerRef.current?.hasLevel) return;

    const tick = () => {
      const root = rootRef.current;
      const orb = orbRef.current;

      if (!root || !orb || !playerRef.current?.playing) {
        orb?.style.removeProperty("--orb-level");
        if (root) delete root.dataset.audio;
        envelopeRef.current.reset();
        levelRaf.current = undefined;
        return;
      }

      orb.style.setProperty(
        "--orb-level",
        envelopeRef.current.push(playerRef.current.getLevel()).toFixed(4),
      );
      /*
       * Switched on from inside the loop, not before it. The attribute turns the
       * envelope off, so setting it up front and then never getting a frame — a
       * backgrounded tab is the ordinary way that happens — would leave a sphere
       * with neither a measured level nor an animated one, frozen mid-sentence.
       */
      root.dataset.audio = "on";
      levelRaf.current = window.requestAnimationFrame(tick);
    };

    if (levelRaf.current === undefined) levelRaf.current = window.requestAnimationFrame(tick);
  }, []);

  /* Runs the step the walkthrough is on, and books the one after it. */
  useEffect(() => {
    clearTimers();

    if (step === null) return;

    const spec = SCRIPT[step];

    /*
     * The voice follows the phase: it speaks while the tutor speaks, and stops the
     * moment the learner takes the floor and through the beat where the answer is
     * put together.
     */
    if (audible) {
      const active = player();

      if (paused || !spec.clip) {
        active.pause();
      } else if (speakingStep.current === step) {
        /* Coming back from Pause, so it carries on rather than starting over. */
        void active.resume().then(followClipLevel);
      } else {
        /*
         * A turn is its own recording, played from the top. The first one is
         * abandoned rather than resumed when the learner interrupts, because that
         * is what the tutor does: it answers the question instead of finishing the
         * sentence nobody is still listening to.
         */
        speakingStep.current = step;
        const src = spec.clip === "answer" ? tutorAnswerClip(voice, locale) : tutorDemoClip(voice, locale);

        void active
          .play(src)
          .then(followClipLevel)
          .catch(() => setAudible(false));
      }
    }

    if (paused) return;

    if (spec.heardKey) {
      const total = t(spec.heardKey).split(" ").length;
      let words = 0;
      heardTimer.current = window.setInterval(() => {
        words += 1;
        setHeard({ step, words });
        if (words >= total) window.clearInterval(heardTimer.current);
      }, HEARD_WORD_MS);
    }

    /*
     * A turn that ends with the recording books no timer — the clip's own end
     * moves it on — except a long stop, so a recording that never reports ending
     * cannot leave the sphere talking forever.
     */
    const waiting = spec.untilClipEnds && audible;
    const wait = waiting ? spec.ms * 4 : spec.ms;

    if (wait > 0) {
      const next = Math.min(step + 1, SCRIPT.length - 1);

      stepTimer.current = window.setTimeout(() => {
        /* The learner cutting in is what the finished screen counts. */
        if (SCRIPT[next].phase === "listening") setQuestions((count) => count + 1);
        setStep(next);
      }, wait);
    }

    return clearTimers;
  }, [audible, clearTimers, followClipLevel, locale, paused, replays, step, t, voice]);

  const closePicker = useCallback(() => {
    setPickingVoice(false);

    if (pickerRef.current) {
      pickerRef.current.open = false;
    }
  }, []);

  /*
   * The popover closes on a press anywhere else, or on Escape — `<details>` does
   * neither on its own.
   */
  useEffect(() => {
    if (!pickingVoice) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) closePicker();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePicker();
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closePicker, pickingVoice]);

  const startSession = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      /* `isTrusted` is the difference between a visitor pressing this and the phone
         mockup's tour driving it: the first gets a voice, the second stays quiet. */
      const withSound = event.isTrusted;
      speakingStep.current = null;
      closePicker();

      if (withSound) {
        /* The clip's own end is what finishes the last turn. */
        player().onEnded = () =>
          setStep((at) => (at !== null && SCRIPT[at].untilClipEnds ? SCRIPT.length - 1 : at));
      } else {
        playerRef.current?.stop();
      }

      setAudible(withSound);
      setPaused(false);
      setPreviewVoice(null);
      setQuestions(0);
      setHeard({ step: -1, words: 0 });
      setStep(0);
    },
    [closePicker],
  );

  /*
   * Tapping a voice plays it, in the language the page is being read in — which is
   * the only way the choice means anything. The tap is a gesture, so this is
   * allowed to make a sound even when the walkthrough behind it was not; a click
   * the page synthesised only selects.
   */
  const previewVoiceSample = useCallback(
    (option: NoteTtsVoice, event: ReactMouseEvent<HTMLButtonElement>) => {
      setVoice(option);
      window.clearTimeout(sampleTimer.current);

      if (!event.isTrusted) return;

      setPreviewVoice(option);

      const active = player();
      active.onEnded = () => setPreviewVoice(null);
      void active
        .play(voiceSampleClip(option, locale))
        .then(followClipLevel)
        .catch(() => {
          /* Refused or missing: the chip still selects the voice, just silently. */
          setPreviewVoice(null);
        });

      /* A clip that never reports ending must not leave the chip lit for ever. */
      sampleTimer.current = window.setTimeout(() => setPreviewVoice(null), VOICE_SAMPLE_MS);
    },
    [followClipLevel, locale],
  );

  const end = useCallback(() => {
    clearTimers();
    speakingStep.current = null;
    playerRef.current?.stop();
    setStep(null);
    setPaused(false);
    setAudible(false);
    setHeard({ step: -1, words: 0 });
  }, [clearTimers]);

  /*
   * "Go over this again": back to the top of the topic, which in a one-topic
   * walkthrough is always the tutor's opening turn — as in the app, the first
   * press repeats what is being said rather than stepping to a previous topic.
   */
  const skipToPreviousTopic = useCallback(() => {
    clearTimers();
    speakingStep.current = null;
    setPaused(false);
    setHeard({ step: -1, words: 0 });
    setStep(FIRST_TURN);
    setReplays((count) => count + 1);
  }, [clearTimers]);

  /* Idle, preparing and finished say what they are in their own copy. */
  const statusKey: MessageKey | null =
    phase === "thinking"
      ? "tutor.state.thinking"
      : phase === "speaking"
        ? "tutor.state.speaking"
        : phase === "listening"
          ? "tutor.state.listening"
          : phase === "paused"
            ? "tutor.state.paused"
            : null;

  /*
   * The line belongs to the turn the learner took, not to the step on screen:
   * it goes up as they speak and stays through the beat where the answer is put
   * together, which is a step later. The tutor speaking takes it down — the app
   * empties it there rather than hiding it, so an old question cannot reappear
   * over a new silence.
   */
  const heardActive =
    heard.step >= 0 &&
    (step === heard.step || (step === heard.step + 1 && SCRIPT[heard.step + 1]?.phase === "thinking"));
  const heardKey = heardActive ? SCRIPT[heard.step].heardKey : undefined;
  const heardText = heardKey ? t(heardKey).split(" ").slice(0, heard.words).join(" ") : "";
  const heardSettled = heardKey ? heard.words >= t(heardKey).split(" ").length : false;

  /*
   * Keeps the window on the words just said. The line is a fixed height and a
   * long question runs past it, so left alone it shows the opening of a sentence
   * and nothing after — which reads as the recognizer giving up.
   */
  useEffect(() => {
    const element = heardRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [heard]);

  const topicTitle = t("tutorDemo.topic");

  return (
    <LandingAppScope theme={theme}>
      <div
        ref={rootRef}
        className={`memo-tutor landing-tutor-demo phase-${phase} ${className ?? ""}`.trim()}
        data-inset={inset}
        style={{ "--orb-hue": voiceHue(previewVoice ?? voice), ...style } as CSSProperties}
      >
        {/*
          * The sphere. Its scale and glow ride the level — the recording's when it is
          * audible, a speaking-shaped envelope when it is not.
          */}
        <div className="memo-orb" ref={orbRef} aria-hidden="true">
          <span className="memo-orb-glow" />
          <span className="memo-orb-body" />
          <span className="memo-orb-ring" />
          <span className="memo-orb-ring second" />
        </div>

        {!isRunning ? (
          /* What this is, before it has said anything. */
          <div className="memo-tutor-intro">
            <p className="memo-tutor-title">{t("tutor.idle.title")}</p>
            <p className="memo-tutor-lede">{t("tutor.idle.lede")}</p>
          </div>
        ) : phase === "finished" ? (
          <div className="memo-tutor-intro">
            <p className="memo-tutor-title">{t("tutor.finished.title")}</p>
            <p className="memo-tutor-lede">
              {t(questions > 0 ? "tutor.finished.summary" : "tutor.finished.summaryQuiet", {
                topics: t("tutor.finished.topics", { count: TOPIC_TOTAL }),
                minutes: t("tutor.finished.minutes", { count: 1 }),
                questions: t("tutor.finished.questions", { count: questions }),
              })}
            </p>
          </div>
        ) : isPreparing ? (
          <div className="memo-tutor-loading-copy" role="status">
            <p className="memo-tutor-title">{t("tutor.state.preparing")}</p>
            <p className="memo-tutor-lede">{t("tutor.state.preparingHint")}</p>
          </div>
        ) : statusKey ? (
          <p className="memo-tutor-statusrow" role="status">
            <span className="memo-tutor-status-dot" aria-hidden="true" />
            {t(statusKey)}
          </p>
        ) : null}

        {isRunning && !isPreparing && phase !== "finished" ? (
          <div className="memo-tutor-caption" aria-live="off">
            {heardText && showsHeardLine(phase) ? (
              <p ref={heardRef} className={`memo-tutor-heard ${heardSettled ? "" : "draft"}`.trim()}>
                {heardText}
              </p>
            ) : null}
          </div>
        ) : null}

        {isRunning && !isPreparing && phase !== "finished" ? (
          <div className="memo-tutor-topicrow">
            <div className="memo-tutor-topic">
              <span className="memo-tutor-topic-title">{topicTitle}</span>
              <span className="memo-tutor-topic-count">
                1 / {TOPIC_TOTAL}
              </span>
            </div>
            <div
              className="memo-tutor-topicbar"
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={TOPIC_TOTAL}
              aria-valuenow={1}
              aria-label={topicTitle}
            >
              <span style={{ width: `${(1 / TOPIC_TOTAL) * 100}%` }} />
            </div>
          </div>
        ) : null}

        {!isRunning ? (
          <>
            {/*
              * The voice, collapsed to one row that shows it and its colour. Opens the
              * app's desktop popover against itself at every width — see the header.
              */}
            <details
              className="memo-tutor-picker"
              ref={pickerRef}
              onToggle={(event) => setPickingVoice(event.currentTarget.open)}
            >
              <summary className="memo-capture-row memo-tutor-voicerow">
                <span className="memo-tutor-voice-swatch" aria-hidden="true" />
                <span className="memo-capture-row-copy">
                  <span>{voice}</span>
                  <span>{t("tutor.voice.label")}</span>
                </span>
                <Msym
                  name={pickingVoice ? "expand_more" : "chevron_right"}
                  size="1.5rem"
                  fill={false}
                  weight={400}
                />
              </summary>
              <div className="memo-tutor-picker-popover">
                <p className="memo-tutor-picker-heading">{t("tutor.voice.hint")}</p>
                <div className="memo-tutor-voices" role="radiogroup" aria-label={t("tutor.voice.label")}>
                  {NOTE_TTS_VOICES.map((option) => (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={voice === option}
                      className={`memo-tutor-voice ${voice === option ? "active" : ""} ${
                        previewVoice === option ? "playing" : ""
                      }`.trim()}
                      style={{ "--voice-hue": voiceHue(option) } as CSSProperties}
                      onClick={(event) => previewVoiceSample(option, event)}
                    >
                      <span className="memo-tutor-voice-dot" aria-hidden="true" />
                      <span>{option}</span>
                    </button>
                  ))}
                </div>
              </div>
            </details>

            <button
              type="button"
              data-tap="tutor-start"
              className="memo-tutor-start"
              onClick={startSession}
            >
              <Msym name="play_arrow" size="1.3rem" fill weight={500} />
              <span>{t("tutor.start")}</span>
            </button>
          </>
        ) : phase === "finished" ? (
          <div className="memo-tutor-actions">
            <button type="button" className="memo-tutor-start" onClick={startSession}>
              {/* `replay`, not `restart_alt`: that glyph draws its arrowhead detached
                  from the ring, which at this size reads as a broken icon. */}
              <Msym name="replay" size="1.3rem" fill={false} weight={500} />
              <span>{t("tutor.restart")}</span>
            </button>

            {onOpenFlashcards ? (
              <button type="button" className="memo-tutor-second" onClick={onOpenFlashcards}>
                <Msym name="style" size="1.2rem" fill={false} weight={500} />
                <span>{t("tutor.finished.flashcards")}</span>
              </button>
            ) : null}
          </div>
        ) : isPreparing ? (
          /* One way out and nothing else: there is nothing yet to pause or skip. */
          <button type="button" className="memo-button-ghost memo-tutor-cancel" onClick={end}>
            {t("common.cancel")}
          </button>
        ) : (
          <div className="memo-tutor-controls">
            <button
              type="button"
              className="memo-tutor-control"
              onClick={skipToPreviousTopic}
              aria-label={t("tutor.previous")}
            >
              <Msym name="skip_previous" size="1.45rem" fill={false} weight={500} />
            </button>

            <button
              type="button"
              className="memo-tutor-control primary"
              onClick={() => setPaused(!isPaused)}
              aria-label={t(isPaused ? "tutor.resume" : "tutor.pause")}
            >
              <Msym name={isPaused ? "play_arrow" : "pause"} size="1.8rem" fill weight={500} />
            </button>

            <button
              type="button"
              className="memo-tutor-control"
              onClick={end}
              aria-label={t("tutor.end")}
            >
              <Msym name="close" size="1.45rem" fill={false} weight={500} />
            </button>
          </div>
        )}
      </div>
    </LandingAppScope>
  );
}
