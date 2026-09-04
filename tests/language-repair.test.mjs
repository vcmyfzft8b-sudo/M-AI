import assert from "node:assert/strict";
import test from "node:test";

import {
  acceptCorrection,
  createProofreadStream,
  reattachPadding,
  shouldCheckLanguage,
  splitForRepair,
  takeSpeakableUnit,
} from "../src/lib/ai/language-repair.ts";

/* --- cutting the stream --------------------------------------------------- */

test("nothing is cut until there is enough text to be worth correcting", () => {
  assert.equal(takeSpeakableUnit("Pozdravljen", { first: true, final: false }), null);
});

test("the first unit is allowed to end at a clause, because it is the one that is waited for", () => {
  const taken = takeSpeakableUnit(
    "Predstavljaj si pismo za prijatelja, ki ga oddaš na pošti in potuje naprej",
    { first: true, final: false },
  );

  assert.equal(taken.unit, "Predstavljaj si pismo za prijatelja,");
  assert.equal(taken.rest, " ki ga oddaš na pošti in potuje naprej");
});

test("a finished sentence always beats a clause, even for the first unit", () => {
  const taken = takeSpeakableUnit(
    "Predstavljaj si, da pošiljaš pismo. Pismo gre najprej na pošto in nato naprej.",
    { first: true, final: false },
  );

  assert.equal(taken.unit, "Predstavljaj si, da pošiljaš pismo.");
});

test("later units are whole sentences, and take as many as the budget allows", () => {
  const filler = "Vsak sloj opravi natanko svoje delo in ga preda naprej sosedu. ";
  const buffer = ` Sloj je ena plast te zgradbe. ${filler.repeat(8)}Ta zadnja poved ne sme priti zraven.`;
  const taken = takeSpeakableUnit(buffer, { first: false, final: false });

  assert.ok(taken.unit.length <= 320);
  assert.ok(taken.unit.trim().endsWith("."));
  // Every sentence that fits comes in one unit — a later correction is free, an extra call is not.
  assert.equal(taken.unit.match(/\./gu).length, 5);
  assert.ok(taken.rest.endsWith("Ta zadnja poved ne sme priti zraven."));
});

test("a later unit does not cut at a clause — half a sentence is only worth it once", () => {
  const buffer = " Sloj je ena plast te zgradbe, ki opravi svoje delo in jo preda naprej sosedu";

  assert.equal(takeSpeakableUnit(buffer, { first: false, final: false }), null);
});

test("an unpunctuated run is cut at a word boundary rather than buffered forever", () => {
  const buffer = `${"beseda ".repeat(60)}`;
  const taken = takeSpeakableUnit(buffer, { first: false, final: false });

  assert.ok(taken.unit.length <= 320);
  assert.ok(taken.unit.endsWith(" "));
  assert.equal(taken.unit + taken.rest, buffer);
});

test("the end of the stream is a unit whether or not it ends in a full stop", () => {
  const taken = takeSpeakableUnit("in to je vse", { first: false, final: true });

  assert.equal(taken.unit, "in to je vse");
  assert.equal(taken.rest, "");
});

/* --- believing the correction --------------------------------------------- */

const ORIGINAL = "Podatke od pošiljaš po omrežju in jih naslovnik prejme.";

test("a repaired word is accepted", () => {
  assert.equal(
    acceptCorrection(ORIGINAL, "Podatke odpošiljaš po omrežju in jih naslovnik prejme."),
    true,
  );
});

test("a rewrite is refused, however much better it reads", () => {
  assert.equal(acceptCorrection(ORIGINAL, "Pošiljaš."), false);
  assert.equal(
    acceptCorrection(
      ORIGINAL,
      "Podatke odpošiljaš po omrežju, kjer potujejo skozi vrsto vmesnih naprav, dokler jih naslovnik na drugem koncu končno ne prejme in razpakira.",
    ),
    false,
  );
});

test("an empty or missing correction is refused", () => {
  assert.equal(acceptCorrection(ORIGINAL, "   "), false);
  assert.equal(acceptCorrection(ORIGINAL, null), false);
  assert.equal(acceptCorrection(ORIGINAL, undefined), false);
});

