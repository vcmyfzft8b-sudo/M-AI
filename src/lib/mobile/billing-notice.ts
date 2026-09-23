/**
 * The notice for a failed Apple purchase or restore. The server answers 409
 * when the Apple purchase belongs to a different Memo account, and the native
 * bridge carries that status in its error text; retrying would never help.
 */
export function nativeBillingFailureKey(error: unknown): "native.otherAccount" | "native.verifyFailed" {
  const text = error instanceof Error ? error.message : String(error ?? "");
  return /\bserver 409\b/.test(text) ? "native.otherAccount" : "native.verifyFailed";
}
