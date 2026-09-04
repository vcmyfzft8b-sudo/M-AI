import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  bankCoverageRatio,
  selectAttemptQuestions,
  shouldRebuildQuestionBank,
  targetQuestionCount,
  usableBankQuestions,
} from "../src/lib/practice-test-selection.ts";

/**
 * The feature these tests describe: the bank covers the whole source, one test is a random draw
 * from it, and sitting several tests walks the learner through everything without re-asking a
 * question while another has never been asked.
 *
 * The implementation this replaced could not do that. It scored every question for exposure and
 * spread, sorted by that score — inside a comparator that called Math.random(), so the ordering
 * was already meaningless — and then shuffled the sorted array, which threw away whatever had
 * survived. What reached the learner was a uniform random draw, so the same question came back on
 * the next test while a third of the material had never been on one.
 */

function bank(size, overrides = () => ({})) {
  return Array.from({ length: size }, (_, index) => ({
    id: `q${index}`,
    prompt: `Explain what mechanism ${index} does and why it matters.`,
    answer_guide: `- point A for ${index}\n- point B for ${index}`,
    difficulty: ["easy", "medium", "hard"][index % 3],
    source_unit_idx: index % 5,
    concept_key: `item-${index}`,
    importance: 4,
    ...overrides(index),
  }));
}

/** A seeded generator, so a failure is a real one rather than an unlucky afternoon. */
function seededRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/** Sits `count` tests in a row, each one seeing what the ones before it asked. */
function sitTests(questions, count, random) {
  const history = [];
  const tests = [];

  for (let index = 0; index < count; index += 1) {
    const selection = selectAttemptQuestions({
      questions,
      previousAttemptQuestionIds: history,
      random,
    });

    tests.push(selection);
    history.push(selection.questions.map((question) => question.id));
  }

  return { tests, history };
}

test("a test is drawn at the length the bank can support", () => {
  assert.equal(targetQuestionCount(6), 5);
  assert.equal(targetQuestionCount(3), 3);
  assert.equal(targetQuestionCount(12), 8);
  assert.equal(targetQuestionCount(20), 10);
  assert.equal(targetQuestionCount(30), 12);
  assert.equal(targetQuestionCount(60), 15);
});

test("no question comes back while another has never been asked", () => {
  const questions = bank(40);
  const { history } = sitTests(questions, 2, seededRandom(7));
  const [first, second] = history;

  assert.equal(first.length, 15);
  assert.equal(second.length, 15);
  assert.equal(new Set([...first, ...second]).size, 30, "the second test repeated the first");
});

test("sitting enough tests walks the learner through the whole bank", () => {
  const questions = bank(40);
  const { history } = sitTests(questions, 3, seededRandom(11));

  assert.equal(
    bankCoverageRatio({ questions, previousAttemptQuestionIds: history }),
    1,
    "three 15-question tests on a 40-question bank must reach every question",
  );
});

test("a fourth test recycles the least-seen questions rather than repeating the third", () => {
  const questions = bank(40);
  const { tests, history } = sitTests(questions, 4, seededRandom(3));
  const seenTwice = history
    .flat()
    .reduce((counts, id) => counts.set(id, (counts.get(id) ?? 0) + 1), new Map());

  // The bank has been exhausted by test three, so test four has to reuse — but only the
  // questions that have been asked once, and never the same one twice.
  assert.ok(tests[3].previousOverlapRatio < 0.5, "the fourth test repeats most of the third");
  assert.ok(
    [...seenTwice.values()].every((count) => count <= 2),
    "a question was asked three times before the bank was exhausted twice",
  );
});

test("no test repeats the one before it, on any seed", () => {
  // The properties above hold for a chosen seed; this asserts they are properties of the sampler
  // rather than of that seed. Six tests on a forty-question bank is past the point where the bank
  // is exhausted and the sampler has to start recycling.
  let worstOverlap = 0;
  let fewestUnits = Number.POSITIVE_INFINITY;
  let mostRepeats = 0;

  for (let seed = 1; seed <= 200; seed += 1) {
    const questions = bank(40);
    const { tests, history } = sitTests(questions, 6, seededRandom(seed));
    const timesAsked = history
      .flat()
      .reduce((counts, id) => counts.set(id, (counts.get(id) ?? 0) + 1), new Map());

    for (const [index, sitting] of tests.entries()) {
      if (index > 0) {
        worstOverlap = Math.max(worstOverlap, sitting.previousOverlapRatio);
      }

      fewestUnits = Math.min(
        fewestUnits,
        new Set(sitting.questions.map((question) => question.source_unit_idx)).size,
      );
    }

    mostRepeats = Math.max(mostRepeats, Math.max(...timesAsked.values()));
  }

  assert.equal(worstOverlap, 0, "a test repeated a question from the test immediately before it");
  assert.equal(fewestUnits, 5, "a test left a section of the source out");
  // Ninety question slots over forty questions: three sittings for one question is the floor.
  assert.equal(mostRepeats, 3, "a question was over-asked while others waited");
});

test("two learners on the same bank do not sit the same test", () => {
  // The bank carries a mix of ratings, which is where a sampler that leans on importance stops
  // being random: without enough noise to reorder questions that differ only by a rating, every
  // learner's first test would be the same fifteen must-know questions in a different order.
  const questions = bank(40, (index) => ({ importance: index % 3 === 0 ? 5 : 4 }));
  const firstTests = new Set();

  for (let seed = 1; seed <= 100; seed += 1) {
    const selection = selectAttemptQuestions({
      questions,
      previousAttemptQuestionIds: [],
      random: seededRandom(seed),
    });

    firstTests.add(
      selection.questions
        .map((question) => question.id)
        .sort()
        .join(","),
    );
  }

  assert.equal(firstTests.size, 100, "two learners were handed the identical first test");
});

