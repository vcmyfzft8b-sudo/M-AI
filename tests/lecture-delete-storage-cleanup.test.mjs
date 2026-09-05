import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const ROUTE_PATH = "src/app/api/lectures/[id]/route.ts";
const ROUTE_SOURCE = readSource(ROUTE_PATH);
const DELETE_HANDLER = ROUTE_SOURCE.slice(
  ROUTE_SOURCE.indexOf("export async function DELETE("),
  ROUTE_SOURCE.indexOf("export async function PATCH("),
);

// The delete itself. Everything a cascade would destroy has to be read above this line.
const LECTURE_DELETE = '.from("lectures")\n    .delete()';

test("read-aloud audio paths are read before the lecture row is deleted", () => {
  // The bug this file exists for: lecture_tts_chunks cascades on lectures, so its rows are the
  // only record of where the read-aloud MP3s live, and they vanish with the lecture. Reading
  // them after the delete returns nothing and the audio stays in the bucket forever.
  const readIndex = DELETE_HANDLER.indexOf('.from("lecture_tts_chunks")');
  const deleteIndex = DELETE_HANDLER.indexOf(LECTURE_DELETE);

  assert.ok(readIndex > 0, "the DELETE handler never reads lecture_tts_chunks");
  assert.ok(deleteIndex > 0, "the DELETE handler no longer deletes the lecture the expected way");
  assert.ok(readIndex < deleteIndex, "lecture_tts_chunks is read after the delete, so it reads nothing");
  assert.match(DELETE_HANDLER.slice(readIndex, deleteIndex), /audio_storage_path/);
});

test("every collected path list reaches the storage removal", () => {
  /*
   * Two branches build storagePaths depending on whether the lecture has a source file, and a
   * list added to only one of them leaks for half of all notes.
   *
   * This used to be checked by counting each list twice, once per branch. It is checked by shape
   * now, because the shape changed when the podcast's segments became a fourth list: both
   * branches are built from one shared array, so a fifth cannot be added to one branch and not
   * the other. What is pinned is that the shared array holds every list and that both branches
   * really do come from it — the same property, made structural instead of duplicated.
   */
  const expression = DELETE_HANDLER.slice(
    DELETE_HANDLER.indexOf("const derivedPaths ="),
    DELETE_HANDLER.indexOf('service.storage.from("lecture-audio").remove('),
  );

  for (const list of [
    "chunkPaths",
    "scanImagePaths",
    "noteMediaPaths",
    "podcastPaths",
    "ttsAudioPaths",
  ]) {
    assert.match(
      expression,
      new RegExp(`\\.\\.\\.${list}\\b`),
      `${list} never reaches the shared list the storage removal is built from`,
    );
  }

  assert.match(
    expression,
    /const storagePaths = lecture\.storage_path\s*\?\s*\[lecture\.storage_path, \.\.\.derivedPaths\]\s*:\s*derivedPaths;/,
    "the two storagePaths branches no longer both come from derivedPaths",
  );
});

test("no other lecture-scoped table hides a storage path behind the cascade", () => {
  // The same gap, generalised: any table that both cascades on lectures and stores a path into
  // the bucket has to be named in the DELETE handler, or deleting a note orphans its objects.
  const directory = fileURLToPath(new URL("../supabase/migrations", import.meta.url));
  const tablesAtRisk = new Set();

  for (const fileName of readdirSync(directory).filter((name) => name.endsWith(".sql"))) {
    const sql = readFileSync(`${directory}/${fileName}`, "utf8");

    for (const match of sql.matchAll(
      /create table if not exists public\.(\w+) \(([\s\S]*?)\n\);/g,
    )) {
      const [, tableName, body] = match;
      const cascades = /references public\.lectures \(id\) on delete cascade/.test(body);

      if (cascades && /storage_path/.test(body)) {
        tablesAtRisk.add(tableName);
      }
    }
  }

  assert.ok(tablesAtRisk.size > 0, "the migration scan found nothing — the parser has drifted");

  for (const tableName of tablesAtRisk) {
    assert.ok(
      DELETE_HANDLER.includes(`.from("${tableName}")`),
      `${tableName} stores a bucket path and dies with its lecture, but ${ROUTE_PATH} never reads it`,
    );
  }
});
