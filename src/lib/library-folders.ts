import "server-only";

import { z } from "zod";

import { createSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { LibraryFolderLectureRow, LibraryFolderRow } from "@/lib/database.types";
import type { AppLibraryFolder } from "@/lib/types";
import { createSanitizedStringSchema, uuidSchema } from "@/lib/validation";

export const libraryFolderNameSchema = createSanitizedStringSchema({
  minLength: 1,
  maxLength: 80,
  collapseWhitespace: true,
});

export const libraryFolderLectureIdsSchema = z.array(uuidSchema).max(250);

export const libraryFolderPayloadSchema = z.object({
  name: libraryFolderNameSchema,
  lectureIds: libraryFolderLectureIdsSchema.default([]),
});

export const libraryFolderImportPayloadSchema = z.object({
  folders: z
    .array(
      z.object({
        name: libraryFolderNameSchema,
        lectureIds: libraryFolderLectureIdsSchema.default([]),
      }),
    )
    .max(100),
});

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}

function mapFolderRows(
  folders: LibraryFolderRow[],
  links: LibraryFolderLectureRow[],
): AppLibraryFolder[] {
  const lectureIdsByFolderId = new Map<string, string[]>();

  for (const link of links) {
    const lectureIds = lectureIdsByFolderId.get(link.folder_id) ?? [];
    lectureIds.push(link.lecture_id);
    lectureIdsByFolderId.set(link.folder_id, lectureIds);
  }

  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    lectureIds: lectureIdsByFolderId.get(folder.id) ?? [],
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  }));
}

export async function listLibraryFoldersForUser(userId: string): Promise<AppLibraryFolder[]> {
  const service = createSupabaseServiceRoleClient();
  const { data: folderData, error: folderError } = await service
    .from("library_folders")
    .select("id, user_id, name, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (folderError) {
    throw folderError;
  }

  const folders = (folderData ?? []) as LibraryFolderRow[];

  if (folders.length === 0) {
    return [];
  }

  const { data: linkData, error: linkError } = await service
    .from("library_folder_lectures")
    .select("folder_id, lecture_id, user_id, created_at")
    .eq("user_id", userId)
    .in("folder_id", folders.map((folder) => folder.id))
    .order("created_at", { ascending: true });

  if (linkError) {
    throw linkError;
  }

  return mapFolderRows(folders, (linkData ?? []) as LibraryFolderLectureRow[]);
}

async function getOwnedLectureIds(userId: string, lectureIds: string[]) {
  const uniqueLectureIds = uniqueValues(lectureIds);

  if (uniqueLectureIds.length === 0) {
    return [];
  }

  const { data, error } = await createSupabaseServiceRoleClient()
    .from("lectures")
    .select("id")
    .eq("user_id", userId)
    .in("id", uniqueLectureIds);

  if (error) {
    throw error;
  }

  const ownedLectureIds = new Set(
    ((data ?? []) as Array<{ id: string }>).map((row) => row.id),
  );
  return uniqueLectureIds.filter((lectureId) => ownedLectureIds.has(lectureId));
}

async function replaceFolderLectures(params: {
  folderId: string;
  userId: string;
  lectureIds: string[];
}) {
  const service = createSupabaseServiceRoleClient();

  const { error: deleteError } = await service
    .from("library_folder_lectures")
    .delete()
    .eq("folder_id", params.folderId)
    .eq("user_id", params.userId);

  if (deleteError) {
    throw deleteError;
  }

  if (params.lectureIds.length === 0) {
    return;
  }

  const rows = params.lectureIds.map((lectureId) => ({
    folder_id: params.folderId,
    lecture_id: lectureId,
    user_id: params.userId,
  }));

  const { error: insertError } = await service
    .from("library_folder_lectures")
    .upsert(rows as never, {
      ignoreDuplicates: true,
      onConflict: "folder_id,lecture_id",
    });

  if (insertError) {
    throw insertError;
  }
}

export async function createLibraryFolder(params: {
  userId: string;
  name: string;
  lectureIds: string[];
}) {
  const service = createSupabaseServiceRoleClient();
  const lectureIds = await getOwnedLectureIds(params.userId, params.lectureIds);
  const { data, error } = await service
    .from("library_folders")
    .insert({
      user_id: params.userId,
      name: params.name,
    } as never)
    .select("id, user_id, name, created_at, updated_at")
    .single();

  if (error) {
    throw error;
  }

  const folder = data as LibraryFolderRow;
  await replaceFolderLectures({
    folderId: folder.id,
    userId: params.userId,
    lectureIds,
  });

  return {
    id: folder.id,
    name: folder.name,
    lectureIds,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  } satisfies AppLibraryFolder;
}

export async function updateLibraryFolder(params: {
  folderId: string;
  userId: string;
  name: string;
  lectureIds: string[];
}) {
  const service = createSupabaseServiceRoleClient();
  const lectureIds = await getOwnedLectureIds(params.userId, params.lectureIds);
  const { data, error } = await service
    .from("library_folders")
    .update({ name: params.name } as never)
    .eq("id", params.folderId)
    .eq("user_id", params.userId)
    .select("id, user_id, name, created_at, updated_at")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const folder = data as LibraryFolderRow;
  await replaceFolderLectures({
    folderId: folder.id,
    userId: params.userId,
    lectureIds,
  });

  return {
    id: folder.id,
    name: folder.name,
    lectureIds,
    createdAt: folder.created_at,
    updatedAt: folder.updated_at,
  } satisfies AppLibraryFolder;
}

export async function deleteLibraryFolder(params: {
  folderId: string;
  userId: string;
}) {
  const { error, count } = await createSupabaseServiceRoleClient()
    .from("library_folders")
    .delete({ count: "exact" })
    .eq("id", params.folderId)
    .eq("user_id", params.userId);

  if (error) {
    throw error;
  }

  return (count ?? 0) > 0;
}

export async function importLibraryFolders(params: {
  userId: string;
  folders: Array<{ name: string; lectureIds: string[] }>;
}) {
  if (params.folders.length === 0) {
    return listLibraryFoldersForUser(params.userId);
  }

  const existingFolders = await listLibraryFoldersForUser(params.userId);
  const foldersByName = new Map(
    existingFolders.map((folder) => [folder.name.toLocaleLowerCase("sl-SI"), folder]),
  );

  for (const folder of params.folders) {
    const key = folder.name.toLocaleLowerCase("sl-SI");
    const existingFolder = foldersByName.get(key);

    if (!existingFolder) {
      const createdFolder = await createLibraryFolder({
        userId: params.userId,
        name: folder.name,
        lectureIds: folder.lectureIds,
      });
      foldersByName.set(key, createdFolder);
      continue;
    }

    const nextLectureIds = uniqueValues([
      ...existingFolder.lectureIds,
      ...folder.lectureIds,
    ]);
    const updatedFolder = await updateLibraryFolder({
      folderId: existingFolder.id,
      userId: params.userId,
      name: existingFolder.name,
      lectureIds: nextLectureIds,
    });

    if (updatedFolder) {
      foldersByName.set(key, updatedFolder);
    }
  }

  return listLibraryFoldersForUser(params.userId);
}
