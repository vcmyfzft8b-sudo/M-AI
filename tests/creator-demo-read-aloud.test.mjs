import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import test from "node:test";

/**
 * The /creator demo reads the opening of each note aloud from pre-rendered clips
 * (src/lib/creator-demo/read-aloud-clips.ts). A clip is keyed by the exact text it says, so a demo
 * note edited without re-running scripts/generate-creator-demo-read-aloud.mjs quietly falls back to
 * silence — which is what this catches. Runs the real seed and planner; only `@/` is resolved.
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

const { buildDemoSeed } = await import("../src/lib/creator-demo/build.ts");
const { buildNoteTtsChunks, parseNoteTtsDocument, stripLeadingRedundantHeading } = await import(
  "../src/lib/note-tts-text.ts"
);
const { demoReadAloudChunkCount, demoReadAloudClipPath, findDemoReadAloudClip } = await import(
  "../src/lib/creator-demo/read-aloud-clips.ts"
);

const LOCALES = ["sl", "en", "hr", "bs", "sr"];

function demoNotes(locale) {
  const seed = buildDemoSeed(locale);

  return Object.entries(seed.details).flatMap(([lectureId, detail]) => {
    const notes = detail?.artifact?.structured_notes_md;

    if (!notes) {
      return [];
    }

    const document = parseNoteTtsDocument(stripLeadingRedundantHeading(notes, detail?.lecture.title));

    return [{ lectureId, document, chunks: buildNoteTtsChunks(document) }];
  });
}

test("every demo note in every language has its opening recorded, matching today's text", () => {
  for (const locale of LOCALES) {
    for (const { lectureId, chunks } of demoNotes(locale)) {
      const count = demoReadAloudChunkCount({ locale, lectureId, chunkTexts: chunks.map((chunk) => chunk.text) });

      assert.ok(count < chunks.length, `${locale}/${lectureId}: no recorded opening (regenerate the clips)`);

      let seconds = 0;

      for (const chunk of chunks.slice(0, count)) {
        const clip = findDemoReadAloudClip({ locale, lectureId, chunkIndex: chunk.chunkIndex, chunkText: chunk.text });
        const file = new URL(
          `../public${demoReadAloudClipPath(locale, lectureId, chunk.chunkIndex).split("?")[0]}`,
          import.meta.url,
        );

        assert.ok(clip, `${locale}/${lectureId}#${chunk.chunkIndex}`);
        assert.ok(fs.existsSync(file), `${file.pathname} is missing`);
        seconds += clip.durationMs / 1000;

        /* The highlight walks the chunk's own words, in order, inside the clip. */
        const indices = clip.alignment.map((word) => word.wordIndex);
        assert.equal(indices[0], chunk.wordStartIndex);
        assert.equal(indices.at(-1), chunk.wordEndIndex - 1);
        assert.ok(clip.alignment.every((word, index) => index === 0 || word.startMs >= clip.alignment[index - 1].startMs));
        assert.ok(clip.alignment.at(-1).endMs <= clip.durationMs + 50);
      }

      assert.ok(seconds >= 40 && seconds <= 120, `${locale}/${lectureId}: opening is ${seconds.toFixed(0)} s`);
    }
  }
});

test("a note edited at the top has no usable recording and is read in full, silently", () => {
  const [{ lectureId, chunks }] = demoNotes("sl");
  const edited = chunks.map((chunk) => chunk.text);
  edited[0] = `${edited[0]} (uredil obiskovalec)`;

  assert.equal(findDemoReadAloudClip({ locale: "sl", lectureId, chunkIndex: 0, chunkText: edited[0] }), null);
  assert.equal(demoReadAloudChunkCount({ locale: "sl", lectureId, chunkTexts: edited }), chunks.length);
});

test("a note edited further down keeps the recording up to the edit", () => {
  const [{ lectureId, chunks }] = demoNotes("sl");
  const texts = chunks.map((chunk) => chunk.text);
  const recorded = demoReadAloudChunkCount({ locale: "sl", lectureId, chunkTexts: texts });
  const edited = [...texts];
  edited[1] = `${edited[1]} (uredil obiskovalec)`;

  assert.ok(recorded >= 2);
  assert.equal(demoReadAloudChunkCount({ locale: "sl", lectureId, chunkTexts: edited }), 1);
});
