"use client";

/* The lockup is a fixed-size PNG; next/image adds nothing here. */
/* eslint-disable @next/next/no-img-element */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MascotFigure, MascotSparkles, useMascot } from "@/components/onboarding-mascot";
import { BRAND_LOCKUP_HEIGHT, BRAND_LOCKUP_SRC, BRAND_LOCKUP_WIDTH, SEO_BRAND_NAME } from "@/lib/brand";
import { ORAL_QUIZ_SCRIPTS, oralQuizWords, type OralQuizTurn } from "@/lib/ugc/oral-quiz";
import ORAL_QUIZ_TIMINGS from "@/lib/ugc/oral-quiz-timings.json";
import { LOCALE_LABELS, LOCALES, type Locale } from "@/lib/i18n/locales";
import type { OralQuizCopy } from "@/lib/ugc/oral-quiz-copy";

/**
 * The UGC oral quiz: Memo asks out loud, the creator answers out loud,
 * and Memo explains, with the word being spoken lit up as it goes. A screen for
 * filming, not a feature — see src/lib/ugc/oral-quiz.ts.
 *
 * It opens on a language picker, and plays in the language picked there: each has
 * its own script and recordings, and the screen's own words follow it. The picker,
 * and the chip that goes back to it, are gone the moment Start is pressed, so
 * nothing about languages is on screen in a take.
 *
 * The learner's turns wait as long as the original video gave them. `?answer=tap`
 * makes each one wait for a tap, Space or Enter instead, for a creator who needs
 * longer; either way a tap moves on early. R starts again.
 */

type Clip = { durationMs: number; words: [number, number][] };

const SCRIPT_CLIPS = ORAL_QUIZ_TIMINGS.scripts as unknown as Record<Locale, Record<string, Clip>>;
const VOICE = ORAL_QUIZ_TIMINGS.voice.toLowerCase();

/* How often the highlight is moved along. Short enough to land on short words. */
const TICK_MS = 40;

/* The heard line finishes arriving at this share of the learner's turn. */
const HEARD_SHARE = 0.8;

/* How often Memo does something on his own while the screen waits to be started. */
const IDLE_MOVE_MS = 3200;

/* What the streak badge counts. Fixed: there is no learner to count for. */
const STREAK = 47;

/* Everything about one language's script that playback needs, worked out once. */
type Plan = {
  title: string;
  turns: OralQuizTurn[];
  clips: Record<string, Clip>;
  src: (clip: string) => string;
  /** Where each turn starts on the whole skit's clock, for the progress bar. */
  starts: number[];
  totalMs: number;
  /** The lesson's paragraph: its tutor turns run together. */
  lessonWords: string[];
  /** Each lesson turn's first word's place in that paragraph. */
  lessonOffsets: Map<number, number>;
};

const PLANS = new Map<Locale, Plan>();

function planFor(locale: Locale): Plan {
  const cached = PLANS.get(locale);

  if (cached) {
    return cached;
  }

  const { title, turns } = ORAL_QUIZ_SCRIPTS[locale];
  const clips = SCRIPT_CLIPS[locale];
  const turnMs = (turn: OralQuizTurn) => (turn.speaker === "tutor" ? clips[turn.clip]?.durationMs ?? 0 : turn.ms);
  const starts = turns.reduce<number[]>((list, turn, index) => {
    list.push(index === 0 ? 0 : list[index - 1] + turnMs(turns[index - 1]));
    return list;
  }, []);
  const lessonTurns = turns.flatMap((turn, index) =>
    turn.speaker === "tutor" && turn.part === "lesson" ? [{ index, words: oralQuizWords(turn.text) }] : [],
  );
  const lessonOffsets = new Map<number, number>();
  let offset = 0;

  for (const turn of lessonTurns) {
    lessonOffsets.set(turn.index, offset);
    offset += turn.words.length;
  }

  const plan: Plan = {
    title,
    turns,
    clips,
    src: (clip) => `/ugc/oral-quiz/${locale}/${VOICE}-${clip}.mp3`,
    starts,
    totalMs: starts[starts.length - 1] + turnMs(turns[turns.length - 1]),
    lessonWords: lessonTurns.flatMap((turn) => turn.words),
    lessonOffsets,
  };

  PLANS.set(locale, plan);
  return plan;
}

type Stage = "ready" | "playing" | "done";

