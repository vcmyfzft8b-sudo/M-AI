import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseRouteHandlerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) return new NextResponse(null, { status: 403 });
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return applyCookies(new NextResponse(null, { status: 401 }));
  const parsed = await parseJsonRequest(request, z.object({ allow: z.boolean() }).strict(), { maxBytes: 1024 });
  if (!parsed.success) return parsed.response;
  const { error } = await supabase.auth.updateUser({ data: {
    memo_native_ai_consent: parsed.data.allow ? "v1" : null,
    memo_native_ai_consent_updated_at: new Date().toISOString(),
  } });
  return applyCookies(NextResponse.json({ saved: !error }, { status: error ? 503 : 200, headers: { "Cache-Control": "no-store" } }));
}
