# Landing page ↔ app sync

The landing page (`/`, `src/app/page.tsx`) sells the app by showing it, which only works if
what it shows is what people get when they sign up. **Every app change that a visitor could see
on the landing page is also a landing-page change**, in the same pull request:

- a new feature (a new note tab, a new study mode, a new way in or out of a note),
- a redesign or restyle of a screen the landing page shows,
- a renamed control, a changed order, new copy on a screen the landing page shows,
- a removed feature.

A PR that does one without the other is unfinished. If the landing part really cannot land with
it, say so in the PR description and open the follow-up before merging, not after.

This is the same kind of rule as [web and iOS parity](../AGENTS.md#web-and-ios-app-parity): one
product, several places it is shown.

## Why the landing drifted, and how it is built now

Until September 2026 every demo on the landing page was a hand-made copy of an app screen: inline
styles, private `--m-*`/`--l-*`/`--lt-*` tokens and private CSS in `landing.css` and
`landing-tutor.css`, "transcribed" from the app at one moment. The app kept moving (the tutor lost
its chip row, flashcards gained a counter and grade buttons, four new tabs arrived) and the
copies did not, because nothing tied them together.

The fix is structural: **the landing renders the app's own markup.**

- `redesign.css` is loaded on every page by the root layout, so the `.memo-*` classes are
  available on the landing page too.
- `LandingAppScope` (`src/components/landing/app/landing-app-scope.tsx`) opens the `.memo` token
  scope. `theme="os"` follows the operating system like the rest of the landing
  (`.memo-os-theme`); `"light"`/`"dark"` pin one (`.memo-theme-light` / `.memo-theme-dark`) for
  the hero phone, whose Appearance setting a visitor can change; `"app"` is the plain scope for a
  landing component mounted inside the app (the onboarding's tutor). The selectors live next to
  the token blocks in `redesign.css`, and `.memo-embed` drops the app screen's full-height page
  background.
- `src/components/landing/app/` holds one component per app screen the landing shows. Each renders
  the real classes, and the app's own component wherever that component is pure
  (`StudyFlashcard`, `StudyQuizQuestion`, `StudyPracticeQuestion`, `StudyCompletionCard`, …).
  What they replace is only what cannot run on a public page: the network, billing, sheets and
  portals, the microphone. That is replaced with local state and a short scripted `autoplay`.
- The note's pill row — which tabs exist, their order, icons and tints — is one list,
  `NOTE_TABS` in `src/lib/note-tabs.ts`, imported by the app's note screen and by every landing
  demo of it. A tab added there appears in the app and on the landing at once, and
  `tests/landing-app-parity.test.mjs` then fails until it has a landing screen and is drawn in
  the hero phone, "How it works" and the feature list.
- The hero phone (`memo-app-preview.tsx`), "How it works" (`landing-flow-demo.tsx`), the tutor
  section (`landing-tutor-demo.tsx`) and the feature list (`landing-feature-showcase.tsx`) all
  draw those same components, so a screen is updated once and every place that shows it follows.

So when you restyle an app screen through its `.memo-*` classes or its shared component, the
landing usually follows on its own. **Check it anyway** — the landing components transcribe the
screen's JSX, and a changed structure (a new element, a moved button, a new class) still has to be
copied across.

Three places still copy rather than share, and have to be kept in step by hand:

- **The hero phone's chrome.** Inside a note tab the hero draws the shared screens, but the phone
  around them — the nav bar, library rows, create sheet, settings, help, chat sheets — is still an
  inline-styled transcription in `memo-app-preview.tsx`, with sizes taken from the app's computed
  styles. A change to any of those app screens needs the same change there.
- **The note body's marks in the hero.** The heading highlight, callout and read-aloud colours are
  keyed on the root theme in `globals.css`; the hero restates them as `--hero-*` values in
  `landing.css` so its own Appearance setting applies. Keep the values in step with `globals.css`.
- **The note tabs' phone layout.** The app's phone layout for the note tabs is written as
  `@media (max-width: 1099px)` rules under `.memo-note-screen`, which a desktop visitor's window
  never matches and which the landing's phone-sized frames are not inside. The blocks in
  `landing.css` headed with the landing screens' names (`LandingFlashcardsScreen / …`, the
  podcast, mindmap, palace and speed-read block) restate those phone rules for the
  `.landing-study-frame` stand-in. **When you change a note tab's phone layout in `redesign.css`,
  change the matching block in `landing.css` too.**

The hero chrome and the phone layout are the next things to move onto shared markup (a container
query would let one rule serve both a phone viewport and the landing's phone-sized frame).

## Where each feature appears on the landing page

| App feature | App source | Landing component | Shown in |
| --- | --- | --- | --- |
| Home, note list, folders, settings, help | `home-dashboard.tsx`, `settings-screen.tsx` | `memo-app-preview.tsx` | Hero phone |
| New note / capture sheet | `note-source-modal.tsx` | `memo-app-preview.tsx`, `landing-flow-demo.tsx`, showcase | Hero, How it works (step 1), Features |
| Note (notes tab), read aloud | `lecture-workspace.tsx`, `note-read-aloud.tsx` | `memo-app-preview.tsx`, `landing-flow-demo.tsx`, showcase | Hero, How it works (step 2), Features |
| Note pill row | `NOTE_TABS` in `src/lib/note-tabs.ts` | the same list, imported | Hero, How it works (step 3) |
| Tutor | `lecture-tutor.tsx` | `landing-tutor-demo.tsx` | Tutor section, hero, How it works, Features |
| Flashcards | `study-flashcard.tsx` + deck screen in `lecture-workspace.tsx` | `app/landing-flashcards-screen.tsx` | Hero, How it works, Features |
| Quiz | `study-question.tsx` + quiz screen | `app/landing-quiz-screen.tsx` | Hero, How it works, Features |
| Practice test | `study-question.tsx` + test screen | `app/landing-test-screen.tsx` | Hero, How it works, Features |
| Results screen | `study-completion-card.tsx` | used directly by the three screens above | wherever they are |
| Podcast | `lecture-podcast.tsx` | `app/landing-podcast-screen.tsx` | Hero, How it works, Features |
| Mindmap | `lecture-mindmap.tsx`, `mindmap-canvas.tsx` | `app/landing-mindmap-screen.tsx` | Hero, How it works, Features |
| Memory palace | `lecture-palace.tsx` | `app/landing-palace-screen.tsx` | Hero, How it works, Features |
| Speed read | `note-speed-reader.tsx` | `app/landing-speed-read-screen.tsx` | Hero, How it works, Features |
| Chat (note and library) | `library-chat.tsx`, `chat-markdown.tsx` | hero chat, showcase | Hero, Features |
| Exam (note tab: journey, readiness, today's tasks) | `lecture-exam.tsx` + `ExamHero`, `ExamReadinessCard`, `ExamTodayTasks` | `app/landing-exam-screen.tsx` — the app's own components over a journey the real planner computes | Hero, How it works, Features |

Keep this table current: a new feature adds a row, and a new landing component is listed here.

## Checklist for an app change

1. Find the feature's row above. If it has none, it is a new feature: add a landing component in
   `src/components/landing/app/`, add it to the hero phone's tabs (if it is a note tab), to the
   "How it works" study pills, and to the feature list, with copy in all five catalogues.
2. Update the landing component so its markup and classes match the app's JSX. Render the app's
   own component instead wherever it is pure.
3. A new note tab goes into `NOTE_TABS` (`src/lib/note-tabs.ts`) once; the app and the landing
   both read it. Add its landing screen to `LANDING_SCREEN_FOR_TAB` in the parity test.
4. Update copy that lists features: the hero lead (`landing.hero.lead`), the JSON-LD
   `featureList` in `page.tsx`, and the FAQ where it describes what the app does.
5. Look at both side by side at phone width, in dark and light:
   - the app with demo data and no login: `/creator/lectures/demo-note-mikroekonomija`
     (the creator demo hides the Tutor tab — compare the tutor against `lecture-tutor.tsx`);
   - the landing: `/`, the hero phone, `#how-it-works`, `#tutor` and `#features`.
6. Run `node --experimental-strip-types --test tests/landing-app-parity.test.mjs` and the i18n
   tests. The parity test fails when a note tab exists in the app but is missing from the landing.

## Rules for landing components

- Render the app's markup inside `LandingAppScope`. Do not add inline-styled copies of app
  screens, and do not add private tokens for app surfaces.
- No network, billing, portals, `useSheet` or microphone. Local state only.
- Sound only after a visitor's tap. `autoplay` stops for good on the first interaction and is
  skipped under `prefers-reduced-motion`.
- The study material inside the demos is the learner's coursework stand-in and stays in the
  language it was written in; the interface around it is translated (see the note at the top of
  `memo-app-preview-data.ts`).
- Landing-only CSS (sizing a screen into a slot, the page layout around it) goes in
  `landing.css`. Anything that styles the app's own elements belongs in `redesign.css`, where the
  app uses it too.