/* `word` is the spoken word on a tutor turn, and how many words have been "heard" on a learner's. */
type Position = { turn: number; word: number; ms: number };

const START: Position = { turn: 0, word: -1, ms: 0 };

/*
 * How loud the voice is right now, 0 to 1, which Memo, his glow and his rings move with.
 *
 * Read off the recording itself when the browser lets us; otherwise (no Web Audio, or
 * the line playing silently) a pulse on every word, from the same timings the highlight
 * uses, so he still talks in step with the words.
 */
function isAppleTouchDevice() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

class VoiceLevel {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Uint8Array<ArrayBuffer> | null = null;
  private level = 0;

  /* Must run inside the tap: an AudioContext starts suspended anywhere else. */
  attach(player: HTMLAudioElement) {
    /*
     * Not on an iPhone or iPad. Measuring the voice routes it through Web Audio, which iOS
     * mutes under the silent switch and stops on an interruption (a call, the lock screen),
     * while a plain <audio> element keeps playing — the take would lose its voice to buy a
     * livelier mouth. There he talks in step with the words instead.
     */
    if (this.context || isAppleTouchDevice()) {
      void this.context?.resume().catch(() => undefined);
      return;
    }

    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaElementSource(player).connect(analyser);
      analyser.connect(context.destination);
      // A context the system suspended carries the voice too, so it is woken again at once.
      context.onstatechange = () => {
        if (context.state !== "running" && context.state !== "closed") {
          void context.resume().catch(() => undefined);
        }
      };
      this.context = context;
      this.analyser = analyser;
      this.samples = new Uint8Array(analyser.fftSize);
      void context.resume().catch(() => undefined);
    } catch {
      this.context = null;
      this.analyser = null;
    }
  }

  close() {
    const context = this.context;
    this.context = null;
    this.analyser = null;

    if (context) {
      context.onstatechange = null;
      void context.close().catch(() => undefined);
    }
  }

  read(sounding: boolean, inWord: boolean) {
    let target = inWord ? 0.7 : 0.08;

    if (sounding && this.analyser && this.samples && this.context?.state === "running") {
      this.analyser.getByteTimeDomainData(this.samples);
      let sum = 0;

      for (const sample of this.samples) {
        const value = (sample - 128) / 128;
        sum += value * value;
      }

      target = Math.min(1, Math.sqrt(sum / this.samples.length) * 5);
    }

    /* Up fast, down slower, like a meter: the mouth opens on the syllable and settles. */
    this.level += (target - this.level) * (target > this.level ? 0.7 : 0.3);
    return this.level;
  }

  reset() {
    this.level = 0;
  }
}

function Words({ words, current }: { words: string[]; current: number }) {
  return words.map((word, index) => (
    <Fragment key={index}>
      <span className={index === current ? "note-read-word current" : "note-read-word"}>{word}</span>{" "}
    </Fragment>
  ));
}

export function UgcOralQuiz({
  copy,
  initialLocale,
}: {
  copy: Record<Locale, OralQuizCopy>;
  initialLocale: Locale | null;
}) {
  const [locale, setLocale] = useState<Locale | null>(initialLocale);

  /* In the address too, so a reload between takes keeps the language. */
  const choose = useCallback((next: Locale | null) => {
    setLocale(next);
    const url = new URL(window.location.href);

    if (next) {
      url.searchParams.set("lang", next);
    } else {
      url.searchParams.delete("lang");
    }

    window.history.replaceState(window.history.state, "", url);
  }, []);

  return locale ? (
    <OralQuizScreen key={locale} locale={locale} copy={copy[locale]} onChangeLanguage={() => choose(null)} />
  ) : (
    <LanguagePicker onPick={choose} />
  );
}

/* The first screen: which language the take is in. In the app's language, with each option in its own. */
function LanguagePicker({ onPick }: { onPick: (locale: Locale) => void }) {
  const t = useT();

  return (
    <div className="memo-oq-picker">
      <div className="memo-oq-picker-mascot" aria-hidden="true">
        <div className="memo-oq-mascot-breathe">
          <MascotFigure lash={3} priority />
        </div>
      </div>
      <h1 className="memo-oq-picker-title">{t("ugcQuiz.pickLanguage")}</h1>
      <div className="memo-oq-picker-list">
        {LOCALES.map((option) => (
          <button key={option} type="button" className="memo-oq-lang" lang={option} onClick={() => onPick(option)}>
            <span>{LOCALE_LABELS[option]}</span>
            <Msym name="chevron_right" size="1.35rem" />
          </button>
        ))}
      </div>
    </div>
  );
}

