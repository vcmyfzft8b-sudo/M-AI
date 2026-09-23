import { NextResponse } from "next/server";
import { z } from "zod";
import { AppleAccountMismatch, saveAppleTransaction } from "@/lib/mobile/apple";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { tr } from "@/lib/i18n/server";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (process.env.APPLE_IAP_ENABLED !== "true") return NextResponse.json({ error: await tr("native.unavailable") }, { status: 503 });
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyCookies(NextResponse.json({ error: await tr("api.unauthorized") }, { status: 401 }));
  const limited = await enforceRateLimit({ request, userId: user.id, route: "mobile:transactions", rules: rateLimitPresets.mutate });
  if (limited) return limited;
  const body = await parseJsonRequest(request, z.object({ signedTransaction: z.string().min(1).max(24_000) }).strict(), { maxBytes: 26_000 });
  if (!body.success) return body.response;
  try {
    await saveAppleTransaction(body.data.signedTransaction, user.id, true);
    return applyCookies(NextResponse.json({ verified: true }, { headers: { "Cache-Control": "no-store" } }));
  } catch (error) {
    // 409 tells the app that retrying cannot help: another Memo account owns it.
    if (error instanceof AppleAccountMismatch) {
      return applyCookies(NextResponse.json({ error: await tr("native.otherAccount") }, { status: 409 }));
    }
    // The type only: no transaction, account or Apple payload in the log.
    console.error("Apple transaction not saved", { error: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message.slice(0, 120) : undefined });
    return applyCookies(NextResponse.json({ error: await tr("native.verifyFailed") }, { status: 503 }));
  }
}
