# Exam prep ("Priprava na test")

A learner names an exam, gives its date and picks the notes it covers; Memo turns that into a
study path. It follows Astra AI's exam-prep flow, drawn in Memo's own components.

## Where it lives

- **"Novo"** (the phone dock button, formerly "Nov zapisek", and the desktop heading above the
  quick actions) opens a sheet whose first item is the exam-prep card (the folder's 🎓 in a coral tile, a faint coral edge,
  no arrow). Like every option
  there, it always starts something new (`/app/exams/new`). The four note sources follow it.
- **The library:** a learner may have any number of preps, and they live in "Moji zapiski", in
  a folder of their own.
  - Mape, the folder picker, holds "Vsi zapiski" (the notes), then "🎓 Priprave na test" (with
    its count) once there is a prep, then the learner's own folders, in the desktop menu and the
    phone sheet alike. The chip names the open folder. There is no prep list on the notes view.
  - The folder shows every prep, the ones ahead first and past or archived ones under "Pretekli
    izpiti". A new prep starts from "Novo" only. Its address is `/app?view=preps`
    (`EXAM_PREPS_HREF`); leaving a prep (the exam's back button, archiving, deleting, closing
    setup) goes there, and arriving that way the chip pulses twice in coral, so a new prep is seen
    to land in it. `/app/exams` redirects there.
  - The rows are note rows; an exam emoji (📝 📚 🎓 …, one per row in turn) in a ring of mastery
    marks them as preps. A search in the folder matches their titles, and one that matches nothing
    says so rather than showing the "no preps yet" screen (`listLibraryExamPreps`, `ExamLibraryList`). Storage stays separate:
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
topics on the review, and each kept topic is a **module**. A module has six lessons: the
**summary**, and five **practice formats**: the voice **tutor**, flashcards, a quiz, true/false and
one written answer. A module is unlocked when it is the first one, when the module before it has
been learned, or when the learner has already started it (a locked module offers a test-out quiz).

**The learner chooses the format** (Astra's next-lesson screen does the same: it suggests a lesson
and lets the student pick how to take it). Nobody is made to talk to the tutor or to write answers:

- A module is **learned** once its summary is read and any **two different practice formats**
  have been done (`MIN_PRACTICE_FORMATS`, so `LESSONS_TO_LEARN` is 3). Two, so a topic is always
  checked in more than one way; never all five, so no one format is forced.
- It is **mastered** when it is learned and every practice format the learner *has done* in it is
  at its pass mark. Formats never tried do not count against it; one tried by choice and failed
  does, until it passes.
- The path still **suggests** an order: the summary first, then the first untried format in the
  default order (tutor, flashcards, quiz, true/false, written; `firstPassKind`). Whatever the learner
  picks instead counts the same.

**Mastery** is the weighted average of the latest scores of the formats the learner has done
(`LESSON_WEIGHT`): flashcards count half, because the learner grades them ("knew it" or not); the
tutor, quiz, true/false and written answer count in full. Until two formats are done, each missing
one counts as a full lesson at 0, so one perfect quiz reads as half a topic, not all of it. The
summary counts as done but not as mastery.

**Scores fade** (`fadedScore`, spaced review): a lesson keeps its score for three days, then loses
4 % of it a day, never below 60 %. A perfect lesson against an 85 % target is due again about a
week later, a bare pass sooner, so a topic learned weeks before the exam comes back for review
before it. Lessons due only because they faded show as "Osveži" on the path (`refresh`), and a
mastered module due for one reads "obvladano · čas za osvežitev". **Fading only schedules a
refresh; it never un-masters a module.** Only a new try under the pass mark, or a failed mock, does.
Without that, a big exam could never be mastered all at once (with every format, 8 topics × 5
lessons at 5 a day: the first lessons fade below 90 % before the last ones are done), and the mock
would never come up.

**Pass marks** (`lessonPassThreshold`, `lessonPassed`): the learner sees the target they chose, but
each lesson is checked against a mark it can actually score. No mark is above 95 %
(`LESSON_PASS_CAP`), so a 100 % target does not demand flawless lessons forever. The tutor, marked
1 / ½ / ¼ per step over three steps, passes at 2.5 of 3 at most (one step right only after the
explanation). Scores are stored as `real` (9/10 reads back as 0.8999…), so every comparison allows
a 0.0001 margin. Displayed percentages round **down** (`percent`, `wholePercent`): 89.6 % against a
90 % mark shows "89 %", never the mark itself.

