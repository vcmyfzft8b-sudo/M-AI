"use client";

/*
 * Lecture capture inside the iOS app.
 *
 * `MediaRecorder` cannot be used there: iOS suspends the web content process
 * when the screen locks and ends the microphone track with it, so a lecture
 * recorded through the page stops the moment the phone goes dark — silently,
 * with no error and a file that is however many minutes long the student
 * happened to leave the screen on for. The app records instead, on an audio
 * session of its own, and shows a Lock Screen banner for as long as it runs.
 * This module is the page's half of that: it drives the recorder and collects
 * the finished file.
 */

import { isNativeIOS, nativeRequest } from "./client";

export type NativeRecorderSnapshot = {
  state: "idle" | "recording" | "paused";
  /** Seconds of audio captured — the app's count, not the page's. */
  elapsed: number;
  /** Paused by a call or another app rather than by the user. */
  interrupted: boolean;
  /** False when Live Activities are switched off for Memo in Settings. */
  bannerAvailable: boolean;
};

/**
 * The bridge version that added the recorder. The page ships independently of
 * the binary, so an installed older build has to be left on the web recorder
 * rather than sent commands it will reject.
 */
const RECORDER_BRIDGE_VERSION = 2;

/**
 * Bytes of audio per bridge message. The finished file crosses as base64, and
 * at this bitrate the three-hour upload limit is ~43 MB — one message that size
 * is a memory spike on both sides, so it travels in slices instead.
 */
const CHUNK_BYTES = 2 * 1024 * 1024;

export function isNativeRecorderAvailable() {
  return (
    isNativeIOS() &&
    typeof window !== "undefined" &&
    (window.memoNative?.version ?? 0) >= RECORDER_BRIDGE_VERSION
  );
}

export async function startNativeRecording() {
  return await nativeRequest<NativeRecorderSnapshot>("recorderStart");
}

export async function pauseNativeRecording() {
  return await nativeRequest<NativeRecorderSnapshot>("recorderPause");
}

export async function resumeNativeRecording() {
  return await nativeRequest<NativeRecorderSnapshot>("recorderResume");
}

export async function readNativeRecordingState() {
  return await nativeRequest<NativeRecorderSnapshot>("recorderState");
}

/** Ends a take and drops it. Used when the modal closes mid-recording. */
export async function discardNativeRecording() {
  await nativeRequest<{ status: string }>("recorderDiscard");
}

/**
 * Stops the recorder and pulls the finished audio across the bridge.
 *
 * The file is deleted from the phone once every slice is in hand — and only
 * then, so a failed transfer leaves the recording where it is rather than
 * throwing a lecture away.
 */
export async function stopNativeRecording(
  onProgress?: (fraction: number) => void,
): Promise<{ file: File; durationSeconds: number }> {
  const stopped = await nativeRequest<{
    fileName: string;
    mimeType: string;
    size: number;
    elapsed: number;
  }>("recorderStop");

  const parts: BlobPart[] = [];
  let offset = 0;

  while (offset < stopped.size) {
    const chunk = await nativeRequest<{ data: string; length: number }>("recorderRead", {
      offset,
      length: Math.min(CHUNK_BYTES, stopped.size - offset),
    });

    // A read that returns nothing would otherwise spin here forever.
    if (!chunk.length) {
      throw new Error("The recording could not be read from the device.");
    }

    parts.push(decodeChunk(chunk.data));
    offset += chunk.length;
    onProgress?.(offset / stopped.size);
  }

  await discardNativeRecording();

  const file = new File([new Blob(parts, { type: stopped.mimeType })], stopped.fileName, {
    type: stopped.mimeType,
  });

  // Never zero. A duration the page cannot vouch for sends the upload path off
  // to read the container's own metadata, and a blob <audio> element in this
  // web view can stall there without ever erroring.
  return { file, durationSeconds: Math.max(stopped.elapsed, 1) };
}

function decodeChunk(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
