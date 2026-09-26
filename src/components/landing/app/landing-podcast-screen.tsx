"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import { useTranslations } from "@/components/i18n-provider";
import { LandingAppScope, type LandingAppTheme } from "@/components/landing/app/landing-app-scope";
import {
  useLandingAutoplay,
  useLandingAutoplayStep,
  type LandingAutoplayStep,
} from "@/components/landing/app/landing-study-content";
import { Msym } from "@/components/msym";
import { NOTE_TTS_VOICES, type NoteTtsVoice } from "@/lib/note-tts-settings";
import {
  DEFAULT_PODCAST_FORMAT,
  DEFAULT_PODCAST_LENGTH,
  DEFAULT_PODCAST_VOICES,
  displacedPodcastVoice,
  estimatedPodcastMinutes,
  getPodcastFormat,
  PODCAST_FORMATS,
  PODCAST_LENGTHS,
  PODCAST_SPEAKERS,
  type PodcastFormat,
  type PodcastLength,
  type PodcastSpeaker,
} from "@/lib/podcast-settings";
import { isResumable } from "@/lib/podcast-progress";
import { PodcastLevelMeter } from "@/lib/podcast-level";
import { LevelEnvelope } from "@/lib/tutor/turn-audio";
import { podcastVoiceHue } from "@/lib/tutor/voice-colors";
import { hasStaticVoiceSamples, podcastVoiceSampleClip } from "@/lib/tutor/voice-clips";

/*
 * The podcast tab, as the app draws it (`lecture-podcast.tsx`).
 *
 * The app's component fetches the episode list, buys each turn's audio as it is about to be
 * heard and bills the listening time, so it cannot run on a public page. This is its JSX,
 * transcribed class for class — the library row with its two spheres, "+ New episode", the
 * minutes-left line, the chooser, the writing screen and the player — over local state, with
 * the app's own libraries for everything that is not the network: formats and lengths, the
 * hosts' colours, the resume rule, the level meter and envelope that make the speaking sphere
 * swell.
 *
 * The episode is the one the app's own demo plays (`src/lib/creator-demo/api.ts`): a turn per
 * host, each voiced by that host's pre-recorded audition clip from `public/tutor-demo`. Nothing
 * is synthesized and nothing is fetched but those static files, and only once a visitor has
 * pressed something — the scripted walkthrough plays silently, moving the spheres on a
 * stand-in level instead.
 *
 * The chooser is a sheet in the app and a portal; here it is drawn inside the screen, which the
 * landing stylesheet pins to the screen's own bottom edge.
 */

/** Turns in the demo episode, alternating hosts, and how long each one runs. */
const DEMO_TURNS = 8;
const TURN_MS = 4_600;
const EPISODE_MS = DEMO_TURNS * TURN_MS;
const SKIP_SECONDS = 10;
/** The listening allowance the usage line reports, as the app's demo reports it. */
const DEMO_REMAINING_MINUTES = 30;
/** How long the writing screen holds before the new episode opens. */
const WRITING_MS = 4_800;

type LandingEpisode = {
  id: string;
  format: PodcastFormat;
  length: PodcastLength;
  positionMs: number;
  finished: boolean;
};

type View = "library" | "player" | "writing";

function formatClock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The app's curve for the writing bar: quick at first, never quite full until it lands. */
function writingProgressPercent(elapsedMs: number, expectedMs: number) {
  const fraction = Math.max(0, elapsedMs) / Math.max(1, expectedMs);

  return Math.min(94, 4 + (1 - Math.exp(-fraction * 2.2)) * 90);
}

function speakerOfTurn(turn: number, speakerCount: 1 | 2): PodcastSpeaker {
  return speakerCount === 1 || turn % 2 === 0 ? "a" : "b";
}

/**
 * A voice's level while nobody can hear it: two slow sines against a fast one, which reads as
 * phrases made of syllables. Only the walkthrough uses it; a visitor who pressed play gets the
 * real level off the audio element through the app's own meter.
 */
function standInLevel(timeMs: number) {
  const syllables = Math.abs(Math.sin(timeMs / 95));
  const phrase = 0.55 + 0.45 * Math.sin(timeMs / 610) * Math.sin(timeMs / 1_370);

  return Math.max(0, 0.02 + 0.13 * syllables * phrase);
}

