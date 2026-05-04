import { NextResponse } from "next/server";

import {
  createLibraryFolder,
  importLibraryFolders,
  libraryFolderImportPayloadSchema,
  libraryFolderPayloadSchema,
  listLibraryFoldersForUser,
} from "@/lib/library-folders";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const LIBRARY_FOLDER_MAX_BYTES = 64 * 1024;

async function getRouteUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

export async function GET(request: Request) {
  const user = await getRouteUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:library-folders:get",
    rules: rateLimitPresets.listRead,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const folders = await listLibraryFoldersForUser(user.id);
  return NextResponse.json({ folders });
}

export async function POST(request: Request) {
  const user = await getRouteUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:library-folders:post",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, libraryFolderPayloadSchema, {
    maxBytes: LIBRARY_FOLDER_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const folder = await createLibraryFolder({
    userId: user.id,
    name: parsed.data.name,
    lectureIds: parsed.data.lectureIds,
  });

  return NextResponse.json({ folder }, { status: 201 });
}

export async function PUT(request: Request) {
  const user = await getRouteUser();

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:library-folders:import",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsed = await parseJsonRequest(request, libraryFolderImportPayloadSchema, {
    maxBytes: LIBRARY_FOLDER_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const folders = await importLibraryFolders({
    userId: user.id,
    folders: parsed.data.folders,
  });

  return NextResponse.json({ folders });
}
