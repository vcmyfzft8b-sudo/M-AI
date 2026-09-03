/*
 * The pass that makes what we generate correct in the language it is written in.
 *
 * GLM 5.3 Flash decides what to teach better than anything else measured for this product, and
 * it is what every text stage has run on since 2026-08-28. What it is weaker at is writing the
 * language it teaches in. Measured 2026-09-02 on the omrezja-sl fixture, its spoken turns carry
 * roughly one error every hundred and thirty words of Slovenian, and they are not case slips a
 * reader forgives: they are words that do not exist. "faxenco", "komban", "pošiljateljnico",
 * "kuverno", and "koca" four times in one answer where "kocka" was meant.
 *
 * On a page a learner skims past those. Spoken, the synthesizer pronounces them, and the tutor
 * sounds like it does not know the language — which is why the voice is where this was noticed
 * and where it matters most. Nothing here is Slovenian-specific: English shows the problem
 * barely, and every language with real morphology shows it, so the checker is told which
 * language it is reading rather than assuming one.
 *
 * Two cheaper fixes were tried before this one and neither moved the rate: telling GLM in the
 * prompt to write correctly (1.31 against 1.33 errors per 100 words), and pinning it to
 * different hosts (1.28 to 1.60). So it is the model, not the prompt and not a bad provider,
 * which leaves either changing the model or repairing what it writes. Changing the model was
 * declined deliberately — GLM's teaching is the reason the feature is good, and the Gemini that
 * writes flawless Slovenian answered a learner's interruption without covering one of the three
 * points it was asked to cover, four times out of four.
 *
 * ## Written text
 *
 * A note is generated in the background and read minutes later, so its repair is an ordinary
 * call: `splitForRepair` cuts the markdown into passages on boundaries markdown allows, they are
 * repaired in parallel, and each one is accepted or discarded on its own.
 *
 * ## Spoken text
 *
 * The tutor cannot afford that, and the whole design problem is that the repair must not be
 * heard. The learner is sitting in silence waiting for the tutor to start: under about a second
 * and a half to the first sound reads as a conversation, past three as a machine thinking. A
 * second call over the finished turn would cost every one of those seconds, because nothing can
 * be spoken until the turn is written. So `createProofreadStream` runs the repair *inside* the
 * stream instead:
 *
 *   - the writer's text is cut into speakable units as it arrives, the first one deliberately
 *     short so it can be repaired and sent while the rest is still being written;
 *   - each unit is repaired as soon as it exists, so unit three is being fixed while unit two is
 *     still being spoken — every repair after the first is hidden behind audio already playing;
 *   - units are emitted in the order they were written, whatever order their repairs come back
 *     in, because speech cannot be reordered;
 *   - every repair races a deadline, and a unit whose repair is late is spoken exactly as it was
 *     written. That is what bounds the tail: this layer can improve a turn but it can never make
 *     one slower than its budget.
 *
 * ## Trust
 *
 * The other half, and the reason for every guard below. A repairer that rewrites is worse than a
 * misspelling, because a misspelled word is still recognisably the right idea while a
 * confidently rewritten sentence is not. So the model is asked for the narrowest possible edit
 * and everything it returns is checked against the original before it is allowed through — see
 * `acceptCorrection`. When a repair fails any of those checks the original is used. Silence
 * about a bad edit is the point: this layer is only ever allowed to be a no-op or an improvement.
 */

import { z } from "zod";

/** What comes back for one passage. One field, so it travels the same path as everything else. */
export const languageRepairSchema = z.object({
  corrected: z
    .string()
    .min(1)
    .describe(
      "The same text with only genuine language errors repaired. If there is nothing wrong " +
        "with it, return it exactly as it was given, character for character.",
    ),
});

/**
 * The instruction block for one repair.
 *
 * Written as prohibitions rather than as a goal on purpose. Asked to "improve" a passage a model
 * will always find something to improve — it tightens, it re-orders, it swaps a term for a
 * better one — and every one of those changes is a chance to say something the material did not.
 * The only edit wanted here is the one a native speaker would otherwise read as a mistake.
 *
 * `language` is a code, not a name, and it is passed straight through rather than mapped: this
 * runs on whatever the learner's material is written in, and a list of supported languages here
 * would be a list of the languages the product quietly stops checking.
 */
