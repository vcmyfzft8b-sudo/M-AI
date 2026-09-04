import assert from "node:assert/strict";
import test from "node:test";

import {
  alignPodcastWords,
  buildPodcastCues,
  cueAt,
  normalizePodcastTurns,
  parseStoredCues,
  parseStoredTurns,
  toSpokenTurnText,
} from "../src/lib/podcast-script.ts";
import {
  displacedPodcastVoice,
  estimatedPodcastMinutes,
  estimatedSpokenSeconds,
  getPodcastFormat,
  PODCAST_RESERVED_WORDS_PER_SECOND,
  PODCAST_WORDS_PER_SECOND,
  normalizePodcastFormat,
  normalizePodcastLength,
  normalizePodcastVoice,
  PODCAST_FORMATS,
  PODCAST_LENGTHS,
  PODCAST_MAX_TURN_WORDS,
  PODCAST_MIN_TURN_WORDS,
  reservedSpokenSeconds,
  SEGMENT_REQUESTS_WHILE_BUFFERED,
  SEGMENT_REQUESTS_WHILE_CATCHING_UP,
  segmentRequestAllowance,
} from "../src/lib/podcast-settings.ts";
import { NOTE_TTS_VOICES } from "../src/lib/note-tts-settings.ts";

const words = (count, word = "beseda") => Array.from({ length: count }, () => word).join(" ");

/*
 * Everything here is a rule the prompt also states. The prompt is where the model is asked; this
 * is where the answer is made safe, because every one of these failures is silent when it lands:
 * a page of markdown is read out as punctuation, a turn past the synthesizer's ceiling loses its
 * ending with a 200, and two turns from the same host play as one voice stopping for no reason.
 */

test("a turn is stripped of everything a synthesizer would read out as noise", () => {
  assert.equal(toSpokenTurnText("**Točno tako** — in to je bistvo."), "Točno tako — in to je bistvo.");
  assert.equal(toSpokenTurnText("## Naslov\nTo je poved."), "Naslov To je poved.");
  assert.equal(toSpokenTurnText("- prva stvar"), "prva stvar");
  assert.equal(toSpokenTurnText("uporabi `map()` tukaj"), "uporabi map() tukaj");
});

test("a speaker label the model wrote anyway is not spoken aloud", () => {
  assert.equal(toSpokenTurnText("A: pa poglejva."), "pa poglejva.");
  assert.equal(toSpokenTurnText("Host B — druga stran."), "druga stran.");
  // A real sentence that merely starts with a short word must survive untouched.
  assert.equal(toSpokenTurnText("Ampak poglej to."), "Ampak poglej to.");
});

test("a formula becomes something a person could say", () => {
  const spoken = toSpokenTurnText("Torej $E = mc^2$ velja.");

  assert.ok(!spoken.includes("$"), "the delimiters must not survive");
  assert.ok(!spoken.includes("^"), "a caret has no sound and must not reach the synthesizer");
  assert.equal(toSpokenTurnText("Velja $\\frac{a}{b}$."), "Velja a / b.");
});

test("consecutive turns from one host are merged into the turn they actually are", () => {
  const turns = normalizePodcastTurns({
    turns: [
      { speaker: "a", text: "Prvi del." },
      { speaker: "a", text: "Drugi del." },
      { speaker: "b", text: "In odgovor." },
    ],
    speakerCount: 2,
  });

  assert.deepEqual(turns, [
    { speaker: "a", text: "Prvi del. Drugi del." },
    { speaker: "b", text: "In odgovor." },
  ]);
});

test("a solo episode has one host however the model labelled its turns", () => {
  const turns = normalizePodcastTurns({
    turns: [
      { speaker: "a", text: "Prva poved." },
      { speaker: "b", text: "Druga poved." },
    ],
    speakerCount: 1,
  });

  assert.equal(turns.length, 2, "a solo episode keeps its own paragraphing");
  assert.ok(
    turns.every((turn) => turn.speaker === "a"),
    "a solo episode cannot alternate",
  );
});

/*
 * The merge above must not reach a solo episode, where every turn is the same speaker by
 * definition. Measured on the omrezja-sl fixture before this exception existed: an eleven-turn
 * briefing collapsed into three blocks of up to 216 words — two minutes of audio in one request,
 * which is two minutes of silence before the first sound and a transcript with three lines to
 * click.
 */
