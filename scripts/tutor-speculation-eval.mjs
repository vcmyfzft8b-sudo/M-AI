/**
 * Does answering early actually pay? Measured 2026-09-04: no, and here is why.
 *
 * The tutor asks Soniox to wait 900ms of silence before calling an utterance finished, and that
 * wait is most of what a learner feels as slowness — of the ~2.05s between their last word and
 * the tutor's first, 900ms is endpointing, ~750ms is the model writing and ~400ms the
 * synthesizer. The obvious idea is to write the answer during the wait, from the transcript as it
 * stands, and speak it the moment the utterance is confirmed. It was built, wired into the tutor,
 * and measured here. It does not work, for a reason worth keeping:
 *
 *   the transcript already said its final words this long before <end>
 *     p10 0ms · p50 0ms · p90 823ms
 *
 * Half the time the recogniser delivers the last words of the question in the same breath as it
 * declares the question over. The endpoint delay and the transcript finalising are not two events
 * with a usable gap between them — they are one event, and there is nothing correct to answer
 * early.
 *
 * Re-measured 2026-09-04 with the trigger that was actually asked for — start the answer when the
 * AUDIO goes quiet, not when the transcript stops changing — because the first attempt fired
 * mid-sentence and proved only that its trigger was wrong. It changes nothing:
 *
 *   started this long after the audio went quiet — was the transcript already right?
 *     0ms 0/15 · 150ms 0/15 · 300ms 0/15 · 450ms 0/6 · 600ms 0/1
 *
 * Never, at any wait. Soniox withholds the last words of an utterance until it endpoints, so
 * there is no moment before `<end>` at which the question is fully written down. The only way to
 * have the transcript sooner is to make Soniox endpoint sooner — which is the endpoint delay
 * again, and a product judgement.
 *
 * The stillness trigger fails on its own account too, worth knowing separately in case Soniox
 * ever changes how it streams tokens:
 *
 *   transcript sat still WHILE the speaker was still talking
 *     p50 146ms · p90 294ms · p99 522ms · max 1044ms
 *
 * Token delivery stalls mid-sentence for longer than the whole 900ms window, so "the transcript
 * stopped changing" cannot stand in for "they stopped talking" at any threshold. Over 15 runs the
 * speculation was accepted 0 times, every guess a fragment: "Nisem čisto raz", "Kaj je pravz",
 * "Zakaj je plasti točno".
 *
 * What is left is the endpoint delay itself, which is a product judgement rather than an
 * engineering one: 900ms is how long the tutor waits before deciding somebody drawing breath has
 * finished, and lowering it trades interrupting them against answering sooner.
 *
 * How it measures: a question is synthesized with Soniox TTS and streamed into Soniox STT at
 * speaking pace, every partial is timestamped along with the moment `<end>` arrives, and the
 * rule below is replayed over that timeline.
 *
 *   node --experimental-strip-types scripts/tutor-speculation-eval.mjs
 *   node --experimental-strip-types scripts/tutor-speculation-eval.mjs --trials=3
 */


/*
 * The rule this harness replays. It lived in src/lib/tutor/speculation.ts and in the tutor itself
 * for exactly as long as it took to measure, so it lives here now, with the measurement that
 * retired it.
 */
const SPECULATION_STABLE_MS = 300;
const SPECULATION_MIN_CHARS = 12;

/** Case and punctuation removed: the recogniser adds both when it finalises a draft. */
function normalizeSpokenQuestion(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

const { default: WebSocket } = await import("ws");

const args = process.argv.slice(2);
const flag = (name, fallback) =>
  args.find((entry) => entry.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;

const trials = Number(flag("trials", "2"));
const SAMPLE_RATE = 24_000;
const FRAME_MS = 20;
const ENDPOINT_DELAY_MS = 900;

/*
 * The things learners actually interrupt with, in the language the tutor is weakest in. Two of
 * them carry a deliberate mid-sentence comma, which is where a speaker is most likely to pause
 * long enough to be guessed at early and wrongly — the case the acceptance rule exists for.
 */
const QUESTIONS = [
  "Počakaj, razloži mi to kot da imam pet let.",
  "Kaj je pravzaprav razlika med tema dvema protokoloma?",
  "Nisem čisto razumel zadnjega dela, lahko ponoviš?",
  "Zakaj je plasti točno sedem in ne manj?",
  "Kaj pomeni to v praksi za navadnega uporabnika?",
];

async function temporaryKey(usage) {
  const response = await fetch("https://api.soniox.com/v1/auth/temporary-api-key", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SONIOX_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ usage_type: usage, expires_in_seconds: 900 }),
  });

  if (!response.ok) {
    throw new Error(`temporary key (${usage}): ${response.status} ${await response.text()}`);
  }

  return (await response.json()).api_key;
}

