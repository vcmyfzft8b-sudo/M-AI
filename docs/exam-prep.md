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

What Astra has and how it is known: the first research read Astra's App Store pages, astra-ai.co
and a paid screen teardown (screensdesign.com). On 2026-10-16 an exam prep was then made and
studied in Astra's web app itself (Economics, ten days, 75 % goal). What it does to get a student to
the goal, and what we took from it:

- **What is repeated, and until when.** Every check a student misses is a knowledge gap that comes
  back until it is answered right; a lesson ends by retrying its misses "asked a different way";
  the next lesson goes after the weak sub-topic. → our knowledge gaps (below).
- **A forecast.** Readiness against the goal, and "at this pace you'll be at about 3 % on exam
  day", from the gain per lesson and the lessons of the last 14 days. → `examForecast`.
- **The plan's phases:** start (intro lesson, diagnostic quiz), learn and practise (podcast, tutor,
  quizzes, true/false, oral mock), spaced repetition, close knowledge gaps, written mock without AI
  help, exam day (flashcard refresher, final weak-spot check). → our learn / practise / close gaps /
  prove stages, fading for spaced review, and the exam-day refresher.
- Not taken: the familiarity and mood questions before the first lesson, the learning-style
  question at setup (our learner picks the format per lesson instead), podcasts and videos, the
  per-week topic heatmap, duels and sharing.

## The model

It works the way Astra AI's exam prep works, measured in its app on 2026-10-16 (three lessons,
their scores and what each did to the numbers). All of it is in `src/lib/exams/exam-model.ts`, pure
and tested (`tests/exam-model.test.mjs`, and `tests/exam-plan.test.mjs`, which runs simulated
learners through weeks of lessons). Put new rules there, not in a component.

- **Topics.** When the exam is set up, each note is split into two to six topics (`planNoteTopics`),
  and each topic is a **module** on the path. Lessons are of six kinds: the **summary** (read), the
  voice **tutor**, **flashcards**, a **quiz**, **true/false** and a **written** answer.
- **Mastery, lesson by lesson.** Every lesson moves its topic's mastery a step towards what the
  lesson showed the learner knows: `m' = m + 0.2 × weight × (known − m)` (`masteryAfterLesson`,
  `MASTERY_RATE`). That is Astra's rule (its topic went 0 → 5 → 15 → 23 % after lessons of 40, 100 and
  71 %, a step of 0.12) with a bigger step: simulated learners (below) showed that at 0.12 the average
  lags so far behind what a learner knows that half of those who knew the material at their goal
  were never told they were ready before the exam. So mastery is accuracy, earned over many lessons:
  about nine good lessons take a topic from 0 to 75 %, and a learner who knows 70 % never reaches a
  75 % goal. The summary tests nothing and moves nothing; flashcards, which the learner grades, move
  half as far (`MASTERY_WEIGHT`).
- **Lucky guesses are taken out** (`knownShare`, `GUESS_RATE`): a true/false statement is right half
  the time by chance and a four-option question a quarter, so 80 % on true/false counts as 60 %
  known and 50 % as nothing. Without it a learner who knows little would reach the goal on guessable
  lessons alone.
- **Does it work?** `tests/exam-plan.test.mjs` runs simulated learners whose true knowledge the model
  cannot see: it grows with every lesson, fades on days off, and answers follow it (with lucky
  guesses, and flashcards graded a little generously). Across 48 such learners per goal (4 topics,
  7 or 14 days, 8 lessons a day), those the prep called ready knew on average 81 % at a 75 % goal
  (lowest 73 %; at least 76 % on the exam day) and 94 % at a 90 % goal (lowest 93 %). The tests fail
  if a learner called ready knows less than the goal, or if one who clearly knows it is never told.
- **Readiness** is the average mastery over every topic of the exam, started or not (Astra: 23 % on
  one of four topics reads as 6 %). A topic is **on target** when its mastery reaches the goal.
- **Spaced review.** A topic keeps its mastery for three days after its last lesson, then fades 4 %
  a day (never below 60 % of what was earned), so a topic learned early drops under the goal and
  comes back before the exam (a "Ponovitev"). One lesson brings it back: fading runs from the last
  lesson.
- **Pass marks** (`lessonPassThreshold`) still decide whether one lesson "failed" (for the rule
  below that rests a format failed twice in a day). No mark is above 95 % (`LESSON_PASS_CAP`), so a
  100 % goal means 95 % mastery; the tutor's mark is never above what one slip leaves (2.5 of 3).

