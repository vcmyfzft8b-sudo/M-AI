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
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { NOTE_TTS_VOICES, type NoteTtsVoice } from "@/lib/note-tts-settings";
import { TutorClipPlayer } from "@/lib/tutor/clip-player";
import { showsHeardLine, type TutorPhase } from "@/lib/tutor/heard-line";
import { voiceHue } from "@/lib/tutor/voice-colors";
import { tutorDemoClip, voiceSampleClip } from "@/lib/tutor/voice-clips";

/*
 * The walkthrough, as a script. The two questions are the learner's; the tutor's
 * own words are never printed in the app either — they are in the room — so
 * there is nothing else here to write.
 */
type ScriptStep = {
  phase: TutorPhase;
  ms: number;
  heardKey?: MessageKey;
  /*
   * The last thing the tutor says runs until the recording runs out rather than
   * for a fixed time, so the demo ends on a finished sentence whatever the voice
   * and whatever the language. `ms` is what it falls back to when there is no
   * sound — a walkthrough nobody started with a tap, or a browser that refused.
   */
  untilClipEnds?: boolean;
};

const SCRIPT: ScriptStep[] = [
  { phase: "preparing", ms: 2000 },
  { phase: "speaking", ms: 8000 },
  { phase: "listening", ms: 3600, heardKey: "tutorDemo.heard1" },
  { phase: "thinking", ms: 1500 },
  { phase: "speaking", ms: 7000, untilClipEnds: true },
  { phase: "finished", ms: 0 },
];

/* How fast the recognizer appears to arrive at the words. */
const HEARD_WORD_MS = 190;

/* The longest a tapped voice chip stays lit if its clip never reports ending. */
const VOICE_SAMPLE_MS = 8000;

export type LandingTutorDemoProps = {
  /** Pulls the voice row's bleed back to the phone's own gutter. */
  inset?: "page" | "phone";
  /** Token overrides — the phone mockup hands it `--m-*`. */
  style?: CSSProperties;
  className?: string;
};