### Until the goal is reached and proved

The exam does not end when every lesson has been opened once. Like Astra, it keeps giving work
until the learner has the knowledge and has shown it (`examStage`, `examNextStep`):

1. **Learn** (`learned`): every module's summary and two formats of the learner's choice done once.
2. **Practise** (`mastered`): the latest score of every format the learner has done at its pass
   mark. A lesson under it comes back on the path as a repeat station, weakest first, and each try
   draws questions the learner has not been shown (see below).

The order of next steps (`examNextStep`): first the suggested first-pass lessons of the first module
that is not learned and can be opened (one whose note is still being made, or whose topics are not
planned yet, is skipped and does not hold back the ones after it), so the whole exam is learned
before anything is repeated; formats beyond the two are never suggested, only offered; then
lessons under their mark, weakest first across modules, except one that has already failed twice
today (`MAX_FAILED_TRIES_PER_DAY`), which rests until tomorrow so one hard lesson cannot hold up the
plan; in the prove stage, the mock; then the most faded lesson (once ready, the weakest format the
learner has done; never one they did not choose). A learner who plateaus under a mark keeps
practising and does not get the mock. The lesson screen's "next" button takes the same step.
3. **Prove**: with every module mastered, the mock exam is the next step. Passing it at the target
   makes the learner **ready**. A mock under the target sends the modules it found weak back to
   practise (`proofOwed`): each needs any one practice format redone, and passed, after that mock
   (`MOCK_PROOF_KINDS` is every format; the path suggests the weakest one the learner has done),
   and then the mock is next again.
4. **Ready**: the path still offers the weakest lesson each day ("Osveži") until the exam, and a
   score that slips below the target puts that module back into practice.

### Choosing the lesson format

The lesson screens keep **one coral button**, the suggested next lesson, and under it a row of chips,
"Ali izberi drugače", with the module's other practice formats (`lessonFormatChoices`): each with
its emoji (`LESSON_KIND_EMOJI`) and name, and a tick with its latest score once done. The chips sit
in the content, not in the bottom button bar.

- **The summary** offers them under "Hitro branje"; tapping one saves the summary as
  read and opens that format instead of the suggested one.
- **The done screen** offers them under the score, leaving out the lesson just finished and the
  one the button already suggests. What the button suggests comes from `moduleAfterLesson`, the
  model's rules applied to the lesson just saved: the next first-pass format while the module is
  not learned, else a format under its mark, else the path's next module (`after`, from
  `examNextStep` with the stage as if this module were mastered) or the mock exam. The headline
  says "Modul naučen!" or "Modul obvladan!" by the same rules.