export function buildLanguageRepairInstructions(
  language: string,
  options: { spoken: boolean } = { spoken: false },
) {
  const medium = options.spoken
    ? "text that is about to be read out loud by a speech synthesizer, one piece at a time, while it is still being written"
    : "study notes that a learner will read";

  return [
    `You are proofreading ${medium}. It is written in the language with the code "${language}". Correct it as a strict native speaker of that language would, and answer in that same language — never translate it into another one.`,
    "",
    "Repair only these, and only where they are genuinely wrong:",
    "- words that do not exist in the language — invented, misspelled, or mangled forms. These are the reason you are here: the writer occasionally produces a word that looks nearly right and is not. Replace it with the word the sentence plainly means.",
    "- words borrowed from a neighbouring language that a native speaker would not use. This matters most between languages that are close: Slovenian, Croatian, Serbian and Bosnian share a great deal and a word from the wrong one of them is exactly the mistake to catch.",
    "- wrong inflections: case, number, gender, verb agreement, aspect. Where the language has a dual, or any other form English does not, check it.",
    "- wrong or missing accents, diacritics and letter forms.",
    "- prepositions and particles that do not agree with the word that follows them.",
    options.spoken
      ? "- anything a synthesizer would pronounce wrongly because of how it is spelled."
      : "- agreement errors across a clause that a careful writer of the language would not make.",
    "",
    "Change nothing else. Specifically, do NOT:",
    "- rephrase, tighten, expand, re-order or improve the style in any way. Leave every word that is not wrong exactly where it is, including conjunctions and filler you would have cut;",
    "- add or remove a single fact, number, name, example or clause;",
    "- swap a technical term for a different one, or translate anything — subject terminology, acronyms and proper nouns stay exactly as written, including foreign ones;",
    "- change the register, the tone, or how the reader is addressed;",
    "- change punctuation or capitalisation.",
    options.spoken
      ? "- change the square-bracket tags, which are sound effects and must survive untouched."
      : "- change one character of the markdown: every heading, list marker, table pipe, bold marker, code span and link stays exactly where it is, in the same order. Repair the words inside them and nothing else.",
    "",
    options.spoken
      ? "The text is a fragment of a longer explanation. It may begin or end mid-thought, it may start with a lowercase letter, and it may have no final full stop. All of that is correct — leave it exactly as it is. Never complete a sentence that has been cut off, and never add a sentence of your own."
      : "The text is one passage out of a longer document. It may begin or end mid-section and it may open with a heading, a table row or a list item. All of that is correct — return the passage with the same structure and the same number of lines it came with. Never continue the document and never add a line of your own.",
    "",
    "If nothing in it is wrong, return it character for character as it was given. That is the expected outcome most of the time, and returning it unchanged is a correct answer, not a failure to find something.",
  ].join("\n");
}

/**
 * How a passage is offered to the model: the text to fix, and what came just before it, so a
 * fragment is judged in the sentence it belongs to rather than on its own.
 *
 * Deliberately nothing else. The obvious next idea is to hand over the topic and its points too,
 * on the reasoning that the errors left standing are invented words — "kamorščina", "okupe",
 * "preveze" — which are only recoverable if the reader knows what the passage is about. It was
 * measured on 2026-09-04 over 114 calls and it is a trap: the repair count did not move (22 and
 * 22) and three edits went from correct to wrong, because a model given a vocabulary list starts
 * reaching into it. It swapped "lopar" for a word out of the context that was not what the
 * sentence said. A checker that guesses is the failure this whole layer is built to avoid, so it
 * is given the least context it can do the job with, and declines the words it cannot recover.
 */
export function buildLanguageRepairInput(params: { text: string; preceding: string }) {
  return JSON.stringify(
    {
      alreadySpoken: params.preceding || null,
      textToCorrect: params.text,
    },
    null,
    2,
  );
}

/* --- which languages this is for ------------------------------------------ */

