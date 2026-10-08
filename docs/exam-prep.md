# Exam prep

A learner names an exam, its date, its type and the grade they want, and picks the notes it
covers. Memo then plans every day until the exam from those notes and shows, honestly, how
close they are to that grade.

- App: the note's **Exam** tab (`NOTE_TABS`, after Test), one of the note's tools like the
  cards, the quiz and the test. With no exam planned it shows the tools' start screen; its
  button opens the planning flow, drawn exactly as the app's onboarding asks its questions
  (`exam-onboarding.tsx`: Memo in a speech bubble, the 3D chips, the coral button with its
  lip). With an exam it shows that exam's journey (`lecture-exam.tsx`). An exam can cover
  several notes; it then shows in each of their Exam tabs.
- The flow asks, in order: the exact exam day on a month calendar (tomorrow to a year
  ahead), **whether there is any other material for the exam**, the exam type, the grade,
  and the daily time and days off. The material step opens Home's own upload sheet
  (`NoteSourceModal` with `onCreated`): the new note joins the exam and is written in the
  background while the learner finishes the setup — the journey shows it as still being
  prepared and plans it once it is ready. The learner's other notes can be added there too.
- Demo, no login: `/creator/lectures/demo-note-mikroekonomija?tab=exam` — an exam that
  already has a week and a half of study behind it; any other demo note starts empty.
- Landing: the Exam pill in the hero phone and "How it works", and the "Exam prep" row of
  the feature list (`landing-exam-screen.tsx`).

## What the research says, and what we took from it

### How other apps do it

| App | What it does | What we took |
| --- | --- | --- |
| RemNote — Exam Scheduler | Exam date per deck; "the exact cards to practise each day"; recalculates priorities and workload by itself after a missed day. | The closest analogue: a dated goal that re-plans itself. |
| Anki + FSRS | No exam date. Users raise desired retention or cap intervals near the exam; backlogs after missed days are the most common complaint. | FSRS as the memory model; a retention target that rises as the exam nears; never a backlog. |
| UWorld / Blueprint | Exam date and hours per day; "Rebalance" redistributes missed work. | Daily budget from the learner; missed work re-planned, capped per day. |
| Magoosh, College Board | Score predictor only after ≥ 50 questions; always a range (SAT ±40). | No forecast below an evidence threshold; always a range. |
| Seneca | Two separate signals: section score (accuracy) and memory strength. | Coverage, memory and accuracy shown as three separate bars. |
| Brainscape | Self-rated "% mastery" — criticised because nothing checks it. | Self-rating never feeds the forecast. |
| Duolingo | Streak freezes *raised* engagement; slack motivates more than rigid rules. | Rest days are part of the plan; no red "missed" counts, no guilt copy. |
| Quizlet, Knowt, StudyFetch, Notion templates | Test-date plans that fail silently when a day is missed. | — |

### How to prepare for an exam by a date

- **Retrieval practice and spacing are the two high-utility techniques**
  (Dunlosky et al. 2013). Testing beats restudying after a delay — one week later 56% vs 42%
  (Roediger & Karpicke 2006) — and restudying raises *confidence* while lowering retention.
- **Successive relearning**: recall each item correctly, then again in later sessions. One
  correct recall in each of three spaced sessions gave 68% a week later vs 26% for three
  recalls in one session (Rawson et al. 2018).
- **Gap ≈ 10–30% of the time left** to the test, falling as the horizon grows (Cepeda et al.
  2008); the last review should fall shortly before the exam.
- **Cramming is a metacognitive trap**: 90% of learners did better spaced, 72% believed
  cramming worked better (Kornell 2009).
- **Practise in the exam's format**: effects are larger when practice matches the final test
  (Adesope et al. 2017). Recognition (multiple choice) is easier than recall.
- **Interleaving** helps choose the method (Brunmair & Richter 2019, g = 0.42).
- **Sleep**: no late-night catch-up; the day before is light.
- **Calibration**: students overrate readiness, low performers most (Serra & DeMarree 2016),
  and overconfidence ends study too early (Dunlosky & Rawson 2012). Quiz performance, not
  feeling, predicts exam performance (r = .57, Sotola & Credé 2020).

Sources are linked at the end.

## How the journey is planned (`src/lib/exam-prep/journey.ts`)

