"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import {
  DEFAULT_NOTE_TTS_PLAYBACK_RATE,
  NOTE_TTS_PLAYBACK_RATES,
  NOTE_TTS_VOICES,
  type NoteTtsPlaybackRate,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";
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
import { stripAudioTags } from "@/lib/tutor/turn-audio";
import { voiceHue } from "@/lib/tutor/voice-colors";
import { voiceSampleClip } from "@/lib/tutor/voice-clips";

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

type PodcastStatus = {
  available: boolean;
  reason: string | null;
  language?: string;
  podcast: PodcastPayload | null;
  tier: "paid" | "free";
  limitSeconds: number;
  secondsUsed: number;
  remainingSeconds: number;
  hasUnlimitedUsage: boolean;
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
}: {
  lectureId: string;
  isReady: boolean;
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
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const [currentIndex, setCurrentIndex] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rate, setRate] = useState<NoteTtsPlaybackRate>(DEFAULT_NOTE_TTS_PLAYBACK_RATE);
  const [preparingIndex, setPreparingIndex] = useState<number | null>(null);
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  const [openVoiceSlot, setOpenVoiceSlot] = useState<PodcastSpeaker | null>(null);
  /* Bumped whenever the segment cache changes, so the render reads the ref's new contents. */
  const [segmentVersion, setSegmentVersion] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const segmentsRef = useRef(new Map<number, LoadedSegment>());
  const pendingRef = useRef(new Map<number, Promise<LoadedSegment | null>>());
  const inFlightRef = useRef(0);
  /* Recomputed every render; read inside the limiter, which must not be rebuilt per keystroke. */
  const concurrencyRef = useRef(segmentRequestAllowance({ bufferedAhead: 0, rate: 1 }));
  const previewPlayerRef = useRef<TutorClipPlayer | null>(null);
  const previewTokenRef = useRef(0);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const activeTurnRef = useRef<HTMLButtonElement | null>(null);
  /* Read inside callbacks that must not be rebuilt every time a voice changes. */
  const voicesRef = useRef(voices);
  const podcastRef = useRef<PodcastPayload | null>(null);
  const isPlayingRef = useRef(false);

  voicesRef.current = voices;
  podcastRef.current = podcast;
  isPlayingRef.current = isPlaying;

  /*
   * How much of the episode is already made, counted forward from the turn playing. Read from
   * the ref rather than from state because the cache is not reactive; `segmentVersion` is what
   * says it changed, and it is a dependency of everything that renders from this.
   */
  let bufferedAhead = 0;

  while (segmentsRef.current.has(currentIndex + bufferedAhead + 1)) {
    bufferedAhead += 1;
  }

  concurrencyRef.current = segmentRequestAllowance({ bufferedAhead, rate });

  /* Memoized so the derived durations and the prefetch effect do not rebuild on every render. */
  const turns = useMemo(() => podcast?.turns ?? [], [podcast]);
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

  const stopPlayback = useCallback(() => {
    const element = audioRef.current;

    if (element) {
      element.pause();
      element.removeAttribute("src");
      element.load();
    }

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
      audioRef.current?.pause();
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

      try {
        const response = await fetch(`/api/lectures/${lectureId}/podcast?${query.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return null;
        }

        const payload = (await response.json()) as PodcastStatus;

        setStatus(payload);
        setPodcast(payload.podcast);

        if (payload.podcast?.status === "ready") {
          setIsWriting(false);
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
  useEffect(() => {
    if (!settingsRestored || !isReady) {
      return;
    }

    stopPlayback();
    releaseSegments();
    pendingRef.current.clear();
    setCurrentIndex(0);
    setPositionMs(0);
    setPodcast(null);
    setError(null);
    setLimitReached(false);
    setScriptAttempts(0);
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
        body: JSON.stringify({ format, length }),
      });

      if (response.status === 202) {
        /* Another request is already writing this one; the poll below picks it up. */
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | { podcast?: PodcastPayload; error?: string }
        | null;

      if (!response.ok || !payload?.podcast) {
        setIsWriting(false);
        setError(payload?.error ?? t("podcast.error.script"));
        return;
      }

      setPodcast(payload.podcast);
      setIsWriting(false);
      setCurrentIndex(0);
      setPositionMs(0);
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
          if (payload?.code === "tts_daily_limit_reached") {
            setLimitReached(true);
          }

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

      const element = audioRef.current;

      if (!element) {
        return;
      }

      element.src = segment.objectUrl;
      element.playbackRate = rate;
      element.currentTime = offsetMs / 1000;

      try {
        await element.play();
        setIsPlaying(true);
      } catch {
        /* A play() the browser refused because the gesture was spent: leave it paused, not broken. */
        setIsPlaying(false);
      }
    },
    [ensureSegment, rate, t],
  );

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

  /* The transcript follows the voice, so the line being spoken is the line on screen. */
  useEffect(() => {
    const active = activeTurnRef.current;
    const scroller = transcriptRef.current;

    if (!active || !scroller) {
      return;
    }

    const activeBox = active.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();

    if (activeBox.top < scrollerBox.top || activeBox.bottom > scrollerBox.bottom) {
      active.scrollIntoView({
        block: "center",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }, [currentIndex]);

  useEffect(() => {
    const element = audioRef.current;

    if (element) {
      element.playbackRate = rate;
    }
  }, [rate]);

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
      await player.play(voiceSampleClip(next, language));
    } catch {
      if (token === previewTokenRef.current) {
        setPreviewVoice(null);
      }
    }
  }

  function togglePlayback() {
    const element = audioRef.current;

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

    if (located.index === currentIndex && audioRef.current?.src) {
      audioRef.current.currentTime = located.offsetMs / 1000;
      setPositionMs(located.offsetMs);
      return;
    }

    void playSegment(located.index, located.offsetMs);
  }

  function seekTo(targetMs: number) {
    const located = locateAt(targetMs);

    if (located.index === currentIndex && audioRef.current?.src) {
      audioRef.current.currentTime = located.offsetMs / 1000;
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

  const hasEpisode = Boolean(podcast && podcast.status === "ready" && turns.length > 0);
  const activeFormat = getPodcastFormat(format);

  const cover = (
    <div className="memo-podcast-cover" aria-hidden="true">
      <span
        className="memo-podcast-orb primary"
        style={{ "--podcast-hue": voiceHue(voices.a) } as CSSProperties}
      />
      {speakerCount === 2 ? (
        <span
          className="memo-podcast-orb secondary"
          style={{ "--podcast-hue": voiceHue(voices.b) } as CSSProperties}
        />
      ) : null}
    </div>
  );

  const voiceRow = (speaker: PodcastSpeaker) => (
    <div className="memo-podcast-voice-slot">
      <button
        type="button"
        className="memo-podcast-voice-current"
        style={{ "--podcast-hue": voiceHue(voices[speaker]) } as CSSProperties}
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
              style={{ "--podcast-hue": voiceHue(option) } as CSSProperties}
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
      {/* One element for the whole episode: turns are swapped into it as they are reached. */}
      <audio
        ref={audioRef}
        preload="auto"
        onTimeUpdate={(event) => setPositionMs(event.currentTarget.currentTime * 1000)}
        onEnded={() => {
          const next = currentIndex + 1;

          if (next < turns.length) {
            void playSegment(next, 0);
            return;
          }

          setIsPlaying(false);
          setPositionMs(durationOf(currentIndex));
        }}
      />

      {cover}

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

            <div className="memo-podcast-rates" role="group" aria-label={t("podcast.speed")}>
              {NOTE_TTS_PLAYBACK_RATES.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`memo-podcast-rate ${rate === option ? "active" : ""}`.trim()}
                  onClick={() => setRate(option)}
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>

          {preparingIndex !== null ? (
            <p className="memo-podcast-hint" role="status">
              {t("podcast.status.preparingTurn")}
            </p>
          ) : null}

          {limitReached ? <p className="memo-inline-error">{t("podcast.limitReached")}</p> : null}
          {error ? <p className="memo-inline-error">{error}</p> : null}

          <div className="memo-podcast-transcript" ref={transcriptRef}>
            {turns.map((turn, index) => (
              <button
                key={index}
                type="button"
                ref={index === currentIndex ? activeTurnRef : undefined}
                className={`memo-podcast-line ${index === currentIndex ? "active" : ""} ${
                  index < currentIndex ? "spoken" : ""
                }`.trim()}
                style={{ "--podcast-hue": voiceHue(voices[turn.speaker]) } as CSSProperties}
                onClick={() => void playSegment(index, 0)}
              >
                <span className="memo-podcast-line-speaker">{voices[turn.speaker]}</span>
                {/* The tags are performed as sounds, never spoken, so they are not shown either. */}
                <span className="memo-podcast-line-text">{stripAudioTags(turn.text)}</span>
              </button>
            ))}
          </div>

          <div className="memo-podcast-footer">
            {voiceRow("a")}
            {speakerCount === 2 ? voiceRow("b") : null}

            <button
              type="button"
              className="memo-podcast-secondary"
              onClick={() => {
                stopPlayback();
                releaseSegments();
                setPodcast(null);
                setCurrentIndex(0);
                setPositionMs(0);
              }}
            >
              <Msym name="tune" size="1.1rem" fill={false} weight={500} />
              <span>{t("podcast.changeShow")}</span>
            </button>
          </div>
        </>
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
          <h2 className="memo-podcast-title">{t("podcast.title")}</h2>
          <p className="memo-podcast-subtitle">{t("podcast.intro")}</p>

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
                <Msym name={option.icon} size="1.3rem" fill={false} weight={500} />
                <span className="memo-podcast-format-label">{t(option.labelKey)}</span>
                <span className="memo-podcast-format-description">{t(option.descriptionKey)}</span>
                <span className="memo-podcast-format-voices">
                  {t(option.speakerCount === 1 ? "podcast.oneVoice" : "podcast.twoVoices")}
                </span>
              </button>
            ))}
          </div>

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

          {status && !status.hasUnlimitedUsage ? (
            <p className="memo-podcast-hint">{t("podcast.usage.note")}</p>
          ) : null}
        </>
      )}
    </div>
  );
}