test("a solo episode keeps the writer's paragraphing instead of collapsing into one block", () => {
  const turns = normalizePodcastTurns({
    turns: Array.from({ length: 8 }, (_entry, index) => ({
      speaker: "a",
      text: `${words(40)} stavek stevilka ${index}.`,
    })),
    speakerCount: 1,
  });

  assert.equal(turns.length, 8, "nothing may be merged when there is only one host");
});

test("empty and whitespace-only turns are dropped rather than sent to be synthesized", () => {
  const turns = normalizePodcastTurns({
    turns: [
      { speaker: "a", text: "   " },
      { speaker: "b", text: "**" },
      { speaker: "a", text: "Prava poved." },
    ],
    speakerCount: 2,
  });

  assert.deepEqual(turns, [{ speaker: "a", text: "Prava poved." }]);
});

/*
 * Soniox stops a request at three minutes of audio and truncates the rest with a 200 and no
 * warning, so a turn the model wrote too long has to be split before it is ever sent — the
 * listener would otherwise simply lose the end of a sentence and never be told.
 */
test("a turn past the synthesizer's ceiling is split, and split between sentences", () => {
  const long = `${words(PODCAST_MAX_TURN_WORDS)}. ${words(PODCAST_MAX_TURN_WORDS)}.`;
  const turns = normalizePodcastTurns({
    turns: [{ speaker: "a", text: long }],
    speakerCount: 2,
  });

  assert.ok(turns.length > 1, "an over-long turn must be split");

  for (const turn of turns) {
    assert.equal(turn.speaker, "a", "a split turn is still the same host speaking");
    assert.ok(
      turn.text.trim().endsWith("."),
      "each part ends where a sentence does, not mid-thought",
    );
    assert.ok(
      turn.text.split(/\s+/u).filter(Boolean).length <= PODCAST_MAX_TURN_WORDS,
      "no part may still exceed the ceiling",
    );
  }
});

test("stored turns are read back defensively, because the column is json", () => {
  assert.deepEqual(parseStoredTurns(null), []);
  assert.deepEqual(parseStoredTurns("not an array"), []);
  assert.deepEqual(
    parseStoredTurns([{ speaker: "b", text: "Da." }, { speaker: "z", text: "Ne." }, { text: "" }, 7]),
    [
      { speaker: "b", text: "Da." },
      { speaker: "a", text: "Ne." },
    ],
  );
});

/*
 * Two hosts who sound alike is the one failure this feature can ship that nobody notices until
 * they are listening: the episode becomes one person talking to themselves.
 */
test("taking a voice moves the other host to one that is not it", () => {
  for (const voice of NOTE_TTS_VOICES) {
    const displaced = displacedPodcastVoice(voice);

    assert.notEqual(displaced, voice, `${voice} was displaced onto itself`);
    assert.ok(NOTE_TTS_VOICES.includes(displaced), `${displaced} is not a voice that exists`);
  }
});

test("a format or length that is not on offer falls back instead of reaching the model", () => {
  assert.equal(normalizePodcastFormat("deep_dive"), "deep_dive");
  assert.equal(normalizePodcastFormat("chat_show"), "deep_dive");
  assert.equal(normalizePodcastFormat(undefined), "deep_dive");
  assert.equal(normalizePodcastLength("brief"), "brief");
  assert.equal(normalizePodcastLength("epic"), "standard");
  assert.equal(normalizePodcastVoice("Nonsense", "b"), "Grace");
});

test("every show names how many voices it needs, and only one show is solo", () => {
  assert.equal(PODCAST_FORMATS.filter((format) => format.speakerCount === 1).length, 1);
  assert.equal(getPodcastFormat("solo").speakerCount, 1);
  assert.equal(getPodcastFormat("debate").speakerCount, 2);
});

test("the lengths are ordered, and each is a plausible episode", () => {
  const minutes = PODCAST_LENGTHS.map((length) => estimatedPodcastMinutes(length.id));

  assert.deepEqual([...minutes].sort((a, b) => a - b), minutes, "the lengths must increase");
  assert.ok(minutes[0] >= 4, "the shortest episode is still an episode");
  assert.ok(minutes[minutes.length - 1] <= 20, "the longest is still something somebody finishes");
});

