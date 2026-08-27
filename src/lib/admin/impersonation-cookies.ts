// Kept free of "server-only" so the cookie contract stays unit-testable
// (tests/admin-impersonation.test.mjs) outside the Next.js runtime.

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Holds the admin's own session while they are inside someone else's account, so coming back
 * needs no re-login.
 *
 * Both cookies are `httpOnly`, but confidentiality is not the property that matters most here —
 * **integrity is**. The restore cookie is fed to `setSession`, so a browser that can be made to
 * present a forged one would be signed in as whoever forged it. Worse, sign-out consults this
 * cookie before it clears anything, which would turn the sign-out button into a sign-in-as-
 * attacker button. Every payload is therefore signed with a server-held key and rejected unless
 * the signature verifies.
 */
export const ADMIN_RESTORE_COOKIE = "memoai-admin-restore";

/**
 * Names the account currently being impersonated. Signed like the restore cookie: an unsigned one
 * would let anyone paint a convincing "Viewing as <someone>" badge over their own session.
 */
export const IMPERSONATION_COOKIE = "memoai-impersonating";

export type AdminRestorePayload = {
  accessToken: string;
  refreshToken: string;
  adminEmail: string | null;
};

export type ImpersonationPayload = {
  targetUserId: string;
  targetEmail: string | null;
  adminEmail: string | null;
  startedAt: string;
};

/** `<base64url payload>.<base64url HMAC>` — JSON alone would not survive the cookie grammar. */
export function signCookiePayload(payload: unknown, secret: Buffer | string) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");

  return `${body}.${signature}`;
}

function verifyCookiePayload(value: string | undefined, secret: Buffer | string): unknown {
  if (!value) {
    return null;
  }

  const separator = value.lastIndexOf(".");

  if (separator <= 0) {
    return null;
  }

  const body = value.slice(0, separator);
  const provided = Buffer.from(value.slice(separator + 1), "base64url");
  const expected = createHmac("sha256", secret).update(body).digest();

  // Length check first: timingSafeEqual throws on a mismatch rather than returning false.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Returns the admin's stored session, or null when the cookie is absent, forged or malformed. */
export function parseAdminRestorePayload(
  value: string | undefined,
  secret: Buffer | string,
): AdminRestorePayload | null {
  const record = asRecord(verifyCookiePayload(value, secret));

  if (!record) {
    return null;
  }

  const accessToken = typeof record.accessToken === "string" ? record.accessToken : "";
  const refreshToken = typeof record.refreshToken === "string" ? record.refreshToken : "";

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    adminEmail: typeof record.adminEmail === "string" ? record.adminEmail : null,
  };
}

export function parseImpersonationPayload(
  value: string | undefined,
  secret: Buffer | string,
): ImpersonationPayload | null {
  const record = asRecord(verifyCookiePayload(value, secret));

  if (!record) {
    return null;
  }

  const targetUserId = typeof record.targetUserId === "string" ? record.targetUserId : "";

  if (!targetUserId) {
    return null;
  }

  return {
    targetUserId,
    targetEmail: typeof record.targetEmail === "string" ? record.targetEmail : null,
    adminEmail: typeof record.adminEmail === "string" ? record.adminEmail : null,
    startedAt: typeof record.startedAt === "string" ? record.startedAt : "",
  };
}

/** Applied to both cookies: server-only, first-party, and gone when the browser closes. */
export const IMPERSONATION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;
