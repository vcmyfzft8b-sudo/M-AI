# UGC oral quiz (`/ugc/oral-quiz`)

A scripted tutor skit for comedy UGC, modelled on the Turbo AI "oral quiz" TikTok
trend: Memo asks a question out loud, the creator answers out loud, Memo answers back
and then explains, with the word being spoken highlighted. The lesson card is on the
left and an animated Memo on the right (he talks with the voice, reacts to each answer
and cheers at the end). It takes the whole screen and is meant to be filmed off a laptop.

**Share it only by its link** — `https://memoai.eu/ugc/oral-quiz`. It is deliberately
separate from the creator demo ([creator-demo.md](creator-demo.md)): creators making
ordinary study content use `/creator`, and nothing there links here. It is noindexed and
disallowed in `robots.txt`. Do not link it from `/creator` or from that doc.

## Recording

- **Start** (or Space/Enter) plays it; **R** starts again. The creator's lines are timed
  to the original video; a tap or Space moves on early. Add `?answer=tap` to make every
  answer wait for a tap instead.
- Memo sits beside the card from 640px wide (a laptop window or a narrow preview pane);
  on a phone he moves into a strip above it.
- The link opens on a language picker (sl, en, hr, bs, sr); the screen then plays in
  the language picked, and `?lang=sl` (which the picker sets) keeps it across reloads or
  skips the picker when shared. A chip under Start goes back to the picker; it and the
  picker are gone once Start is pressed. "DICK" stays English in every language,
  declined where the grammar asks ("malo DICK-a"); everything else, the drug names
  included, is translated.
- On a laptop Memo moves with the voice's loudness. On an iPhone or iPad he moves in
  step with the words instead: measuring the voice would route it through Web Audio,
  which the silent switch mutes.

## Changing it

- The script is `src/lib/ugc/oral-quiz.ts`, one per language.
- Sound is pre-recorded with the app's Soniox voice (Grace) in
  `public/ugc/oral-quiz/<locale>/`, with per-word timings in
  `src/lib/ugc/oral-quiz-timings.json`. After changing a tutor line, re-record:
  `node --experimental-strip-types scripts/generate-oral-quiz-clips.mjs [--language sl]`.
  `tests/ugc-oral-quiz.test.mjs` fails until the recordings match the text.
- How the voice says a word that would come out wrong (DICK, IV, the brand name) is the
  `SPOKEN` table in the same file — one word for one word, so the highlight stays aligned.
