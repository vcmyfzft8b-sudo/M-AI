"use client";

import { isNativeUserAgent } from "./runtime";
export { useNativeIOS } from "@/components/native-provider";

export type NativeKeyboardFrame = { inset: number; height: number; target: number; keyboardHeight: number };

type NativeBridge = { version: number; readonly keyboardFrame?: NativeKeyboardFrame; request: (command: string, payload?: Record<string, unknown>) => Promise<unknown> };
declare global { interface Window { memoNative?: NativeBridge } }

export function isNativeIOS() {
  return typeof navigator !== "undefined" && isNativeUserAgent(navigator.userAgent);
}

export async function nativeRequest<T>(command: string, payload?: Record<string, unknown>): Promise<T> {
  if (!isNativeIOS() || !window.memoNative) throw new Error("Native bridge unavailable");
  return await window.memoNative.request(command, payload) as T;
}

