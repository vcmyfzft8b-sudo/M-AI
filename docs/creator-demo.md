# Creator demo (`/creator`)

A dummy version of the app for recording UGC videos. It looks and behaves like
production, but there is no account, no upload and no AI.

Open `https://memoai.eu/creator` (or `http://localhost:3000/creator`). No login,
no paywall, nothing to set up.

## What works

- **Library** — starts with four ready notes (audio lecture, PDF script, web
  article, pasted text) plus two folders. Search, folder filter, swipe to
  rename or delete.
- **New note** — all four sources open with a file **already staged**, and the
  only button is "Ustvari": a prepared recording, an audio file, a PDF and an
  article link. The note is ready in about a second, already opened.
- **Note** — full notes with headings, callouts, tables, figures and
  highlighting. Transcript tab on audio notes. Every note (seeded or
  created) carries subject-matched diagrams — a supply/demand graph, a neuron
  and action-potential figure, ERP module and phase diagrams, a revolution
  timeline. They live in `public/creator-demo/` as SVGs.
- **Study** — flashcards ready to swipe, an eight-question quiz with
  explanations, and a written practice test that gets graded with per-question
  feedback.
- **Chat** — answers about the note, from a canned set per subject.

## What to know before recording

- **Nothing of the creator's own can get in.** Every source is pre-staged and
  there is no way to add anything else: the file pickers, the camera/scan
  button, "Posnemi znova" and the in-note "add photo" button are all removed,
  the link field and text area are read-only, and the microphone is never
  opened. The note that appears is pre-written content matching the source
  type, so the staged file name won't match the note title.
- **"Poslušaj" (read-aloud) plays silently.** The word-by-word highlighting runs
  normally, but there is no voice. Fine over a voiceover, avoid if the video
  needs to demo the audio itself.
- **The live recorder is off in the demo.** Record mode shows a prepared clip
  instead. If a take needs the real recording animation — waveform, timer, stop
  button — say so and it can be switched back on; it never uploaded anything
  either way.
- **State lives in the browser tab.** Notes created during a take survive a
  reload and disappear when the tab closes. To start clean mid-session:
  Nastavitve → "Ponastavi demo".
- Creating several notes from the same source type repeats the same note, since
  each source maps to one prepared subject.

## Changing the demo content

All of it — notes, flashcards, quiz, practice questions, transcript, chat
answers — lives in [`src/lib/creator-demo/content.ts`](../src/lib/creator-demo/content.ts).
Note markdown follows the same "Structured Plus" format the real generator
produces, so edits render exactly like production notes.

Figures are SVGs in `public/creator-demo/`, attached through each pack's
`images` array. `afterText` is a phrase from the paragraph the figure should sit
under, so rewording the notes can't silently detach an image.

The file names that come pre-staged in the create sheet are
`DEMO_STAGED_SOURCES` in
[`src/components/note-source-modal.tsx`](../src/components/note-source-modal.tsx).

## How it works

`/creator` mounts the real app components with two things swapped underneath:

- `src/lib/creator-demo/api.ts` answers every `/api/*` call from an in-memory
  store instead of the network, installed by
  `src/components/creator-demo/creator-demo-provider.tsx`.
- A base-path context rewrites the `/app` links the components hardcode to
  `/creator`, so no production code path is duplicated.

Outside `/creator` the context is null and the swap never installs, so the real
app is untouched.