/**
 * The languages the checker is not run on, and the only entry is English.
 *
 * This is a measurement, not an assumption about who the product is for. The same GLM that
 * averages 0.55 to 1.06 errors per 100 words of spoken Slovenian was marked over eight English
 * turns and roughly a thousand words on 2026-09-04 (scripts/tutor-language-sweep.mjs, the
 * synapse-en fixture) and made none at all: 0.00 per 100 words in both arms, with the checker
 * finding one thing to change in fifty-five units and the judge agreeing there had been nothing
 * to find. What it did cost was 570 to 780ms on the first word of every turn.
 *
 * That is the trade in one line — a measured zero against the one number the spoken tutor is
 * judged on — and the reason it comes out this way is that English barely inflects. Every
 * language this product is used in that does inflect goes through the checker, which is the
 * point: the mechanism knows nothing about any particular language and is handed whichever one
 * the learner is being taught in.
 *
 * If GLM is ever replaced, or English turns out to have a failure mode nobody has sampled, this
 * list is where that gets undone — with a run of the sweep behind it, the way it was put here.
 */
const LANGUAGES_WITHOUT_THE_PROBLEM = new Set(["en"]);

/** Whether text in this language is worth checking at all. */
export function shouldCheckLanguage(language: string | null | undefined) {
  if (!language) {
    // Unknown means the material could be anything, and the check is the safe side of that.
    return true;
  }

  return !LANGUAGES_WITHOUT_THE_PROBLEM.has(language.trim().toLowerCase().split(/[-_]/u)[0]);
}

/* --- cutting the stream into things worth correcting ---------------------- */

/**
 * The first unit is cut as early as a phrase can be, because it is the only one the learner
 * waits for. Everything after it is corrected while the previous unit is being spoken, so
 * those are cut at whole sentences, which is what a proofreader judges best.
 */
const FIRST_UNIT_MIN_CHARS = 30;
const FIRST_UNIT_MAX_CHARS = 130;
const LATER_UNIT_MIN_CHARS = 80;
const LATER_UNIT_MAX_CHARS = 320;

/** A sentence end, and — for the first unit only — a clause end, which arrives sooner. */
const SENTENCE_END = /[.!?…](?=["'»”’)\]]?(?:\s|$))/gu;
const CLAUSE_END = /[,;:—–](?=\s)/gu;

/** How much of what has already been spoken travels with a unit as context. */
const PRECEDING_CONTEXT_CHARS = 240;

/**
 * Where to cut, and the two answers pull opposite ways.
 *
 * The opening unit wants the EARLIEST boundary it is allowed, because every character past it
 * is silence the learner is sitting in. Every unit after it wants the LATEST one that fits,
 * because by then the cost of waiting is nil — the previous unit is still being spoken — and a
 * proofreader judges a whole sentence better than half of one, in fewer calls.
 */
function findBoundary(
  text: string,
  pattern: RegExp,
  { min, max, earliest }: { min: number; max: number; earliest: boolean },
) {
  pattern.lastIndex = 0;
  let best = -1;

  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const end = match.index + match[0].length;

    if (end > max) {
      break;
    }

    if (end >= min) {
      best = end;

      if (earliest) {
        break;
      }
    }
  }

  return best;
}

/**
 * Takes the next speakable unit out of the buffer, or null while the buffer is still too
 * short to be worth cutting.
 *
 * `final` is the end of the writer's stream, where whatever is left is a unit whether or not
 * it ends in a full stop — the last thing a tutor says often does not.
 */
export function takeSpeakableUnit(
  buffer: string,
  options: { first: boolean; final: boolean },
): { unit: string; rest: string } | null {
  // Trailing whitespace is not something anybody says, and dropping it here is what stops the
  // end of a stream from dispatching a repair call for a newline.
  if (!buffer.trim()) {
    return null;
  }

  if (options.final) {
    return { unit: buffer, rest: "" };
  }

  const min = options.first ? FIRST_UNIT_MIN_CHARS : LATER_UNIT_MIN_CHARS;
  const max = options.first ? FIRST_UNIT_MAX_CHARS : LATER_UNIT_MAX_CHARS;

  if (buffer.length < min) {
    return null;
  }

  const bounds = { min, max, earliest: options.first };
  // A finished sentence is always the best cut.
  let cut = findBoundary(buffer, SENTENCE_END, bounds);

  // Only the opening unit is allowed to be half a sentence, and only because the alternative
  // is the learner listening to nothing while the writer finishes one.
  if (cut < 0 && options.first) {
    cut = findBoundary(buffer, CLAUSE_END, bounds);
  }

  // Nothing punctuated in range: cut at a word boundary rather than let the buffer grow
  // unbounded behind a writer that is mid-list.
  if (cut < 0 && buffer.length >= max) {
    const space = buffer.lastIndexOf(" ", max);
    cut = space > min ? space + 1 : max;
  }

  if (cut < 0) {
    return null;
  }

  return { unit: buffer.slice(0, cut), rest: buffer.slice(cut) };
}

/* --- cutting a written document into passages ----------------------------- */

/**
 * How much markdown goes into one repair call.
 *
 * Small enough that a model holds the whole passage in view and returns it intact, large enough
 * that a note is a handful of parallel calls rather than fifty. The passages are repaired
 * concurrently, so this is about accuracy, not speed.
 */
const REPAIR_PASSAGE_MAX_CHARS = 2_000;

/**
 * Cuts a markdown document into passages that can be repaired independently and reassembled by
 * plain concatenation.
 *
 * Two rules and nothing else. A cut may only fall on a blank line, because that is the one place
 * markdown has no state to carry across — a cut inside a table or a list hands the model half a
 * structure and gets back a model's guess at the other half. And a fenced code block is never
 * split: code is not prose, its contents are not the language being checked, and it is the one
 * thing in a note that must come back byte-identical.
 *
 * `splitForRepair(text).join("") === text` for every input, which is what makes reassembly safe.
 */
export function splitForRepair(text: string, options: { maxChars?: number } = {}): string[] {
  const maxChars = options.maxChars ?? REPAIR_PASSAGE_MAX_CHARS;

  if (!text) {
    return [];
  }

  const lines = text.split(/(?<=\n)/u);
  const passages: string[] = [];
  let current = "";
  let block = "";
  let inFence = false;

  const closeBlock = () => {
    if (!block) {
      return;
    }

    // A block that would overflow the passage starts a new one — unless nothing is open yet, in
    // which case an oversized block travels alone rather than being cut somewhere unsafe.
    if (current && current.length + block.length > maxChars) {
      passages.push(current);
      current = "";
    }

    current += block;
    block = "";
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
    }

    block += line;

    if (!inFence && !line.trim()) {
      closeBlock();
    }
  }

  closeBlock();

  if (current) {
    passages.push(current);
  }

  return passages;
}

