# Exam prep ("Priprava na test")

A learner names an exam, gives its date and picks the notes it covers; Memo turns that into a
study path. It follows Astra AI's exam-prep flow, drawn in Memo's own components.

## Where it lives

- **"Novo"** (the phone dock button, formerly "Nov zapisek", and the desktop heading above the
  quick actions) opens a sheet whose first item is the coral exam-prep card. Like every option
  there, it always starts something new (`/app/exams/new`). The four note sources follow it.
- **The library:** a learner may have any number of preps, and they live in "Moji zapiski", in
  a folder of their own.
  - Mape, the folder picker, holds "Vsi zapiski" (the notes), then "🎓 Priprave na test" (with
    its count) once there is a prep, then the learner's own folders, in the desktop menu and the
    phone sheet alike. The chip names the open folder. There is no prep list on the notes view.
  - The folder shows every prep, the ones ahead first and past or archived ones under "Pretekli
    izpiti", and a row that starts a new one. Its address is `/app?view=preps`
    (`EXAM_PREPS_HREF`); leaving a prep (the exam's back button, archiving, deleting, closing
    setup) goes there, and arriving that way the chip pulses twice in coral, so a new prep is seen
    to land in it. `/app/exams` redirects there.
  - The rows are note rows; Memo in a ring of mastery marks them as preps. A search in the folder
    matches their titles (`listLibraryExamPreps`, `ExamLibraryList`). Storage stays separate:
    preps are `exams` rows that reference their notes through `exam_modules`, never `lectures`
    rows.
- **Desktop rail:** no entry of its own; "Domov" stays lit on every exam page, and an exam page
  has no "← Domov" link either, since the rail already is one. Lessons and the Generalka keep
  their link back to the exam.
- Routes: `/app?view=preps` (the folder; `/app/exams` redirects there), `/app/exams/new` (setup), `/app/exams/[id]` (dashboard),
  `/app/exams/[id]/lesson?topic=&kind=` (one lesson), `/app/exams/[id]/mock` (mock exam).

What Astra has and how it is known: the research behind this feature read Astra's App Store pages,
astra-ai.co and a paid screen teardown (screensdesign.com); nobody here has used the Croatian or
Slovenian app itself. The screens and the flow follow that. Astra does not publish how it scores
mastery or decides a student is ready, so the learn/practise/prove loop below is ours.

## The model

As in Astra, the path is made of **topics**: when the exam is set up, each note is split into two to
six topics (`planNoteTopics`, one model call per note), the learner keeps, drops, renames or adds
topics on the review, and each kept topic is a **module**. A module is a fixed chain of six lessons:
summary → **tutor** → flashcards → quiz → true/false → one written answer. A module is unlocked when
it is the first one, when the module before it has been learned, or when the learner has already
started it (a locked module offers a test-out quiz).

**Mastery** is the weighted average of the five practice lessons' latest scores (`LESSON_WEIGHT`):
flashcards count half, because the learner grades them ("knew it" or not); the tutor, quiz,
true/false and written answer count in full. The summary counts as done but not as mastery.

**Scores fade** (`fadedScore`, spaced review): a lesson keeps its score for three days, then loses
4 % of it a day, never below 60 %. A perfect lesson against an 85 % target is due again about a
week later, a bare pass sooner, so a topic learned weeks before the exam comes back for review
before it. Lessons due only because they faded show as "Osveži" on the path (`refresh`).

### Until the goal is reached and proved

The exam does not end when every lesson has been opened once. Like Astra, it keeps giving work
until the learner has the knowledge and has shown it (`examStage`, `examNextStep`):

1. **Learn** (`learned`): every lesson of every module done once.
2. **Practise** (`mastered`): every practice lesson's latest score at or above the exam's target.
   A lesson under it comes back on the path as a repeat station, weakest first, and each try draws
   questions the learner has not been shown (see below). Modules are taken in order: the path
   points at the first one not yet mastered.
3. **Prove**: with every module mastered, the mock exam is the next step. Passing it at the target
   makes the learner **ready**. A mock under the target sends the modules it found weak back to
   practise: their quiz and written answer count only once redone after that mock
   (`MOCK_PROOF_KINDS`), and then the mock is next again.
4. **Ready**: the path still offers the weakest lesson each day ("Osveži") until the exam, and a
   score that slips below the target puts that module back into practice.

### The tutor lesson