/*
 * The two rates are not interchangeable and swapping them is a silent money bug rather than a
 * visible one: reserving at the display rate under-holds the daily allowance on every turn slower
 * than average, and the shortfall is only settled once the audio already exists.
 */
test("a turn is reserved against a slower rate than it is advertised at", () => {
  assert.ok(
    PODCAST_RESERVED_WORDS_PER_SECOND < PODCAST_WORDS_PER_SECOND,
    "the reservation rate must sit below the measured average, never above it",
  );

  const turn = words(100);

  assert.ok(
    reservedSpokenSeconds(turn) > estimatedSpokenSeconds(turn),
    "a hundred words must be held for longer than they are expected to take",
  );
  assert.equal(reservedSpokenSeconds(""), 1, "a reservation is never nothing");
});

/*
 * The estimate is what the daily allowance is reserved against before a word has been
 * synthesized, so it must never come back as nothing.
 */
test("a turn's estimated length is always at least a second", () => {
  assert.equal(estimatedSpokenSeconds(""), 1);
  assert.ok(estimatedSpokenSeconds(words(PODCAST_MIN_TURN_WORDS)) >= 1);
  assert.ok(
    estimatedSpokenSeconds(words(100)) > estimatedSpokenSeconds(words(50)),
    "a longer turn must estimate longer",
  );
});

/*
 * How many streams one listener takes decides how many people can listen at once, because the
 * synthesizer's concurrency cap is org-wide and shared with the voice tutor — which is talking to
 * somebody in real time and cannot queue behind an episode. Getting this wrong is not a bug the
 * listener sees; it is a bug everybody else sees.
 */
test("a listener takes one stream once buffered, and two only while catching up", () => {
  assert.equal(
    segmentRequestAllowance({ bufferedAhead: 3, rate: 1 }),
    SEGMENT_REQUESTS_WHILE_BUFFERED,
    "a comfortable buffer at normal speed needs one stream — synthesis outruns playback",
  );
  assert.equal(
    segmentRequestAllowance({ bufferedAhead: 0, rate: 1 }),
    SEGMENT_REQUESTS_WHILE_CATCHING_UP,
    "nothing buffered means the listener is waiting, so take the second stream",
  );
  assert.equal(
    segmentRequestAllowance({ bufferedAhead: 9, rate: 2 }),
    SEGMENT_REQUESTS_WHILE_CATCHING_UP,
    "at 2x one stream cannot keep up however deep the buffer already is",
  );
  assert.equal(
    segmentRequestAllowance({ bufferedAhead: 3, rate: 0.5 }),
    SEGMENT_REQUESTS_WHILE_BUFFERED,
    "slower than real time needs no help at all",
  );
});

test("the shortest episode is the one a listener waits through, and the ladder is honest", () => {
  // The labels are computed from the measured rate, so this is really a check that the numbers
  // on the buttons are the numbers of the audio — the thing that was wrong when the rate was
  // borrowed from read-aloud.
  assert.deepEqual(
    PODCAST_LENGTHS.map((length) => estimatedPodcastMinutes(length.id)),
    [4, 7, 12],
  );
});

/* --- subtitles ----------------------------------------------------------- */

/** Word-sized pieces the way the synthesizer reports them: text with exact start and end. */
function pieces(sentence, msPerWord = 400) {
  return sentence.split(" ").map((text, index) => ({
    text,
    start_ms: index * msPerWord,
    end_ms: (index + 1) * msPerWord - 20,
  }));
}

/** The ordinary case: the synthesizer reported every word of the turn it was given. */
const cuesFor = (sentence) => buildPodcastCues(sentence, pieces(sentence));

test("a subtitle line breaks at a sentence end rather than on width", () => {
  const cues = cuesFor("Prva poved se konca tukaj. Druga se zacne zdaj.");

  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, "Prva poved se konca tukaj.");
  assert.equal(cues[1].text, "Druga se zacne zdaj.");
});

