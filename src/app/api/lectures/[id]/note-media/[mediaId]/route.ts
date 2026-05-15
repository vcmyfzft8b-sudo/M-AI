import { NextResponse } from "next/server";

import { STORAGE_BUCKET } from "@/lib/constants";
import { ensureUserOwnsLecture } from "@/lib/lectures";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient, createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { routeIdParamSchema, uuidSchema } from "@/lib/validation";

const mediaParamsSchema = routeIdParamSchema.extend({
  mediaId: uuidSchema,
});

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; mediaId: string }> },
) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:lectures:note-media:get",
    rules: rateLimitPresets.detailRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = mediaParamsSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID slike." }, { status: 400 });
  }

  const { id, mediaId } = parsedParams.data;
  const lecture = await ensureUserOwnsLecture({
    lectureId: id,
    user,
  });

  if (!lecture) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  const service = createSupabaseServiceRoleClient();
  const { data: media, error: mediaError } = await service
    .from("lecture_note_media")
    .select("storage_path")
    .eq("id", mediaId)
    .eq("lecture_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mediaError) {
    return NextResponse.json({ error: mediaError.message }, { status: 500 });
  }

  if (!media) {
    return NextResponse.json({ error: "Slika ni najdena." }, { status: 404 });
  }

  const { data: signed, error: signedError } = await service.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl((media as { storage_path: string }).storage_path, 10 * 60);

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json(
      { error: signedError?.message ?? "Slike ni bilo mogoče odpreti." },
      { status: 500 },
    );
  }

  return NextResponse.redirect(signed.signedUrl, 307);
}