Right after the summary, the voice tutor teaches the topic (`exam-tutor-server.ts`,
`ExamTutorLesson`): it plans three steps from the topic and its note (`planTutorLesson`, the fast
`tutor_turn` model, a few seconds), and in each it explains one point out loud and asks an open
question about it. The answer is spoken or typed. `tutorTurn` marks it against the step's answer
guide: right at the first ask is a full point; otherwise the tutor says what was missing, explains
it and asks again (right then: half; partly right at best: a quarter), then gives the answer and
moves on (`tutorStepPoints`). Results are stored in quarters and shown as a percentage. It runs on
the voice tutor's own session and talking time (`useExamVoice`, shared with the oral mock); with no
microphone, no talking time or no Web Audio it runs in writing, Memo in place of the sphere.

### Practice that does not repeat itself

A lesson's result records the questions it showed (`exam_lesson_results.item_ids`). The next try of
a quiz, true/false or written lesson draws questions this learner has not seen in the topic
(`preferUnseen`; quiz and true/false share a pool); when the topic has fewer unseen than a lesson
needs, fresh questions are written for it (`writeFreshQuestions`, `needsFreshItems`) and kept on the
topic (`exam_topics.extra`). Flashcards are memorised, so they come back by the note's own spaced
repetition instead. The mock exam holds back every question the learner practised and fills the
time with unseen ones, written for the mock where the banks run short; practised questions come back
only if that writing fails. AI-written questions carry ids that say where they live
(`gen:<topic>:q3`, `x:<topic>:w0`), so practised ones are recognised everywhere.

The daily goal counts the repeats still owed, not only untried lessons. The lesson's done screen
applies the same rule to decide what comes next (the next lesson, a repeat, the next module, or the
mock exam) and says when a score is under the target.

All of that arithmetic, plus the daily goal, the streak, grade mapping and how
material is picked, is in `src/lib/exams/exam-model.ts`. It is pure and tested
(`tests/exam-model.test.mjs`). Put new rules there, not in a component.

- **Modules are topics** (`examModuleStates` takes `{ topicId, lectureId }` pairs and lesson results
  carry `topic_id`); access, grading and the mock exam still go by the topic's note.
- **Days are Ljubljana days**, as everywhere else in the product.
- **The daily goal** spreads the untried lessons over the days left, but is never less than the
  learner's daily minutes buy (6 minutes a lesson). It is computed against what was left at the
  start of the day, so finishing a lesson moves "done", not the goal.
- **Grades:** the setup only offers a target percentage (75/90/100 %); the model still maps
  university 5–10 and school 1–5 scales, which older rows or a future setting may use.

## Setup

