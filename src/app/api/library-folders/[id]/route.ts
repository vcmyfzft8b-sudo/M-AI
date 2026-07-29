import { NextResponse } from "next/server";

import { getApiUser } from "@/lib/api-auth";
import {
  deleteLibraryFolder,
  libraryFolderPayloadSchema,
  updateLibraryFolder,
} from "@/lib/library-folders";
import { parseJsonRequest } from "@/lib/request-validation";
import { enforceRateLimit, rateLimitPresets } from "@/lib/rate-limit";
import { routeIdParamSchema } from "@/lib/validation";

const LIBRARY_FOLDER_MAX_BYTES = 64 * 1024;

async function getRouteUser(request: Request) {
  const user = await getApiUser(request);

  return user;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getRouteUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:library-folders:patch",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID mape." }, { status: 400 });
  }

  const parsed = await parseJsonRequest(request, libraryFolderPayloadSchema, {
    maxBytes: LIBRARY_FOLDER_MAX_BYTES,
  });

  if (!parsed.success) {
    return parsed.response;
  }

  const folder = await updateLibraryFolder({
    folderId: parsedParams.data.id,
    userId: user.id,
    name: parsed.data.name,
    lectureIds: parsed.data.lectureIds,
  });

  if (!folder) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  return NextResponse.json({ folder });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getRouteUser(request);

  if (!user) {
    return NextResponse.json({ error: "Nedovoljen dostop." }, { status: 401 });
  }

  const limited = await enforceRateLimit({
    request,
    route: "api:library-folders:delete",
    rules: rateLimitPresets.mutate,
    userId: user.id,
  });

  if (limited) {
    return limited;
  }

  const parsedParams = routeIdParamSchema.safeParse(await context.params);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Neveljaven ID mape." }, { status: 400 });
  }

  const deleted = await deleteLibraryFolder({
    folderId: parsedParams.data.id,
    userId: user.id,
  });

  if (!deleted) {
    return NextResponse.json({ error: "Ni najdeno." }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
