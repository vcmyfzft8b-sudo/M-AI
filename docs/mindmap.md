# Mindmap

The note read as a shape: one tab on the note screen showing the material as a tree you can pan,
fold, search and save as an image.

## How it is built

One model call, not a pipeline. Flashcards, quizzes and practice tests go through the coverage
pipeline that reads the source unit by unit; a map cannot, because it is a *shape* rather than a
set of items and only something that has read the whole note can judge which topics are peers and
which are details of another. Per-chunk calls would produce ten little maps stapled together.

- Stage: `mindmap` in `src/lib/ai/model-config.ts` — GLM, `medium` thinking, 180s timeout.
- Prompt and wire schema: `src/lib/ai/mindmap-prompt.ts`. The tree is written at a **fixed depth**
  (title → topic → idea → fact) because structured output rejects a self-referencing schema, and
  because a map deeper than four levels is not glanceable anyway. Free-text fields carry no
  `.max()` — Gemini rejects a schema whose string bounds multiply out across nested arrays — so
  the caps live in `src/lib/mindmap-doc.ts` and are applied to what comes back.
- Generation: `src/lib/mindmap.ts`. Reads up to 60k characters of `structured_notes_md`, cut at a
  paragraph boundary, and stores the whole tree as one `jsonb` document in
  `lecture_mindmap_assets` alongside a hash of the note it was drawn from.

## Cost and when it runs

Nothing is generated until somebody opens the tab. That is deliberate: unlike the tutor's running
order — which is warmed when the note is written because a learner who presses start cannot wait
fifty seconds for it — a map is wanted by one tab that most readers never press, and it is fast
enough to make on demand.

Opening the tab is free when the note has not changed: `generateLectureMindmap` compares the
stored `notes_hash` against the note and returns without a call. "Draw again"
(`POST /api/lectures/[id]/mindmap/regenerate`, paid only) is the one control that always spends.

An edited note does **not** invalidate the stored map. It is still a map of most of the note, and
throwing it away on the reader's behalf would replace something they can read with a spinner they
did not ask for — so it is drawn, labelled "your note has changed", and a redraw is one tap away.

## Layout

`src/lib/mindmap-layout.ts` is pure and takes its text measurement as a parameter, so the canvas,
the PNG export and `tests/mindmap-layout.test.mjs` all lay out identically. It is a two-sided tidy
tree: the title in the middle, branches split left and right **by subtree height rather than by
count**, each side a tidy tree in which a parent sits centred between its own children. That is
what makes overlaps impossible rather than unlikely.

### The opening fold is the whole feature

A map that opens showing everything at 40% has technically drawn the note and practically shown
the reader nothing. `suggestMindmapFold` measures what the map would fit at, in the frame it will
actually be drawn in, and folds a level away if that is below `READABLE_ZOOM`: leaves first, and
only for a map too big for even that does it fall back to the topics alone. Folded nodes keep a
count badge, so nothing is hidden without saying so.

The two reference frames in `MINDMAP_REFERENCE_FRAMES` are **measured**, not guessed. If the note
screen's chrome changes, re-measure them: `.memo-mm-stage`'s own `getBoundingClientRect()` on a
1440x900 laptop and a 375x812 phone is the whole method.

## The screen

- `src/components/lecture-mindmap.tsx` owns loading, polling, the toolbar, search, the detail card
  and full screen. It fetches from its own endpoint rather than riding `getLectureDetailForUser`,
  which already fans out to a dozen queries on every open of a note.
- `src/components/mindmap-canvas.tsx` owns pixels: the SVG, pan, pinch, folding and the export.
- The chat column stands down while this tab is on screen (`showChatPanel` in
  `lecture-workspace.tsx`). It is the only screen whose usefulness is a function of its width.
- The note's title and date are hidden on this tab: the map draws the title in its own middle.

Two implementation notes that are not obvious:

- **Pointer capture is released inside `pointerup`.** While a pointer is captured the `click` that
  follows is dispatched to the capture target rather than to what is under the finger, so holding
  it one moment longer sends every node tap to the background.
- **The PNG is drawn, not rasterised from the SVG.** Serialising the live SVG into an `<img>` is
  less code and is what most implementations do, but it loses the fonts — a `foreignObject`-free
  SVG loaded through an image renders text in whatever *that document* resolves the family to,
  which on iOS is not the app's face.

## The demo

`/creator` intercepts every `/api/*` call, so the tab needs data there too or it spins forever on
the one screen with no signed-in user to notice. `src/lib/creator-demo/mindmap.ts` builds the map
mechanically from the demo note's own markdown — headings become topics, bullets become ideas.
It is not what production generates, but it is drawn from the note the visitor is looking at, so
nothing on that screen is a lie, and it cannot drift when a demo pack is edited.