function OralQuizScreen({
  locale,
  copy,
  onChangeLanguage,
}: {
  locale: Locale;
  copy: OralQuizCopy;
  onChangeLanguage: () => void;
}) {
  const plan = planFor(locale);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const runRef = useRef(0);
  const advanceRef = useRef<(() => void) | null>(null);
  const [stage, setStage] = useState<Stage>("ready");
  const [position, setPosition] = useState<Position>(START);
  const [calm, setCalm] = useState(false);

  const scope = useCallback(() => rootRef.current, []);
  const mascot = useMascot({ accent: "#ff6d68", calm, scope });
  const { move, burst, stopGroove } = mascot;
  const voiceLevel = useRef(new VoiceLevel());

  const setLevel = useCallback(
    (level: number) => {
      rootRef.current?.style.setProperty("--oq-level", calm ? "0" : level.toFixed(3));
    },
    [calm],
  );

  useEffect(() => {
    setCalm(window.matchMedia("(prefers-reduced-motion: reduce)").matches);

    const level = voiceLevel.current;

    return () => {
      runRef.current += 1;
      audioRef.current?.pause();
      level.close();
    };
  }, []);

  /* Warm the cache so no line waits on the network mid-take. */
  useEffect(() => {
    for (const turn of plan.turns) {
      if (turn.speaker === "tutor") {
        void fetch(plan.src(turn.clip)).catch(() => undefined);
      }
    }
  }, [plan]);

  /* One element for every line: iOS lets an element play again once a tap has started it. */
  const audio = useCallback(() => {
    audioRef.current ??= new Audio();
    return audioRef.current;
  }, []);

  const playTutor = useCallback(
    (index: number, startMs: number, clip: Clip, src: string, run: number) =>
      new Promise<void>((resolve) => {
        const player = audio();
        let sounding = false;
        const startedAt = performance.now();

        player.src = src;
        player.currentTime = 0;
        player.play().then(
          () => {
            sounding = true;
          },
          // Refused or failed: the words still go by at the voice's pace, in silence.
          () => undefined,
        );

        const timer = window.setInterval(() => {
          // Superseded: the player is the new run's now, so it is left alone (restart paused it).
          if (run !== runRef.current) {
            window.clearInterval(timer);
            resolve();
            return;
          }

          const ms = sounding && !player.paused ? player.currentTime * 1000 : performance.now() - startedAt;
          let word = -1;

          while (word + 1 < clip.words.length && clip.words[word + 1][0] <= ms) {
            word += 1;
          }

          setPosition({ turn: index, word, ms: startMs + Math.min(ms, clip.durationMs) });
          const inWord = word >= 0 && ms < clip.words[word][1];
          setLevel(voiceLevel.current.read(sounding && !player.paused, inWord));

          if (player.ended || ms >= clip.durationMs + 150) {
            window.clearInterval(timer);
            voiceLevel.current.reset();
            setLevel(0);
            resolve();
          }
        }, TICK_MS);
      }),
    [audio, setLevel],
  );

  const waitLearner = useCallback(
    (index: number, startMs: number, text: string, ms: number, untilTap: boolean, run: number) =>
      new Promise<void>((resolve) => {
        const startedAt = performance.now();
        const words = oralQuizWords(text).length;
        let done = false;

        const finish = () => {
          if (done) {
            return;
          }

          done = true;
          window.clearInterval(timer);
          window.clearTimeout(react);

          if (advanceRef.current === finish) {
            advanceRef.current = null;
          }

          if (run === runRef.current) {
            setPosition({ turn: index, word: words, ms: startMs + ms });
          }

          resolve();
        };

        advanceRef.current = finish;

        /* Memo reacts as the line lands: a shake of the head at a question, a nod at anything else. */
        const react = window.setTimeout(() => {
          if (run === runRef.current) {
            move("hero", text.trim().endsWith("?") ? "shake" : "nod");
          }
        }, Math.min(ms * 0.5, 900));

        const timer = window.setInterval(() => {
          if (run !== runRef.current) {
            finish();
            return;
          }

          const elapsed = performance.now() - startedAt;
          const heard = Math.min(words, Math.ceil((elapsed / (ms * HEARD_SHARE)) * words));
          setPosition({ turn: index, word: heard, ms: startMs + Math.min(elapsed, ms) });

          if (!untilTap && elapsed >= ms) {
            finish();
          }
        }, TICK_MS);
      }),
    [move],
  );

  const start = useCallback(async () => {
    const run = (runRef.current += 1);
    const untilTap = new URLSearchParams(window.location.search).get("answer") === "tap";

    // Started inside the tap, so the browser counts every later line as the tap's.
    const player = audio();
    player.muted = false;
    voiceLevel.current.attach(player);
    setStage("playing");
    setPosition(START);

    for (const [index, turn] of plan.turns.entries()) {
      if (run !== runRef.current) {
        return;
      }

      if (turn.speaker === "tutor") {
        move("hero", "hop");
        move("hero", "groove", Infinity);
        await playTutor(index, plan.starts[index], plan.clips[turn.clip], plan.src(turn.clip), run);

        if (run !== runRef.current) {
          return;
        }

        stopGroove();
      } else {
        await waitLearner(index, plan.starts[index], turn.text, turn.ms, untilTap, run);
      }
    }

    if (run === runRef.current) {
      setStage("done");
      move("hero", "cheer");
      burst("hero", "confetti");
    }
  }, [audio, burst, move, plan, playTutor, stopGroove, waitLearner]);

  const restart = useCallback(() => {
    audioRef.current?.pause();
    stopGroove();
    void start();
  }, [start, stopGroove]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A focused button answers its own Space and Enter (the language chip goes to the picker).
      if (event.metaKey || event.ctrlKey || event.altKey || (event.target instanceof HTMLElement && event.target.closest("button"))) {
        return;
      }

      if (event.key === "r" || event.key === "R") {
        restart();
      } else if (event.key === " " || event.key === "Enter") {
        event.preventDefault();

        if (stage === "playing") {
          advanceRef.current?.();
        } else {
          restart();
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [restart, stage]);

  /* He drops in, then keeps waving and hopping until somebody starts him. */
  useEffect(() => {
    if (stage !== "ready") {
      return;
    }

    const drop = window.setTimeout(() => {
      move("hero", "dropIn");
      burst("hero", "sparkle");
    }, 250);
    let beat = 0;
    const idle = window.setInterval(() => {
      beat += 1;
      move("hero", beat % 3 === 0 ? "cheer" : beat % 2 === 0 ? "hop" : "wave");

      if (beat % 3 === 0) {
        burst("hero", "sparkle");
      }
    }, IDLE_MOVE_MS);

    return () => {
      window.clearTimeout(drop);
      window.clearInterval(idle);
    };
  }, [burst, move, stage]);

  const current = plan.turns[position.turn];
  const inLesson = stage === "done" || (stage === "playing" && current.part === "lesson");
  const lessonWord =
    stage === "playing" && current.speaker === "tutor" && current.part === "lesson"
      ? (plan.lessonOffsets.get(position.turn) ?? 0) + position.word
      : -1;

  /* The quiz so far: every turn up to this one, the learner's only as much as was heard. */
  const quizTurns = useMemo(
    () =>
      stage === "playing" && !inLesson
        ? plan.turns.slice(0, position.turn + 1).map((turn, index) => ({
            turn,
            index,
            words: oralQuizWords(turn.text),
          }))
        : [],
    [inLesson, plan, position.turn, stage],
  );

  /* Keep the line being read in view: down when it nears the bottom, in the one scroller. */
  useEffect(() => {
    const scroller = scrollerRef.current;

    if (!scroller) {
      return;
    }

    if (!inLesson) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
      return;
    }

    const word = scroller.querySelector<HTMLElement>(".note-read-word.current");

    if (!word) {
      if (lessonWord < 0 && stage === "playing") {
        scroller.scrollTo({ top: 0 });
      }

      return;
    }

    const top = word.getBoundingClientRect().top - scroller.getBoundingClientRect().top;

    if (top > scroller.clientHeight * 0.62) {
      scroller.scrollTo({ top: scroller.scrollTop + top - scroller.clientHeight * 0.3, behavior: "smooth" });
    }
  }, [inLesson, lessonWord, position.turn, position.word, quizTurns.length, stage]);

  const listening = stage === "playing" && current.speaker === "learner";
  const mode = stage === "playing" ? (listening ? "listening" : "speaking") : stage;
  const progress = stage === "done" ? 1 : stage === "ready" ? 0 : position.ms / plan.totalMs;

  const lockup = (className: string) => (
    <img
      src={BRAND_LOCKUP_SRC}
      width={BRAND_LOCKUP_WIDTH}
      height={BRAND_LOCKUP_HEIGHT}
      alt={SEO_BRAND_NAME}
      className={className}
      draggable={false}
    />
  );

  return (
    <div ref={rootRef} className="memo-oq" data-mode={mode}>
      <section className="memo-oq-card" onClick={() => advanceRef.current?.()}>
        <header className="memo-oq-head">
          {lockup("memo-oq-head-lockup")}
          <span className="memo-oq-product">{copy.product}</span>
          <span className="memo-oq-streak" aria-label={copy.streak.replace("{count}", String(STREAK))}>
            <Msym name="bolt" size="1.25rem" />
            {STREAK}
          </span>
        </header>
        <div className="memo-progress memo-oq-progress" aria-hidden="true">
          <div style={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }} />
        </div>

        <div ref={scrollerRef} className="memo-oq-body note-read-content">
          {stage === "ready" ? (
            <div className="memo-oq-ready">
              <span className="memo-eyebrow">{copy.eyebrow}</span>
              <p className="memo-oq-hint">{copy.startHint}</p>
              <button type="button" className="memo-button-coral memo-oq-start" onClick={() => void start()}>
                {copy.start}
              </button>
              <button type="button" className="memo-oq-langchip" onClick={onChangeLanguage}>
                <Msym name="language" size="1.1rem" />
                {LOCALE_LABELS[locale]}
              </button>
            </div>
          ) : inLesson ? (
            <article className="memo-oq-lesson">
              <h1 className="memo-oq-title">{plan.title}</h1>
              <p className="memo-oq-text">
                <Words words={plan.lessonWords} current={lessonWord} />
              </p>
            </article>
          ) : (
            <div className="memo-oq-quiz">
              <span className="memo-eyebrow">{copy.eyebrow}</span>
              {quizTurns.map(({ turn, index, words }) =>
                turn.speaker === "tutor" ? (
                  <p key={index} className={index === position.turn ? "memo-oq-line" : "memo-oq-line past"}>
                    <Words words={words} current={index === position.turn ? position.word : -1} />
                  </p>
                ) : index < position.turn || position.word > 0 ? (
                  <p key={index} className="memo-oq-heard">
                    <Msym name="mic" size="1.1rem" />
                    <span>{(index < position.turn ? words : words.slice(0, position.word)).join(" ")}</span>
                  </p>
                ) : null,
              )}
            </div>
          )}
        </div>

        <footer className={`memo-oq-status${listening ? " listening" : ""}`}>
          {stage === "done" ? (
            <button
              type="button"
              className="memo-primary-pill"
              onClick={(event) => {
                event.stopPropagation();
                restart();
              }}
            >
              <Msym name="replay" size="1.25rem" />
              {copy.again}
            </button>
          ) : stage === "playing" ? (
            <>
              <Msym name={listening ? "mic" : "graphic_eq"} size="1.35rem" />
              <span>{listening ? copy.listening : copy.speaking}</span>
            </>
          ) : null}
        </footer>
      </section>

      <aside className="memo-oq-brand" aria-hidden="true">
        <span className="memo-oq-tagline">{copy.tagline}</span>
        <div className="memo-oq-stage">
          <div className="memo-oq-mascot">
            <span className="memo-oq-halo" />
            <span className="memo-oq-ring" />
            <span className="memo-oq-ring second" />
            <span className="memo-oq-ring third" />
            <MascotSparkles />
            <span key={stage === "ready" ? "ready" : "on"} className="memo-oq-sticker">
              {copy.lockIn}
            </span>
            <div ref={mascot.refs.heroBurst} className="memo-oq-burst" />
            <div ref={mascot.refs.setHero} className="memo-oq-mascot-body">
              <div className="memo-oq-mascot-voice">
                <div className="memo-oq-mascot-breathe">
                  <MascotFigure lash={3} priority />
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
