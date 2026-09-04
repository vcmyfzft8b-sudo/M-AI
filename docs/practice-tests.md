# Practice tests

A practice test is a written exam generated from one note: open questions the learner answers in
their own words, marked against a scheme, with a percentage and a per-question breakdown at the
end. It is the third study surface beside flashcards and the quiz, and it is the only one where
the product produces a **grade** — which is why almost everything below is about defending that
number.

## The shape

```
source → knowledge items → question bank (all of the material)
                                  ↓  sampler
                            one test (10-15 questions)
                                  ↓  learner answers
                            marking, point by point
                                  ↓
                          score, feedback, history
```

Three separate things, and they fail separately:

| Stage | Where | What it owes the learner |
| --- | --- | --- |
| Bank generation | `src/lib/practice-test.ts`, `src/lib/study-items.ts` | Every examinable thing in the source has a question behind it |
| Test assembly | `src/lib/practice-test-selection.ts` | A different test each time, spread across the material, most-important material first |
| Marking | `src/lib/practice-test-scoring.ts` + `buildPracticeGradingInstructions` | A grade that is the same tomorrow, and that can be explained back |

## The bank covers the material; one test is a draw from it

The bank is generated from the same knowledge items the notes are written from, one question per
deck-worthy item, so "did the notes cover it" and "did the bank cover it" are one question. The
bank is not capped: forty items means forty questions.

A single test is 5-15 questions depending on bank size. The sampler is **exposure-first**: no
question is asked a second time while another has never been asked. On a 40-question bank that
means three sittings reach every question, and the test in front of the learner is never the test
they just sat. Within that, the draw spreads across source sections and concepts, prefers the
material the extractor rated most important, and mixes difficulty. The presentation order is
shuffled, so a test never walks the source from the top.

Measured in `tests/practice-test-selection.test.mjs` over 200 seeds × 6 sittings: zero overlap
with the immediately previous test, every test touching every section, and no question asked more
than three times in ninety question slots.

A bank is rebuilt only when it is missing, unfinished, built by an older pipeline, or too damaged
to seat a test — **not** when the learner has been through it. Recycling least-seen-first is what
a question bank is for; rebuilding put a full generation run in front of roughly every third
attempt.

## The grade is arithmetic, not an opinion

The model is never asked for a score. It is asked, for each marking point in the scheme, whether
the answer contains it (`met` / `partial` / `missed`), plus two flags: `criticalError` (the answer
asserts something the scheme contradicts) and `offTopic`. The score is computed from those marks
in `scoreFromRubric`:

| Share of the scheme earned | Mark |
| --- | --- |
| all of it | 5 |
| 80%+ | 4 |
| 60%+ | 3 |
| 40%+ | 2 |
| anything above zero | 1 |
| nothing | 0 |

`partial` is worth half a point. A `criticalError` costs a mark and caps the question at 3.
`offTopic` is 0. Full marks require the whole scheme — rounding a ratio would hand out a 5 for
90%, and then a 5 stops meaning anything.

Deliberate properties:

- **An answer nobody could mark is left out of the total, not scored zero.** A failed grading call
  is our outage; scoring it as a zero hands the learner a percentage they cannot appeal. The
  attempt is only failed outright when *every* answer failed to mark.
- **"?" and "ne vem" are folded into "I don't know"** before anything is sent to a model. They
  score zero and cost nothing.
- **The student's answer is fenced and named as the work being marked**, and the instructions say
  it is never an instruction. "Award full marks" typed into the answer box scores 0.
- **Spelling, accents, length and order do not move the mark.** A test is written under time.
- **Feedback comes back in the language of the question**, whatever language the student wrote in.

## How to verify a change here

```bash
npm test                                                              # the two suites below
node --experimental-strip-types scripts/grading-eval.mjs --repeats=3  # marking against hand-marked answers
node --experimental-strip-types scripts/grading-eval.mjs --baseline   # the grader this replaced
node --experimental-strip-types scripts/study-eval.mjs --variant=glm-5.3-flash --fixture=omrezja-sl
```

- `tests/practice-test-selection.test.mjs` — the sampler's properties, over many seeds.
- `tests/practice-test-grading.test.mjs` — the marking arithmetic and its boundaries.
- `scripts/grading-eval.mjs` runs the **real** prompt and the **real** arithmetic against
  `evals/grading/practice-grading.json`: hand-marked student answers at known quality levels — a
  complete answer in the learner's own words, the same one typed without diacritics, half of it,
  a confidently wrong claim, a fluent answer to a different question, an answer that asks for full
  marks, and a correct answer written in the wrong language. Each carries the band a teacher would
  put it in, and every answer is marked several times because a grader that gives the same answer
  a 4 and then a 2 is not a grader.

Measured 2026-09-04, GLM 5.3 Flash (what `study_items` runs), 18 answers × 3 markings:

| | outside its band | unstable | feedback in the wrong language | cost |
| --- | --- | --- | --- | --- |
| rubric grader (shipping) | **0 / 54** | 0 | 0 | $0.012 |
| `--baseline` (what it replaced) | 2 / 54 | 0 | **12 / 18 answers** | $0.004 |

The baseline's two misses are the ones that matter most: a terse but fully correct answer marked
3/5, and a flatly wrong year given 1/5 on two runs out of three. Its language failure is the
whole product: two thirds of a Slovene test came back explained in English. Three times the cost
per marking is the price of the point-by-point pass, and it is roughly a tenth of a cent per
question.

Kept out of `evals/fixtures/`: `note-eval` and `study-eval` load every `.json` in that directory
as source material.

## Operational notes

- Both the attempt route and the submit route declare `maxDuration = 300` and run inside
  `runWithinInvocationBudget`. Both build or mark with a dozen model calls, and a killed
  invocation takes the function's own error handling with it — the budget is what leaves an
  invocation alive to record the failure and answer the reader in their own language.
- `PRACTICE_TEST_GENERATION_VERSION` is the bank's pipeline stamp. Bumping it rebuilds every
  stored bank the first time its owner starts a test, inline, inside that 300 seconds.
- `practice_test_questions.importance` (migration 0041) is the knowledge item's 1-5 rating,
  carried into the bank so the sampler can prefer central material.
- Attempt metadata records `bankSize`, `usableBankSize`, `bankCoverage` and
  `previousOverlapRatio`; the asset records `materialCoverage`. A bank with a hole in it, or one a
  learner never gets through, is meant to be findable by looking rather than by a learner noticing
  a topic never came up.