Nothing about the day-by-day plan is stored. It is recomputed from the learner's real study
every time the screen opens, which is what makes a missed day harmless: its work is
re-planned into the days left by what is most at risk of being forgotten, instead of piling up.

1. **Phases** are anchored to the day the plan was made, over the study days (rest days
   excluded): with ≥ 14 days, 50% learn / 35% practise / 15% mock exams; 6–13 days, 40/40/20;
   3–5 days, a short learn phase and one mock day; 1–2 days, retrieval only. The last study
   day before the exam is always a light **final day** (half the budget, reviews only, no new
   material, an early night). A learning day with nothing left to learn becomes practice.
2. **Learn units** are the note's study sections, interleaved across notes, paced evenly
   over the learning days that remain (not front-loaded). Each is "read the section, then its
   cards" and counts as learned once 60% of its cards have been seen.
3. **Reviews** come from FSRS-5 (`fsrs.ts`): an item is due when its recall drops below
   the retention target (0.90 more than three weeks out, 0.925 two to three weeks, 0.95
   inside two) or when its gap exceeds ~30% of the days left. Due items are ordered by
   projected recall on exam morning, lowest first.
4. **The day's budget** is the learner's own minutes. Fixed practice is placed first (a
   mixed quiz each practice day, a practice test in the exam's format every fourth practice
   day for written and problem exams, explaining aloud with the tutor every other day for
   oral ones, a mock per mock day), then reviews (45% of what is left on learning days, 70%
   on practice days, all of it on the final day), then new material. Spare time on a practice
   day becomes another quiz. What does not fit stays due and moves to the next days — a
   backlog is never squeezed into one day.
5. **Today** is planned from the state at the start of today, so it does not shift while the
   learner works through it. Tasks tick themselves off from real study (cards reviewed, quiz
   answers, a graded practice test); only what the app cannot see — reading a note with no
   cards, explaining aloud, the wind-down — has a check to tap. Days after today start from
   what is really known now, plus what is left of today's plan, assumed done.
6. **Feasibility**: if some sections cannot be reached before the exam at this budget, the
   plan says so and offers the smallest daily budget that covers everything (binary search
   over the same simulation).

Minutes per unit (`STUDY_MINUTES`): 15 s per review card, 30 s per new card, 30 s per quiz
question, 2.5 min per written practice question, reading at 160 words a minute.

## How close the learner is (`src/lib/exam-prep/forecast.ts`)

Per note:

- **Accuracy** — a Beta posterior (prior 2/2) over *first-attempt* answers only: a question
  seen once before counts 0.3, from the third look on 0, because accuracy on repeats mostly
  measures having seen them. Answers decay with a 14-day half-life. Format weights: written
  practice answers count 1.3× for a written exam and quiz answers 0.6× (a right option is
  credited 0.8 — recognising is easier than recalling); for a multiple-choice exam the quiz
  counts fully.
