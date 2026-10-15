"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

import { useTranslations } from "@/components/i18n-provider";
import { TutorClipPlayer } from "@/lib/tutor/clip-player";
import { voiceSampleClip } from "@/lib/tutor/voice-clips";
import { voiceHue } from "@/lib/tutor/voice-colors";
import { NOTE_TTS_VOICE_STORAGE_KEY, NOTE_TTS_VOICES, type NoteTtsVoice } from "@/lib/note-tts-settings";

/**
 * The tutor's own voice picker, for the exam's spoken screens: each voice in its colour, and a tap
 * plays its sample (the tutor's pre-rendered one: free and instant) and keeps it as the learner's
 * voice for the tutor too, since it is the same setting.
 */
export function ExamVoicePicker({
  voice,
  onChange,
  label,
}: {
  voice: NoteTtsVoice;
  onChange: (voice: NoteTtsVoice) => void;
  label: string;
}) {
  const { locale } = useTranslations();
  /* The voice whose sample is playing, as in the tutor's picker. */
  const [previewVoice, setPreviewVoice] = useState<NoteTtsVoice | null>(null);
  const clipRef = useRef<TutorClipPlayer | null>(null);
  const clipTokenRef = useRef(0);

  useEffect(() => () => clipRef.current?.destroy(), []);

  async function audition(next: NoteTtsVoice) {
    onChange(next);
    clipTokenRef.current += 1;
    const token = clipTokenRef.current;
    clipRef.current?.stop();

    try {
      window.localStorage.setItem(NOTE_TTS_VOICE_STORAGE_KEY, next);
    } catch {
      /* The choice still holds for this screen. */
    }

    if (!clipRef.current) {
      clipRef.current = new TutorClipPlayer();
    }

    const player = clipRef.current;
    setPreviewVoice(next);
    player.onEnded = () => {
      if (token === clipTokenRef.current) {
        setPreviewVoice(null);
      }
    };

    try {
      await player.play(voiceSampleClip(next, locale));
    } catch {
      if (token === clipTokenRef.current) {
        setPreviewVoice(null);
      }
    }
  }

  return (
    <div className="memo-tutor-voices memo-exam-voices" role="radiogroup" aria-label={label}>
      {NOTE_TTS_VOICES.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={voice === option}
          className={`memo-tutor-voice ${voice === option ? "active" : ""} ${previewVoice === option ? "playing" : ""}`.trim()}
          style={{ "--voice-hue": voiceHue(option) } as CSSProperties}
          onClick={() => void audition(option)}
        >
          <span className="memo-tutor-voice-dot" aria-hidden="true" />
          <span>{option}</span>
        </button>
      ))}
    </div>
  );
}