export function LandingTutorDemo({ inset = "page", style, className }: LandingTutorDemoProps) {
  const { t, locale } = useTranslations();

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

  /*
   * The voice. One player for the walkthrough's bed and for the chips, since only
   * one of them is ever meant to be heard.
   *
   * Whether it is *allowed* to make a sound is not ours to decide: a browser only
   * lets audio start from something the visitor did. So `audible` is set from the
   * click that started the walkthrough — `isTrusted` separates a real press from
   * the phone mockup's scripted tour, which drives the same button and must stay
   * silent. Everything works either way; without sound the sphere just mimes, as
   * it did before there were any recordings.
   */
  const playerRef = useRef<TutorClipPlayer | null>(null);
  const [audible, setAudible] = useState(false);
  const levelRaf = useRef<number | undefined>(undefined);

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

  /*
   * Read rather than depended on: toggling the microphone should change what
   * comes next, not restart the sentence being spoken now.
   */
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;

    /* The button says "microphone", and in the app that is all it is. Here there
       is no microphone to close, so it does the thing the icon promises on the
       only channel this demo has: it stops the voice being heard. */
    if (playerRef.current) playerRef.current.muted = muted;
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

  /* Whether the recording has been started this run, so a resumed turn carries on
     from where the learner cut in rather than from the top. */
  const clipStarted = useRef(false);

  /*
   * The sphere on the real voice.
   *
   * While the level is readable it is written straight onto the element and the
   * keyframe envelope is switched off, so the sphere is moving on what is being
   * said rather than on a loop that only looks like it. Where there is no
   * analyser — no sound, or a browser that would not give one — the attribute
   * never goes on and the keyframes carry it, which is what they are for.
   */
  const followClipLevel = useCallback(() => {
    const root = rootRef.current;
    const active = playerRef.current;

    if (!root || !active?.hasLevel) return;

    const tick = () => {
      if (!rootRef.current || !playerRef.current?.playing) {
        rootRef.current?.style.removeProperty("--lt-level");
        delete rootRef.current?.dataset.audio;
        levelRaf.current = undefined;
        return;
      }

      rootRef.current.style.setProperty("--lt-level", playerRef.current.getLevel().toFixed(3));
      /*
       * Switched on from inside the loop, not before it. The attribute turns the
       * envelope off, so setting it up front and then never getting a frame — a
       * backgrounded tab is the ordinary way that happens — would leave a sphere
       * with neither a measured level nor an animated one, frozen mid-sentence.
       */
      rootRef.current.dataset.audio = "on";
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
     * The voice follows the phase, which is the whole point of the thing: it
     * speaks while the tutor speaks, and stops the moment the learner takes the
     * floor — a duck, held through the beat where the answer is put together,
     * and picked up again exactly where it left off.
     */
    if (audible) {
      const active = player();

      if (paused || spec.phase === "listening" || spec.phase === "thinking") {
        active.pause();
      } else if (spec.phase === "speaking") {
        if (clipStarted.current) {
          void active.resume().then(followClipLevel);
        } else {
          clipStarted.current = true;
          void active
            .play(tutorDemoClip(voice, locale), { muted: mutedRef.current })
            .then(followClipLevel)
            .catch(() => setAudible(false));
        }
      } else if (spec.phase === "finished") {
        active.stop();
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
      stepTimer.current = window.setTimeout(
        () => setStep((at) => (at === null ? at : nextStep(at))),
        wait,
      );
    }

    return clearTimers;
  }, [audible, clearTimers, followClipLevel, locale, nextStep, paused, step, t, voice]);

  const startSession = useCallback((withSound: boolean) => {
    clipStarted.current = false;

    if (withSound) {
      /* The clip's own end is what finishes the last turn. */
      player().onEnded = () =>
        setStep((at) => (at !== null && SCRIPT[at].untilClipEnds ? SCRIPT.length - 1 : at));
    } else {
      playerRef.current?.stop();
    }

    setAudible(withSound);
    setPaused(false);
    setHeard({ step: -1, words: 0 });
    setStep(0);
  }, []);

  /*
   * Tapping a voice plays it, in the language the page is being read in — which is
   * the only way the choice means anything. The tap is a gesture, so this is
   * allowed to make a sound even when the walkthrough behind it was not.
   */
  const previewVoiceSample = useCallback(
    (option: NoteTtsVoice) => {
      setVoice(option);
      setPreviewVoice(option);
      window.clearTimeout(sampleTimer.current);

      const active = player();
      active.onEnded = () => setPreviewVoice(null);
      void active
        .play(voiceSampleClip(option, locale))
        .then(followClipLevel)
        .catch(() => {
          /* Refused or missing: the chip still selects the voice, just silently. */
        });

      /* A clip that never reports ending must not leave the chip lit for ever. */
      sampleTimer.current = window.setTimeout(() => setPreviewVoice(null), VOICE_SAMPLE_MS);
    },
    [followClipLevel, locale],
  );

  const end = useCallback(() => {
    clearTimers();
    playerRef.current?.stop();
    setStep(null);
    setPaused(false);
    setAudible(false);
    setHeard({ step: -1, words: 0 });
  }, [clearTimers]);

  /*
   * Driving the voice row with a mouse.
   *
   * In the app this row is under a thumb, so it needs nothing: you swipe it. Out
   * here it is as often under a cursor, and then it is a scroller with no
   * scrollbar — the design hides it — that a wheel does not reach, which leaves
   * eleven voices behind a chip cut off at the edge and no way to get at them.
   *
   * So a wheel over the row moves it sideways, and it can be dragged. The wheel
   * is only taken while the row still has somewhere to go in that direction: at
   * either end the page gets its scroll back, rather than the row swallowing it
   * and trapping the reader halfway down the page.
   */
  const voiceRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const row = voiceRowRef.current;
    if (!row) return;

    const onWheel = (event: WheelEvent) => {
      /* A pinch-zoom arrives as a wheel too, and is not ours to take. */
      if (event.ctrlKey) return;
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const room =
        delta < 0 ? row.scrollLeft : row.scrollWidth - row.clientWidth - row.scrollLeft;
      if (!delta || room < 1) return;
      event.preventDefault();
      row.scrollLeft += delta;
    };

    /* Non-passive, and native: React's own wheel listener cannot preventDefault. */
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, [isRunning]);

  /*
   * The drag. Mouse only — a finger already has the platform's own scroller,
   * with its momentum, and taking the pointer from it would replace that with a
   * worse one.
   */
  const voiceDrag = useRef<{ x: number; from: number; moved: boolean } | null>(null);
  /* A drag that ends on a chip must not also play it. */
  const voiceDragged = useRef(false);

  const onVoiceRowPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    voiceDragged.current = false;
    const row = voiceRowRef.current;
    if (!row || event.pointerType !== "mouse" || event.button !== 0) return;
    if (row.scrollWidth <= row.clientWidth) return;
    voiceDrag.current = { x: event.clientX, from: row.scrollLeft, moved: false };
  };

  const onVoiceRowPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = voiceDrag.current;
    const row = voiceRowRef.current;
    if (!drag || !row) return;
    const dx = event.clientX - drag.x;
    /* A few pixels of slop, so a click that wobbles is still a click. */
    if (!drag.moved && Math.abs(dx) < 4) return;
    drag.moved = true;
    voiceDragged.current = true;
    row.scrollLeft = drag.from - dx;
  };

  const endVoiceRowDrag = () => {
    voiceDrag.current = null;
  };

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
          <div
            ref={voiceRowRef}
            className="landing-tutor-voices"
            role="radiogroup"
            aria-label={t("tutor.voice.label")}
            onPointerDown={onVoiceRowPointerDown}
            onPointerMove={onVoiceRowPointerMove}
            onPointerUp={endVoiceRowDrag}
            onPointerCancel={endVoiceRowDrag}
          >
            {NOTE_TTS_VOICES.map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={voice === option}
                className={`landing-tutor-voice ${voice === option ? "active" : ""} ${
                  previewVoice === option ? "playing" : ""
                }`.trim()}
                onClick={() => {
                  if (voiceDragged.current) return;
                  previewVoiceSample(option);
                }}
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

          <button
            type="button"
            data-tap="tutor-start"
            className="landing-tutor-start"
            /* `isTrusted` is the difference between a visitor pressing this and
               the phone mockup's tour driving it: the first gets a voice, the
               second stays quiet behind the page's own copy. */
            onClick={(event) => startSession(event.isTrusted)}
          >
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
                onClick={
                  phase === "finished"
                    ? (event) => startSession(event.isTrusted)
                    : () => setPaused(false)
                }
              >
                {/* `replay`, not `restart_alt`: that glyph draws its arrowhead
                    detached from the ring, which at this size reads as a broken
                    icon rather than as a circular arrow. */}
                <Msym
                  name={phase === "finished" ? "replay" : "play_arrow"}
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