/* --- deciding whether to believe the correction --------------------------- */

/** Word-count ratios outside this are a rewrite wearing a proofreader's clothes. */
const MIN_LENGTH_RATIO = 0.7;
const MAX_LENGTH_RATIO = 1.4;

/**
 * How far a repair may move the actual characters.
 *
 * The word-count check alone lets a whole passage be re-worded as long as it comes back the same
 * length, which is the failure that matters: a fluent paraphrase reads perfectly and is not what
 * the material said. Repairing spelling and inflection touches a few characters in a few words —
 * measured over the tutor fixture, the real repairs moved 1 to 4 per cent of a passage. The floor
 * is there so a very short unit, where one fixed word is a large share of it, survives.
 */
const MAX_EDIT_SHARE = 0.25;
const MIN_EDIT_ALLOWANCE = 20;

/** The sound-effect tags from tutor-voice-prompt.ts. Anything else in brackets is not ours. */
const BRACKET_TAG = /\[[^\]]*\]/gu;

/** Furniture a synthesizer reads as noise. A repair that introduces any is not a repair. */
const UNSPEAKABLE = /[*#`_|]|\\[a-zA-Z]+|\$[^$]+\$/u;

/**
 * Every markdown token that carries structure, in the order it appears.
 *
 * Compared rather than counted, so a repair that moves a heading, drops a table pipe or turns a
 * list item into a paragraph is refused. What is inside them is free to change; where they are
 * is not.
 */
const MARKDOWN_SKELETON = /^[ \t]*(?:#{1,6}[ \t]|[-*+][ \t]|\d+[.)][ \t]|>[ \t])|\||\*\*|`+|!?\[|\]\(/gmu;

function words(text: string) {
  return text.trim().split(/\s+/u).filter(Boolean);
}

function tags(text: string) {
  return (text.match(BRACKET_TAG) ?? []).join("|");
}

function skeleton(text: string) {
  return (text.match(MARKDOWN_SKELETON) ?? []).map((token) => token.trim()).join("\u0000");
}

/**
 * Levenshtein distance, abandoned as soon as it exceeds `limit`.
 *
 * Bounded on purpose: the answer is only ever compared against a threshold, and a passage that
 * has been rewritten wholesale is exactly the one where the full computation would cost the most
 * and tell us the least.
 */
function editDistanceWithin(a: string, b: string, limit: number) {
  if (Math.abs(a.length - b.length) > limit) {
    return limit + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_unused, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowBest = i;

    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
      current.push(value);
      rowBest = Math.min(rowBest, value);
    }

    if (rowBest > limit) {
      return limit + 1;
    }

    previous = current;
  }

  return previous[b.length];
}

export function acceptCorrection(
  original: string,
  corrected: string | null | undefined,
  options: { markdown?: boolean } = {},
) {
  if (typeof corrected !== "string") {
    return false;
  }

  const trimmed = corrected.trim();

  if (!trimmed) {
    return false;
  }

  const originalWords = words(original);
  const correctedWords = words(trimmed);

  if (!originalWords.length || !correctedWords.length) {
    return false;
  }

  const ratio = correctedWords.length / originalWords.length;

  if (ratio < MIN_LENGTH_RATIO || ratio > MAX_LENGTH_RATIO) {
    return false;
  }

  const allowance = Math.max(MIN_EDIT_ALLOWANCE, Math.round(original.length * MAX_EDIT_SHARE));

  if (editDistanceWithin(original.trim(), trimmed, allowance) > allowance) {
    return false;
  }

  if (options.markdown) {
    // In a note the markdown is the document. A repair may fix the words inside a table cell; it
    // may not decide the table should have been a list.
    return skeleton(original) === skeleton(trimmed);
  }

  // Sound effects are performed, not read. One invented here would be an audible event the
  // teaching model never asked for, so the set has to come through exactly as it went in.
  if (tags(original) !== tags(trimmed)) {
    return false;
  }

  return !(UNSPEAKABLE.test(trimmed) && !UNSPEAKABLE.test(original));
}

/**
 * Keeps the spacing the writer chose.
 *
 * Units are cut mid-stream, so a unit usually carries a leading and a trailing space that
 * hold it apart from its neighbours. A model returns its answer trimmed. Losing those spaces
 * welds two words together, which the synthesizer duly pronounces as one.
 */
export function reattachPadding(original: string, corrected: string) {
  const leading = original.match(/^\s*/u)?.[0] ?? "";
  const trailing = original.match(/\s*$/u)?.[0] ?? "";

  return `${leading}${corrected.trim()}${trailing}`;
}

/* --- the stream ----------------------------------------------------------- */

export type ProofreadUnitOutcome = "corrected" | "unchanged" | "rejected" | "timedOut" | "failed";

export type ProofreadStreamStats = {
  units: number;
  outcomes: Record<ProofreadUnitOutcome, number>;
  /** How long the learner waited on the proofreader beyond the writer, for the first unit. */
  firstUnitWaitMs: number | null;
};

export type ProofreadStreamOptions = {
  /**
   * Runs one correction. Separated from the stream so the same pipeline can be measured
   * offline against any model without dragging the server's usage logging in with it.
   */
  correct: (params: {
    text: string;
    preceding: string;
    signal: AbortSignal;
  }) => Promise<string | null>;
  /** Where corrected text goes. Called in writing order, exactly once per unit. */
  onDelta: (text: string) => void;
  /**
   * How long a unit may wait for its correction before it is spoken as written.
   *
   * The first unit's budget is the only one the learner can hear as silence, so it is the
   * tight one; by the second there are already several seconds of audio queued ahead of it
   * and the correction finishes far inside the time that audio takes to play.
   */
  firstUnitDeadlineMs?: number;
  laterUnitDeadlineMs?: number;
};

/*
 * Measured 2026-09-04 on gemini-3.5-flash-lite over real tutor units
 * (scripts/language-check-bench.mjs): a first unit comes back at a p50 of 736ms and a p90 of
 * 825ms, a later one at 850ms and 917ms. Both budgets sit well past p90, because the cost of
 * being wrong is asymmetric — a deadline set at the median throws away half the repairs to save
 * a few hundred milliseconds, and one set too high can only ever cost that much once per unit.
 *
 * The first budget is the only one a learner can hear as silence. By the second unit there are
 * several seconds of audio queued ahead of it and the repair finishes far inside the time that
 * audio takes to play, so the later budget is loose on purpose: it is there to catch a hung
 * gateway, not to pace anything.
 */
const DEFAULT_FIRST_DEADLINE_MS = 1_400;
const DEFAULT_LATER_DEADLINE_MS = 2_500;

/**
 * Wraps the writer's `onDelta` with the correction pipeline.
 *
 * Returns the same shape the caller was going to use — `push` for each delta, `flush` once
 * the writer is done — so the tutor route changes by one wrapper rather than by a rewrite.
 */
export function createProofreadStream(options: ProofreadStreamOptions) {
  const firstDeadlineMs = options.firstUnitDeadlineMs ?? DEFAULT_FIRST_DEADLINE_MS;
  const laterDeadlineMs = options.laterUnitDeadlineMs ?? DEFAULT_LATER_DEADLINE_MS;

  let buffer = "";
  /** Everything already emitted, which is the context the next unit is judged in. */
  let emitted = "";
  let unitCount = 0;
  let firstUnitWaitMs: number | null = null;
  const outcomes: Record<ProofreadUnitOutcome, number> = {
    corrected: 0,
    unchanged: 0,
    rejected: 0,
    timedOut: 0,
    failed: 0,
  };

  /*
   * Corrections start the moment their unit exists and finish whenever they finish; speech
   * has to come out in the order it was written. Chaining each emit onto the previous one is
   * what keeps those two facts apart — the calls overlap, the output does not.
   */
  let queue: Promise<void> = Promise.resolve();

  const dispatch = (unit: string, first: boolean) => {
    unitCount += 1;
    const preceding = emitted.slice(-PRECEDING_CONTEXT_CHARS);
    emitted += unit;

    const controller = new AbortController();
    const deadlineMs = first ? firstDeadlineMs : laterDeadlineMs;
    const startedAt = Date.now();

    /*
     * Two things happen at the deadline, and both are needed. The signal is raised, so a
     * correction that is still in flight releases its socket rather than queueing behind every
     * unit after it — but nothing here may *depend* on the caller honouring that signal. The
     * race is what actually bounds the wait: whatever the correction does or does not do about
     * being cancelled, the unit is spoken on time. That is the promise this layer makes, and a
     * proofreader that hangs is exactly the case where it has to hold.
     */
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<{ text: string; outcome: ProofreadUnitOutcome }>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ text: unit, outcome: "timedOut" });
      }, deadlineMs);
    });

    const attempt = options
      .correct({ text: unit, preceding, signal: controller.signal })
      .then((corrected) => {
        if (!acceptCorrection(unit, corrected)) {
          return { text: unit, outcome: "rejected" as const };
        }

        const repaired = reattachPadding(unit, corrected as string);

        return repaired === unit
          ? { text: unit, outcome: "unchanged" as const }
          : { text: repaired, outcome: "corrected" as const };
      })
      .catch(() => ({
        text: unit,
        outcome: (controller.signal.aborted ? "timedOut" : "failed") as ProofreadUnitOutcome,
      }));

    const settled = Promise.race([attempt, expired]).finally(() => clearTimeout(timer));

    queue = queue.then(async () => {
      const { text, outcome } = await settled;
      outcomes[outcome] += 1;

      if (first) {
        firstUnitWaitMs = Date.now() - startedAt;
      }

      try {
        options.onDelta(text);
      } catch (error) {
        /*
         * The consumer is gone — a learner who closed the tab mid-turn, most often. It must not
         * poison the chain: a rejected `queue` would strand every unit behind it and turn a
         * finished turn into a failed one at `flush`. There is nothing to recover here, only
         * something not to break.
         */
        console.warn("[language-repair] could not deliver a repaired unit", error);
      }
    });
  };

  return {
    push(delta: string) {
      buffer += delta;

      for (;;) {
        const taken = takeSpeakableUnit(buffer, { first: unitCount === 0, final: false });

        if (!taken) {
          return;
        }

        buffer = taken.rest;
        dispatch(taken.unit, unitCount === 0);
      }
    },

    /** Sends what is left, then resolves once every unit has been emitted in order. */
    async flush(): Promise<ProofreadStreamStats> {
      if (buffer.trim()) {
        dispatch(buffer, unitCount === 0);
      }

      buffer = "";
      await queue;

      return { units: unitCount, outcomes, firstUnitWaitMs };
    },
  };
}
