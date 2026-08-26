// Kept free of "server-only" so the cookie contract stays unit-testable
// (tests/admin-impersonation.test.mjs) outside the Next.js runtime.

/**
 * Holds the admin's own session while they are inside someone else's account, so coming back
 * needs no re-login. It carries the admin's *own* tokens — the same material their normal auth
 * cookie holds — so it is written `httpOnly`/`secure` and grants nothing their ordinary session
 * does not already grant.
 */
export const ADMIN_RESTORE_COOKIE = "memoai-admin-restore";

/**
 * Names the account currently being impersonated. Readable by the server only; the banner is
 * rendered server-side from it, so the value never reaches client JavaScript.
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

/**
 * Cookie values are base64url JSON: the payloads carry emails, and a raw JSON cookie would be
 * rejected or mangled by the `;`/`,` rules of the cookie grammar.
 */
export function encodeCookiePayload(payload: unknown) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCookiePayload(value: string | undefined): unknown {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Returns the admin's stored session, or null when the cookie is absent or malformed. */
export function parseAdminRestorePayload(value: string | undefined): AdminRestorePayload | null {
  const record = asRecord(decodeCookiePayload(value));

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

export function parseImpersonationPayload(value: string | undefined): ImpersonationPayload | null {
  const record = asRecord(decodeCookiePayload(value));

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