/** Speaks a question, so the recogniser hears something a person could have said. */
async function synthesize({ apiKey, text }) {
  const socket = new WebSocket("wss://tts-rt.soniox.com/tts-websocket");
  const chunks = [];

  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  socket.send(
    JSON.stringify({
      api_key: apiKey,
      model: process.env.SONIOX_TTS_MODEL || "tts-rt-v2",
      language: "sl",
      voice: process.env.SONIOX_TTS_VOICE || "Grace",
      audio_format: "pcm_s16le",
      sample_rate: SAMPLE_RATE,
      stream_id: "spec-eval",
    }),
  );
  socket.send(JSON.stringify({ text, text_end: true, stream_id: "spec-eval" }));

  await new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.error_code) {
        reject(new Error(`${message.error_code}: ${message.error_message}`));

        return;
      }

      if (message.audio) {
        chunks.push(Buffer.from(message.audio, "base64"));
      }

      if (message.terminated) {
        socket.close();
        resolve();
      }
    });
    socket.on("error", reject);
  });

  return Buffer.concat(chunks);
}

/**
 * Streams that audio into the recogniser exactly as the browser does — same handshake, same 20ms
 * frames, same endpoint setting — and records when every transcript appeared.
 */
async function transcribe({ apiKey, pcm }) {
  const socket = new WebSocket("wss://stt-rt.soniox.com/transcribe-websocket");
  socket.binaryType = "arraybuffer";

  await new Promise((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });

  socket.send(
    JSON.stringify({
      api_key: apiKey,
      model: process.env.SONIOX_STT_REALTIME_MODEL || "stt-rt-v5",
      audio_format: "pcm_s16le",
      sample_rate: SAMPLE_RATE,
      num_channels: 1,
      language_hints: ["sl"],
      enable_endpoint_detection: true,
      max_endpoint_delay_ms: ENDPOINT_DELAY_MS,
    }),
  );

  const partials = [];
  let finalText = "";
  let draftText = "";
  let utterance = null;
  let utteranceAt = null;

  const done = new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString());

      if (message.error_code) {
        reject(new Error(`${message.error_code}: ${message.error_message}`));

        return;
      }

      let endpointed = false;
      let draft = "";

      for (const token of message.tokens ?? []) {
        const text = typeof token.text === "string" ? token.text : "";

        if (text === "<end>") {
          endpointed = true;
          continue;
        }

        if (text === "<fin>") {
          continue;
        }

        if (token.is_final === true) {
          finalText += text;
        } else {
          draft += text;
        }
      }

      draftText = draft;
      const heard = `${finalText}${draft}`.trim();

      if (heard) {
        partials.push({ at: Date.now(), text: heard });
      }

      if (endpointed) {
        utterance = `${finalText}${draftText}`.trim();
        utteranceAt = Date.now();
        finalText = "";
        draftText = "";
        socket.close();
        resolve();
      }
    });
    socket.on("error", reject);
    socket.on("close", () => resolve());
  });

  // Real time, in real frames: endpoint detection is about silence, and a burst would not have any.
  const bytesPerFrame = (SAMPLE_RATE * 2 * FRAME_MS) / 1000;
  const startedAt = Date.now();

  for (let offset = 0; offset < pcm.length; offset += bytesPerFrame) {
    socket.send(pcm.subarray(offset, offset + bytesPerFrame));
    const nextFrameAt = startedAt + (offset / bytesPerFrame + 1) * FRAME_MS;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextFrameAt - Date.now())));
  }

  const speechEndedAt = Date.now();
  const silence = Buffer.alloc(bytesPerFrame);

  // Silence, until the recogniser says the utterance is over — that wait is what is being measured.
  for (let frame = 0; frame < 150 && utterance === null; frame += 1) {
    socket.send(silence);
    await new Promise((resolve) => setTimeout(resolve, FRAME_MS));
  }

  await done;

  return { partials, utterance, utteranceAt, speechEndedAt };
}

