"use client";

import { cn } from "@/lib/utils";

/**
 * The level meter under the recording clock.
 *
 * It does not read the microphone. It used to take a `MediaStream` and ignore
 * it, and there is now nothing to take: inside the iOS app the audio never
 * reaches the page at all — it is captured natively so the recording survives
 * the screen locking. What the row has to say is that the app is still
 * listening, and five coral bars moving at their own speeds say it in both
 * places without a decoder.
 */
export function LiveAudioWave({ active }: { active: boolean }) {
  return (
    <div aria-hidden="true" className={cn("memo-record-level", !active && "paused")}>
      {[0, 1, 2, 3, 4].map((bar) => (
        <span key={bar} />
      ))}
    </div>
  );
}
