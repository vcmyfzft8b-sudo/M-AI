"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { VoiceUsageSheet, type VoiceUsage } from "@/components/voice-usage-sheet";
import { NOTE_TTS_VOICES, type NoteTtsVoice } from "@/lib/note-tts-settings";
import {
  DEFAULT_PODCAST_FORMAT,
  DEFAULT_PODCAST_LENGTH,
  DEFAULT_PODCAST_VOICES,
  displacedPodcastVoice,
  estimatedPodcastMinutes,
  estimatedSpokenSeconds,
  getPodcastFormat,
  normalizePodcastFormat,
  normalizePodcastLength,
  normalizePodcastVoice,
  PODCAST_FORMATS,
  PODCAST_FORMAT_STORAGE_KEY,
  PODCAST_LENGTHS,
  PODCAST_LENGTH_STORAGE_KEY,
  PODCAST_VOICE_A_STORAGE_KEY,
  PODCAST_VOICE_B_STORAGE_KEY,
  segmentRequestAllowance,
  type PodcastFormat,
  type PodcastLength,
  type PodcastSpeaker,
  type PodcastTurn,
} from "@/lib/podcast-settings";
import { TutorClipPlayer } from "@/lib/tutor/clip-player";
import { podcastVoiceHue } from "@/lib/tutor/voice-colors";
import { podcastVoiceSampleClip } from "@/lib/tutor/voice-clips";

/**
 * The generated podcast.
 *
 * Two things are happening on this screen and it is worth separating them, because they fail and
 * wait in completely different ways. Writing the episode is one long model call the listener
 * waits through once. Playing it is many short synthesis calls, made one turn ahead of where the
 * listener is, so that a ten-minute episode starts within seconds of its script landing rather
 * than after all ten minutes of it have been produced.
 *
 * The second of those is the whole reason this is not a "generate, then download a file" screen.
 * A turn's audio is bought when somebody is about to hear it; an episode abandoned after two
 * minutes costs two minutes.
 */

/** Turns kept ready ahead of the one playing. Three covers a slow synthesis without racing ahead. */
const PREFETCH_AHEAD = 3;

/** A segment the server said is still being made: ask again, backing off, rather than failing. */
const SEGMENT_PENDING_RETRY_MS = [1_200, 2_000, 3_000, 4_000, 5_000, 5_000, 5_000, 5_000];

/** How often the screen asks whether the script it is waiting for has landed. */
const SCRIPT_POLL_MS = 4_000;

/**
 * How long a wait is allowed to run before the screen asks again for the episode.
 *
 * A generation lives inside one Vercel invocation and dies with it, and an invocation the
 * platform kills runs no catch block — so the row can be left saying "generating" by a process
 * that no longer exists. The server takes such a row over once it is plainly dead; nothing was
 * asking it to. Polling alone left the listener watching a progress bar for ever.
 *
 * Longer than the server's own stale window, so the re-request only ever lands on a row the
 * server already considers abandoned, and never cancels a call that is merely slow.
 */
const SCRIPT_RETRY_AFTER_MS = 7 * 60 * 1000;

/** How many times to re-ask before telling the listener it is not going to happen. */
const SCRIPT_MAX_ATTEMPTS = 2;

const SKIP_SECONDS = 10;

type PodcastPayload = {
  id: string;
  status: string;
  title: string | null;
  format: PodcastFormat;
  length: PodcastLength;
  language: string;
  turns: PodcastTurn[];
  readySegments: Array<{ segmentIndex: number; durationMs: number }>;
};

type PodcastEpisode = {
  id: string;
  format: PodcastFormat;
  length: PodcastLength;
  language: string;
  title: string | null;
  turnCount: number;
  estimatedSeconds: number;
  createdAt: string;
};

/*
 * One shape, defined where the meter that reads it lives. Kept as an alias rather than a
 * second declaration because the two drifted the moment the allowance gained a field: a
 * structural copy typechecks until it does not.
 */
type PodcastUsage = VoiceUsage;

type PodcastStatus = {
  available: boolean;
  reason: string | null;
  language?: string;
  podcast: PodcastPayload | null;
  episodes: PodcastEpisode[];
  /* The spoken tutor's allowance: one pot of minutes for every voice this app has. */
  usage: PodcastUsage;
};

type LoadedSegment = {
  durationMs: number;
  /** The audio itself, held as an object URL: a signed link expires, a blob does not. */
  objectUrl: string;
};

function readStored<T extends string>(key: string, normalize: (value: unknown) => T): T {
  if (typeof window === "undefined") {
    return normalize(undefined);
  }

  try {
    return normalize(window.localStorage.getItem(key));
  } catch {
    return normalize(undefined);
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Private browsing refuses storage; the choice still holds for this session. */
  }
}

/**
 * The bar that moves while the script is being written.
 *
 * There is nothing to measure — one model call that reports no progress — so this is an honest
 * guess that decelerates and never reaches the end, in the shape read-aloud already uses for the
 * same problem. Its job is to say "still working", not to predict.
 */
function writingProgressPercent(startedAt: number, expectedSeconds: number) {
  const elapsed = Math.max(0, (Date.now() - startedAt) / 1000);
  const fraction = elapsed / Math.max(20, expectedSeconds);

  return Math.min(94, 4 + (1 - Math.exp(-fraction * 2.2)) * 90);
}

