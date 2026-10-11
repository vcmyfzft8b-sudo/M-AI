import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  PENDING_UPLOAD_MAX_AGE_MS,
  orphanedUploads,
  uploadsOlderThan,
} from "../src/lib/ugc/pending-upload-plan.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

const NOW = new Date("2026-10-12T03:25:00Z");
const hoursAgo = (hours) => new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();

test("only uploads older than a day are considered", () => {
  assert.equal(PENDING_UPLOAD_MAX_AGE_MS, 24 * 60 * 60 * 1000);

  const uploads = [
    { path: "pending/a.mp4", createdAt: hoursAgo(1) },
    { path: "pending/b.mp4", createdAt: hoursAgo(23.9) },
    { path: "pending/c.mp4", createdAt: hoursAgo(24.1) },
    { path: "pending/d.mp4", createdAt: hoursAgo(24 * 30) },
    // Storage did not say when: never old enough, so never deleted.
    { path: "pending/e.mp4", createdAt: null },
    { path: "pending/f.mp4", createdAt: "not a date" },
  ];

  assert.deepEqual(
    uploadsOlderThan(uploads, NOW).map((upload) => upload.path),
    ["pending/c.mp4", "pending/d.mp4"],
  );
});

test("an upload an application points at is never deleted, however old", () => {
  const old = [
    { path: "pending/kept.mp4", createdAt: hoursAgo(24 * 365) },
    { path: "pending/orphan.mov", createdAt: hoursAgo(48) },
  ];

  assert.deepEqual(orphanedUploads(old, new Set(["pending/kept.mp4"])), ["pending/orphan.mov"]);
  assert.deepEqual(orphanedUploads(old, new Set(["pending/kept.mp4", "pending/orphan.mov"])), []);
});

test("nothing outside pending/ is ever a candidate", () => {
  assert.deepEqual(orphanedUploads([{ path: "approved/x.mp4", createdAt: hoursAgo(100) }], new Set()), []);
});

test("the sweep refuses to delete when it cannot tell which uploads are in use", () => {
  const sweep = readSource("src/lib/ugc/pending-upload-sweep.ts");
  // A failed lookup throws before any delete; a failed list throws too.
  assert.match(sweep, /Could not check which uploads are in use/);
  assert.match(sweep, /Could not list pending uploads/);
  assert.ok(
    sweep.indexOf("Could not check which uploads are in use") < sweep.indexOf("bucket.remove("),
    "the reference check comes before the delete",
  );
});

test("the sweep runs daily behind the cron secret", () => {
  const vercel = JSON.parse(readSource("vercel.json"));
  assert.ok(vercel.crons.some((cron) => cron.path === "/api/cron/ugc-pending-uploads"));

  const route = readSource("src/app/api/cron/ugc-pending-uploads/route.ts");
  assert.match(route, /process\.env\.CRON_SECRET/);
  assert.match(route, /status: 401/);
});