- **The path** draws all six stations. Once a module is learned, the formats the learner did not
  pick are quiet, optional stations ("po želji"), never locked. Every station of an open module
  can be tapped at any time, practice ones before the summary too: the path suggests the summary
  first but does not insist (a locked module's stations still open the test-out quiz). The
  station with the call to action is always `examNextStep`'s, so it is never an optional one.

### The tutor lesson

Suggested right after the summary (the first format in the default order), the voice tutor teaches
the topic (`exam-tutor-server.ts`,
`ExamTutorLesson`): it plans three steps from the topic and its note (`planTutorLesson`, the fast
`tutor_turn` model, a few seconds), and in each it explains one point out loud and asks an open
question about it, and the learner answers out loud. `tutorTurn` marks it against the step's answer
guide: right at the first ask is a full point; otherwise the tutor says what was missing, explains
it and asks again (right then: half; partly right at best: a quarter), then gives the answer and
moves on (`tutorStepPoints`). Results are stored in quarters and shown as a percentage.

It looks and works like the app's own voice tutor on a note (`LectureTutor`), with the same markup
and styles: the sphere riding the voice, the voice row and "Začni" before it starts, a one-word
status with its dot, the topic row with its bar, and the round transport (go back over the
point, pause, end). While the tutor speaks its words run as live captions, a sentence at a time
with the one before fading above (`spokenSoFar` on the speech output, the read position over each
piece's estimated character timings); while the learner talks, their own words are captioned.
It is a conversation: the learner answers out loud and going quiet ends the answer. It runs on the
voice tutor's own session and talking time (`useExamVoice`, shared with the oral mock).

Without a microphone it still speaks and the learner types the answers ("Poskusi z mikrofonom"
tries again). The tap on "Začni" plays a silent blip that unlocks Web Audio (a microphone capture
used to be what did that), and a voice that cannot start within 6 s gives way to writing rather
than "Pripravljam se" for good. With no talking time or no Web Audio it runs silent, in writing,
with Memo in place of the sphere. The greeting is written by the plan in the note's language.

### Practice that does not repeat itself

A lesson's result records the questions it showed (`exam_lesson_results.item_ids`). The next try of
a quiz, true/false or written lesson draws questions this learner has not seen in the topic
(`preferUnseen`; quiz and true/false share a pool); when the topic has fewer unseen than a lesson
needs, fresh questions are written for it (`writeFreshQuestions`, `needsFreshItems`) and kept on the
topic (`exam_topics.extra`). Flashcards are memorised, so they come back by the note's own spaced
repetition instead. The mock exam holds back every question the learner practised and fills the
time with unseen ones, written for the mock where the banks run short; practised questions come back
only if that writing fails. AI-written questions carry ids that say where they live
(`gen:<topic>:q3`, `x:<topic>:w0`), so practised ones are recognised everywhere. A fresh question's
number is a serial stored with it (`n`, counted on from `extra.next`), never its place in the list:
the list keeps only the newest (`FRESH_KEEP`), and a place would hand a seen question's id to a new
one. Fresh questions stored before serials keep their place as their number. Two lessons topping up
the same topic at once cannot both write: the write only lands while `extra.next` is what was read.

The daily goal counts the repeats still owed, not only untried lessons. The lesson's done screen
applies the same rule to decide what comes next (the next lesson, a repeat, the next module, or the
mock exam) and says when a score is under the target.

All of that arithmetic, plus the daily goal, the streak, grade mapping and how
material is picked, is in `src/lib/exams/exam-model.ts`. It is pure and tested
(`tests/exam-model.test.mjs`). Put new rules there, not in a component.

- **Modules are topics** (`examModuleStates` takes `{ topicId, lectureId }` pairs and lesson results
  carry `topic_id`); access, grading and the mock exam still go by the topic's note.
- **Days are Ljubljana days**, as everywhere else in the product.
- **The daily goal** spreads the lessons still needed to learn each module (`lessonsLeft`: the summary
  and two formats) and the repeats owed over the days left, but is never less than the
  learner's daily minutes buy (6 minutes a lesson). It is computed against what was left at the
  start of the day (the modules on the results from before today, `planFor`), so finishing a
  lesson, a first try or a repeat, moves "done", not the goal. Once the exam day has passed there
  is no goal.
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
building screen only waits for it. The **review** is the AI's plan, read-only (the owner wanted the
plan made for the learner, not edited by them): a numbered path of modules, one card per topic with
its note and the emojis of what it holds, then the mock exam and the goal. The planner asks for at
least two topics per note and asks again when an answer has fewer (`planNoteTopics`). Nothing is
stored until "Start"; `createExam` stores the planned topics. A note that was still being made at
setup has no topics yet; the exam screen plans them (`POST /api/exams/[id]/topics`) once it is ready.

**Material leads with one upload field.** "Naloži gradivo" takes anything a note can be made from:
tap to pick files, photos or the camera, or drop files on it. The picked files open the normal
note-source modal (`initialFiles`), which takes them as it takes a drop: one audio file is a
recording, anything else documents or photos. There is no separate record or link option here.
`NoteSourceModal`'s `onCreated` hands the new note's id back instead of navigating to it, and the
note joins the exam while it is still being made (`createExam` accepts any owned note that has not
failed). Notes already in the app are the secondary choice, behind "Ali izberi iz svojih zapiskov".
Without `canCreateNotes` the field sends the learner to the paywall.

## The exam screen

`/app/exams/[id]` is one path down the screen, as Astra and Duolingo draw a course: the exam's
title and three numbers (days left, mastery against the goal, lessons today), then each module as
a heading with its six lessons as round stations on a line that swings left and right (formats the
learner did not choose for a learned module are drawn quieter, as optional). The
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
up from the rest of its note. Its summary lesson is the topic's own summary and key points, to read
or speed-read (the read-aloud "Poslušaj" was taken out at the owner's request; the tutor is the
spoken lesson). True/false statements are made from quiz questions the quiz lesson did not use.

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

## Tables (`supabase/migrations/0068_exam_prep.sql`, `0069_exam_tutor_and_fresh_questions.sql`)

`exams`, `exam_modules`, `exam_topics`, `exam_lesson_results`, `exam_mock_attempts`. All are
owner-only by RLS and every route uses the client that verified the learner (`getRouteUser`); an
update cannot move a module, topic or mock attempt onto another exam or note (`0069` recreates the
update policies with the insert policies' checks). `0069` adds the `tutor` lesson kind,
`exam_lesson_results.item_ids` and `exam_topics.extra`. Neither is on production.

The numbers moved while the PR was open, because `supabase db push` refuses a local migration older
than the newest one production has: 0061 → 0062 (PR #579 took 0061), 0062/0063 → 0065/0066 (main
shipped 0064), 0065/0066 → 0068/0069 (main shipped 0067). Each time, staging's old records were
reverted only after the exam tables were dropped (so the revert is true), and the files were pushed
again under the new numbers. Never `repair --status applied`.

## Access and limits

- Setup, planning, lessons, the tutor and readiness follow the notes' own access
  (`canUseLectureFeatures`): `POST /api/exams` leaves out a note the account cannot study and
  answers 402 when none is left; `POST /api/exams/[id]/topics` plans only studiable notes.
- The mock exam is paid-only at every step: starting it, each oral examiner turn and the hand-in.
  An attempt takes turns and a hand-in until 30 minutes after its clock ran out
  (`mockAttemptExpired`); after that it is closed (`failed`).
- An archived exam takes no lessons, tutor turns or mocks (409); its lesson page sends the learner
  back to the exam screen, which offers to bring it back.
- The lesson route has the read limit, since the client polls it; a load that has to call the
  model (the tutor's plan, sorting items into topics, writing a topic's lessons or fresh questions)
  is also held to the expensive limit. A lesson written for the first time is only stored if no
  other request stored one first.
- Topics planned on the exam screen are checked again before they are stored, and if two requests
  still stored a plan for the same note, the first stored is kept (`keepFirstPlan`).

## Memo, animated

`src/components/exams/memo-buddy.tsx` is the onboarding's Memo (`MascotFigure`, the moves in
`src/lib/onboarding-mascot.ts`) as a reusable in-app character: he breathes, blinks on his own, hops
when tapped, and plays a move when a screen changes his `mood` (cheer with confetti for a right
answer or a passed mock, a droop for a wrong one, a wave hello, a thought cloud while he thinks).
Scripted moves are skipped under `prefers-reduced-motion`; the CSS breathing is stopped by the global
rule.

`src/components/animated-lockup.tsx` puts the same Memo into the "Memo AI" lockup in the app's own
chrome (phone home bar, desktop header): the lettering is `public/memo-wordmark.png` (the lockup's
own pixels with the brain taken out and the sticker outline closed round the "M"; a `clip-path` crop
of the lockup left the M's outline cut flat), the brain is a live `MemoBuddy` laid exactly over the
image's brain, livelier than elsewhere (a hop every 3–5.5 s, a blink every 1.4–3.2 s), and a sheen
masked by the lettering crosses it every 4.5 s. A tap anywhere on the lockup makes him hop with a
sparkle and runs the sheen at once. The landing, paywall and onboarding keep the still image.

## Not built yet

Astra has these and they are deliberately not built (owner's decision, 2026-10-15): focus mode (iOS
Screen Time), classrooms and shared or public exam preps, the "+2 grades or refund" guarantee, and
real past matura papers. Nor are Astra's date strip, quick date buttons and Modules/Path/Plan tabs:
the owner asked for the simpler screens. The landing's hero phone shows the exam-prep row in its
"Novo" sheet (the app's own `ExamEntryCard`); tapping it there only closes the sheet, since the
landing has no exam screens. Exam prep is not in the landing's feature list or FAQ.
