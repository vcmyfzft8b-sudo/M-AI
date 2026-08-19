import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { getOptionalUser } from "@/lib/auth";
import { enforceRateLimit } from "@/lib/rate-limit";
import { callRpc } from "@/lib/admin/db";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";

/**
 * Visitor beacon.
 *
 * Records a page view and keeps the session's `last_seen_at` fresh, which is
 * what the admin dashboard's "online now" panel reads. Deliberately stores no
 * IP address and no raw user agent: country and device class are enough for the
 * dashboard, and neither identifies a person.
 */

export const runtime = "nodejs";

/** Session cookie. Not `httpOnly`, so the client can avoid a needless beacon. */
const SESSION_COOKIE = "memo-visit";
const SESSION_MAX_AGE_SECONDS = 24 * 60 * 60;

const MAX_BODY_BYTES = 2 * 1024;

const trackSchema = z.object({
  path: z.string().min(1).max(512),
  referrer: z.string().max(2048).optional().nullable(),
  // A heartbeat keeps the session marked online without inflating page views.
  event: z.enum(["view", "heartbeat"]).default("view"),
});

/** Paths that must never appear in visitor analytics. */
function isExcludedPath(path: string): boolean {
  return (
    path.startsWith("/admin") ||
    path.startsWith("/api/") ||
    path.startsWith("/auth/") ||
    path.startsWith("/_next")
  );
}

const BOT_PATTERN =
  /bot|crawler|spider|crawling|slurp|bingpreview|headlesschrome|lighthouse|pingdom|uptime|curl|wget|python-requests|axios|node-fetch|semrush|ahrefs|facebookexternalhit|whatsapp|telegram/i;

function detectDevice(userAgent: string): "mobile" | "tablet" | "desktop" | "bot" | "unknown" {
  if (!userAgent) {
    return "unknown";
  }

  if (BOT_PATTERN.test(userAgent)) {
    return "bot";
  }

  if (/ipad|tablet|playbook|silk/i.test(userAgent)) {
    return "tablet";
  }

  if (/mobi|iphone|ipod|android.*mobile|windows phone/i.test(userAgent)) {
    return "mobile";
  }

  return "desktop";
}

function detectBrowser(userAgent: string): string | null {
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/opr\/|opera/i.test(userAgent)) return "Opera";
  if (/chrome|crios/i.test(userAgent)) return "Chrome";
  if (/firefox|fxios/i.test(userAgent)) return "Firefox";
  if (/safari/i.test(userAgent)) return "Safari";
  return null;
}

function detectOs(userAgent: string): string | null {
  if (/windows/i.test(userAgent)) return "Windows";
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod|ios/i.test(userAgent)) return "iOS";
  if (/mac os x|macintosh/i.test(userAgent)) return "macOS";
  if (/linux/i.test(userAgent)) return "Linux";
  return null;
}

function hostFromUrl(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname.replace(/^www\./, "").slice(0, 200);
  } catch {
    return null;
  }
}

/** Keeps only the pathname, so query strings never reach the database. */
function sanitizePath(value: string): { path: string; params: URLSearchParams } {
  try {
    const url = new URL(value, "https://memoai.eu");
    return { path: url.pathname.slice(0, 512), params: url.searchParams };
  } catch {
    return { path: value.split("?")[0].slice(0, 512), params: new URLSearchParams() };
  }
}

function readUtm(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value ? value.slice(0, 120) : null;
}

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit({
    request,
    route: "track:post",
    rules: [{ windowSeconds: 60, maxRequests: 120, scope: "ip", storage: "memory" }],
  });

  if (limited) {
    return limited;
  }

  const raw = await request.text();

  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false }, { status: 413 });
  }

  let parsed;

  try {
    parsed = trackSchema.safeParse(JSON.parse(raw || "{}"));
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  if (!parsed.success) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { path, params } = sanitizePath(parsed.data.path);

  if (isExcludedPath(path)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const userAgent = request.headers.get("user-agent") ?? "";
  const deviceType = detectDevice(userAgent);

  // Bots are recorded but flagged, so the dashboard aggregates can exclude them
  // while the rows remain available if a traffic spike needs explaining.
  const isBot = deviceType === "bot";

  const existingKey = request.cookies.get(SESSION_COOKIE)?.value;
  const sessionKey =
    existingKey && /^[a-f0-9-]{36}$/i.test(existingKey)
      ? existingKey
      : crypto.randomUUID();

  const user = await getOptionalUser().catch(() => null);

  const serviceRole = createSupabaseServiceRoleClient();

  const { error } = await callRpc(serviceRole, "record_site_visit", {
    p_session_key: sessionKey,
    p_user_id: user?.id ?? null,
    p_path: path,
    p_referrer_host: hostFromUrl(parsed.data.referrer),
    p_utm_source: readUtm(params, "utm_source"),
    p_utm_medium: readUtm(params, "utm_medium"),
    p_utm_campaign: readUtm(params, "utm_campaign"),
    p_country: request.headers.get("x-vercel-ip-country"),
    p_region: request.headers.get("x-vercel-ip-country-region"),
    p_city: request.headers.get("x-vercel-ip-city"),
    p_device_type: deviceType,
    p_browser: detectBrowser(userAgent),
    p_os: detectOs(userAgent),
    p_is_bot: isBot,
    p_count_page_view: parsed.data.event === "view",
  });

  // Analytics must never surface as an error to a visitor mid-navigation.
  const response = NextResponse.json({ ok: !error });

  response.cookies.set(SESSION_COOKIE, sessionKey, {
    maxAge: SESSION_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return response;
}