`src/components/exams/exam-setup.tsx` is one screen per question, laid out like the app onboarding:
a back (or close) button beside the progress bar, Memo saying the question in a typed-out bubble,
one coral button at the bottom, everything centred and fitting one phone screen. The steps are
intro → material → **AI may add topics** (Astra's switch; off and recommended, with Astra's "not
recommended" warning when on) → subject → date (a bare month calendar) → a motivating summary →
target % (a gauge dragged by hand) → **school and year** (onboarding's options, starting from the
learner's onboarding answer) → daily minutes → "Creating your study path" → review → create.

**The study path is planned in the background** (`POST /api/exams/plan`) as soon as the material and
the switch are settled, the way Astra reviews the uploads while the learner answers the rest; the
building screen only waits for it. The **review** is Astra's topic checklist, one group per note:
untick to leave a topic out, the pencil to rename it, "Dodaj temo" to add one's own. Nothing is
stored until "Start"; `createExam` stores the topics as the learner left them. A note that was still
being made at setup has no topics yet; the exam screen plans them (`POST /api/exams/[id]/topics`)
once it is ready.

**Material leads with new uploads.** The primary card opens the normal note-source modal (document
or photos, recording, audio file, link) on top of the setup; `NoteSourceModal`'s `onCreated` hands
the new note's id back instead of navigating to it, and the note joins the exam while it is still
being made (`createExam` accepts any owned note that has not failed). Notes already in the app are
the secondary choice, behind "Ali izberi iz svojih zapiskov". Without `canCreateNotes` the upload
card sends the learner to `/app/start`.

## The exam screen

`/app/exams/[id]` is one path down the screen, as Astra and Duolingo draw a course: the exam's
title and three numbers (days left, mastery against the goal, lessons today), then each module as
a heading with its five lessons as round stations on a line that swings left and right. The
station to do next carries the only call to action ("Začni · Povzetek") and Memo stands beside it;
the screen opens scrolled to it. Done stations turn coral, a locked module's stations show a lock
and its heading offers "Preskoči" (the test-out quiz). The mock exam (🏆) and the exam day (🏁)
end the path. The geometry is `src/lib/exams/exam-path.ts` (tested in `tests/exam-path.test.mjs`);
keep its row height in step with `.memo-exam-station` in `redesign.css`.

## Where a topic's lessons come from

A **material topic** (`source = 'material'`) teaches from what the note already has: `flashcards`,
`quiz_questions` and `practice_test_questions`, sorted into the note's topics the first time a
lesson of that kind is opened (`ensureTopicItems`, one cheap model call per note and kind; the ids
land on `exam_topics`, and a regenerated note is sorted again). A topic with too few items is topped
up from the rest of its note. Its summary lesson is the topic's own summary and key points, and
"Poslušaj" plays it (`POST /api/exams/[id]/topics/[topicId]/speech`: spoken once per voice into
storage, then a signed link). True/false statements are made from quiz questions the quiz lesson
did not use.

A topic the learner **added**, or one the **AI added** (only with the switch on, at most two, things
an exam on the subject usually asks that the material leaves out), has nothing to draw on: its
summary, cards, quiz and two written questions are written for it the first time one of its lessons
opens (`writeTopicContent`), grounded on the note where it says anything. Its written answers are
marked through `POST /api/exams/[id]/written`. If a note has not had that material generated yet, the lesson route
says which generator to start, and the client starts it through the note's own route
(`POST /api/lectures/[id]/study|quiz|practice-test`) and polls. Written answers are marked by the
practice-test grader through `/api/lectures/[id]/practice-test/check`, so they cost exactly what
the palace's written questions cost.

The **mock exam** ("Generalka") is written or oral, as in Astra. Its length is set on the same gauge
(written 10–120 min, oral 5–30 min, in fives). The written one draws multiple-choice and written
questions across the exam's notes, weakest note first, snapshots them in `exam_mock_attempts` (so a
rebuilt question bank cannot rewrite a past result) and grades the written answers in parallel with
`markAnswerWithRetry`.

The **oral** one (`src/components/exams/exam-oral.tsx`) is a voice examiner built on the tutor's
speech: the same session route, Soniox keys, recogniser, speech output, sphere and talking-time
allowance (counted on one of the exam's notes). The learner picks the examiner's manner (strict,
recommended; friendly; encouraging) and a voice, reads Astra's instructions and presses "Pripravljen
sem". The examiner asks each question (the microphone is muted while it speaks), listens, and after
each answer either asks one follow-up about what was missing or moves on
(`POST /mock/[attemptId]/oral`, `examinerTurn`); it never says whether an answer was right. Oral
questions are all open: the notes' written questions, then quiz questions asked openly and marked
against their right answer. The transcribed answers are graded like a written mock.

Results show the grade, the time spent, the review (strengths, weak points, a recommendation) and
the answers; "Ponovi generalko" retries and "Nadaljuj" returns to the path. The mock exam is the
one paid-only part: setup, path, lessons and readiness follow the notes' own access (a free account
can prep from its free note).

## Tables (`supabase/migrations/0062_exam_prep.sql`, `0063_exam_tutor_and_fresh_questions.sql`)

`exams`, `exam_modules`, `exam_topics`, `exam_lesson_results`, `exam_mock_attempts`. All are
owner-only by RLS and every route uses the client that verified the learner (`getRouteUser`). The
migration was first written as 0061 and applied to staging only; PR #579 claimed 0061 too, so it
moved to 0062 (staging's 0061 record was reverted and its tables dropped first). `0063` adds the `tutor`
lesson kind, `exam_lesson_results.item_ids` and `exam_topics.extra`; it was applied to staging
(with the owner's go-ahead) from this branch, never to production.

## Memo, animated

`src/components/exams/memo-buddy.tsx` is the onboarding's Memo (`MascotFigure`, the moves in
`src/lib/onboarding-mascot.ts`) as a reusable in-app character: he breathes, blinks on his own, hops
when tapped, and plays a move when a screen changes his `mood` (cheer with confetti for a right
answer or a passed mock, a droop for a wrong one, a wave hello, a thought cloud while he thinks).
Scripted moves are skipped under `prefers-reduced-motion`; the CSS breathing is stopped by the global
rule.

`src/components/animated-lockup.tsx` puts the same Memo into the "Memo AI" lockup in the app's own
chrome (phone home bar, desktop header): the lettering is the lockup image cropped by `clip-path`,
the brain is a live `MemoBuddy` laid exactly over the image's brain, and a sheen masked by the
lockup crosses it now and then. The landing, paywall and onboarding keep the still image.

## Not built yet

Astra has these and they are deliberately not built (owner's decision, 2026-10-15): focus mode (iOS
Screen Time), classrooms and shared or public exam preps, the "+2 grades or refund" guarantee, and
real past matura papers. Nor are Astra's date strip, quick date buttons and Modules/Path/Plan tabs:
the owner asked for the simpler screens. The landing page shows the "Novo" label but not yet the
exam-prep card or a feature-list entry.