test("no subtitle line is wider than the eye takes in one glance", () => {
  const cues = cuesFor(Array.from({ length: 40 }, () => "beseda").join(" "));

  assert.ok(cues.length > 1, "forty words cannot be one line");

  for (const cue of cues) {
    assert.ok(cue.text.length <= 46, `"${cue.text}" is ${cue.text.length} characters`);
  }
});

test("cues run forward, never overlap, and carry the synthesizer's own timings", () => {
  const cues = cuesFor("Ena dve tri stiri. Pet sest sedem osem. Devet deset enajst dvanajst.");

  assert.equal(cues[0].startMs, 0, "the first line starts when the first word does");

  for (let i = 0; i < cues.length; i += 1) {
    assert.ok(cues[i].endMs > cues[i].startMs, "a line must last");

    if (cues[i + 1]) {
      assert.ok(
        cues[i + 1].startMs >= cues[i].startMs,
        "lines must run forward",
      );
      assert.ok(
        cues[i].endMs <= cues[i + 1].startMs,
        "a line must be gone before the next one arrives, or two are on screen at once",
      );
    }
  }
});

/* A line that appears and vanishes inside a few frames is unreadable however correct its timing. */
test("a very short phrase is held long enough to read", () => {
  const [cue] = buildPodcastCues("Tocno.", [{ text: "Tocno.", start_ms: 0, end_ms: 180 }]);

  assert.ok(cue.endMs - cue.startMs >= 900, `held for only ${cue.endMs - cue.startMs}ms`);
});

test("the line on screen is the one being spoken, and the last one holds to the end", () => {
  const cues = cuesFor("Prva poved se konca tukaj. Druga se zacne zdaj.");

  assert.equal(cueAt(cues, 0)?.text, cues[0].text);
  assert.equal(cueAt(cues, cues[1].startMs + 50)?.text, cues[1].text);
  assert.equal(
    cueAt(cues, cues[1].endMs + 10_000)?.text,
    cues[1].text,
    "past the end the last line stays rather than blanking",
  );
});

test("a turn with no timings yields no cues rather than wrong ones", () => {
  assert.deepEqual(buildPodcastCues("Nekaj besed.", []), []);
  assert.equal(cueAt([], 1_000), null);
});

test("stored cues are read back defensively, because the column is json", () => {
  assert.deepEqual(parseStoredCues(null), []);
  assert.deepEqual(parseStoredCues("nope"), []);
  assert.deepEqual(
    parseStoredCues([
      { text: "Velja.", startMs: 0, endMs: 900 },
      { text: "brez casov" },
      { startMs: 1, endMs: 2 },
      42,
    ]),
    [{ text: "Velja.", startMs: 0, endMs: 900 }],
  );
});

/*
 * The defect this alignment exists for, caught on a real episode: a turn opening "Danes gre za
 * osnove…" produced a first subtitle reading "es gre za osnove…". The audio was complete; the
 * synthesizer's timing report simply omitted the first few characters. Anything that takes its
 * text from the report inherits the hole, so the report is used for WHEN and the script for WHAT.
 */
test("a turn whose opening the synthesizer failed to report still reads correctly", () => {
  const text = "Danes gre za osnove omrezij.";
  const reported = pieces(text).slice(1);
  reported[0] = { ...reported[0], text: "re" };

  const cues = buildPodcastCues(text, reported);
  const shown = cues.map((cue) => cue.text).join(" ");

  assert.equal(shown, text, "every word of the script must reach the screen");
});

test("a word the report skipped is placed between the words around it", () => {
  const text = "ena dve tri stiri";
  const reported = pieces(text).filter((piece) => piece.text !== "tri");
  const timed = alignPodcastWords(text, reported);

  assert.deepEqual(timed.map((word) => word.text), ["ena", "dve", "tri", "stiri"]);

  const missing = timed[2];
  assert.ok(missing.startMs >= timed[1].endMs, "the gap-filled word cannot start before the last");
  assert.ok(missing.endMs <= timed[3].startMs, "nor end after the next one begins");
});

test("audio tags never reach the subtitle, because they are never spoken", () => {
  const text = "[laughs] Tocno tako se zgodi.";
  const spoken = "Tocno tako se zgodi.";
  const cues = buildPodcastCues(text, pieces(spoken));

  assert.equal(cues.map((cue) => cue.text).join(" "), spoken);
});