- **Coverage** — share of the note's cards (or questions) studied at all.
- **Memory** — FSRS recall on exam morning, both if the learner stops now and if they follow
  the plan (the planner's simulated end state).
- **Score** — `known = coverage × τ × knowledge`, `p = known + (1 − known) × guess`, where
  knowledge is today's accuracy carried to exam morning by the ratio of projected to current
  memory, τ ≈ 0.9 discounts app questions against the examiner's, and the guessing rate is ¼
  for multiple choice and ~0 for written work. Without any exam-style answers, card recall is
  credited at ¾ and kept wide.

The **range** is the 10th–90th percentile of 1,500 seeded Monte Carlo draws over the
posteriors, τ (N(0.9, 0.05)) and the luck of which questions the exam asks (binomial over
~40 MC / 20 written / 15 problem / 6 oral questions). The same draws give the **chance of
reaching the target**. Below 10 weighted first-attempt answers there is no forecast at all —
the card says how many more new questions unlock it.

The screen shows two forecasts: *if the exam were today* and *on exam day if you follow the
plan*, plus three separate bars (coverage, memory on exam day, first-try accuracy) and, in
small type, how much would be left with no more study.

**None of the constants are fitted yet** (repeat weights, τ, the threshold, the phase
splits). After the exam the plan asks for the real result (`exam_plans.result_percent`); that
is the data to calibrate them with.

### Grades (`grade-scales.ts`)

`ten_point` (5–10; Ljubljana's 51/61/71/81/91), `five_point` (1–5; 50/63/77/90 in Slovenian
schools, 50/60/75/90 in Croatian, Bosnian and Serbian ones), `letter` (A–F), `percent`,
`pass_fail`. Cut-offs differ by faculty, so the target is stored as a percentage the learner
can correct in the builder, and the forecast maps percentages to grades with that correction
written in.

## Data (`supabase/migrations/0058_exam_prep.sql`)

- `exam_plans` — the goal: title, date, type, scale, target grade and percent, daily minutes,
  rest-day bitmask (bit 0 = Monday), time zone, and the real result afterwards.
- `exam_plan_lectures` — the notes it covers.
- `exam_plan_task_checks` — ticks on tasks the app cannot detect.
- `study_events` — the review log: one row per flashcard grade
  (`/api/flashcards/[id]/progress`) and per quiz answer
  (`/api/lectures/[id]/quiz/answers`, marked on the server from the answer key). Practice
  tests are read from `practice_test_attempt_answers`. Cards studied before the log existed
  are counted once, from `flashcard_progress.last_reviewed_at`.

All four are owner-only under RLS; the server reads them with the service role after
verifying the learner, as `listLecturesForUser` does. Free accounts can plan only from their
trial note (`checkExamLectures`); the preview bypass account has no auth row and gets a 403.

## API

| Route | |
| --- | --- |
| `GET /api/exams` | Summaries (today's progress, forecast); `?lectureId=` for one note's Exam tab. |
| `POST /api/exams` | Create. |
| `GET /api/exams/[id]` | The plan and its journey, computed now. |
| `PATCH /api/exams/[id]` | Edit, including the daily budget and the real result. |
| `DELETE /api/exams/[id]` | Delete the plan (study history is kept). |
| `POST /api/exams/[id]/checks` | Tick or untick a manual task. |
| `POST /api/lectures/[id]/quiz/answers` | Log a quiz answer. |

Today's tasks on the same note switch the note's tab in place; tasks on another note link
to it with `?tab=flashcards|quiz|test|tutor|exam` (`LectureWorkspace`'s `initialTabId`).
`GET /api/exams?lectureId=` returns the exams covering that note and the notes the planning
flow can add, in one request.

## Not done yet

- Reminders. A daily push needs `push_queue.kind` widened beyond the note-ready kinds.
- Fitting τ and the other constants per learner from reported results.
- Topic weights set by the learner ("this chapter is half the exam").

## Sources

- Dunlosky et al. 2013, *Improving students' learning with effective learning techniques*:
  https://www.psychologicalscience.org/news/releases/which-study-strategies-make-the-grade.html
- Roediger & Karpicke 2006: https://psychology.ecu.edu/wp-content/pv-uploads/sites/216/2019/03/Roediger-Karpicke-2006.pdf
- Cepeda et al. 2008: https://pubmed.ncbi.nlm.nih.gov/19076480/
- Successive relearning: https://journals.sagepub.com/doi/full/10.1177/09637214221100484
- Kornell 2009: https://cir.nii.ac.jp/crid/1361699994055985152
- Adesope et al. 2017: https://journals.sagepub.com/doi/10.3102/0034654316689306
- Brunmair & Richter 2019: https://www.psychologie.uni-wuerzburg.de/fileadmin/06020400/2019/Brunmair_Richter_in_press__2019_META-ANALYSIS_OF_INTERLEAVED_LEARNING.pdf
- Serra & DeMarree 2016: https://www.acsu.buffalo.edu/~kgdemarr/Pub/2016.SD.MemCog.pdf
- Sotola & Credé 2020: https://link.springer.com/article/10.1007/s10648-020-09563-9
- FSRS: https://github.com/open-spaced-repetition/awesome-fsrs/wiki/The-Algorithm
- RemNote Exam Scheduler: https://help.remnote.com/en/articles/9102040-understanding-the-exam-scheduler
- Blueprint rebalance: https://blog.blueprintprep.com/medical/how-to-rebalance-during-your-dedicated-usmle-study-period/
- Seneca: https://help.senecalearning.com/en/articles/3568901-what-is-section-score-and-memory-strength
- Duolingo streaks: https://blog.duolingo.com/how-duolingo-streak-builds-habit
- Grading in Slovenia: https://en.wikipedia.org/wiki/Academic_grading_in_Slovenia