function formatClock(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function LecturePodcast({
  lectureId,
  isReady,
  language,
  dockSlot,
}: {
  lectureId: string;
  isReady: boolean;
  /* The note screen's dock, where this app keeps the controls of the screen you are on. */
  dockSlot: HTMLElement | null;
  /** The note's own language, so voices audition in the one the episode will be in. */
  language: string;
}) {
  const t = useT();

  const [format, setFormat] = useState<PodcastFormat>(DEFAULT_PODCAST_FORMAT);
  const [length, setLength] = useState<PodcastLength>(DEFAULT_PODCAST_LENGTH);
  const [voices, setVoices] = useState<Record<PodcastSpeaker, NoteTtsVoice>>(DEFAULT_PODCAST_VOICES);
  const [settingsRestored, setSettingsRestored] = useState(false);

  const [status, setStatus] = useState<PodcastStatus | null>(null);
  const [podcast, setPodcast] = useState<PodcastPayload | null>(null);
  const [isWriting, setIsWriting] = useState(false);
  const [writingStartedAt, setWritingStartedAt] = useState<number | null>(null);
  const [writingPercent, setWritingPercent] = useState(0);
  const [scriptAttempts, setScriptAttempts] = useState(0);
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  /*
   * Whether the first status load has landed.
   *
   * Until it has, this screen does not know whether the note has episodes — and rendering the
   * chooser meanwhile meant the tab opened on "make a new one" and flicked to the library a
   * moment later. Which screen you are on is not a thing to guess at and correct; it is worth
   * the fraction of a second of holding still.
   */
  const [hasLoadedStatus, setHasLoadedStatus] = useState(false);
  /*
   * The episode being opened. Its script is a round trip away, and a row that looks untouched
   * while it loads reads as a tap that missed — so it says what it is doing, and cannot be
   * tapped twice on the way.
   */
  const [openingEpisodeId, setOpeningEpisodeId] = useState<string | null>(null);
  /*
   * The player is never arrived at, only opened.
   *
   * It used to appear on its own whenever a finished episode happened to match the saved show and
   * length — so somebody opening the tab to make a NEW episode was dropped into an old one they
   * had not asked for, with the chooser hidden behind a button. Landing is always the setup
   * screen now; this is set by pressing Create, or by picking an episode from the library.
   */
  const [openedEpisodeId, setOpenedEpisodeId] = useState<string | null>(null);
  /* Set when the player was opened by an act that means "play it": Create, or tapping an episode. */
  const [autoPlay, setAutoPlay] = useState(false);
  /*
   * An episode picked from the library, waiting for its script to arrive before it can open.
   *
   * A ref rather than state, and that is the whole point: the request is fired in the same tick
   * the choice is made, so a `loadStatus` closed over the previous render would read the previous
   * value — null — and quietly decline to open the episode the listener just tapped.
   */
  const pendingEpisodeIdRef = useRef<string | null>(null);
  /* Whether the chooser is showing instead of the library. Always true when there is no library. */
  const [isChoosing, setIsChoosing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Set when a 402 says the shared listening allowance is spent. */
  const [limitReached, setLimitReached] = useState(false);
  const [buyingCredits, setBuyingCredits] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [preparingIndex, setPreparingIndex] = useState<number | null>(null);
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  const [openVoiceSlot, setOpenVoiceSlot] = useState<PodcastSpeaker | null>(null);
  /* Bumped whenever the segment cache changes, so the render reads the ref's new contents. */
  const [segmentVersion, setSegmentVersion] = useState(0);

  /*
   * Two elements, not one, and this is what removes the pause between speakers.
   *
   * With a single element every hand-off is `src = next; play()`, and even from a blob already in
   * memory the browser still has to load and decode before the first sample — audible, every time
   * the conversation changes hands, which on a two-hander is every twenty seconds.
   *
   * So the next turn is loaded into the OTHER element while this one is still speaking, and the
   * hand-off is a bare play() on something already decoded and ready.
   */
  const audioARef = useRef<HTMLAudioElement | null>(null);
  const audioBRef = useRef<HTMLAudioElement | null>(null);
  const activeSlotRef = useRef<"a" | "b">("a");
  /** Which turn is already loaded into which element, so a prepared hand-off is recognised. */
  const preparedRef = useRef<{ slot: "a" | "b"; index: number } | null>(null);
  const segmentsRef = useRef(new Map<number, LoadedSegment>());
  const pendingRef = useRef(new Map<number, Promise<LoadedSegment | null>>());
  const inFlightRef = useRef(0);
  /* Recomputed every render; read inside the limiter, which must not be rebuilt per keystroke. */
  const concurrencyRef = useRef(segmentRequestAllowance({ bufferedAhead: 0, rate: 1 }));
  const previewPlayerRef = useRef<TutorClipPlayer | null>(null);
  const previewTokenRef = useRef(0);
  /* Read inside callbacks that must not be rebuilt every time a voice changes. */
  const voicesRef = useRef(voices);
  const podcastRef = useRef<PodcastPayload | null>(null);
  const isPlayingRef = useRef(false);
  /*
   * Read inside loadStatus rather than closed over.
   *
   * `isWriting` used to be one of its dependencies, which made it a new function every time a
   * generation started or stopped — and the effect that resets the screen when the show changes
   * depends on loadStatus. So pressing Create reset the very screen it had just started: the
   * episode was written and filed in the library, and the listener was put back in front of the
   * library to watch it appear rather than hearing it.
   */
  const isWritingRef = useRef(false);
  /*
   * Which status request is the current one.
   *
   * Every change of show, length or voice fires a fresh request, and they do not come back in the
   * order they were sent. A reply for the variant the listener has just moved away from used to
   * be applied anyway — and if that variant had no episode it set the podcast to null, closing a
   * player that had just opened and dropping the listener back to the library while the audio it
   * had already started carried on playing underneath. Intermittent by nature: it only bites when
   * the stale reply happens to land after the fresh one.
   */
  const statusRequestRef = useRef(0);

  voicesRef.current = voices;
  podcastRef.current = podcast;
  isPlayingRef.current = isPlaying;
  isWritingRef.current = isWriting;

  /*
   * How much of the episode is already made, counted forward from the turn playing. Read from
   * the ref rather than from state because the cache is not reactive; `segmentVersion` is what
   * says it changed, and it is a dependency of everything that renders from this.
   */
  let bufferedAhead = 0;

  while (segmentsRef.current.has(currentIndex + bufferedAhead + 1)) {
    bufferedAhead += 1;
  }

  concurrencyRef.current = segmentRequestAllowance({ bufferedAhead, rate: 1 });

  /* Memoized so the derived durations and the prefetch effect do not rebuild on every render. */
  const turns = useMemo(() => podcast?.turns ?? [], [podcast]);

  /* The player shows only an episode the listener opened — see openedEpisodeId. */
  const hasEpisode = Boolean(
    podcast && podcast.status === "ready" && turns.length > 0 && podcast.id === openedEpisodeId,
  );
  const speakerCount = getPodcastFormat(format).speakerCount;
  /*
   * Being written — by this screen, or by a request that started before it was opened.
   *
   * The second case is the one worth naming. A generation outlives the tab that asked for it, so
   * somebody who reloads, or opens the note on their phone, arrives at a row that says
   * "generating" without ever having pressed anything. Keying the waiting screen on local state
   * alone left them watching a bar that never moved and a poll that never ran.
   */
  const isProducing = isWriting || podcast?.status === "generating";

  /**
   * Which of the four screens this is.
   *
   * Named once rather than re-derived at each place that needs it: the branching, the artwork and
   * the standfirst all used to work it out separately from the same three flags, which is how a
   * screen ends up carrying decoration that belongs to a different one.
   */
  const view: "player" | "writing" | "library" | "chooser" | "loading" = hasEpisode
    ? "player"
    : isProducing
      ? "writing"
      : !hasLoadedStatus
        ? "loading"
        : episodes.length > 0 && !isChoosing
          ? "library"
          : "chooser";

  /* Restored once, on the client: reading storage during render would differ from the server. */
  useEffect(() => {
    setFormat(readStored(PODCAST_FORMAT_STORAGE_KEY, normalizePodcastFormat));
    setLength(readStored(PODCAST_LENGTH_STORAGE_KEY, normalizePodcastLength));
    setVoices({
      a: readStored(PODCAST_VOICE_A_STORAGE_KEY, (value) => normalizePodcastVoice(value, "a")),
      b: readStored(PODCAST_VOICE_B_STORAGE_KEY, (value) => normalizePodcastVoice(value, "b")),
    });
    setSettingsRestored(true);
  }, []);

  const releaseSegments = useCallback((predicate?: (index: number) => boolean) => {
    for (const [index, segment] of segmentsRef.current) {
      if (predicate && !predicate(index)) {
        continue;
      }

      URL.revokeObjectURL(segment.objectUrl);
      segmentsRef.current.delete(index);
    }

    setSegmentVersion((version) => version + 1);
  }, []);

  const elementFor = useCallback(
    (slot: "a" | "b") => (slot === "a" ? audioARef.current : audioBRef.current),
    [],
  );

  const stopPlayback = useCallback(() => {
    for (const element of [audioARef.current, audioBRef.current]) {
      if (element) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
    }

    preparedRef.current = null;
    setIsPlaying(false);
  }, []);

  /* Nothing outlives the screen: an object URL is a file the browser keeps until it is told not to. */
  useEffect(
    () => () => {
      for (const segment of segmentsRef.current.values()) {
        URL.revokeObjectURL(segment.objectUrl);
      }

      segmentsRef.current.clear();
      pendingRef.current.clear();
      previewPlayerRef.current?.stop();
      audioARef.current?.pause();
      audioBRef.current?.pause();
    },
    [],
  );

  const durationOf = useCallback(
    (index: number) => {
      const loaded = segmentsRef.current.get(index);

      /*
       * A loaded turn knows its own length, unless it somehow came back without one — in which
       * case the estimate below is still a better answer than zero, which would shrink the
       * episode's total as it played and drag the scrubber backwards.
       */
      if (loaded?.durationMs) {
        return loaded.durationMs;
      }

      const known = podcast?.readySegments.find((segment) => segment.segmentIndex === index);

      if (known) {
        return known.durationMs;
      }

      const turn = turns[index];

      return turn ? estimatedSpokenSeconds(turn.text) * 1000 : 0;
    },
    /* segmentVersion is the signal that the cache changed; the ref itself is not reactive. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [podcast, turns, segmentVersion],
  );

  const totalMs = useMemo(
    () => turns.reduce((sum, _turn, index) => sum + durationOf(index), 0),
    [turns, durationOf],
  );

  const elapsedMs = useMemo(() => {
    let sum = 0;

    for (let index = 0; index < currentIndex; index += 1) {
      sum += durationOf(index);
    }

    return sum + positionMs;
  }, [currentIndex, positionMs, durationOf]);

  /** Which turn a point in the whole episode falls in, and how far into it. */
  const locateAt = useCallback(
    (targetMs: number) => {
      let remaining = Math.max(0, targetMs);

      for (let index = 0; index < turns.length; index += 1) {
        const duration = durationOf(index);

        if (remaining < duration || index === turns.length - 1) {
          return { index, offsetMs: Math.min(remaining, Math.max(0, duration - 500)) };
        }

        remaining -= duration;
      }

      return { index: 0, offsetMs: 0 };
    },
    [turns.length, durationOf],
  );

  const loadStatus = useCallback(
    async (options?: { silent?: boolean }) => {
      const query = new URLSearchParams({
        format,
        length,
        voiceA: voicesRef.current.a,
        voiceB: voicesRef.current.b,
      });

      const requestId = statusRequestRef.current + 1;
      statusRequestRef.current = requestId;

      try {
        const response = await fetch(`/api/lectures/${lectureId}/podcast?${query.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          /* Still an answer: it settles the screen onto the chooser rather than a spinner. */
          setHasLoadedStatus(true);
          return null;
        }

        const payload = (await response.json()) as PodcastStatus;

        /* Something newer has been asked for since; this answer is about the past. */
        if (requestId !== statusRequestRef.current) {
          return null;
        }

        setHasLoadedStatus(true);

        setStatus(payload);
        setPodcast(payload.podcast);
        setEpisodes(payload.episodes ?? []);

        /*
         * The episode picked from the library has arrived with its script. Matching on the id
         * rather than simply "a podcast came back" is what stops a stale response from an earlier
         * variant opening the wrong one.
         */
        if (payload.podcast && payload.podcast.id === pendingEpisodeIdRef.current) {
          setOpenedEpisodeId(payload.podcast.id);
          pendingEpisodeIdRef.current = null;
          setOpeningEpisodeId(null);
          setCurrentIndex(0);
          setPositionMs(0);
          /* Tapping an episode in the library is a request to hear it, not to look at it. */
          setAutoPlay(true);
        }

        if (payload.podcast?.status === "ready" && isWritingRef.current) {
          /* This screen asked for it and has been watching the bar; it opens on arrival. */
          setIsWriting(false);
          setOpenedEpisodeId(payload.podcast.id);
        }

        /*
         * A generation that ended badly is recorded on the row, and without this the screen
         * simply falls back to the setup panel — which reads as "nothing happened here", the one
         * thing that is not true. The listener is told, and the button is theirs again.
         */
        if (payload.podcast?.status === "failed") {
          setIsWriting(false);
          setError(t("podcast.error.script"));
        }

        return payload;
      } catch {
        setHasLoadedStatus(true);

        if (!options?.silent) {
          setError(t("podcast.error.status"));
        }

        return null;
      }
    },
    [format, length, lectureId, t],
  );

  /*
   * Changing the show or its length changes which episode this is, so everything about the last
   * one goes: its audio, its position, and the request that was about to fetch its next turn.
   */
  /*
   * The variant this screen last reset for.
   *
   * The effect below depends on several callbacks, and a callback that is rebuilt for any reason
   * re-runs it — which threw away an episode that had just opened, seconds after it opened,
   * leaving the audio playing under the library. Whether the episode changed is a question about
   * the show and the length, not about identities, so it is asked directly.
   */
  const lastVariantRef = useRef<string | null>(null);

  useEffect(() => {
    if (!settingsRestored || !isReady) {
      return;
    }

    const variant = `${format}:${length}`;

    if (lastVariantRef.current === variant) {
      return;
    }

    lastVariantRef.current = variant;

    stopPlayback();
    releaseSegments();
    pendingRef.current.clear();
    setCurrentIndex(0);
    setPositionMs(0);
    setPodcast(null);
    setError(null);
    setLimitReached(false);
    setScriptAttempts(0);
    setOpenedEpisodeId(null);
    void loadStatus({ silent: true });
  }, [settingsRestored, isReady, format, length, loadStatus, releaseSegments, stopPlayback]);

  const requestScript = useCallback(async () => {
    setError(null);
    setIsWriting(true);
    setScriptAttempts((attempts) => attempts + 1);

    try {
      const response = await fetch(`/api/lectures/${lectureId}/podcast`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format,
          length,
          voiceA: voicesRef.current.a,
          voiceB: voicesRef.current.b,
        }),
      });

      if (response.status === 202) {
        /* Another request is already writing this one; the poll below picks it up. */
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { podcast?: PodcastPayload; error?: string }
        | null;

      if (response.status === 402) {
        setIsWriting(false);
        setLimitReached(true);
        setError(payload?.error ?? t("podcast.limitReached"));
        return;
      }

      if (!response.ok || !payload?.podcast) {
        setIsWriting(false);
        setError(payload?.error ?? t("podcast.error.script"));
        return;
      }

      /*
       * The freshly written episode is the newest truth about this variant, so any status request
       * already in flight is stale — including the polls that were watching this very generation,
       * which would otherwise land a moment later and put "still generating" back on screen.
       */
      statusRequestRef.current += 1;
      /*
       * Filed in the library immediately rather than on the next status load, so the player's way
       * back is never a button that is not there yet.
       */
      setEpisodes((current) =>
        current.some((episode) => episode.id === payload.podcast!.id)
          ? current
          : [
              {
                id: payload.podcast!.id,
                format: payload.podcast!.format,
                length: payload.podcast!.length,
                language: payload.podcast!.language,
                title: payload.podcast!.title,
                turnCount: payload.podcast!.turns.length,
                estimatedSeconds: payload.podcast!.turns.reduce(
                  (sum, turn) => sum + estimatedSpokenSeconds(turn.text),
                  0,
                ),
                createdAt: new Date().toISOString(),
              },
              ...current,
            ],
      );
      setPodcast(payload.podcast);
      setOpenedEpisodeId(payload.podcast.id);
      setIsWriting(false);
      setCurrentIndex(0);
      setPositionMs(0);
      /*
       * Waiting through a generation is asking for the episode. Landing in a paused player and
       * having to press play again is asking twice.
       */
      setAutoPlay(true);
    } catch {
      setIsWriting(false);
      setError(t("podcast.error.script"));
    }
  }, [format, length, lectureId, t]);

  /* The script is written by a request that may outlive the tab; polling is how a reload finds it. */
  useEffect(() => {
    if (!isProducing) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadStatus({ silent: true });

      /*
       * Nothing has come back for longer than a generation can possibly still be alive, so the
       * row belongs to an invocation that was killed. Asking again is what takes it over; the
       * server refuses to start a second call while the first is merely slow.
       */
      if (
        writingStartedAt !== null &&
        Date.now() - writingStartedAt > SCRIPT_RETRY_AFTER_MS &&
        scriptAttempts < SCRIPT_MAX_ATTEMPTS
      ) {
        setWritingStartedAt(Date.now());
        void requestScript();
      }
    }, SCRIPT_POLL_MS);

    return () => window.clearInterval(timer);
  }, [isProducing, loadStatus, requestScript, scriptAttempts, writingStartedAt]);

  /* A generation found already running has no start time here; it gets one when it is noticed. */
  useEffect(() => {
    if (isProducing) {
      setWritingStartedAt((current) => current ?? Date.now());
      return;
    }

    setWritingStartedAt(null);
  }, [isProducing]);

  useEffect(() => {
    if (!isProducing || writingStartedAt === null) {
      setWritingPercent(0);
      return;
    }

    const expectedSeconds = PODCAST_LENGTHS.find((option) => option.id === length)?.targetWords ?? 900;
    const tick = () =>
      setWritingPercent(writingProgressPercent(writingStartedAt, expectedSeconds / 12));

    tick();

    const timer = window.setInterval(tick, 400);

    return () => window.clearInterval(timer);
  }, [isProducing, writingStartedAt, length]);

  /**
   * Fetches one turn's audio, waiting out the answers that mean "not yet".
   *
   * A 202 is not a failure: either another request is synthesizing this exact turn, or every
   * stream slot the organization has is busy. Both are answered by asking again shortly, which is
   * why this backs off rather than surfacing an error the listener can do nothing about.
   */
  const requestSegment = useCallback(
    async (index: number): Promise<LoadedSegment | null> => {
      const current = podcastRef.current;

      if (!current) {
        return null;
      }

      for (let attempt = 0; attempt <= SEGMENT_PENDING_RETRY_MS.length; attempt += 1) {
        const response = await fetch(`/api/lectures/${lectureId}/podcast/segments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            podcastId: current.id,
            segmentIndex: index,
            voiceA: voicesRef.current.a,
            voiceB: voicesRef.current.b,
          }),
        });

        if (response.status === 202) {
          const delay = SEGMENT_PENDING_RETRY_MS[attempt];

          if (delay === undefined) {
            return null;
          }

          await new Promise((resolve) => window.setTimeout(resolve, delay));
          continue;
        }

        const payload = (await response.json().catch(() => null)) as
          | { audioUrl?: string; durationMs?: number; code?: string; error?: string }
          | null;

        if (!response.ok) {
  

          throw new Error(payload?.error ?? t("podcast.error.audio"));
        }

        if (!payload?.audioUrl) {
          throw new Error(t("podcast.error.audio"));
        }

        /*
         * Downloaded rather than played from the signed URL. Two reasons, both audible: a link
         * minted for a turn the listener reaches eight minutes later has expired by then, and an
         * element that has to open a connection between turns leaves a gap where a conversation
         * should be.
         */
        const audio = await fetch(payload.audioUrl);

        if (!audio.ok) {
          throw new Error(t("podcast.error.audio"));
        }

        return {
          durationMs: payload.durationMs ?? 0,
          objectUrl: URL.createObjectURL(await audio.blob()),
        };
      }

      return null;
    },
    [lectureId, t],
  );

  const ensureSegment = useCallback(
    (index: number): Promise<LoadedSegment | null> => {
      const cached = segmentsRef.current.get(index);

      if (cached) {
        return Promise.resolve(cached);
      }

      const pending = pendingRef.current.get(index);

      if (pending) {
        return pending;
      }

      const work = (async () => {
        while (inFlightRef.current >= concurrencyRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }

        inFlightRef.current += 1;

        try {
          const segment = await requestSegment(index);

          if (segment) {
            segmentsRef.current.set(index, segment);
            setSegmentVersion((version) => version + 1);
          }

          return segment;
        } finally {
          inFlightRef.current -= 1;
          pendingRef.current.delete(index);
        }
      })();

      pendingRef.current.set(index, work);

      return work;
    },
    [requestSegment],
  );

  const playSegment = useCallback(
    async (index: number, offsetMs = 0) => {
      if (index >= (podcastRef.current?.turns.length ?? 0)) {
        setIsPlaying(false);
        return;
      }

      setCurrentIndex(index);
      setPositionMs(offsetMs);
      setError(null);

      const cached = segmentsRef.current.get(index);
      let segment = cached ?? null;

      if (!segment) {
        setPreparingIndex(index);

        try {
          segment = await ensureSegment(index);
        } catch (caught) {
          setPreparingIndex(null);
          setIsPlaying(false);
          setError(caught instanceof Error ? caught.message : t("podcast.error.audio"));
          return;
        }

        setPreparingIndex(null);
      }

      if (!segment) {
        setIsPlaying(false);
        setError(t("podcast.error.audio"));
        return;
      }

      /*
       * Use the element this turn was already loaded into if the hand-off was prepared; otherwise
       * take whichever is idle. Either way the other one is silenced, so a seek during playback
       * cannot leave two turns talking over each other.
       */
      const prepared = preparedRef.current;
      const slot: "a" | "b" =
        prepared && prepared.index === index
          ? prepared.slot
          : activeSlotRef.current === "a"
            ? "b"
            : "a";
      const element = elementFor(slot);
      const other = elementFor(slot === "a" ? "b" : "a");

      if (!element) {
        return;
      }

      other?.pause();

      if (element.src !== segment.objectUrl) {
        element.src = segment.objectUrl;
      }

      element.currentTime = offsetMs / 1000;
      activeSlotRef.current = slot;
      preparedRef.current = null;

      try {
        await element.play();
        setIsPlaying(true);
      } catch {
        /* A play() the browser refused because the gesture was spent: leave it paused, not broken. */
        setIsPlaying(false);
      }
    },
    [elementFor, ensureSegment, t],
  );

  /*
   * The first turn is fetched the moment the episode opens, before anything is pressed.
   *
   * Synthesis is the whole wait — roughly the length of the audio — and it used to start on the
   * press, so Play meant fifteen seconds of nothing. Starting it when the player appears spends
   * that wait while the listener is reading the title, and the press is then instant. It is not
   * speculative work: an episode that has been opened is one somebody is about to play.
   */
  useEffect(() => {
    if (!hasEpisode || turns.length === 0) {
      return;
    }

    for (const index of [currentIndex, currentIndex + 1]) {
      if (index < turns.length && !segmentsRef.current.has(index)) {
        void ensureSegment(index).catch(() => {
          /* Retried when playback actually reaches the turn. */
        });
      }
    }
    /* Deliberately not keyed on isPlaying: the point is to be ahead of it. */
  }, [hasEpisode, currentIndex, turns.length, ensureSegment, segmentVersion]);

  useEffect(() => {
    if (!autoPlay || !hasEpisode || isPlaying) {
      return;
    }

    setAutoPlay(false);
    void playSegment(currentIndex, 0);
    /* playSegment waits for the turn itself; this only has to fire once the episode is there. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, hasEpisode]);

  /*
   * Loads the next turn into the idle element, which is what makes the hand-off silent. Runs
   * whenever the turn or the cache changes, so it is ready long before it is needed.
   */
  useEffect(() => {
    if (!hasEpisode) {
      return;
    }

    const next = currentIndex + 1;
    const segment = segmentsRef.current.get(next);

    if (!segment || preparedRef.current?.index === next) {
      return;
    }

    const slot = activeSlotRef.current === "a" ? "b" : "a";
    const element = elementFor(slot);

    if (!element) {
      return;
    }

    element.src = segment.objectUrl;
    element.load();
    preparedRef.current = { slot, index: next };
  }, [hasEpisode, currentIndex, segmentVersion, elementFor]);

  /* One turn ahead is not enough when a synthesis takes longer than a turn lasts. */
  useEffect(() => {
    if (!podcast || podcast.status !== "ready" || !isPlaying) {
      return;
    }

    for (let ahead = 1; ahead <= PREFETCH_AHEAD; ahead += 1) {
      const index = currentIndex + ahead;

      if (index < podcast.turns.length && !segmentsRef.current.has(index)) {
        void ensureSegment(index).catch(() => {
          /* A prefetch that fails is retried when playback actually reaches the turn. */
        });
      }
    }
  }, [podcast, currentIndex, isPlaying, ensureSegment, segmentVersion]);

  /**
   * Opens an episode the listener already has.
   *
   * The row carries only what a list needs, so the script is fetched by pointing the variant at
   * it — the same request the screen makes anyway. `pendingEpisodeId` is what turns that arrival
   * into an open player, and it is matched by id so a response for the previous variant, still in
   * flight, cannot open the wrong episode.
   */
  function openEpisode(episode: PodcastEpisode) {
    setError(null);
    pendingEpisodeIdRef.current = episode.id;
    setOpeningEpisodeId(episode.id);
    setIsChoosing(false);

    if (episode.format === format && episode.length === length) {
      /* Already the variant on screen: nothing will change, so ask for it directly. */
      void loadStatus({ silent: true });
      return;
    }

    chooseFormat(episode.format);
    chooseLength(episode.length);
  }

  /**
   * Closes the player and returns to the library.
   *
   * Playback stops on the way out, because the player is the only place with controls — leaving
   * it while the audio carried on would mean sound with nothing to pause it.
   */
  function leavePlayer() {
    pendingEpisodeIdRef.current = null;
    setOpeningEpisodeId(null);
    stopPlayback();
    releaseSegments();
    setOpenedEpisodeId(null);
    setIsChoosing(false);
    setCurrentIndex(0);
    setPositionMs(0);
  }

  /**
   * Buys an hour of listening time.
   *
   * The tutor's endpoint, deliberately: the hour is one hour of spoken audio, spendable on either
   * feature, and offering two purchases for one pot of minutes would be charging for a
   * distinction that does not exist.
   */
  async function buyCredits() {
    setBuyingCredits(true);

    try {
      const response = await fetch("/api/billing/tutor-credits", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error ?? t("tutor.error.creditsFailed"));
      }

      window.location.href = payload.url;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("tutor.error.creditsFailed"));
      setBuyingCredits(false);
    }
  }

  function chooseFormat(next: PodcastFormat) {
    setFormat(next);
    writeStored(PODCAST_FORMAT_STORAGE_KEY, next);
  }

  function chooseLength(next: PodcastLength) {
    setLength(next);
    writeStored(PODCAST_LENGTH_STORAGE_KEY, next);
  }

  /**
   * Picks a voice for one host, plays it, and keeps the two hosts distinguishable.
   *
   * Taking the voice the other host already has would make the episode one person talking to
   * themselves, so the other host is moved rather than the choice being refused — a picker that
   * greys out an option makes you work out why, and this simply does the sensible thing.
   */
  async function chooseVoice(speaker: PodcastSpeaker, next: NoteTtsVoice) {
    const other: PodcastSpeaker = speaker === "a" ? "b" : "a";

    setVoices((current) => {
      const updated = { ...current, [speaker]: next };

      if (speakerCount === 2 && updated[other] === next) {
        updated[other] = displacedPodcastVoice(next);
        writeStored(other === "a" ? PODCAST_VOICE_A_STORAGE_KEY : PODCAST_VOICE_B_STORAGE_KEY, updated[other]);
      }

      voicesRef.current = updated;

      return updated;
    });
    writeStored(speaker === "a" ? PODCAST_VOICE_A_STORAGE_KEY : PODCAST_VOICE_B_STORAGE_KEY, next);

    /*
     * The script is untouched by this — it never names its hosts — but every turn already
     * synthesized was said in the old voice, so it is dropped. Turns spoken by the other host
     * survive, which is what makes changing one voice cheap.
     */
    stopPlayback();
    releaseSegments((index) => (podcastRef.current?.turns[index]?.speaker ?? "a") === speaker);
    setPositionMs(0);
    /*
     * Reloaded because the cast may have changed grammatical gender, and the script's words agree
     * with it — swapping a woman for a man is a different script, not the same one in a new voice.
     * Swapping within a gender resolves to the same row and costs nothing.
     */
    setOpenedEpisodeId(null);
    void loadStatus({ silent: true });

    previewTokenRef.current += 1;
    const token = previewTokenRef.current;
    previewPlayerRef.current?.stop();

    const player = (previewPlayerRef.current ??= new TutorClipPlayer());
    player.onEnded = () => {
      if (token === previewTokenRef.current) {
        setPreviewVoice(null);
      }
    };
    setPreviewVoice(next);

    try {
      await player.play(podcastVoiceSampleClip(next, language));
    } catch {
      if (token === previewTokenRef.current) {
        setPreviewVoice(null);
      }
    }
  }

  function togglePlayback() {
    const element = elementFor(activeSlotRef.current);

    if (isPlaying) {
      element?.pause();
      setIsPlaying(false);
      return;
    }

    if (element?.src && element.readyState > 0) {
      void element.play().then(
        () => setIsPlaying(true),
        () => setIsPlaying(false),
      );
      return;
    }

    void playSegment(currentIndex, positionMs);
  }

  function skip(seconds: number) {
    const target = elapsedMs + seconds * 1000;
    const located = locateAt(Math.max(0, Math.min(target, Math.max(0, totalMs - 1_000))));

    const active = elementFor(activeSlotRef.current);

    if (located.index === currentIndex && active?.src) {
      active.currentTime = located.offsetMs / 1000;
      setPositionMs(located.offsetMs);
      return;
    }

    void playSegment(located.index, located.offsetMs);
  }

  function seekTo(targetMs: number) {
    const located = locateAt(targetMs);

    const active = elementFor(activeSlotRef.current);

    if (located.index === currentIndex && active?.src) {
      active.currentTime = located.offsetMs / 1000;
      setPositionMs(located.offsetMs);
      return;
    }

    void playSegment(located.index, located.offsetMs);
  }

  if (!isReady) {
    return <p className="ios-info lecture-empty-message">{t("podcast.notReady")}</p>;
  }

  if (status && !status.available) {
    return (
      <p className="ios-info lecture-empty-message">
        {t(status.reason === "subscription_required" ? "podcast.paidOnly" : "podcast.notReady")}
      </p>
    );
  }

  const activeFormat = getPodcastFormat(format);

  const cover = (
    <div className="memo-podcast-cover" aria-hidden="true">
      <span
        className="memo-podcast-orb primary"
        style={{ "--podcast-hue": podcastVoiceHue(voices.a) } as CSSProperties}
      />
      {speakerCount === 2 ? (
        <span
          className="memo-podcast-orb secondary"
          style={{ "--podcast-hue": podcastVoiceHue(voices.b) } as CSSProperties}
        />
      ) : null}
    </div>
  );

  const voiceRow = (speaker: PodcastSpeaker) => (
    <div className="memo-podcast-voice-slot">
      <button
        type="button"
        className="memo-podcast-voice-current"
        style={{ "--podcast-hue": podcastVoiceHue(voices[speaker]) } as CSSProperties}
        aria-expanded={openVoiceSlot === speaker}
        onClick={() => setOpenVoiceSlot(openVoiceSlot === speaker ? null : speaker)}
      >
        <span className="memo-podcast-voice-dot" />
        <span className="memo-podcast-voice-role">
          {t(
            speakerCount === 1
              ? "podcast.speaker.solo"
              : speaker === "a"
                ? "podcast.speaker.a"
                : "podcast.speaker.b",
          )}
        </span>
        <span className="memo-podcast-voice-name">{voices[speaker]}</span>
        <Msym
          name={openVoiceSlot === speaker ? "expand_less" : "expand_more"}
          size="1.1rem"
          fill={false}
          weight={500}
        />
      </button>

      {openVoiceSlot === speaker ? (
        <div className="memo-podcast-voice-options" role="radiogroup" aria-label={t("podcast.voice.label")}>
          {NOTE_TTS_VOICES.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={voices[speaker] === option}
              className={`memo-podcast-voice-option ${voices[speaker] === option ? "active" : ""} ${
                previewVoice === option ? "playing" : ""
              }`.trim()}
              style={{ "--podcast-hue": podcastVoiceHue(option) } as CSSProperties}
              onClick={() => void chooseVoice(speaker, option)}
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
      ) : null}
    </div>
  );

  return (
    <div className="memo-podcast">
      <VoiceUsageSheet
        usage={status?.usage ?? null}
        dockSlot={dockSlot}
        blocked={limitReached}
        buyingCredits={buyingCredits}
        onBuyCredits={() => void buyCredits()}
      />
      {/* One element for the whole episode: turns are swapped into it as they are reached. */}
      {(["a", "b"] as const).map((slot) => (
        <audio
          key={slot}
          ref={slot === "a" ? audioARef : audioBRef}
          preload="auto"
          onTimeUpdate={(event) => {
            if (activeSlotRef.current === slot) {
              setPositionMs(event.currentTarget.currentTime * 1000);
            }
          }}
          onEnded={() => {
            /* The idle element can fire this too, having been loaded and seeked. Ignore it. */
            if (activeSlotRef.current !== slot) {
              return;
            }

            const next = currentIndex + 1;

            if (next < turns.length) {
              void playSegment(next, 0);
              return;
            }

            setIsPlaying(false);
            setPositionMs(durationOf(currentIndex));
          }}
        />
      ))}

      {/*
        * The artwork is the episode's, so it appears where an episode is the subject — the
        * library, the player, the wait for one — and not on the form that chooses a show, where
        * it is a hundred and twenty points of decoration pushing the controls off the screen.
        */}
      {view === "chooser" ? null : cover}

      {hasEpisode ? (
        <>
          <h2 className="memo-podcast-title">{podcast?.title ?? t("podcast.title")}</h2>
          <p className="memo-podcast-subtitle">
            {t(activeFormat.labelKey)} · {formatClock(totalMs)}
          </p>

          <div className="memo-podcast-scrubber">
            <span className="memo-podcast-clock">{formatClock(elapsedMs)}</span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.round(totalMs))}
              value={Math.min(Math.round(elapsedMs), Math.max(1, Math.round(totalMs)))}
              aria-label={t("podcast.seek")}
              onChange={(event) => seekTo(Number(event.currentTarget.value))}
            />
            <span className="memo-podcast-clock">{formatClock(totalMs)}</span>
          </div>

          <div className="memo-podcast-controls">
            <button
              type="button"
              className="memo-podcast-control"
              onClick={() => skip(-SKIP_SECONDS)}
              aria-label={t("podcast.back10")}
            >
              <Msym name="replay_10" size="1.4rem" fill={false} weight={500} />
            </button>

            <button
              type="button"
              className="memo-podcast-control primary"
              onClick={togglePlayback}
              aria-label={t(isPlaying ? "podcast.pause" : "podcast.play")}
              disabled={preparingIndex !== null}
            >
              <Msym
                name={preparingIndex !== null ? "progress_activity" : isPlaying ? "pause" : "play_arrow"}
                size="1.7rem"
                fill
                weight={500}
              />
            </button>

            <button
              type="button"
              className="memo-podcast-control"
              onClick={() => skip(SKIP_SECONDS)}
              aria-label={t("podcast.forward10")}
            >
              <Msym name="forward_10" size="1.4rem" fill={false} weight={500} />
            </button>

          </div>

          {preparingIndex !== null ? (
            <p className="memo-podcast-hint" role="status">
              {t("podcast.status.preparingTurn")}
            </p>
          ) : null}

          {error ? <p className="memo-inline-error">{error}</p> : null}

          {/*
            * No voices here. They are picked on the way in, and a listener who is already
            * listening has answered that question — leaving the pickers under the transport
            * turned the player into a settings screen with a play button on it. Changing a
            * host is still one tap away: the way back to the episodes is below, and the
            * chooser is one more from there.
            */}
          <div className="memo-podcast-footer">
            {/*
              * Out of the player, and back to the episodes rather than past them to the chooser.
              *
              * The library is the hub: from it you reach any episode in one tap and the chooser in
              * one more. Sending this button straight to the chooser instead left the only route
              * back to the other episodes running through making a new one — reachable, but by a
              * door marked something else.
              */}
            <button type="button" className="memo-podcast-secondary" onClick={leavePlayer}>
              <Msym name="arrow_back" size="1.1rem" fill={false} weight={500} />
              <span>{t("podcast.library.back")}</span>
            </button>
          </div>
        </>
      ) : view === "loading" ? (
        /*
         * Held still until the first status load says which screen this is. Rendering the chooser
         * meanwhile is what made the tab open on "make a new one" and flick to the library.
         */
        <div className="memo-podcast-loading" role="status" aria-label={t("common.loading")}>
          <Msym name="progress_activity" size="1.5rem" fill={false} weight={500} />
        </div>
      ) : isProducing ? (
        <>
          <h2 className="memo-podcast-title">{t("podcast.status.writing")}</h2>
          <p className="memo-podcast-subtitle">{t("podcast.status.writingHint")}</p>
          <div
            className="memo-podcast-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(writingPercent)}
          >
            <span style={{ width: `${writingPercent}%` }} />
          </div>
        </>
      ) : (
        <>
          {/*
            * The chooser carries no heading, no artwork and no standfirst: the pill row above it
            * already reads "Podcast", the note's own title is above that, and four labelled cards
            * do not need to be introduced. It is a form, and the other two screens are about an
            * episode — which is the whole difference between them.
            */}
          {view === "library" ? (
            <>
              <h2 className="memo-podcast-title">{t("podcast.title")}</h2>
              <p className="memo-podcast-subtitle memo-podcast-intro">{t("podcast.intro")}</p>
            </>
          ) : null}

          {episodes.length > 0 && !isChoosing ? (
            <div className="memo-podcast-setup">
              {/*
                * What this note already has. Shown instead of the chooser rather than above it,
                * because both together cannot fit one screen on a phone — and because somebody
                * who has made an episode is far more often coming back to it than making another.
                */}
              <div className="memo-podcast-library" role="list">
                {episodes.map((episode) => {
                  const shown = getPodcastFormat(episode.format);

                  return (
                    <button
                      key={episode.id}
                      type="button"
                      role="listitem"
                      className={`memo-podcast-episode ${
                        openingEpisodeId === episode.id ? "opening" : ""
                      }`.trim()}
                      disabled={openingEpisodeId !== null}
                      onClick={() => openEpisode(episode)}
                    >
                      <span className="memo-podcast-episode-voices" aria-hidden="true">
                        <span style={{ "--podcast-hue": podcastVoiceHue(voices.a) } as CSSProperties} />
                        {shown.speakerCount === 2 ? (
                          <span style={{ "--podcast-hue": podcastVoiceHue(voices.b) } as CSSProperties} />
                        ) : null}
                      </span>
                      <span className="memo-podcast-episode-text">
                        <span className="memo-podcast-episode-title">
                          {episode.title ?? t("podcast.title")}
                        </span>
                        <span className="memo-podcast-episode-meta">
                          {t(shown.labelKey)} ·{" "}
                          {t("podcast.minutes", {
                            count: Math.max(1, Math.round(episode.estimatedSeconds / 60)),
                          })}
                        </span>
                      </span>
                      <Msym
                        name={openingEpisodeId === episode.id ? "progress_activity" : "play_arrow"}
                        size="1.3rem"
                        fill={openingEpisodeId !== episode.id}
                        weight={500}
                      />
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="memo-podcast-secondary"
                onClick={() => setIsChoosing(true)}
              >
                <Msym name="add" size="1.1rem" fill={false} weight={500} />
                <span>{t("podcast.newEpisode")}</span>
              </button>
            </div>
          ) : (
          <div className="memo-podcast-setup">
            <div className="memo-podcast-formats" role="radiogroup" aria-label={t("podcast.format.label")}>
              {PODCAST_FORMATS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={format === option.id}
                  className={`memo-podcast-format ${format === option.id ? "active" : ""}`.trim()}
                  onClick={() => chooseFormat(option.id)}
                >
                  <Msym name={option.icon} size="1.15rem" fill={false} weight={500} />
                  <span className="memo-podcast-format-label">{t(option.labelKey)}</span>
                </button>
              ))}
            </div>

            {/*
              * One description, for the show that is actually selected.
              *
              * All four at once was four paragraphs of prose above the thing being chosen, and
              * on a phone it was most of the screen — a wall of text to make a choice between
              * four short names. The names and the icons carry the choice; this line carries
              * what the name does not, for the one card the eye is on.
              */}
            <p className="memo-podcast-format-hint">{t(getPodcastFormat(format).descriptionKey)}</p>

            <div className="memo-podcast-lengths" role="radiogroup" aria-label={t("podcast.length.label")}>
              {PODCAST_LENGTHS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={length === option.id}
                  className={`memo-podcast-length ${length === option.id ? "active" : ""}`.trim()}
                  onClick={() => chooseLength(option.id)}
                >
                  <span>{t(option.labelKey)}</span>
                  <span className="memo-podcast-length-minutes">
                    {t("podcast.minutes", { count: estimatedPodcastMinutes(option.id) })}
                  </span>
                </button>
              ))}
            </div>

            <div className="memo-podcast-voice-picker">
              {voiceRow("a")}
              {speakerCount === 2 ? voiceRow("b") : null}
            </div>

              {error ? <p className="memo-inline-error">{error}</p> : null}

            <button type="button" className="memo-podcast-start" onClick={() => void requestScript()}>
              <Msym name="graphic_eq" size="1.2rem" fill={false} weight={500} />
              <span>{t("podcast.generate")}</span>
            </button>

            {/*
              * Shown when there is a screen behind this one — which is what `isChoosing` means:
              * the listener pressed "New episode" to get here. Gating it on whether the note has
              * episodes was wrong twice over: it is a fact about data rather than about where you
              * came from, and it can change underneath you, so the way back could vanish while
              * you were looking at it. When the chooser IS the landing screen, there is genuinely
              * nothing behind it and no button pretends otherwise.
              */}
            {isChoosing ? (
              <button
                type="button"
                className="memo-podcast-secondary"
                onClick={() => setIsChoosing(false)}
              >
                <Msym name="arrow_back" size="1.1rem" fill={false} weight={500} />
                <span>{t("podcast.library.back")}</span>
              </button>
            ) : null}
          </div>
          )}

          {status?.usage && !status.usage.hasUnlimitedUsage ? (
            <p className="memo-podcast-hint">
              {t("podcast.usage.remaining", {
                minutes: Math.max(0, Math.floor(status.usage.remainingSeconds / 60)),
              })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
