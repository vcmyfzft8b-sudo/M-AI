import { NextResponse } from "next/server";

import {
  collectLectureStorageObjectPaths,
  removeAccountResidualDatabaseRows,
  removeLectureStorageObjects,
} from "@/lib/account-data-cleanup";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import {
  createSupabaseRouteHandlerClient,
  createSupabaseServiceRoleClient,
} from "@/lib/supabase/server";

export async function POST(request: Request) {
  const { supabase, applyCookies } = await createSupabaseRouteHandlerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:account:delete:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const service = createSupabaseServiceRoleClient();
  let cleanup: Awaited<ReturnType<typeof collectLectureStorageObjectPaths>>;

  try {
    cleanup = await collectLectureStorageObjectPaths({
      service,
      userId: user.id,
    });
    await removeLectureStorageObjects({
      service,
      storagePaths: cleanup.storagePaths,
    });
    await removeAccountResidualDatabaseRows({
      service,
      userId: user.id,
      email: user.email,
    });
  } catch (cleanupError) {
    return NextResponse.json(
      {
        error:
          cleanupError instanceof Error
            ? cleanupError.message
            : "Podatkov računa ni bilo mogoče pripraviti za brisanje.",
      },
      { status: 500 },
    );
  }

  const { error } = await service.auth.admin.deleteUser(user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase.auth.signOut();

  return applyCookies(NextResponse.json({ ok: true, deletedStorageObjects: cleanup.storagePaths.length }));
}
