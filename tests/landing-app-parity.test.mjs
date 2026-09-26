import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { NOTE_STUDY_TABS, NOTE_TABS } from "../src/lib/note-tabs.ts";

/*
 * The landing page shows the app, so a feature the app gains has to reach it too
 * (docs/landing-page-sync.md). These checks fail when a note tab exists in the app
 * but the landing page does not show it, or when a landing demo stops drawing the
 * app's own row and starts keeping a copy of it again.
 */

function readSource(relativePath) {
  return readFileSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)), "utf8");
}

function sourceExists(relativePath) {
  return existsSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url)));
}

/* The landing screen that draws each study tab. A new tab needs one. */
const LANDING_SCREEN_FOR_TAB = {
  tutor: "src/components/landing/landing-tutor-demo.tsx",
  flashcards: "src/components/landing/app/landing-flashcards-screen.tsx",
  podcast: "src/components/landing/app/landing-podcast-screen.tsx",
  quiz: "src/components/landing/app/landing-quiz-screen.tsx",
  mindmap: "src/components/landing/app/landing-mindmap-screen.tsx",
  palace: "src/components/landing/app/landing-palace-screen.tsx",
  test: "src/components/landing/app/landing-test-screen.tsx",
  speed: "src/components/landing/app/landing-speed-read-screen.tsx",
};

function exportedComponent(path) {
  const match = readSource(path).match(/export function (Landing\w+)/);
  assert.ok(match, `${path} exports no Landing* component`);
  return match[1];
}

test("the app draws its pill row from the shared list", () => {
  const workspace = readSource("src/components/lecture-workspace.tsx");
  assert.match(workspace, /from "@\/lib\/note-tabs"/);
  assert.doesNotMatch(workspace, /const NOTE_TABS\s*=/, "lecture-workspace keeps its own copy of NOTE_TABS");
});

test("every study tab in the app has a landing screen", () => {
  for (const tab of NOTE_STUDY_TABS) {
    const path = LANDING_SCREEN_FOR_TAB[tab.id];
    assert.ok(
      path,
      `The app has a "${tab.id}" tab but the landing page has no screen for it. ` +
        "Add one in src/components/landing/app/ and list it here (docs/landing-page-sync.md).",
    );
    assert.ok(sourceExists(path), `${path} is missing`);
  }
});

test("How it works shows the app's own study pills", () => {
  const flow = readSource("src/components/landing/landing-flow-demo.tsx");
  assert.match(flow, /from "@\/lib\/note-tabs"/);
  assert.doesNotMatch(flow, /const STUDY_TABS\s*=\s*\[/, "the flow demo keeps its own copy of the pill row");

  for (const tab of NOTE_STUDY_TABS) {
    const component = exportedComponent(LANDING_SCREEN_FOR_TAB[tab.id]);
    assert.match(flow, new RegExp(`<${component}\\b`), `How it works never draws the ${tab.id} screen`);
  }
});

test("the feature list has a row and a screen for every study tab", () => {
  const showcase = readSource("src/components/landing/landing-feature-showcase.tsx");

  for (const tab of NOTE_STUDY_TABS) {
    assert.match(showcase, new RegExp(`id: "${tab.id}"`), `the feature list has no "${tab.id}" row`);
    const component = exportedComponent(LANDING_SCREEN_FOR_TAB[tab.id]);
    assert.match(showcase, new RegExp(`<${component}\\b`), `the feature list never draws the ${tab.id} screen`);
  }
});

test("the hero phone shows the app's pill row", () => {
  const data = readSource("src/components/landing/memo-app-preview-data.ts");
  const preview = readSource("src/components/landing/memo-app-preview.tsx");
  assert.match(data + preview, /from "@\/lib\/note-tabs"/, "the hero phone keeps its own copy of the pill row");

  for (const tab of NOTE_STUDY_TABS) {
    const component = exportedComponent(LANDING_SCREEN_FOR_TAB[tab.id]);
    assert.match(preview, new RegExp(`<${component}\\b`), `the hero phone never draws the ${tab.id} screen`);
  }
});

test("the landing draws app markup, not copies of it", () => {
  assert.ok(NOTE_TABS.length > NOTE_STUDY_TABS.length);

  for (const path of Object.values(LANDING_SCREEN_FOR_TAB)) {
    assert.match(readSource(path), /LandingAppScope/, `${path} does not render inside LandingAppScope`);
  }
});