test("a sound effect may not be invented, dropped or changed", () => {
  const withTag = "[whispers] To je pravzaprav izpitno vprašanje.";

  assert.equal(acceptCorrection(withTag, "[whispers] To je pravzaprav izpitno vprašanje."), true);
  assert.equal(acceptCorrection(withTag, "To je pravzaprav izpitno vprašanje."), false);
  assert.equal(acceptCorrection(withTag, "[laughs] To je pravzaprav izpitno vprašanje."), false);
  assert.equal(acceptCorrection(ORIGINAL, `[laughs] ${ORIGINAL}`), false);
});

test("a correction may not introduce anything a synthesizer reads as noise", () => {
  assert.equal(acceptCorrection(ORIGINAL, "**Podatke** odpošiljaš po omrežju in jih prejme."), false);
});

test("padding is put back, because the model returns its answer trimmed", () => {
  assert.equal(reattachPadding(" sloj je plast. ", "Sloj je plast."), " Sloj je plast. ");
});

/* --- the stream ----------------------------------------------------------- */

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

test("speech comes out in the order it was written, whatever order the corrections return in", async () => {
  const gates = [deferred(), deferred(), deferred()];
  let dispatched = 0;
  const spoken = [];

  const stream = createProofreadStream({
    onDelta: (text) => spoken.push(text),
    correct: async () => {
      const gate = gates[dispatched];
      dispatched += 1;

      return gate.promise;
    },
  });

  // Long enough that each is a unit of its own: the first is cut as early as it may be, and
  // each one after it fills its own budget.
  const long = (n) =>
    `Poved številka ${n} je namenoma tako dolga, da sama zapolni svojo enoto in je ni mogoče združiti s sosedo.`;
  // A believable repair rather than a rewrite, so the guard lets it through.
  const repair = (text) => text.trim().replace("namenoma", "namerno");

  stream.push(`${long(1)} ${long(2)} `);
  stream.push(`${long(3)}`);

  assert.equal(dispatched, 3, "every unit is sent for correction as soon as it exists");

  // Answer them backwards: the last correction to be asked for lands first.
  gates[2].resolve(repair(long(3)));
  gates[1].resolve(repair(long(2)));
  gates[0].resolve(repair(long(1)));

  const stats = await stream.flush();

  assert.equal(stats.units, 3);
  assert.deepEqual(
    spoken.map((text) => text.trim()),
    [repair(long(1)), repair(long(2)), repair(long(3))],
  );
  assert.equal(stats.outcomes.corrected, 3);
});