/**
 * Replays the client's rule over a recorded timeline.
 *
 * The speculation fires once the transcript has been unchanged for SPECULATION_STABLE_MS, and is
 * accepted only when it normalizes equal to what the recogniser finally settled on.
 */
function replaySpeculation({ partials, utterance, utteranceAt }) {
  let firedAt = null;
  let firedText = null;

  for (let i = 0; i < partials.length; i += 1) {
    const { at, text } = partials[i];

    if (normalizeSpokenQuestion(text).length < SPECULATION_MIN_CHARS) {
      continue;
    }

    // The next moment this transcript changes, or the utterance if it never does.
    const nextChange =
      partials.slice(i + 1).find((entry) => entry.text !== text)?.at ?? utteranceAt;
    const wouldFireAt = at + SPECULATION_STABLE_MS;

    if (wouldFireAt <= nextChange) {
      firedAt = wouldFireAt;
      firedText = text;
      break;
    }
  }

  if (firedAt === null) {
    return { fired: false, accepted: false, headStartMs: 0 };
  }

  return {
    fired: true,
    firedText,
    accepted: normalizeSpokenQuestion(firedText) === normalizeSpokenQuestion(utterance ?? ""),
    headStartMs: Math.max(0, (utteranceAt ?? firedAt) - firedAt),
  };
}

const [ttsKey, sttKey] = await Promise.all([temporaryKey("tts_rt"), temporaryKey("transcribe_websocket")]);

console.log(`${QUESTIONS.length} questions × ${trials} trials, endpoint delay ${ENDPOINT_DELAY_MS}ms, stability ${SPECULATION_STABLE_MS}ms\n`);
console.log(`${"question".padEnd(46)}${"fired".padEnd(8)}${"accepted".padEnd(10)}head start`);

const results = [];
const gapsDuringSpeech = [];
/*
 * The question the transcript-stillness trigger could not answer: if the answer is started when
 * the AUDIO goes quiet rather than when the transcript stops changing, is the transcript complete
 * by then? And if not immediately, how long after silence does it become complete — while there
 * is still some of the 900ms left to save?
 */
const WAITS_AFTER_SILENCE = [0, 150, 300, 450, 600, 750];
const byWait = new Map(WAITS_AFTER_SILENCE.map((wait) => [wait, { correct: 0, total: 0 }]));
/*
 * How long before the recogniser calls the utterance over the transcript already says what it
 * will finally say. This is the ceiling on any speculation, whatever triggers it: guess earlier
 * than this and you are guessing at a sentence that is not finished arriving.
 */
const settledAheadOfEnd = [];

