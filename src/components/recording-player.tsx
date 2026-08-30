"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Msym } from "@/components/msym";

/** The rates the design's speed chip cycles through. */
const RATES = [1, 1.5, 2] as const;

const SKIP_SECONDS = 10;

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const padded = String(rest).padStart(2, "0");

  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${padded}`
    : `${minutes}:${padded}`;
}

/**
 * The recording's player above the transcript, as the redesign draws it: a
 * scrubbing track with a knob, elapsed and total either side beneath it, the
 * two skips around a filled play button, and a speed chip under those.
 *
 * The audio element itself stays in the tree — it is what actually plays — but
 * without `controls`, because the browser's own bar is not the design's.
 *
 * Key this on the source: a different recording starts from the beginning at
 * the default speed, and remounting says that more plainly than resetting four
 * pieces of state would.
 */
export function RecordingPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState<number>(RATES[0]);

  useEffect(() => {
    const audio = audioRef.current;

    if (audio) {
      audio.playbackRate = rate;
    }
  }, [rate]);

  const seekTo = useCallback((seconds: number) => {
    const audio = audioRef.current;

    if (!audio || !Number.isFinite(audio.duration)) {
      return;
    }

    const next = Math.min(Math.max(0, seconds), audio.duration);
    audio.currentTime = next;
    setElapsed(next);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;

    if (!audio) {
      return;
    }

    if (audio.paused) {
      // Autoplay can be refused; leaving the button in its paused state then
      // tells the truth about what happened.
      void audio.play().catch(() => setIsPlaying(false));
      return;
    }

    audio.pause();
  }, []);

  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0;
  const progressPercent = `${(progress * 100).toFixed(2)}%`;

  return (
    <div className="memo-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => {
          const value = event.currentTarget.duration;
          setDuration(Number.isFinite(value) ? value : 0);
          event.currentTarget.playbackRate = rate;
        }}
        onTimeUpdate={(event) => setElapsed(event.currentTarget.currentTime)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />

      {/*
       * The range sits on top of the drawn track rather than replacing it: it
       * carries the keyboard and pointer behaviour, and the track underneath
       * carries the design.
       */}
      <div className="memo-player-track">
        <div style={{ width: progressPercent }} />
        <span className="memo-player-knob" style={{ left: progressPercent }} />
        <input
          type="range"
          className="memo-player-range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={elapsed}
          disabled={!duration}
          aria-label="Premakni po posnetku"
          onChange={(event) => seekTo(Number(event.target.value))}
        />
      </div>

      <div className="memo-player-times">
        <span>{clock(elapsed)}</span>
        <span>{clock(duration)}</span>
      </div>

      <div className="memo-player-controls">
        <button
          type="button"
          className="memo-player-skip"
          aria-label={`Nazaj ${SKIP_SECONDS} s`}
          onClick={() => seekTo(elapsed - SKIP_SECONDS)}
        >
          <Msym name="replay_10" size="1.45rem" fill={false} weight={500} />
        </button>

        <button
          type="button"
          className="memo-player-play"
          aria-label={isPlaying ? "Ustavi" : "Predvajaj"}
          onClick={togglePlay}
        >
          <Msym name={isPlaying ? "pause" : "play_arrow"} size="1.9rem" fill />
        </button>

        <button
          type="button"
          className="memo-player-skip"
          aria-label={`Naprej ${SKIP_SECONDS} s`}
          onClick={() => seekTo(elapsed + SKIP_SECONDS)}
        >
          <Msym name="forward_10" size="1.45rem" fill={false} weight={500} />
        </button>
      </div>

      <div className="memo-player-rate-row">
        <button
          type="button"
          className="memo-player-rate"
          aria-label="Hitrost predvajanja"
          onClick={() => setRate((current) => RATES[(RATES.indexOf(current as 1) + 1) % RATES.length])}
        >
          <Msym name="speed" size="1.15rem" fill={false} weight={500} />
          {rate}x
        </button>
      </div>
    </div>
  );
}