test("one test reaches across the material rather than sitting in one section", () => {
  const questions = bank(40);
  const { tests } = sitTests(questions, 1, seededRandom(5));
  const units = new Set(tests[0].questions.map((question) => question.source_unit_idx));

  assert.equal(units.size, 5, "a 15-question test skipped a section of the source");
});

test("a test does not ask the same concept twice while another is untouched", () => {
  // Two questions per concept, so a careless draw pairs them up.
  const questions = bank(24, (index) => ({ concept_key: `item-${Math.floor(index / 2)}` }));
  const { tests } = sitTests(questions, 1, seededRandom(13));
  const concepts = tests[0].questions.map((question) => question.concept_key);

  assert.equal(new Set(concepts).size, concepts.length, "one concept was tested twice");
});

test("the questions are asked in a different order than the bank stores them", () => {
  const questions = bank(40);
  const { tests } = sitTests(questions, 1, seededRandom(21));
  const asked = tests[0].questions.map((question) => question.id);
  const inBankOrder = [...asked].sort(
    (left, right) =>
      questions.findIndex((question) => question.id === left) -
      questions.findIndex((question) => question.id === right),
  );

  assert.notDeepEqual(asked, inBankOrder, "every test would walk the source from the top");
});

test("the most important material is what a short test is built from", () => {
  const questions = bank(30, (index) => ({ importance: index < 10 ? 5 : 2 }));
  const { tests } = sitTests(questions, 1, seededRandom(4));
  const important = tests[0].questions.filter((question) => question.importance === 5).length;

  assert.ok(
    important >= 7,
    `a 12-question test drew only ${important} of the ten must-know questions`,
  );
});

test("a question a learner cannot answer on its own never reaches a test", () => {
  const questions = bank(20, (index) =>
    index % 4 === 0
      ? { prompt: "What does the table above show about this?" }
      : {},
  );
  const usable = usableBankQuestions(questions);

  assert.equal(usable.length, 15);

  const { tests } = sitTests(questions, 1, seededRandom(2));

  assert.ok(
    tests[0].questions.every((question) => !question.prompt.includes("table above")),
    "a source-dependent prompt was put on a test",
  );
});

test("a question with nothing to mark against never reaches a test", () => {
  const questions = bank(20, (index) => (index % 5 === 0 ? { answer_guide: "   " } : {}));

  assert.equal(usableBankQuestions(questions).length, 16);

  const { tests } = sitTests(questions, 1, seededRandom(6));

  assert.ok(tests[0].questions.every((question) => question.answer_guide.trim().length > 0));
});

test("a bank the learner has been through is not thrown away and generated again", () => {
  // The old rule rebuilt the whole bank as soon as the unused questions no longer filled one
  // test, which put a full generation run in front of roughly every third attempt.
  assert.equal(
    shouldRebuildQuestionBank({ questions: bank(40), builtByCurrentPipeline: true }),
    false,
  );
});

test("a bank an older pipeline built is rebuilt once, and an empty one always", () => {
  assert.equal(
    shouldRebuildQuestionBank({ questions: bank(40), builtByCurrentPipeline: false }),
    true,
  );
  assert.equal(shouldRebuildQuestionBank({ questions: [], builtByCurrentPipeline: true }), true);
});

test("one bad question does not condemn the bank around it", () => {
  const questions = bank(40, (index) => (index === 0 ? { answer_guide: "" } : {}));

  assert.equal(
    shouldRebuildQuestionBank({ questions, builtByCurrentPipeline: true }),
    false,
    "a single unusable question used to trigger a full regeneration on every single start",
  );
});

test("a bank the current pipeline built is never rebuilt twice for the same reason", () => {
  // Whatever is wrong with a bank the current gates produced, generating it again produces the
  // same bank — so a rule that rebuilds on that would rebuild on every single start, forever.
  // A short source honestly yields a short bank.
  const tiny = bank(2);

  assert.equal(shouldRebuildQuestionBank({ questions: tiny, builtByCurrentPipeline: true }), false);
  assert.equal(
    shouldRebuildQuestionBank({
      questions: bank(20, (index) => (index % 2 === 0 ? { prompt: "Explain this." } : {})),
      builtByCurrentPipeline: true,
    }),
    false,
  );
});

test("the attempt route decides once, on the pipeline stamp", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../src/lib/practice-test.ts", import.meta.url)),
    "utf8",
  );

  assert.match(
    source,
    /const builtByCurrentPipeline =\s*assetMetadata\.pipeline === PRACTICE_TEST_GENERATION_VERSION;/,
  );
  assert.match(source, /shouldRebuildQuestionBank\(\{ questions: questionRows, builtByCurrentPipeline \}\)/);
});

test("a bank smaller than one test still produces a test", () => {
  const questions = bank(3);
  const { tests } = sitTests(questions, 2, seededRandom(8));

  assert.equal(tests[0].questions.length, 3);
  assert.equal(tests[1].questions.length, 3);
});

test("the attempt route reads the bank version before it reads the history", () => {
  // Attempts sat on an older bank name question ids that no longer exist; counting them as
  // "already seen" would hide the whole new bank from the sampler.
  const source = readFileSync(
    fileURLToPath(new URL("../src/lib/practice-test.ts", import.meta.url)),
    "utf8",
  );

  assert.match(source, /getAttemptsForBank\(\{\s*attempts: previousAttempts,\s*bankVersion,/);
  assert.match(source, /previousAttemptQuestionIds,?\n?\s*\}\)/);
});