### The path, one lesson at a time

As in Astra, the path is one lesson after another, and the path picks the next one
(`examNextStep`):

1. **Learn.** The first open topic that has not reached the goal yet. Topics open in order, and
   **only reaching the goal opens the next one** (the owner's rule, 2026-10-17): no number of lessons
   under it does, so a learner at 0 % stays in the module and its lessons keep coming. The path
   draws what it still needs after "Naslednja" as locked stations (`lessonsToTarget` from the
   module's knowledge now, at most 12 drawn, "Še 9 lekcij do 90 %"), so a weak lesson visibly adds
   stations, and the next module sits under its own locked heading ("Odklene se, ko modul 1 doseže
   90 %"). The lesson's done screen says the same under the bar. **Reaching the goal once is what
   counts** (`topicMastery`'s `peak`): a later lesson that dips under it does not shut the next
   module again; the dip is practised like a faded topic. A module studied before the one ahead of
   it reached the goal (old data, or a link) is shut again until it does, and the lesson page sends
   a link to a shut module back to the path. The path is drawn **module by module** in path order
   (each open module's lessons done, "Naslednja" and what it still needs in its own module, then
   the first shut module's heading), not in the order lessons were done, so a module's run never
   looks finished while it is under the goal. Until 2026-10-17 four practice lessons opened the next module whatever the score; that is
   gone, and with it the guarantee that every topic is reached before the exam: a learner who cannot
   reach the goal in one module never sees the later ones.
2. **Close gaps.** A topic's open knowledge gaps (below), the topic with the most first.
3. **Practise.** The open topic furthest under the goal (faded ones included).
4. **Exam day.** On the exam's eve and the day itself, a flashcard refresher for each topic.
5. **Prove.** With every topic on target, the mock exam. Passing it at the goal makes the learner
   **ready**; a mock under the goal asks the topics it found weak for a lesson after it
   (`proofOwed`), and then the mock is next again.
6. **Keep sharp.** Once ready, the weakest topic's next lesson, until the exam.

**The format** of that lesson rotates by itself (`suggestedKind`), as Astra's "Next up" does (intro,
smart text, quiz, exercise, …): every format once, in the order summary, tutor, quiz, written,
true/false, flashcards, then round the practice ones; open gaps first, in the format that asks them
the other way round. A format failed `MAX_FAILED_TRIES_PER_DAY` (2) times today rests until tomorrow.
The learner can swap it for any other (below); the suggestion is only the default.

The daily goal (`dailyPlan`) spreads the lessons every topic still needs to reach the goal
(`lessonsToTarget`, assuming about 90 % right answers), a lesson per topic's gaps and owed proofs,
over the days left, never less than the learner's daily minutes buy (6 minutes a lesson). It is
computed against what was left at the start of the day, so finishing a lesson moves "done", not the
goal. Days are Ljubljana days, as everywhere else in the product.

### The check ("Preverjanje") and what "ready" means

A topic counts as on target for readiness only once it has **passed a check lately**: a test
(`CHECK_KINDS`: quiz, written answer, tutor) scoring at the goal by its own score, guessing taken
out (`knownShare`), within `REVIEW_GRACE_DAYS` (3) of now. A topic at the goal without one has
`checkDue`, and its next station is the check: a quiz of `CHECK_QUIZ_SIZE` (10) questions
(`&check=1` on the lesson, mostly unseen questions, since the server writes fresh ones when fewer
than ten are left), then a written answer if the quiz failed twice that day. The result screen says
"Preverjanje opravljeno" or "Še ne čisto". Self-graded flashcards and half-guessed true/false never
count as a check. Opening the next module still goes by the estimate (`peak`), not by a check.

Why this shape, measured on 48 simulated learners per goal (4 topics, 14 days, 8 practices a day,
hidden true knowledge that grows with practice and fades; 2026-10-17):

| Rule | 75 %: ready / truly at goal on every topic | 90 %: ready / truly at goal | ready learners' topics >5 pts under |
|---|---|---|---|
| Estimate only (before) | 44 / 42 | 16 / 11 | 6 % / 9 % |
| A check before each module opens, and lately for ready | 37 / 39 | 5 / 4 | 1 % / 5 % |
| **Estimate opens; a recent check for ready (built)** | **40 / 44** | **10 / 12** | **3 % / 5 %** |

Checking before every module opened stopped lucky openings (from 3–4 % to 1 % of modules) but
spent the days later modules needed, so fewer learners reached the goal at all; the final check
round catches a lucky module before "ready" anyway and keeps old topics fresh. Pooling the last two
tests, or a lenient pass mark (raw score at the goal), made readiness less honest. What remains is
the limit of ten questions: they cannot always tell 70 % from 75 %, so a ready learner's topic can
still be a few points under (the test allows one in 60+ topics more than ten points under, none
fifteen). At a 100 % goal nobody finished four topics in 14 days, under any rule.

### 100 % is reachable

The average closes 20 % of the gap per practice, so perfect answers alone would creep to 99.9 %
and show 99 % for ever. `masteryAfterPractice`: a topic at `FULL_FROM` (90 %) or more whose last
`FULL_RUN` (3) tests (quiz, written answer, tutor) were all fully right goes to 100 %; any miss resets
the run, flashcards neither count nor break it. A 100 % goal therefore means 100 % per topic
(`masteryGoal`); lesson pass marks and the mock exam keep the 95 % cap (`passThreshold`), since a
single lesson or a written mock should not have to be flawless. Between topics equally strong (several at 100 %),
the next review goes to the one practised longest ago, so reviews rotate instead of sticking to the
first. Simulated learners who learn fast all reached "ready" at a 100 % goal (by day 9 on average,
each topic truly at 95 %+); slower ones do not in two weeks, which is the honest answer.

### Found clicking through a fresh prep (2026-10-17)

- **Lesson material starts at setup** (`warmExamMaterial`): a note's flashcards, quiz and written
  questions are queued right after the prep is created and after a pending note is planned. Before,
  they were made only when a lesson first asked, one generator at a time.
- **A Lekcija waits for its parts**: a part still being made (or not started, which the screen
  starts, each generator once) makes the whole lesson show "being prepared" instead of opening as a
  reading that tests nothing.
- **Each format gets one turn in the first pass** (`suggestedKind`): the n-th lesson offers the first
  untried format from the n-th place on, so a tutor swapped away (no microphone) is not offered every
  time; it comes back in the rotation.
- **The mock**: a written mock left mid-way reopens with its answers and at the first unanswered
  question; the chosen answer shows the ink ring; position is one progress bar, not a step per
  question; a second hand-in returns the first grade.
- Planning stops starting notes after 75 s (`PLAN_BUDGET_MS`), the rest come back pending.

### Knowledge gaps: what comes back, and until when

A lesson's result records which of the questions it showed the learner got wrong
(`exam_lesson_results.missed_ids`, migration `0070`): a wrong quiz answer or true/false call, or a
written answer marked under 3 of 5. A question missed and not answered right since is an open
**knowledge gap** (`openGaps`, replaying the topic's results in order). Only the quiz, true/false and
written lessons open and close gaps: flashcards are graded by the learner and return by the note's
own spaced repetition, and the summary and tutor show no stored questions.

- **Asked again first.** The next quiz, true/false or written lesson of the topic starts with its
  open gaps, up to 60 % of the lesson (`withGapsFirst`, `GAP_SHARE_OF_LESSON`), and fills the rest
  with questions the learner has not seen. Quiz and true/false share questions, so a gap comes back
  "another way": missed in the quiz, asked as a true/false statement, and the reverse
  (`gapLessonKind`). Those questions carry a "Ponovitev · prej ni šlo" tag.
- **Retried before the lesson ends.** A quiz or true/false lesson asks its misses once more before
  it finishes ("Še enkrat"), the quiz with its answers in reverse order and a false statement with
  the right answer as the claim. The score is the first try's. A miss answered right there is
  closed, as Astra counts it (its gaps stayed at 0 after a miss fixed in the lesson's own repeat);
  one missed again stays open.
- **On the path.** Once every topic is learned, a topic's gaps are the next step, the topic with
  the most first, **before the mock exam** (Astra closes gaps before its written mock). A gap missed
  `GAP_MAX_MISSES` (3) times still comes back in lessons but no longer holds the path, so one
  question cannot keep the mock away for good. The picker's "Vrzeli" opens them directly (locked
  while there are none). The daily plan counts a topic's gaps as one lesson more.
- **Said out loud.** The done screen says how many gaps the lesson closed and how many questions
  will come back until they are answered right. The goal card and the Napredek tab count the open
  gaps.

### The forecast

Astra's: "each lesson adds about +1.9 %. To reach your goal you need about 37 more lessons, about 4
a day. At this pace you'll be at about 8 % on exam day" (`examForecast`, once two practice lessons
are done). The gain per lesson is readiness over the lessons done; the pace is the lessons of the
last 14 days spread over all 14 (one busy first day is not a pace). The goal card says where the
pace lands ("Po tem tempu ~X % na dan izpita", green with 📈 when it reaches the goal); the Napredek
tab says all of it.

### The exam day

On the exam's eve and the day itself (`finalDay`), after repeats and gaps, each learned topic gets a
flashcard refresher ("Osvežitev pred izpitom") before the mock or anything else, weakest topic first,
as Astra's exam-day routine does.

### The lesson ("Lekcija"): several parts, one station

Astra's main lesson (Smart Text) is not one activity: it is the reading with a check after every
section, a retry of what was missed, and a final quiz, and only all of it together moves the
topic. Ours is the same idea with the app's own screens: **Lekcija** (`summary`) is the topic's
reading, then a few flashcards (4), the quiz (5) and a written answer, one after another, each the
app's own lesson of that kind (`LESSON_PARTS`; the header shows Branje · Kartice · Kviz · Pisni
odgovor). Their scores add up into the lesson's one result (cards known + quiz right + written
marks), which moves the topic's mastery like any lesson. A part whose material is not ready is left
out; a lesson with no part at all is the reading alone, is saved with nothing to score (`total` 0)
and moves nothing. Questions shown in a lesson count as seen for the quiz, true/false, written and
flashcard lessons after it, and its quiz misses are knowledge gaps (its written misses are not: no
later quiz could ask them). It is every topic's first station; the single-format lessons come after
it, as Astra's practice lessons do.

**Fixing a written answer, with a hint.** Astra's exercise is one applied problem the tutor walks the
learner through, naming the trap when an answer goes wrong and asking the next step. Our written
answer keeps its marking and adds the guided second try: an answer marked under 3 of 5 offers
"Popravi z namigom", which shows what it missed as the hint and keeps the answer to fix; the second
marking and the first count half each. The tutor lesson is the fully guided, step-by-step version.

### Choosing the lesson format

The bottom bar of the path has Astra's two buttons: the round **swap** button and the coral
**"Nadaljuj · <lesson>"**. Swap opens the **"Naslednja lekcija"** picker (a sheet on the phone, a
dialog on desktop), in Astra's three tabs:

- **Nauči se:** Lekcija, Tutor, Kartice, and **Vrzeli** (the topic's open gaps; locked while there
  are none).
- **Vadi:** Kviz, Drži / ne drži, Pisni odgovor, and **Ponovitev** (the topic's weakest format again;
  locked until the topic has had `REPETITION_AFTER` (3) practice lessons).
- **Izpit:** the written and the oral mock exam, at any time.

Topic chips choose the topic (the open ones; the path's next topic first), and the path's suggestion
is marked "Priporočeno". Whatever the learner picks counts the same.

A lesson ends Astra's way: after the learning-zone question, **"+N % znanja"** with the topic's
mastery on a bar against the goal (or "Tema je na cilju! 🎯" when it got there), the score, and the
gaps it closed and left. "Nadaljuj" goes back to the path, where "Next up" is the next lesson;
"Ponovi lekcijo" does the same lesson again. The summary's "Nadaljuj" saves it as read and goes back
to the path too.

### The tutor lesson

**Talking time.** The tutor spends the account's voice allowance (`tutor-allowance.ts`: a free
account's one lifetime minute, a subscription's half hour a day, then bought hours). A tutor lesson
starts only with a whole lesson's talking left, `TUTOR_LESSON_MIN_SECONDS` (5 minutes;
`canStartTutorLesson`). Without it the learner never meets the tutor and is never told why: the
path suggests the next format in its place (`suggestedKind` with `tutor: false`), the picker does
not list it, opening a tutor lesson (an old link, a station) goes straight to that exercise
(`instead`, from the page; the lesson route answers 409 `tutor_time` and the client follows it
there too), and no model call or speech is spent. If the time runs out in the moment between, the
voice session's 402 opens that exercise as well (`onOutOfTime`); a lesson that runs out part-way
goes on in writing without a word about it.

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
point, pause, end). While the tutor speaks its words run as live subtitles: phrases of up to nine
words (ending early at a sentence end), each word appearing as it is said and a full phrase making
way for an empty line, read a fifth of a second ahead of the sound (`spokenSoFar` on the speech output, over
each piece's estimated character timings); while the learner talks, their own words are captioned.
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

- **Grades:** the setup only offers a target percentage (75/90/100 %); the model still maps
  university 5–10 and school 1–5 scales, which older rows or a future setting may use.

### Lesson screens on the phone

Every lesson screen fits one phone screen without scrolling (the reading part aside). A missed
quiz question keeps all its answers, the right one marked, with the verdict pinned to the foot;
only when that would make the screen scroll do the others go, leaving the picked answer and the
right one. The rule lives in `StudyQuizQuestion` (`data-crowded`, measured after the verdict is
on the page) and so applies to every quiz in the app: the note's quiz tab, the palace, chat sets
and the landing's demo too. True or false shows the question small and the claimed answer as the
statement; its verdict names the right answer only when the statement was false.

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

**Material is the prep's, not a note.** "Naloži gradivo" takes anything a note can be made from:
tap to pick files, photos or the camera, or drop files on it. No sheet opens and nothing navigates
away: each pick becomes a **material card** in the setup (📄 document, 🖼️ a set of photos, 🎙️ a
recording) that shows its own progress ("V vrsti …", the pipeline's own busy label, "Dodano · Memo
ga predela v ozadju", or the error with "Poskusi znova"), with ✕ to take it out again (which deletes
the note made from it). Photos are grouped into sets of `MAX_SCAN_IMAGE_COUNT`, one note each.

- The upload itself is the app's pipeline, unchanged: a `NoteSourceModal` rendered `headless` per
  card, which starts on its `initialFiles` at once and reports through `onBusy`, `onFailed` and
  `onCreated` instead of drawing a sheet. **Three run at once** (`PARALLEL_UPLOADS`); the rest wait.
  Six files (five documents, three photos) were all in after 18 s on a local dev server.
- The modal keeps those callbacks in a ref and reports only when its label or error changes. They
  were in the effects' dependencies at first, and a caller's inline callback is new every render:
  a stale "busy" re-sent after `onCreated` put a finished card back to "Nalagam …", and since the
  queue waited on it, every card behind it sat in "V vrsti …" for good. The setup also ignores news
  for a card that is no longer pending (`updatePendingUpload`).
- **Limits:** 10 documents or recordings (`MAX_SETUP_UPLOADS`) and 50 photos (`MAX_SETUP_PHOTOS`)
  per prep. Each note still passes the create routes' own `expensiveCreate` limit, raised for this
  to 12 per 10 minutes, 30 per hour and 80 per day per user and route: a full prep (10 documents and
  five photo sets) fits, a script uploading in a loop does not.
- `createExam` stores the uploaded notes with `exam_modules.material = true` (`0071`), and the notes
  library (`listLecturesForUser(..., { hideExamMaterial: true })` on `/app` and the setup's own
  picker) leaves them out: they are the prep's material. Deleting the prep brings them back as
  notes. Material uploaded at a setup that is then abandoned stays an ordinary note.
- While a note is still being made, the exam screen shows "Memo bere tvoje gradivo …" with the count
  in place of its topics and checks back every 8 s; its topics join the path once it is ready.

Notes already in the app are the secondary choice, behind "Ali izberi iz svojih zapiskov". Without
`canCreateNotes` the field sends the learner to the paywall.

## Tables (`supabase/migrations/0068_exam_prep.sql` to `0071_exam_material.sql`)

`exams`, `exam_modules`, `exam_topics`, `exam_lesson_results`, `exam_mock_attempts`. All are
owner-only by RLS and every route uses the client that verified the learner (`getRouteUser`); an
update cannot move a module, topic or mock attempt onto another exam or note (`0069` recreates the
update policies with the insert policies' checks). `0069` adds the `tutor` lesson kind,
`exam_lesson_results.item_ids` and `exam_topics.extra`. `0070` adds `exam_lesson_results.missed_ids`
(the knowledge gaps). `0071` adds `exam_modules.material`. None of the four is on production; all
four are on staging.

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
