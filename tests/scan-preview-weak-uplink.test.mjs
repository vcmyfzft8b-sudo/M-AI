import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// 2026-09-04 (MEMOAI-WEB 144942453): six HEIC previews on one weak uplink each burned the
// full 18 s budget in turn, beside the real upload, and each filed a Sentry defect.
const SOURCE = readFileSync(new URL("../src/components/note-source-modal.tsx", import.meta.url), "utf8");

function functionBody(name) {
  const start = SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} has been renamed or removed`);
  const open = SOURCE.indexOf("{", SOURCE.indexOf(")", start));
  let depth = 0;
  for (let index = open; index < SOURCE.length; index += 1) {
    if (SOURCE[index] === "{") depth += 1;
    else if (SOURCE[index] === "}" && --depth === 0) return SOURCE.slice(open, index + 1);
  }
  throw new Error(`${name} is unbalanced`);
}

const preview = functionBody("prepareHeicPhotoPreview");

test("after one preview gets no answer, the rest of the batch skips the round trip", () => {
  const guard = preview.slice(0, preview.indexOf("new FormData()"));
  assert.match(guard, /previewTransportFailedRef\.current/);
  assert.match(guard, /submitInFlightRef\.current/);

  const fetchAt = preview.indexOf('fetchWithTimeout("/api/scan-preview"');
  const transportCatch = preview.indexOf("catch (transportError)", fetchAt);
  const flag = preview.indexOf("previewTransportFailedRef.current = true", transportCatch);
  const early = preview.indexOf("return;", flag);
  const defectCapture = preview.indexOf("Sentry.captureException(previewError");
  assert.ok(fetchAt > 0 && transportCatch > fetchAt && flag > transportCatch, "a failed fetch sets the flag");
  assert.ok(early > flag && early < defectCapture, "and returns before the defect report");
});

test("a real defect — a refused or unreadable preview — still reaches Sentry", () => {
  assert.match(preview, /Sentry\.captureException\(previewError/);
  assert.match(preview, /capture\.error\.previewFailed/);
  assert.match(preview, /capture\.error\.previewUnreadable/);
});

test("submitting the photo note aborts the preview in flight", () => {
  const submit = functionBody("createPhotoLecture");
  assert.match(submit.slice(0, 400), /previewAbortRef\.current\?\.abort\(\)/);
  assert.match(preview, /signal: controller\.signal/);
});

test("a fresh sheet forgets that an earlier upload was on a weak link", () => {
  assert.match(SOURCE, /submitInFlightRef\.current = false;\n\s*previewTransportFailedRef\.current = false;/);
});
