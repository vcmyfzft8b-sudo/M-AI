"use client";

/*
 * The spoken walkthrough, playing on the marketing page.
 *
 * A transcription of `LectureTutor` — the sphere, the caption under it, the
 * voice row, the transport — with the one thing it cannot have out here
 * replaced: there is no session, no microphone and no Soniox key on the landing
 * page, so the phases run off a script instead of off a conversation and the
 * level the sphere breathes on comes from keyframes rather than from audio.
 * Everything a visitor can see and touch is the app's own: the same phases in
 * the same order, the same captions from the same catalogue keys, the same
 * eleven voices with the same hue each, and the same controls doing the same
 * things to the session.
 *
 * It is written against `--lt-*` rather than the app's tokens so the same
 * component can sit inside the phone mockup (which paints from `--m-*`) and on
 * the page around it (`--l-*`) — see the block in landing.css.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { NOTE_TTS_VOICES, type NoteTtsVoice } from "@/lib/note-tts-settings";
import { showsHeardLine, type TutorPhase } from "@/lib/tutor/heard-line";
import { voiceHue } from "@/lib/tutor/voice-colors";

/*
 * The walkthrough, as a script. The two questions are the learner's; the tutor's
 * own words are never printed in the app either — they are in the room — so
 * there is nothing else here to write.
 */
type ScriptStep = { phase: TutorPhase; ms: number; heardKey?: MessageKey };

const SCRIPT: ScriptStep[] = [
  { phase: "preparing", ms: 2400 },
  { phase: "speaking", ms: 7600 },
  { phase: "listening", ms: 3600, heardKey: "tutorDemo.heard1" },
  { phase: "thinking", ms: 1500 },
  { phase: "speaking", ms: 8600 },
  { phase: "listening", ms: 3200, heardKey: "tutorDemo.heard2" },
  { phase: "thinking", ms: 1400 },
  { phase: "speaking", ms: 7000 },
  { phase: "finished", ms: 0 },
];

/* How fast the recognizer appears to arrive at the words. */
const HEARD_WORD_MS = 190;

/* How long a tapped voice chip plays for before the row goes quiet again. */
const VOICE_SAMPLE_MS = 1800;

export type LandingTutorDemoProps = {
  /**
   * Start on its own once it is on screen. The page's own sections do; inside
   * the phone mockup the guided tour presses the button instead, the same way
   * it presses every other one.
   */
  autoStart?: boolean;
  /** Pulls the voice row's bleed back to the phone's own gutter. */
  inset?: "page" | "phone";
  /** Token overrides — the phone mockup hands it `--m-*`. */
  style?: CSSProperties;
  className?: string;
};

