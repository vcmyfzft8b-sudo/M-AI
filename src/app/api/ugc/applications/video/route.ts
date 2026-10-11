import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { captureRouteError } from "@/lib/monitoring";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request-validation";
import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import {
  APPLICATION_VIDEO_BUCKET,
  APPLICATION_VIDEO_MAX_BYTES,
  APPLICATION_VIDEO_TYPES,
} from "@/lib/ugc/creator-application";

const ROUTE = "api:ugc:applications:video:post";

const requestSchema = z.object({
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

/**
 * A place to upload one sample video for a creator application.
 *
 * The browser uploads straight to storage on the signed URL this returns — a phone
 * video is far past Vercel's 4.5 MB request limit — and then sends the path with the
 * application. The bucket enforces the size and type itself; the checks here only
 * save someone a long upload that storage would refuse at the end.
 */
export async function POST(request: Request) {
  const limited = await enforceRateLimit({
    request,
    route: ROUTE,
    rules: rateLimitPresets.creatorApplicationVideo,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, requestSchema, { maxBytes: 512 });

  if (!parsed.success) {
    return parsed.response;
  }

  const contentType = parsed.data.contentType.toLowerCase();
  const extension = APPLICATION_VIDEO_TYPES[contentType];

  if (!extension) {
    return NextResponse.json({ error: "type" }, { status: 400 });
  }

  if (parsed.data.size > APPLICATION_VIDEO_MAX_BYTES) {
    return NextResponse.json({ error: "size" }, { status: 400 });
  }

  const path = `pending/${randomUUID()}.${extension}`;
  const { data, error } = await createSupabaseServiceRoleClient()
    .storage.from(APPLICATION_VIDEO_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data?.token) {
    captureRouteError(error ?? new Error("Signed application video upload URL missing"), {
      route: ROUTE,
      operation: "application_video_upload_target",
      request,
    });

    return NextResponse.json({ error: "unavailable" }, { status: 500 });
  }

  return NextResponse.json({ path, token: data.token });
}
