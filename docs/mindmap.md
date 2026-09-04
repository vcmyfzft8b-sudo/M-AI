# Mindmap

The note read as a shape: one tab on the note screen showing the material as a tree you can pan,
fold, search and save as an image.

## How it is built

A map is a *shape* rather than a set of items, so it cannot be built a chunk at a time the way
flashcards and practice tests are: chunks that each choose their own topics merge into several
maps sharing a title, which is the structureless column the competing implementation draws. A
note that fits one call therefore gets exactly one call.

A note that does not gets two phases, split along the seam that matters:

1. **Topics**, decided once over a *skeleton* of the whole note — every heading and the first line
   of prose under it. That stays a couple of thousand characters however long the note runs, so
   the shape is still judged by something that has seen all of the material.
2. **Filling**, one call per window (`planSourceWriteWindows`, the same helper note writing uses),
   each sorting its part of the note into that one agreed topic list, four at a time.

`mergeWindowedBranches` folds the answers back together: ordered by the plan so the map reads in
the note's own order, matched on a normalised label so a window that wrote "povprasevanje" is not
silently dropped, and deduplicated because two windows describing the same idea either side of a
page break is the normal case. A window that never comes back costs its own share and not the map.

This replaced a hard 60,000-character cut with the rest of the note thrown away — a quiet way of
not covering the material, and the reason the windowing exists at all.

- Stage: `mindmap` in `src/lib/ai/model-config.ts` — GLM, `medium` thinking, 180s timeout.
- Prompt and wire schema: `src/lib/ai/mindmap-prompt.ts`. The tree is written at a **fixed depth**
  (title → topic → idea → fact) because structured output rejects a self-referencing schema, and
  because a map deeper than four levels is not glanceable anyway. Free-text fields carry no
  `.max()` — Gemini rejects a schema whose string bounds multiply out across nested arrays — so
  the caps live in `src/lib/mindmap-doc.ts` and are applied to what comes back.
- Generation: `src/lib/mindmap.ts` drives it; the decisions that are not calls — the skeleton and
  the merge — live in `src/lib/mindmap-merge.ts`, free of `server-only` so
  `tests/mindmap-coverage.test.mjs` can assert on them. The finished tree is stored whole as one
  `jsonb` document alongside a hash of the note it was drawn from.

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
the PNG export and `tests/mindmap-layout.test.mjs` all lay out identically. It is a two-sided
tree: the title in the middle, branches split left and right **by weight rather than by count**,
each side placed by `src/lib/mindmap-tidy.ts`.

That module is A.J. van der Ploeg's 2013 *Drawing Non-layered Tidy Trees in Linear Time* — the
algorithm the good tree-layout libraries implement. `d3-flextree` is a port of the author's own
Java and `entitree-flex` is another; neither was worth taking as a dependency (flextree pins
`d3-hierarchy@1` and has not been touched since 2022, entitree-flex carries no licence, and both
would still need wrapping for the two-sided root split, the mirroring and the fold state). So the
algorithm is in the repo and the dependency is not.

What it buys over the bounding-box stacking it replaced is **contours**: a deep, narrow subtree no
longer reserves its whole bounding box against its neighbour, so a tall thin branch nests into the
gap beside a short wide one. Measured on an irregular 32-node fixture, 596px tall became 477px —
and the map went from opening folded to opening whole.

The inner levels are deliberately narrower than they look like they should be. A map's width is
the sum of its column widths and nothing else, so no amount of vertical packing touches it; those
levels wrap to two or three short lines instead of running to one wide one, spending the height
the contours just freed on the axis that was actually binding.

### The opening fold is the whole feature

A map that opens showing everything at 40% has technically drawn the note and practically shown
the reader nothing. `suggestMindmapFold` measures what the map would fit at, in the frame it will
actually be drawn in, and folds a level away if that is below `READABLE_ZOOM`: leaves first, and
only for a map too big for even that does it fall back to the topics alone. Folded nodes keep a
count badge, so nothing is hidden without saying so.

The two reference frames in `MINDMAP_REFERENCE_FRAMES` are **measured**, not guessed. If the note
screen's chrome changes, re-measure them: `.memo-mm-stage`'s own `getBoundingClientRect()` on a
1440x900 laptop and a 375x812 phone is the whole method.

## Focusing

Folding takes things away; **focus** takes the reader in. `focusMindmapOn` re-roots the map on any
node — that node becomes the centre and its children the branches — which is what makes a map of a
long note navigable rather than merely foldable. Node ids are positional, so a fold, a selection
and a search all survive the trip in and back out, and the trail above the canvas is the way back.

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