export function LandingTutorDemo({
  autoStart = false,
  inset = "page",
  style,
  className,
}: LandingTutorDemoProps) {
  const t = useT();

  const [step, setStep] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [voice, setVoice] = useState<NoteTtsVoice>(NOTE_TTS_VOICES[0]);
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  /* Counted against the step it belongs to, so the line a previous turn left
     behind cannot flash under the next one before its first word arrives. */
  const [heard, setHeard] = useState({ step: -1, words: 0 });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const heardRef = useRef<HTMLParagraphElement | null>(null);
  const stepTimer = useRef<number | undefined>(undefined);
  const heardTimer = useRef<number | undefined>(undefined);
  const sampleTimer = useRef<number | undefined>(undefined);
  /* Latched by the first start of any kind — the observer's, or the visitor's.
     Scrolling back past it does not start the walkthrough over, and neither
     does the observer once somebody has taken the panel over themselves. */
  const autoStarted = useRef(false);

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
    },
    [],
  );

  const current = step === null ? null : SCRIPT[step];
  const phase: TutorPhase = paused ? "paused" : (current?.phase ?? "idle");
  const isRunning = step !== null;
  const isPreparing = phase === "preparing";

  /*
   * Read rather than depended on: toggling the microphone should change what
   * comes next, not restart the sentence being spoken now.
   */
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  /*
   * A muted microphone means the tutor cannot be cut into, so the two phases
   * that only exist because it can — the learner's turn and the beat where the
   * answer is put together — are not played at all.
   */
  const nextStep = useCallback((from: number) => {
    let next = from + 1;
    while (
      mutedRef.current &&
      next < SCRIPT.length &&
      (SCRIPT[next].phase === "listening" || SCRIPT[next].phase === "thinking")
    ) {
      next += 1;
    }
    return Math.min(next, SCRIPT.length - 1);
  }, []);

  /* Runs the step the walkthrough is on, and books the one after it. */
  useEffect(() => {
    clearTimers();
    if (step === null || paused) return;

    const spec = SCRIPT[step];

    if (spec.heardKey) {
      const total = t(spec.heardKey).split(" ").length;
      let words = 0;
      heardTimer.current = window.setInterval(() => {
        words += 1;
        setHeard({ step, words });
        if (words >= total) window.clearInterval(heardTimer.current);
      }, HEARD_WORD_MS);
    }

    if (spec.ms > 0) {
      stepTimer.current = window.setTimeout(
        () => setStep((at) => (at === null ? at : nextStep(at))),
        spec.ms,
      );
    }

    return clearTimers;
  }, [clearTimers, nextStep, paused, step, t]);

  const startSession = useCallback(() => {
    autoStarted.current = true;
    setPaused(false);
    setHeard({ step: -1, words: 0 });
    setStep(0);
  }, []);

  /* On screen and asked to play by itself: start once, and only once. */
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || autoStarted.current) return;
          startSession();
        });
      },
      { threshold: 0.4 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [autoStart, startSession]);

  const previewVoiceSample = useCallback((option: NoteTtsVoice) => {
    autoStarted.current = true;
    setVoice(option);
    setPreviewVoice(option);
    window.clearTimeout(sampleTimer.current);
    sampleTimer.current = window.setTimeout(() => setPreviewVoice(null), VOICE_SAMPLE_MS);
  }, []);

  const end = useCallback(() => {
    autoStarted.current = true;
    clearTimers();
    setStep(null);
    setPaused(false);
    setHeard({ step: -1, words: 0 });
  }, [clearTimers]);

  /* Idle has no status of its own — the start screen's own line says what this is. */
  const statusKey: MessageKey | null =
    phase === "preparing"
      ? "tutor.state.preparing"
      : phase === "thinking"
        ? "tutor.state.thinking"
        : phase === "speaking"
          ? "tutor.state.speaking"
          : phase === "listening"
            ? "tutor.state.listening"
            : phase === "paused"
              ? "tutor.state.paused"
              : phase === "finished"
                ? "tutor.state.finished"
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
   * Keeps the two-line window on the words just said. The line is a fixed
   * height and a long question runs past it, so left alone it shows the opening
   * of a sentence and nothing after — which reads as the recognizer giving up.
   */
  useEffect(() => {
    const element = heardRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [heard]);

  return (
    <div
      ref={rootRef}
      className={`landing-tutor ${className ?? ""}`.trim()}
      data-phase={phase}
      data-inset={inset}
      style={{ "--tutor-hue": voiceHue(previewVoice ?? voice), ...style } as CSSProperties}
    >
      {/*
       * The sphere. Its scale and glow ride the level, so it breathes with
       * whichever voice is in the room rather than animating on a timer.
       */}
      <div className="landing-tutor-orb" aria-hidden="true">
        <span className="landing-tutor-orb-glow" />
        <span className="landing-tutor-orb-body" />
        <span className="landing-tutor-orb-ring" />
        <span className="landing-tutor-orb-ring second" />
      </div>

      {statusKey ? (
        <p className="landing-tutor-status" role="status">
          {t(statusKey)}
        </p>
      ) : null}

      {isPreparing ? <p className="landing-tutor-hint">{t("tutor.state.preparingHint")}</p> : null}

      {/* One line, and only while the floor is theirs. */}
      {heardText && showsHeardLine(phase) ? (
        <p ref={heardRef} className={`landing-tutor-heard ${heardSettled ? "" : "draft"}`.trim()}>
          {heardText}
        </p>
      ) : null}

      {!isRunning ? (
        <>
          {/* Pick a voice, hear it, then start. Tapping one plays it. */}
          <div className="landing-tutor-voices" role="radiogroup" aria-label={t("tutor.voice.label")}>
            {NOTE_TTS_VOICES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={voice === option}
                className={`landing-tutor-voice ${voice === option ? "active" : ""} ${
                  previewVoice === option ? "playing" : ""
                }`.trim()}
                onClick={() => previewVoiceSample(option)}
              >
                <Msym
                  name={previewVoice === option ? "graphic_eq" : "play_arrow"}
                  size="1rem"
                  fill={false}
                  weight={500}
                />
                <span>{option}</span>
              </button>
            ))}
          </div>

          <button type="button" data-tap="tutor-start" className="landing-tutor-start" onClick={startSession}>
            <Msym name="graphic_eq" size="1.2rem" fill={false} weight={500} />
            <span>{t("tutor.start")}</span>
          </button>
        </>
      ) : isPreparing ? (
        /* One way out and nothing else: there is nothing yet to pause, skip or mute. */
        <div className="landing-tutor-controls">
          <button type="button" className="landing-tutor-control" onClick={end}>
            <Msym name="close" size="1.3rem" fill={false} weight={500} />
            <span>{t("common.cancel")}</span>
          </button>
        </div>
      ) : (
        <>
          {muted ? <p className="landing-tutor-hint">{t("tutor.hint.muted")}</p> : null}

          <div className="landing-tutor-controls">
            <button
              type="button"
              className={`landing-tutor-control ${muted ? "off" : ""}`.trim()}
              onClick={() => setMuted((on) => !on)}
              aria-pressed={muted}
              aria-label={t(muted ? "tutor.unmute" : "tutor.mute")}
            >
              <Msym name={muted ? "mic_off" : "mic"} size="1.3rem" fill={false} weight={500} />
            </button>

            {phase === "paused" || phase === "finished" ? (
              <button
                type="button"
                className="landing-tutor-control primary"
                onClick={phase === "finished" ? startSession : () => setPaused(false)}
              >
                <Msym
                  name={phase === "finished" ? "restart_alt" : "play_arrow"}
                  size="1.35rem"
                  fill={false}
                  weight={500}
                />
                <span>{t(phase === "finished" ? "tutor.restart" : "tutor.resume")}</span>
              </button>
            ) : (
              <button
                type="button"
                className="landing-tutor-control primary"
                onClick={() => setPaused(true)}
              >
                <Msym name="pause" size="1.35rem" fill={false} weight={500} />
                <span>{t("tutor.pause")}</span>
              </button>
            )}

            <button
              type="button"
              className="landing-tutor-control"
              onClick={end}
              aria-label={t("tutor.end")}
            >
              <Msym name="close" size="1.3rem" fill={false} weight={500} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
