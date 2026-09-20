import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { isNativeUserAgent } from "@/lib/mobile/runtime";
import { applePushConfigured } from "@/lib/mobile/apns";
import { forgetPushDevice, registerPushDevice } from "@/lib/mobile/push";

/**
 * Where to reach a signed-in learner's phone.
 *
 * The app posts here once iOS has given it a device token, and again on sign
 * out to take it away. A browser has no business doing either, so both verbs
 * are closed to anything but the wrapper — presentation-level gating on top of
 * the session check, never instead of it.
 */

// An APNs token is 32 bytes of hex today and Apple has said it may grow, so
// the bound is generous; what matters is that it is hex and not a sentence.
const tokenSchema = z.string().regex(/^[0-9a-f]{64,200}$/i);

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });
  if (!isNativeUserAgent(request.headers.get("user-agent"))) return new NextResponse(null, { status: 404 });
  if (!applePushConfigured()) return NextResponse.json({ error: "push_unavailable" }, { status: 503 });

  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyCookies(new NextResponse(null, { status: 401 }));

  const parsed = await parseJsonRequest(request, z.object({
    token: tokenSchema,
    environment: z.enum(["production", "sandbox"]),
    locale: z.string().max(16).nullable().optional(),
  }).strict(), { maxBytes: 1024 });
  if (!parsed.success) return parsed.response;

  try {
    await registerPushDevice({
      userId: user.id,
      token: parsed.data.token.toLowerCase(),
      environment: parsed.data.environment,
      locale: parsed.data.locale ?? null,
    });
  } catch {
    return applyCookies(NextResponse.json({ error: "not_saved" }, { status: 503, headers: { "Cache-Control": "no-store" } }));
  }
  return applyCookies(NextResponse.json({ registered: true }, { headers: { "Cache-Control": "no-store" } }));
}

/**
 * Sign-out. Deliberately does not require the session to still be valid: the
 * app calls this as it is signing out, and a token left behind would notify
 * the wrong person on a shared phone. Knowing the token is the authorization —
 * it is a device secret, and the only thing it can do here is silence itself.
 */
export async function DELETE(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });
  if (!isNativeUserAgent(request.headers.get("user-agent"))) return new NextResponse(null, { status: 404 });

  const parsed = await parseJsonRequest(request, z.object({ token: tokenSchema }).strict(), { maxBytes: 1024 });
  if (!parsed.success) return parsed.response;

  try {
    await forgetPushDevice(parsed.data.token.toLowerCase());
  } catch {
    return NextResponse.json({ error: "not_removed" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ removed: true }, { headers: { "Cache-Control": "no-store" } });
}
