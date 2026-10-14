# Exam prep ("Priprava na izpit")

A learner names an exam, gives its date and picks the notes it covers; Memo turns that into a
study path. It follows Astra AI's exam-prep flow, drawn in Memo's own components.

## Where it lives

- **"Novo"** (the phone dock button, formerly "Nov zapisek", and the desktop heading above the
  quick actions) opens a sheet whose first item is the coral exam-prep card. With an exam set up,
  the card continues the nearest one. The four note sources follow it, unchanged.
- **Desktop rail:** "Izpiti" → `/app/exams`.
- Routes: `/app/exams` (list), `/app/exams/new` (setup), `/app/exams/[id]` (dashboard),
  `/app/exams/[id]/lesson?lecture=&kind=` (one lesson), `/app/exams/[id]/mock` (mock exam).

## The model

Each note in an exam is a **module**. A module is a fixed chain of five lessons, in Astra's order:
summary → flashcards → quiz → true/false → one written answer. A module is unlocked when it is the
first one, when the module before it is complete, or when the learner has already started it (a
locked module offers a test-out quiz). Mastery is the average of the latest score of the four
practice lessons; the summary counts as done but not as mastery.

All of that arithmetic, plus the daily goal, the streak, the date strip, grade mapping and how
material is picked, is in `src/lib/exams/exam-model.ts`. It is pure and tested
(`tests/exam-model.test.mjs`). Put new rules there, not in a component.

- **Days are Ljubljana days**, as everywhere else in the product.
- **The daily goal** spreads the untried lessons over the days left, but is never less than the
  learner's daily minutes buy (6 minutes a lesson). It is computed against what was left at the
  start of the day, so finishing a lesson moves "done", not the goal.
- **Grades:** university 5–10 (below the pass mark is 5, the rest split into five bands), school
  1–5, or a plain percentage.

## Nothing is generated for an exam

Lessons are assembled when opened from the material the note already has: `flashcards`,
`quiz_questions` and `practice_test_questions`. True/false statements are made from quiz questions
the quiz lesson did not use. If a note has not had that material generated yet, the lesson route
says which generator to start, and the client starts it through the note's own route
(`POST /api/lectures/[id]/study|quiz|practice-test`) and polls. Written answers are marked by the
practice-test grader through `/api/lectures/[id]/practice-test/check`, so they cost exactly what
the palace's written questions cost.

The **mock exam** draws multiple-choice and written questions across the exam's notes, weakest
module first, snapshots them in `exam_mock_attempts` (so a rebuilt question bank cannot rewrite a
past result) and grades the written answers in parallel with `markAnswerWithRetry`. It is the one
paid-only part: setup, path, lessons and readiness follow the notes' own access (a free account can
prep from its free note).

## Tables (`supabase/migrations/0061_exam_prep.sql`)

`exams`, `exam_modules`, `exam_lesson_results`, `exam_mock_attempts`. All four are owner-only by RLS
and every route uses the client that verified the learner (`getRouteUser`).

## Memo, animated

`src/components/exams/memo-buddy.tsx` is the onboarding's Memo (`MascotFigure`, the moves in
`src/lib/onboarding-mascot.ts`) as a reusable in-app character: he breathes, blinks on his own, hops
when tapped, and plays a move when a screen changes his `mood` (cheer with confetti for a right
answer or a passed mock, a droop for a wrong one, a wave hello, a thought cloud while he thinks).
Scripted moves are skipped under `prefers-reduced-motion`; the CSS breathing is stopped by the global
rule.

## Not built yet

Astra has these and the design (`claude.ai` artifact "Memo Izpiti", v2) shows them; they are not in
this version: the oral mock exam, focus mode (iOS Screen Time), classrooms and the invite step,
badges, daily push reminders, uploading new files from inside the setup (it links to the normal
note flow instead), and the "AI may add topics" switch. The landing page shows the "Novo" label but
not yet the exam-prep card or a feature-list entry.