for (const question of QUESTIONS) {
  const pcm = await synthesize({ apiKey: ttsKey, text: question });

  for (let trial = 0; trial < trials; trial += 1) {
    try {
      const timeline = await transcribe({ apiKey: sttKey, pcm });
      const outcome = replaySpeculation(timeline);

      /*
       * How long the transcript sits unchanged WHILE the speaker is still going. This is the
       * number that decides whether transcript stillness can stand in for a pause at all: if
       * these gaps reach into the same range as a real pause, no threshold can tell them apart.
       */
      const changes = timeline.partials.filter(
        (entry, index, all) => index === 0 || entry.text !== all[index - 1].text,
      );

      for (let i = 1; i < changes.length; i += 1) {
        if (changes[i].at <= timeline.speechEndedAt) {
          gapsDuringSpeech.push(changes[i].at - changes[i - 1].at);
        }
      }

      const finalText = normalizeSpokenQuestion(timeline.utterance ?? "");
      const settledAt = changes.find(
        (entry) => normalizeSpokenQuestion(entry.text) === finalText,
      )?.at;

      if (settledAt && timeline.utteranceAt) {
        settledAheadOfEnd.push(timeline.utteranceAt - settledAt);
      }

      for (const wait of WAITS_AFTER_SILENCE) {
        const at = timeline.speechEndedAt + wait;

        if (timeline.utteranceAt && at >= timeline.utteranceAt) {
          // Waiting this long is not speculation any more; the recogniser has already answered.
          continue;
        }

        const visible = timeline.partials.filter((entry) => entry.at <= at).at(-1)?.text ?? "";
        const bucket = byWait.get(wait);
        bucket.total += 1;
        bucket.correct += normalizeSpokenQuestion(visible) === finalText ? 1 : 0;
      }

      results.push({ question, ...outcome, heard: timeline.utterance });
      console.log(
        `${question.slice(0, 44).padEnd(46)}${(outcome.fired ? "yes" : "no").padEnd(8)}` +
          `${(outcome.accepted ? "YES" : "no").padEnd(10)}${outcome.headStartMs}ms`,
      );
    } catch (error) {
      console.log(`${question.slice(0, 44).padEnd(46)}FAILED — ${error.message}`);
    }
  }
}

const fired = results.filter((row) => row.fired);
const accepted = results.filter((row) => row.accepted);
const headStarts = accepted.map((row) => row.headStartMs).sort((a, b) => a - b);
const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

console.log(`\n${results.length} runs`);
console.log(`  speculated on          ${fired.length}/${results.length}`);
console.log(`  answer was usable      ${accepted.length}/${results.length}`);
console.log(
  `  head start when usable  mean ${Math.round(mean(headStarts))}ms · ` +
    `min ${headStarts[0] ?? 0}ms · max ${headStarts[headStarts.length - 1] ?? 0}ms`,
);

const sortedGaps = [...gapsDuringSpeech].sort((a, b) => a - b);
const at = (p) => sortedGaps[Math.min(sortedGaps.length - 1, Math.floor((sortedGaps.length - 1) * p))] ?? 0;

console.log(
  `\ntranscript sat still for this long WHILE the speaker was still talking (${sortedGaps.length} gaps):\n` +
    `  p50 ${at(0.5)}ms · p90 ${at(0.9)}ms · p99 ${at(0.99)}ms · max ${at(1)}ms`,
);

const sortedSettled = [...settledAheadOfEnd].sort((a, b) => a - b);
const settledAt = (p) =>
  sortedSettled[Math.min(sortedSettled.length - 1, Math.floor((sortedSettled.length - 1) * p))] ?? 0;

console.log(
  `\nthe transcript already said its final words this long before <end> ` +
    `(${sortedSettled.length}/${results.length} runs):\n` +
    `  p10 ${settledAt(0.1)}ms · p50 ${settledAt(0.5)}ms · p90 ${settledAt(0.9)}ms`,
);

console.log(
  `\nstarting the answer this long after the AUDIO goes quiet — was the transcript already right?\n` +
    `${"wait".padEnd(9)}${"correct".padEnd(12)}${"head start left".padEnd(18)}verdict`,
);

for (const wait of WAITS_AFTER_SILENCE) {
  const bucket = byWait.get(wait);

  if (!bucket.total) {
    continue;
  }

  const share = bucket.correct / bucket.total;
  console.log(
    `${wait}ms`.padEnd(9) +
      `${bucket.correct}/${bucket.total}`.padEnd(12) +
      `~${Math.max(0, ENDPOINT_DELAY_MS - wait)}ms`.padEnd(18) +
      (share >= 0.5 ? "worth it" : share > 0 ? "sometimes" : "never"),
  );
}

const rejected = results.filter((row) => row.fired && !row.accepted);

if (rejected.length) {
  console.log("\nguessed wrong (request thrown away, nothing spoken):");
  rejected.forEach((row) => console.log(`  guessed: ${row.firedText}\n  heard:   ${row.heard}`));
}
