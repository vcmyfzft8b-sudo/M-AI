/**
 * Native audio capture, exposed by the iOS app shell.
 *
 * In a browser this is always `null` and callers fall back to `MediaRecorder`. Inside the app it
 * matters a great deal: WebKit ends a `MediaRecorder` track the moment the web view stops being
 * frontmost, so locking the phone or switching apps silently truncates a lecture. The native
 * recorder keeps running, and drives the Lock Screen activity while it does.
 *
 * The finished audio comes back as an ordinary `File`, so everything downstream — lecture
 * creation, the signed upload, billing, processing — is the same code either way.
 */

export type NativeRecording = {
  url: string;
  durationSeconds: number;
  mimeType: string;
  fileName: string;
};

export type NativeRecorder = {
  start: () => Promise<{ ok: boolean }>;
  pause: () => Promise<{ ok: boolean; elapsed: number }>;
  resume: () => Promise<{ ok: boolean; elapsed: number }>;
  cancel: () => Promise<{ ok: boolean }>;
  stop: () => Promise<NativeRecording>;
  state: () => Promise<{ isRecording: boolean; elapsed: number }>;
  toFile: (recording: NativeRecording) => Promise<File>;
};

type MemoNativeBridge = {
  platform: string;
  recorder?: NativeRecorder;
};

declare global {
  interface Window {
    MemoNative?: MemoNativeBridge;
  }
}

/** The native recorder, or `null` when running anywhere other than the iOS app. */
export function getNativeRecorder(): NativeRecorder | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.MemoNative?.recorder ?? null;
}
