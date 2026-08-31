import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatCurrency } from "../src/lib/utils.ts";

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

function filesBelow(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    return statSync(path).isDirectory() ? filesBelow(path) : [path];
  });
}

test("document language uses a full BCP 47 tag on the server and after hydration", () => {
  assert.match(readSource("src/app/layout.tsx"), /lang=\{LOCALE_BCP47\[locale\]\}/);
  assert.match(
    readSource("src/components/i18n-provider.tsx"),
    /document\.documentElement\.lang = languageTag/,
  );
});

test("prices follow each active locale instead of carrying fixed euro text", () => {
  assert.equal(formatCurrency(1.25, "en"), "€1.25");
  assert.match(formatCurrency(1.25, "sl"), /^1,25\s€$/u);
  assert.match(formatCurrency(1.25, "hr"), /^1,25\s€$/u);
  assert.match(formatCurrency(1.25, "bs"), /^1,25\s€$/u);
  assert.match(formatCurrency(1.25, "sr"), /^1,25\s€$/u);

  const offer = readSource("src/components/discount-offer.tsx");
  assert.match(offer, /formatCurrency\(offerPlan\.headlineAmount, locale\)/);
  assert.doesNotMatch(offer, /€1[.,]25|€65|€130/);
});

test("the formerly hard-coded UI controls resolve through the catalogue", () => {
  const expected = [
    ["src/components/home-dashboard.tsx", "status.generatingNotes"],
    ["src/components/note-source-modal.tsx", "capture.recordAgain"],
    ["src/components/recording-player.tsx", "recording.backSeconds"],
    ["src/components/note-read-aloud.tsx", "t(color.labelKey)"],
    ["src/components/landing/memo-app-preview.tsx", "preview.correctAnswerValue"],
    ["src/components/impersonation-banner.tsx", "impersonation.viewingAs"],
  ];

  for (const [path, key] of expected) {
    assert.ok(readSource(path).includes(key), `${path} must translate ${key}`);
  }
});

test("stream failures and public not-found responses are translated", () => {
  assert.match(readSource("src/lib/chat-stream.ts"), /errorMessage/);
  assert.match(readSource("src/app/api/library-chat/route.ts"), /errorMessage:\s*await tr\(/);

  const publicRoutes = [
    "src/app/api/lectures/[id]/route.ts",
    "src/app/api/flashcards/[id]/route.ts",
    "src/app/api/library-folders/[id]/route.ts",
  ];

  for (const path of publicRoutes) {
    const source = readSource(path);
    assert.match(source, /await tr\("api\.notFound"\)/, path);
    assert.doesNotMatch(source, /Ni najdeno\./, path);
  }
});

test("public API failures do not expose raw database messages", () => {
  const apiRoot = fileURLToPath(new URL("../src/app/api", import.meta.url));
  const internalSegments = ["/admin/", "/cron/", "/stripe/", "/webhooks/"];
  const publicRoutes = filesBelow(apiRoot).filter(
    (path) => path.endsWith("route.ts") && !internalSegments.some((part) => path.includes(part)),
  );

  for (const path of publicRoutes) {
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /error:\s*(?:error|caught|\w+Error)\.message/,
      path,
    );
  }
});
