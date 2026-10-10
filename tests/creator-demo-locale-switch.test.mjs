import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

/**
 * The `/creator` demo's library follows the language the page is rendered in.
 *
 * The seed is built in the request's locale on the server, but the client store
 * outlives a language change (the picker refreshes the page in place) and a
 * reload restores the tab's earlier take from sessionStorage — both of which
 * used to keep whatever language the library was first written in. These run
 * the real store and builders: only the `@/` alias is resolved for Node.
 */

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith("@/")) {
        const base = new URL("../src/" + specifier.slice(2), ${JSON.stringify(import.meta.url)}).href;
        for (const candidate of [base + ".ts", base + ".tsx", base + "/index.ts", base]) {
          try {
            return await next(candidate, context);
          } catch {}
        }
      }
      return next(specifier, context);
    }
  `)}`,
);

const { buildDemoSeed, buildDemoSeedDetail } = await import("../src/lib/creator-demo/build.ts");
const { getDemoContent, getDemoNotePack } = await import("../src/lib/creator-demo/content.ts");
const store = await import("../src/lib/creator-demo/store.ts");
const { getLiveNoteScript } = await import("../src/lib/creator-demo/college-live-note.ts");

test("the seeded library is written in the requested language", () => {
  const seed = buildDemoSeed("sr");
  const micro = seed.details["demo-note-mikroekonomija"];
  const pack = getDemoNotePack("mikroekonomija", "sr");

  assert.equal(seed.locale, "sr");
  assert.equal(micro.lecture.title, pack.title);
  assert.equal(micro.lecture.language_hint, "sr");
  assert.equal(micro.artifact.structured_notes_md, pack.notesMd);
  assert.equal(micro.flashcards[0].front, pack.flashcards[0].front);
  assert.equal(micro.quizQuestions[0].prompt, pack.quiz[0].prompt);
  assert.equal(micro.practiceTestQuestions[0].prompt, pack.practice[0].prompt);
  assert.equal(micro.transcript[0].text, pack.transcript[0].text);
  assert.deepEqual(
    seed.folders.map((folder) => folder.name),
    Object.values(getDemoContent("sr").folderNames),
  );
  assert.equal(buildDemoSeedDetail("demo-note-erp", "hr").lecture.title, getDemoNotePack("erp", "hr").title);
});

test("switching language rewrites the library and keeps what the creator did", () => {
  store.initCreatorDemoState(buildDemoSeed("sl"));
  store.renameDemoLecture("demo-note-erp", "Moj ERP");
  const createdId = store.createDemoLecture("pdf");
  store.createDemoFolder("Moja mapa");

  store.syncCreatorDemoLocale("en");
  const state = store.getCreatorDemoState();

  assert.equal(state.locale, "en");
  assert.equal(state.order[0], createdId, "the created note survives, in place");
  assert.equal(state.details[createdId].lecture.title, getDemoNotePack("anatomija", "en").title);
  assert.equal(state.details[createdId].artifact.structured_notes_md, getDemoNotePack("anatomija", "en").notesMd);
  assert.equal(state.details["demo-note-erp"].lecture.title, "Moj ERP", "a typed title is the creator's, not ours");
  assert.equal(
    state.details["demo-note-mikroekonomija"].flashcards[0].front,
    getDemoNotePack("mikroekonomija", "en").flashcards[0].front,
  );

  const names = state.folders.map((folder) => folder.name);
  assert.ok(names.includes(getDemoContent("en").folderNames["demo-folder-izpiti"]));
  assert.ok(names.includes("Moja mapa"), "a folder the creator named keeps its name");

  store.resetCreatorDemo();
  assert.equal(store.getCreatorDemoState().locale, "en", "a reset starts over in the current language");
});

test("the college write-up is the record note, in the reader's language", () => {
  for (const locale of ["sl", "en", "hr", "bs", "sr"]) {
    const script = getLiveNoteScript(locale);
    const pack = getDemoNotePack("mikroekonomija", locale);
    const written = script.segments
      .filter((segment) => segment.kind === "markdown")
      .map((segment) => segment.text)
      .join("");

    assert.equal(script.title, pack.title);
    assert.equal(written, pack.notesMd, `${locale}: the write-up is the whole note`);
    assert.equal(
      script.segments.filter((segment) => segment.kind === "figure").length,
      getDemoContent(locale).liveFigures.length,
      `${locale}: every figure lands`,
    );
  }
});

test("a study session saved in the old language does not come back over the new one", () => {
  const storage = () => {
    const values = new Map();
    const api = {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
    // `Object.keys(localStorage)` lists the stored keys in a browser.
    return new Proxy(api, { ownKeys: () => [...values.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) });
  };

  globalThis.window = { localStorage: storage(), sessionStorage: storage() };

  try {
    store.initCreatorDemoState(buildDemoSeed("sl"));
    store.syncCreatorDemoLocale("sl");
    window.localStorage.setItem("lecture-study-session:demo-note-mikroekonomija", "{}");
    window.localStorage.setItem("nota-selected-library-folder:someone-else", "x");

    store.syncCreatorDemoLocale("hr");

    assert.equal(window.localStorage.getItem("lecture-study-session:demo-note-mikroekonomija"), null);
    assert.equal(window.localStorage.getItem("nota-selected-library-folder:someone-else"), "x");
  } finally {
    delete globalThis.window;
  }
});