export function LandingPodcastScreen({
  theme,
  autoplay = false,
  className,
  title,
}: {
  theme?: LandingAppTheme;
  autoplay?: boolean;
  className?: string;
  /** The note the episode is about; the landing's sample lecture when left out. */
  title?: string;
}) {
  const { t, locale } = useTranslations();
  const noteTitle = title ?? t("flowDemo.noteTitle.audio");
  const clipLanguage = hasStaticVoiceSamples(locale) ? locale : "en";

  const rootRef = useRef<HTMLDivElement | null>(null);
  const coverRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const meterRef = useRef<PodcastLevelMeter | null>(null);
  const envelopesRef = useRef({ a: new LevelEnvelope(), b: new LevelEnvelope() });

  const [view, setView] = useState<View>("library");
  const [episodes, setEpisodes] = useState<LandingEpisode[]>(() => [
    {
      id: "landing-episode-1",
      format: DEFAULT_PODCAST_FORMAT,
      length: DEFAULT_PODCAST_LENGTH,
      positionMs: 0,
      finished: false,
    },
  ]);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [format, setFormat] = useState<PodcastFormat>(DEFAULT_PODCAST_FORMAT);
  const [length, setLength] = useState<PodcastLength>(DEFAULT_PODCAST_LENGTH);
  const [voices, setVoices] = useState<Record<PodcastSpeaker, NoteTtsVoice>>(DEFAULT_PODCAST_VOICES);
  const [isChooserOpen, setIsChooserOpen] = useState(false);
  const [openVoiceSlot, setOpenVoiceSlot] = useState<PodcastSpeaker | null>(null);
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  const [writingPercent, setWritingPercent] = useState(4);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  /*
   * How many times an episode has been opened, which the walkthrough keys its next move on. The
   * walkthrough plays with the sound off; the first press of a visitor's own turns it on.
   */
  const [opens, setOpens] = useState(0);

  const opened = episodes.find((episode) => episode.id === openedId) ?? null;
  const openedFormat = getPodcastFormat(opened?.format ?? format);
  const speakerCount = getPodcastFormat(format).speakerCount;
  const activeVoiceSlot: PodcastSpeaker | null =
    openVoiceSlot === null ? null : speakerCount === 1 ? "a" : openVoiceSlot;

  const hueA = podcastVoiceHue(voices.a, "a");
  const hueB = podcastVoiceHue(voices.b, "b");
  const pairHues = { "--hue-a": hueA, "--hue-b": hueB } as CSSProperties;

  /* Everything the frame loop reads, so it runs once for the life of the player. */
  const playbackRef = useRef({
    playing: false,
    audible: false,
    fromMs: 0,
    startedAt: 0,
    turn: -1,
    speakerCount: 2 as 1 | 2,
    voices,
  });
  playbackRef.current.voices = voices;
  playbackRef.current.speakerCount = openedFormat.speakerCount;
  /* Read by the frame loop when an episode runs out. */
  const openedIdRef = useRef<string | null>(null);
  openedIdRef.current = openedId;

  /** Where the episode is now, between the renders the clock does not trigger. */
  const currentPosition = () => {
    const playback = playbackRef.current;

    return playback.playing
      ? Math.min(EPISODE_MS, playback.fromMs + (performance.now() - playback.startedAt))
      : playback.fromMs;
  };

  const clipFor = useCallback(
    (turn: number) => {
      const { speakerCount: count, voices: cast } = playbackRef.current;

      return podcastVoiceSampleClip(cast[speakerOfTurn(turn, count)], clipLanguage);
    },
    [clipLanguage],
  );

  /** Starts the turn at `atMs` on the audio element, when the visitor can hear it. */
  const soundTurn = useCallback(
    (atMs: number) => {
      const playback = playbackRef.current;
      const element = audioRef.current;
      const turn = Math.min(DEMO_TURNS - 1, Math.floor(atMs / TURN_MS));

      playback.turn = turn;

      if (!element || !playback.audible || !playback.playing) {
        return;
      }

      const src = clipFor(turn);
      const offset = (atMs - turn * TURN_MS) / 1000;

      if (element.getAttribute("src") !== src) {
        element.src = src;
      }

      /* A seek into the gap after a host has finished is silence until the next one speaks. */
      if (Number.isFinite(element.duration) && offset >= element.duration) {
        element.pause();
        return;
      }

      element.currentTime = offset;
      void element.play().catch(() => {});
    },
    [clipFor],
  );

  const pause = useCallback(() => {
    const playback = playbackRef.current;

    if (playback.playing) {
      playback.fromMs = Math.min(
        EPISODE_MS,
        playback.fromMs + (performance.now() - playback.startedAt),
      );
    }

    playback.playing = false;
    audioRef.current?.pause();
    setPositionMs(playback.fromMs);
    setIsPlaying(false);
  }, []);

  const play = useCallback(
    (options: { audible: boolean; fromMs?: number }) => {
      const playback = playbackRef.current;

      playback.fromMs = options.fromMs ?? playback.fromMs;

      if (playback.fromMs >= EPISODE_MS) {
        playback.fromMs = 0;
      }

      playback.audible = playback.audible || options.audible;
      playback.playing = true;
      playback.startedAt = performance.now();
      playback.turn = -1;

      if (playback.audible) {
        (meterRef.current ??= new PodcastLevelMeter()).start([audioRef.current]);
      }

      soundTurn(playback.fromMs);
      setPositionMs(playback.fromMs);
      setIsPlaying(true);
    },
    [soundTurn],
  );

  const seekTo = useCallback(
    (targetMs: number) => {
      const playback = playbackRef.current;
      const at = Math.min(EPISODE_MS, Math.max(0, targetMs));

      playback.fromMs = at;
      playback.startedAt = performance.now();
      setPositionMs(at);

      if (playback.playing) {
        soundTurn(at);
      }
    },
    [soundTurn],
  );

  /*
   * One frame loop while the player is up: the clock, the hand-off between hosts, and the
   * level of whichever of them is speaking — written to the cover as the app writes it, one
   * channel per host with the other driven to zero.
   */
  useEffect(() => {
    if (view !== "player") {
      return;
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let lastState = 0;

    const pump = (now: number) => {
      const playback = playbackRef.current;
      let at = playback.fromMs;

      if (playback.playing) {
        at = Math.min(EPISODE_MS, playback.fromMs + (now - playback.startedAt));

        if (at >= EPISODE_MS) {
          playback.playing = false;
          playback.fromMs = EPISODE_MS;
          audioRef.current?.pause();
          setIsPlaying(false);
          setPositionMs(EPISODE_MS);
          setEpisodes((current) =>
            current.map((episode) =>
              episode.id === openedIdRef.current
                ? { ...episode, positionMs: EPISODE_MS, finished: true }
                : episode,
            ),
          );
        } else {
          const turn = Math.floor(at / TURN_MS);

          if (turn !== playback.turn) {
            soundTurn(at);
          }

          if (now - lastState > 120) {
            lastState = now;
            setPositionMs(at);
          }
        }
      }

      const cover = coverRef.current;

      if (cover && !reducedMotion) {
        const turn = Math.min(DEMO_TURNS - 1, Math.floor(at / TURN_MS));
        const speaking = speakerOfTurn(turn, playback.speakerCount);
        const element = audioRef.current;
        const level = !playback.playing
          ? 0
          : playback.audible
            ? element && !element.paused
              ? meterRef.current?.getLevel(element) ?? standInLevel(now)
              : 0
            : standInLevel(now);

        for (const host of PODCAST_SPEAKERS) {
          const value = envelopesRef.current[host].push(host === speaking ? level : 0);
          cover.style.setProperty(`--orb-level-${host}`, value.toFixed(4));
        }
      }

      frame = window.requestAnimationFrame(pump);
    };

    frame = window.requestAnimationFrame(pump);

    return () => window.cancelAnimationFrame(frame);
  }, [soundTurn, view]);

  /* Nothing outlives the screen: the audio stops and the meter's graph is closed. */
  useEffect(
    () => () => {
      audioRef.current?.pause();
      previewRef.current?.pause();
      meterRef.current?.close();
      meterRef.current = null;
    },
    [],
  );

  const openEpisode = useCallback(
    (episode: LandingEpisode, audible: boolean) => {
      setIsChooserOpen(false);
      setOpenedId(episode.id);
      setFormat(episode.format);
      setLength(episode.length);
      setView("player");
      setOpens((count) => count + 1);
      /* Heard to the end starts again; anything past the first few seconds picks up where it was. */
      play({
        audible,
        fromMs: !episode.finished && isResumable({ ...episode, durationMs: EPISODE_MS })
          ? episode.positionMs
          : 0,
      });
    },
    [play],
  );

  const leavePlayer = useCallback(() => {
    const playback = playbackRef.current;

    pause();
    setEpisodes((current) =>
      current.map((episode) =>
        episode.id === openedIdRef.current
          ? {
              ...episode,
              positionMs: playback.fromMs,
              finished: episode.finished || playback.fromMs >= EPISODE_MS,
            }
          : episode,
      ),
    );
    setOpenedId(null);
    setView("library");
  }, [pause]);

  function togglePlayback() {
    if (playbackRef.current.playing) {
      pause();
      return;
    }

    play({ audible: true });
  }

  /* Writing the episode: the bar runs on the app's curve, then the new episode opens. */
  const [writingSince, setWritingSince] = useState<number | null>(null);
  const writingAudibleRef = useRef(false);

  function requestEpisode(audible: boolean) {
    setIsChooserOpen(false);
    setOpenVoiceSlot(null);
    writingAudibleRef.current = audible;
    setWritingPercent(4);
    setWritingSince(performance.now());
    setView("writing");
  }

  useEffect(() => {
    if (view !== "writing" || writingSince === null) {
      return;
    }

    const tick = window.setInterval(() => {
      setWritingPercent(writingProgressPercent(performance.now() - writingSince, WRITING_MS * 1.6));
    }, 200);
    const done = window.setTimeout(() => {
      const episode: LandingEpisode = {
        id: `landing-episode-${Date.now()}`,
        format,
        length,
        positionMs: 0,
        finished: false,
      };

      setEpisodes((current) => [episode, ...current]);
      setWritingSince(null);
      openEpisode(episode, writingAudibleRef.current);
    }, WRITING_MS);

    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [format, length, openEpisode, view, writingSince]);

  /* Auditioning a voice, as the chooser does: the host's own clip, only ever after a tap. */
  function chooseVoice(speaker: PodcastSpeaker, next: NoteTtsVoice) {
    setVoices((current) => {
      const updated = { ...current, [speaker]: next };
      const other: PodcastSpeaker = speaker === "a" ? "b" : "a";

      if (speakerCount === 2 && updated[other] === next) {
        updated[other] = displacedPodcastVoice(next);
      }

      return updated;
    });

    const element = previewRef.current;

    if (!element) {
      return;
    }

    element.pause();
    element.src = podcastVoiceSampleClip(next, clipLanguage);
    element.currentTime = 0;
    setPreviewVoice(next);
    void element.play().catch(() => setPreviewVoice(null));
  }

  function closeChooser() {
    previewRef.current?.pause();
    setPreviewVoice(null);
    setOpenVoiceSlot(null);
    setIsChooserOpen(false);
  }

  /*
   * The walkthrough, silent throughout: open the episode, listen a while, go back to the
   * library where the row now shows how far in it is, and open it again from there.
   */
  const { running } = useLandingAutoplay(autoplay, rootRef);
  const first = episodes[0];
  const step: LandingAutoplayStep =
    view === "library" && !isChooserOpen && first
      ? { key: `open-${opens}`, delay: 1_700, run: () => openEpisode(first, false) }
      : view === "player"
        ? isPlaying
          ? { key: `leave-${opens}`, delay: 13_000, run: leavePlayer }
          : { key: `done-${opens}`, delay: 1_800, run: leavePlayer }
        : null;

  useLandingAutoplayStep(running, step);

  const elapsedMs = Math.min(positionMs, EPISODE_MS);

  const episodeMeta = (episode: LandingEpisode, withDate: boolean) => {
    const shown = getPodcastFormat(episode.format);
    const minutes = t("podcast.minutes.exact", { count: Math.max(1, Math.round(EPISODE_MS / 60_000)) });
    const remaining = t("podcast.remaining", {
      time: formatClock(Math.max(0, EPISODE_MS - episode.positionMs)),
    });
    const resuming = !episode.finished && isResumable({ ...episode, durationMs: EPISODE_MS });
    const parts = [t(shown.labelKey)];

    if (resuming && !withDate) {
      parts.push(remaining);
    } else {
      parts.push(minutes);

      if (resuming) {
        parts.push(remaining);
      }
    }

    if (episode.finished) {
      parts.push(t("podcast.listened"));
    }

    return parts.join(" · ");
  };

  const cover = (variant?: "playing" | "writing", ref?: RefObject<HTMLDivElement | null>) => {
    const count = variant === "playing" ? openedFormat.speakerCount : speakerCount;

    return (
      <div
        ref={ref}
        className={`memo-podcast-cover ${variant ?? ""} ${count === 1 ? "solo" : ""}`.trim()}
        aria-hidden="true"
      >
        {variant === "writing" ? (
          <>
            <span className="memo-orb-ring" style={{ "--orb-hue": hueA } as CSSProperties} />
            <span className="memo-orb-ring second" style={{ "--orb-hue": hueA } as CSSProperties} />
          </>
        ) : null}
        <span className="memo-orb-glow a" style={{ "--orb-hue": hueA } as CSSProperties} />
        <span className="memo-orb-body a" style={{ "--orb-hue": hueA } as CSSProperties} />
        {count === 2 ? (
          <>
            {variant === "writing" ? null : (
              <span className="memo-orb-glow b" style={{ "--orb-hue": hueB } as CSSProperties} />
            )}
            <span className="memo-orb-body b" style={{ "--orb-hue": hueB } as CSSProperties} />
          </>
        ) : null}
      </div>
    );
  };

  const speakerLabel = (speaker: PodcastSpeaker) =>
    speakerCount === 1
      ? t("podcast.speaker.solo")
      : t(speaker === "a" ? "podcast.speaker.a" : "podcast.speaker.b");

  const usageLine = (
    <p className="memo-podcast-usage">
      {t("podcast.usage.remaining", { minutes: DEMO_REMAINING_MINUTES })}
    </p>
  );

  const activeFormat = getPodcastFormat(format);
  const castLine =
    speakerCount === 1 ? voices.a : t("podcast.cast.pair", { a: voices.a, b: voices.b });
  const playerCast =
    openedFormat.speakerCount === 1 ? voices.a : t("podcast.cast.pair", { a: voices.a, b: voices.b });

  const voiceOptions = (speaker: PodcastSpeaker) => (
    <div className="memo-podcast-voice-options" role="radiogroup" aria-label={speakerLabel(speaker)}>
      {NOTE_TTS_VOICES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={voices[speaker] === option}
          className={`memo-podcast-voice-option ${voices[speaker] === option ? "active" : ""} ${
            previewVoice === option ? "playing" : ""
          }`.trim()}
          style={{ "--orb-hue": podcastVoiceHue(option, speaker) } as CSSProperties}
          onClick={() => chooseVoice(speaker, option)}
        >
          <Msym
            name={previewVoice === option ? "graphic_eq" : "play_arrow"}
            size="0.95rem"
            fill={false}
            weight={500}
          />
          <span>{option}</span>
        </button>
      ))}
    </div>
  );

  return (
    <LandingAppScope
      theme={theme}
      className={["landing-study-screen landing-feature-screen", className].filter(Boolean).join(" ")}
    >
      <div ref={rootRef} className="landing-study-frame" data-note-tab="podcast">
        <div className="memo-podcast">
          <audio ref={audioRef} preload="none" />
          <audio
            ref={previewRef}
            preload="none"
            onEnded={() => setPreviewVoice(null)}
            onPause={() => setPreviewVoice(null)}
          />

          {view === "writing" ? (
            <div className="memo-podcast-hero writing">
              {cover("writing")}
              <h2 className="memo-podcast-title">{t("podcast.status.writing")}</h2>
              <p className="memo-podcast-body">{t("podcast.status.writingHint")}</p>
              <div
                className="memo-podcast-progress"
                style={pairHues}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(writingPercent)}
              >
                <span style={{ width: `${writingPercent}%` }} />
              </div>
              <p className="memo-podcast-choice">
                {t(activeFormat.labelKey)} · {t("podcast.minutes", { count: estimatedPodcastMinutes(length) })}
              </p>
            </div>
          ) : null}

          {view === "library" ? (
            <div className="memo-podcast-shelf">
              <div className="memo-podcast-list" role="list">
                {episodes.map((episode) => {
                  const shown = getPodcastFormat(episode.format);
                  const resuming =
                    !episode.finished && isResumable({ ...episode, durationMs: EPISODE_MS });
                  const rowHueB = shown.speakerCount === 2 ? hueB : hueA;

                  return (
                    <button
                      key={episode.id}
                      type="button"
                      role="listitem"
                      className={`memo-note-row memo-podcast-episode ${resuming ? "resumable" : ""}`.trim()}
                      onClick={() => openEpisode(episode, true)}
                    >
                      <span
                        className={`memo-podcast-episode-art ${shown.speakerCount === 1 ? "solo" : ""}`.trim()}
                        aria-hidden="true"
                      >
                        <span
                          className="memo-orb-body compact a"
                          style={{ "--orb-hue": hueA } as CSSProperties}
                        />
                        {shown.speakerCount === 2 ? (
                          <span
                            className="memo-orb-body compact b"
                            style={{ "--orb-hue": rowHueB } as CSSProperties}
                          />
                        ) : null}
                      </span>

                      <span className="memo-note-copy">
                        <span className="memo-note-title">{noteTitle}</span>
                        <span className="memo-note-meta memo-podcast-meta-phone">
                          {episodeMeta(episode, false)}
                        </span>
                        {resuming ? (
                          <span
                            className="memo-podcast-episode-bar"
                            style={{ "--hue-a": hueA, "--hue-b": rowHueB } as CSSProperties}
                          >
                            <span
                              style={{
                                width: `${Math.min(100, Math.round((episode.positionMs / EPISODE_MS) * 100))}%`,
                              }}
                            />
                          </span>
                        ) : null}
                      </span>

                      <Msym
                        name={episode.finished ? "replay" : "play_arrow"}
                        size="1.55rem"
                        fill={false}
                        weight={400}
                      />
                    </button>
                  );
                })}
              </div>

              <button type="button" className="memo-podcast-new" onClick={() => setIsChooserOpen(true)}>
                <Msym name="add" size="1.2rem" fill={false} weight={500} />
                <span>{t("podcast.newEpisode")}</span>
              </button>

              {usageLine}
            </div>
          ) : null}

          {view === "player" ? (
            <div className="memo-podcast-stage">
              {cover("playing", coverRef)}

              <div className="memo-podcast-titles">
                <h2 className="memo-podcast-title">{noteTitle}</h2>
                <p className="memo-podcast-subtitle">
                  {t(openedFormat.labelKey)} · {playerCast}
                </p>
              </div>

              <div className="memo-podcast-scrubber" style={pairHues}>
                <span className="memo-podcast-clock">{formatClock(elapsedMs)}</span>
                <input
                  type="range"
                  min={0}
                  max={EPISODE_MS}
                  value={Math.round(elapsedMs)}
                  aria-label={t("podcast.seek")}
                  style={{ "--played": `${Math.min(100, (elapsedMs / EPISODE_MS) * 100)}%` } as CSSProperties}
                  onChange={(event) => seekTo(Number(event.currentTarget.value))}
                />
                <span className="memo-podcast-clock end">{formatClock(EPISODE_MS)}</span>
              </div>

              <div className="memo-podcast-controls">
                <button
                  type="button"
                  className="memo-podcast-control"
                  onClick={() => seekTo(currentPosition() - SKIP_SECONDS * 1000)}
                  aria-label={t("podcast.back10")}
                >
                  <Msym name="replay_10" size="1.45rem" fill={false} weight={500} />
                </button>

                <button
                  type="button"
                  className="memo-podcast-control primary"
                  onClick={togglePlayback}
                  aria-label={t(isPlaying ? "podcast.pause" : "podcast.play")}
                >
                  <Msym name={isPlaying ? "pause" : "play_arrow"} size="1.8rem" fill weight={500} />
                </button>

                <button
                  type="button"
                  className="memo-podcast-control memo-podcast-back"
                  onClick={leavePlayer}
                  aria-label={t("podcast.library.back")}
                >
                  <Msym name="close" size="1.45rem" fill={false} weight={500} />
                </button>
              </div>
            </div>
          ) : null}

          {isChooserOpen ? (
            <>
              <button
                type="button"
                aria-label={t("common.close")}
                className="memo-scrim"
                onClick={closeChooser}
              />
              <div
                className="memo-confirm memo-confirm-fixed memo-podcast-chooser"
                role="dialog"
                aria-label={t("podcast.newEpisode.title")}
              >
                <div className="memo-grab" />
                <div className="memo-podcast-form">
                  <div
                    className="memo-podcast-shows"
                    role="radiogroup"
                    aria-label={t("podcast.format.label")}
                  >
                    {PODCAST_FORMATS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={format === option.id}
                        className={`memo-chip memo-podcast-show ${format === option.id ? "active" : ""}`.trim()}
                        onClick={() => setFormat(option.id)}
                      >
                        <Msym name={option.icon} size="1.15rem" fill={false} weight={500} />
                        <span>{t(option.labelKey)}</span>
                      </button>
                    ))}
                  </div>

                  <p className="memo-podcast-show-hint">{t(activeFormat.descriptionKey)}</p>

                  <div className="memo-podcast-cast">
                    <div
                      className="memo-segment memo-podcast-lengths"
                      role="radiogroup"
                      aria-label={t("podcast.length.label")}
                    >
                      {PODCAST_LENGTHS.map((option) => (
                        <button
                          key={option.id}
                          type="button"
                          role="radio"
                          aria-checked={length === option.id}
                          className={length === option.id ? "active" : ""}
                          onClick={() => setLength(option.id)}
                        >
                          <span>{t(option.labelKey)}</span>
                          <span className="memo-podcast-length-minutes">
                            {t("podcast.minutes", { count: estimatedPodcastMinutes(option.id) })}
                          </span>
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      className="memo-capture-row memo-podcast-voices"
                      aria-expanded={openVoiceSlot !== null}
                      onClick={() => setOpenVoiceSlot(openVoiceSlot === null ? "a" : null)}
                    >
                      <span
                        className={`memo-podcast-voices-art ${speakerCount === 1 ? "solo" : ""}`.trim()}
                        aria-hidden="true"
                      >
                        <span
                          className="memo-orb-body mini a"
                          style={{ "--orb-hue": hueA } as CSSProperties}
                        />
                        {speakerCount === 2 ? (
                          <span
                            className="memo-orb-body mini b"
                            style={{ "--orb-hue": hueB } as CSSProperties}
                          />
                        ) : null}
                      </span>
                      <span className="memo-capture-row-copy">
                        <span>{castLine}</span>
                        <span>{t(speakerCount === 1 ? "podcast.oneVoice" : "podcast.twoVoices")}</span>
                      </span>
                      <Msym name="chevron_right" size="1.5rem" fill={false} weight={400} />
                    </button>
                  </div>

                  {activeVoiceSlot !== null ? (
                    <div className="memo-podcast-picker">
                      {speakerCount === 2 ? (
                        <div className="memo-podcast-picker-tabs">
                          {PODCAST_SPEAKERS.map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              aria-pressed={activeVoiceSlot === slot}
                              className={`memo-podcast-picker-tab ${activeVoiceSlot === slot ? "active" : ""}`.trim()}
                              style={{ "--orb-hue": slot === "a" ? hueA : hueB } as CSSProperties}
                              onClick={() => setOpenVoiceSlot(slot)}
                            >
                              <span className="memo-orb-body mini" aria-hidden="true" />
                              <span className="memo-podcast-picker-tab-copy">
                                <span>{speakerLabel(slot)}</span>
                                <span>{voices[slot]}</span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="memo-podcast-picker-caption">{t("podcast.speaker.solo")}</p>
                      )}
                      {voiceOptions(activeVoiceSlot)}
                    </div>
                  ) : null}

                  <div className="memo-podcast-actions">
                    <button
                      type="button"
                      className="memo-podcast-primary"
                      onClick={() => {
                        previewRef.current?.pause();
                        requestEpisode(true);
                      }}
                    >
                      <Msym name="graphic_eq" size="1.3rem" fill={false} weight={500} />
                      <span>{t("podcast.generate")}</span>
                    </button>
                    {usageLine}
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </LandingAppScope>
  );
}