test("a correction that is late is not waited for — the turn is spoken as it was written", async () => {
  const original = "Podatke od pošiljaš po omrežju in jih naslovnik prejme na drugi strani.";
  let spoken = "";

  const stream = createProofreadStream({
    firstUnitDeadlineMs: 20,
    laterUnitDeadlineMs: 20,
    onDelta: (text) => {
      spoken += text;
    },
    correct: ({ signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  });

  stream.push(original);

  const stats = await stream.flush();

  assert.equal(spoken, original);
  assert.equal(stats.outcomes.timedOut, stats.units);
});

test("a proofreader that throws costs nothing but the correction", async () => {
  const original = "Podatke od pošiljaš po omrežju in jih naslovnik prejme na drugi strani.";
  let spoken = "";

  const stream = createProofreadStream({
    onDelta: (text) => {
      spoken += text;
    },
    correct: async () => {
      throw new Error("gateway down");
    },
  });

  stream.push(original);
  const stats = await stream.flush();

  assert.equal(spoken, original);
  assert.equal(stats.outcomes.failed, stats.units);
});

test("not one character of the turn is lost or duplicated on the way through", async () => {
  const original =
    "Predstavljaj si, da pošiljaš pismo. Ovojnica ima naslov, pismo pa vsebino. " +
    "Omrežje dela enako: naslov pove, kam gre, vsebina pa je tisto, kar šteje. " +
    "In prav to je bistvo sloja, ki ga zdaj gledava.";
  let spoken = "";

  const stream = createProofreadStream({
    onDelta: (text) => {
      spoken += text;
    },
    // A proofreader that finds nothing wrong is the expected case, and it must be a no-op.
    correct: async ({ text }) => text.trim(),
  });

  for (const chunk of original.match(/.{1,7}/gsu)) {
    stream.push(chunk);
  }

  const stats = await stream.flush();

  assert.equal(spoken, original);
  assert.equal(stats.outcomes.unchanged, stats.units);
});

test("a proofreader that ignores its deadline cannot hold the speech up", async () => {
  const original = "Podatke od pošiljaš po omrežju in jih naslovnik prejme na drugi strani.";
  let spoken = "";
  let resolveLate;

  const stream = createProofreadStream({
    firstUnitDeadlineMs: 20,
    laterUnitDeadlineMs: 20,
    onDelta: (text) => {
      spoken += text;
    },
    // Deliberately deaf to the signal — a hung gateway, or simply an implementation that
    // forgot to pass it on. The turn still has to be spoken on time.
    correct: () =>
      new Promise((resolve) => {
        resolveLate = resolve;
      }),
  });

  stream.push(original);

  const stats = await stream.flush();

  assert.equal(spoken, original);
  assert.equal(stats.outcomes.timedOut, stats.units);

  resolveLate?.("too late to matter");
});

/* --- cutting a written document ------------------------------------------ */

test("a document split for repair reassembles into exactly itself", () => {
  const note = [
    "## 1. Računalniško omrežje\n",
    "\n",
    "**Omrežje** je skupina naprav.\n",
    "\n",
    "| # | Plast | Naloga |\n",
    "|---|---|---|\n",
    "| 7 | aplikacijska | storitve aplikacijam |\n",
    "\n",
    "- LAN: ena stavba\n",
    "- WAN: več držav\n",
  ].join("");

  assert.equal(splitForRepair(note, { maxChars: 60 }).join(""), note);
});

test("a table is never cut in half, however small the budget", () => {
  const note = "Uvod.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\n\nZaključek.\n";
  const passages = splitForRepair(note, { maxChars: 10 });

  assert.equal(passages.join(""), note);
  assert.equal(
    passages.filter((passage) => passage.includes("|")).length,
    1,
    "the whole table travels as one passage",
  );
});

test("a fenced code block is not a paragraph boundary", () => {
  const note = "Koda:\n\n```js\nconst a = 1;\n\nconst b = 2;\n```\n\nKonec.\n";
  const passages = splitForRepair(note, { maxChars: 20 });

  assert.equal(passages.join(""), note);
  assert.equal(passages.filter((passage) => passage.includes("```")).length, 1);
});

test("an empty document has no passages", () => {
  assert.deepEqual(splitForRepair(""), []);
});

/* --- believing a repair to a written note --------------------------------- */

const ROW = "| 3 | omrežna | usmerjanje paketov med različnimi omrežji |\n";

test("a note repair may fix the words in a table cell", () => {
  assert.equal(
    acceptCorrection(ROW, "| 3 | omrežna | usmerjanje paketov med različnimi omrežji |", {
      markdown: true,
    }),
    true,
  );
});

test("a note repair may not restructure the markdown around them", () => {
  assert.equal(
    acceptCorrection(ROW, "- omrežna: usmerjanje paketov med različnimi omrežji", {
      markdown: true,
    }),
    false,
  );
  assert.equal(
    acceptCorrection("## Naslov\n", "### Naslov", { markdown: true }),
    false,
  );
});

test("a fluent paraphrase of the same length is refused, which is the edit the guard exists for", () => {
  const original =
    "Vsaka plast opravi svojo nalogo in preda podatke naslednji plasti pod seboj.";

  // Same word count, same shape, entirely different sentence — the failure a length check misses.
  assert.equal(
    acceptCorrection(original, "Sleherni sloj izvede lastno delo ter posreduje vsebino sosednjemu sloju nad njim."),
    false,
  );
  // The repair it is supposed to let through, on the same sentence.
  assert.equal(
    acceptCorrection(original, "Vsaka plast opravi svojo nalogo in preda podatke naslednji plasti pod sabo."),
    true,
  );
});

/* --- which languages the checker is for ----------------------------------- */

test("English is left alone, because it was measured not to need this", () => {
  assert.equal(shouldCheckLanguage("en"), false);
  assert.equal(shouldCheckLanguage("EN"), false);
  // A regional tag is still English.
  assert.equal(shouldCheckLanguage("en-GB"), false);
});

test("every language that inflects goes through the checker", () => {
  for (const language of ["sl", "hr", "sr", "bs", "de", "cs", "pl", "sl-SI"]) {
    assert.equal(shouldCheckLanguage(language), true, language);
  }
});

test("an unknown language is checked, because unknown could be anything", () => {
  assert.equal(shouldCheckLanguage(null), true);
  assert.equal(shouldCheckLanguage(undefined), true);
  assert.equal(shouldCheckLanguage(""), true);
});
