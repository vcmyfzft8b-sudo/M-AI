/**
 * The notice for a failed Apple purchase or restore. The server answers 409
 * when the Apple purchase belongs to a different Memo account, and the native
 * bridge carries that status in its error text; retrying would never help.
 */
export function nativeBillingFailureKey(error: unknown): "native.otherAccount" | "native.verifyFailed" {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /\bserver 409\b/.test(text) ? "native.otherAccount" : "native.verifyFailed";
}

/**
 * The technical reason the wrapper attached to a failed request ("…[server 503]"
 * or a StoreKit error), for showing beside the notice. Without it a failure
 * that is not the 409 case reads the same as every other one, and cannot be
 * told apart from a screenshot.
 */
export function nativeFailureDetail(error: unknown): string | null {
  const text = error instanceof Error ? error.message : String(error ?? "");
  const match = /\[([^\]]{1,120})\]\s*$/.exec(text);
  return match ? match[1] : null;
}
