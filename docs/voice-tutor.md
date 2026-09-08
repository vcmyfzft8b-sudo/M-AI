# The voice tutor

A spoken walkthrough of one note. The tutor explains the material out loud, a topic
at a time, and the learner can cut in mid-sentence by speaking — the way you would
interrupt a person, not by pressing anything.

It lives beside flashcards, quiz and test in the note's pill row (`Tutor`), and it
writes nothing to the database.

## Why it is built the way it is

Every other Soniox call in this app is made server-side: a note's audio is
synthesized in a function, cached, and served as a file. A conversation cannot work
that way.

- **Barge-in is measured in tens of milliseconds.** Putting a serverless function
  between the microphone and the recognizer adds a hop each way on every packet.
- **Vercel functions cannot hold a WebSocket open at all**, so there is no server to
  relay through even if the latency were acceptable.

So the browser talks to Soniox directly, and short-lived single-purpose keys are what
make that safe. `POST /api/lectures/[id]/tutor/session` mints two of them
(`transcribe_websocket` and `tts_rt`, one hour, `src/lib/tutor-realtime.ts`). Each can
do exactly one thing and expires on its own; the real `SONIOX_API_KEY` never leaves
the server.

This is the same architecture as Soniox's own Voice Agent reference app — there is no
hosted speech-to-speech endpoint to use instead, only STT, TTS and translation, with
agents built by the customer or through LiveKit/Pipecat.

## The pieces

| File | What it is |
| --- | --- |
| `src/lib/ai/tutor-voice-prompt.ts` | How the tutor speaks, per turn kind, plus the wire schemas. Loadable outside Next (relative imports) so `scripts/tutor-eval.mjs` can run it. |
| `src/lib/tutor-voice.ts` | Reads the note, plans the running order, streams one spoken turn. |
| `src/lib/tutor-realtime.ts` | Mints the two temporary keys. |
| `src/lib/tutor/turn-audio.ts` | The decisions: where an interrupted turn was cut, whether the mic heard the tutor's own echo, which band of the spectrum a frame sat in, and when that counts as somebody speaking. No browser globals — unit-tested in `tests/tutor-turn-audio.test.mjs`. |
| `src/lib/tutor/speech-output.ts` | The TTS socket and the Web Audio graph that plays it. |
| `src/lib/tutor/speech-input.ts` | The microphone, the worklet, and the recognizer socket. |
| `src/lib/tutor/voice-colors.ts` | A hue per voice, so the sphere looks like the voice picked. |
| `src/components/lecture-tutor.tsx` | The sphere, the voice picker and the conversation loop. |
| `src/app/api/lectures/[id]/tutor/session` | The two short-lived Soniox keys, and the language. Fast. |
| `src/app/api/lectures/[id]/tutor/plan` | The running order, fetched alongside the opening turn. |
| `src/app/api/lectures/[id]/tutor/turn` | One spoken turn, streamed as SSE. |

## How a turn works

Starting a session fires **three requests at once**: the credentials (`/tutor/session`,
~700 ms), the running order (`/tutor/plan`, ~5–9 s), and the opening turn — which needs no
plan, and so starts talking while the plan is still being written. That is the difference
between ~9.5 s and **~4.5 s to the first word**. Anything that does need the plan awaits
the same promise, long after it has resolved.

Each turn is a fresh request carrying the plan, what has been said, and the recent
conversation; the **note itself is always read server-side**, never taken from the body.
The turn streams, and the client forwards each delta into the speech socket as it lands,
so the tutor begins talking while the rest is still being written.

The kinds are `opening`, `teach`, `answer`, `feedback`, `resume` and `closing`. Two fields
on the response drive the flow: `handBack` (who holds the floor when this ends) and
`awaitingExplanation` (see the method below).

Three details that are easy to get wrong:

- **The speech stream is opened by the first word, not by the intention to speak.**
  Soniox ends a stream with a 408 if it is announced and then left silent, and the model
  can take seconds to produce its first token. This raced a timeout on exactly the slow
  turns that most needed to work.
- **A half-streamed turn is never retried.** Chat can discard a partial answer and re-run
  the call. Speech cannot: the first half has already been said out loud, and following it
  with a complete second version is worse than stopping short.
- **Only a turn that still holds the floor decides what happens next** (`floorTokenRef`).
  `turn.finished` resolves both when a turn ends naturally and when something stops it, so
  without a token an interruption looked exactly like a finished turn and the walkthrough
  advanced over the learner.

## Response timing and turn ownership (2026-09-08)

Keep `max_endpoint_delay_ms` at 900. It caps Soniox's semantic endpointing rather
than imposing a fixed wait. The proposed 300ms value is below the documented
500–3000ms range and trades away thinking pauses; a clean ending can already
arrive before the cap. See [Soniox endpoint detection](https://soniox.com/docs/stt/rt/endpoint-detection).
Only an endpoint triggers an answer. Partials stop an existing turn but never
speculatively generate or speak an answer.

The client now removes waits elsewhere:

- `answer` and `feedback` use the authenticated note and conversation immediately,
  with a plan if one is already available. They do not wait for the planner. Lesson
  progression (`teach`, `resume`, `closing`) still requires the plan.
- Credential renewal and an idle speech socket reconnect overlap the turn request.
  Opening a connection sends no speech; a synthesis stream still starts on its
  first text. In the controlled regression, an 800ms request plus a 300ms reconnect
  took 1100ms before and 800ms after. These are simulated timings, not live percentiles.
- Every turn claims its cancellation token before waiting for anything. A pause,
  end, newer turn, or real learner word invalidates it during planning, fetching,
  renewal, reconnecting, and streaming. Real partials cancel `thinking` as well as
  `speaking`; noise and echo still pass through `judgeHeard` first. Muted input
  discards in-flight words, and closed/replaced recognizers cannot deliver stale
  words or errors into the current session.
- Recognized learner speech extends the pending silence timer. Explain-back keeps
  its 16-second window and its original next-topic action. A follow-up after a
  hand-back gets at least seven seconds from the latest words. An endpoint answers
  immediately; abandoned speech can still time out and resume the lesson.

`tests/tutor-session-turns.test.mjs` drives the actual component callbacks through
controlled network, audio, and timers. It covers the cancellation races, early
questions, echo/noise, explain-back and follow-up timers, and overlapping startup.
Real microphone/room acoustics still need a device check on the PR preview.

## Which language it speaks

**The note's**, not the app's. Somebody studying a Slovenian lecture wants it explained in
Slovenian even with the interface in English, and the terms they will be examined on are
the ones on the page. It is detected over the note itself rather than taken from the
lecture's `language_hint`, which is what the transcriber was told — for an uploaded PDF
that is whatever the default was rather than what is on the page.

The learner's own voice overrides it, immediately and completely, for as long as they keep
using another language. The recognizer gets the note's language as a hint, never strict, so
a question in a different one still gets a fair hearing.

Voice previews speak the note's language too (`voice-sample.ts`), which is why that line
lives outside the message catalogues — those are keyed by interface locale, and this is not
a UI string. Previewing a voice in English and then being taught in Slovenian tells you
nothing about the thing you were choosing.

## The method

The tutor teaches by Feynman's method, which is a discipline rather than a manner: plain
words first, an everyday anchor before the definition, and — the half that gets skipped —
**the learner explaining it back**.

That last part is wired into the flow rather than left to the prompt. On the ideas the
material rests on, a `teach` turn ends by asking the learner to say it back and sets
`awaitingExplanation`. The client then waits **16 seconds** rather than the usual 7,
because finding your own words for something you heard a minute ago is the method working,
not a stall. What they say next is sent as a `feedback` turn — marked, not answered: what
they got right, then the gap, then only the gap filled.

Silence moves the walkthrough on rather than pressing. The prompt asks for an explain-back
roughly every second or third topic and never twice running, because a tutor that demands
one after every idea is exhausting and it stops meaning anything.

## Sounds a person makes

`tts-rt-v2` performs square-bracket tags rather than reading them: `[laughs]`, `[sighs]`,
`[coughs]`, `[clears throat]`, `[whispers]`. Verified in Slovenian by synthesizing each and
transcribing the audio back — none of the bracket text is ever spoken, and the recognizer
hears a real vocalization ("Heh" for `[laughs]` and `[coughs]`, "Hm" for `[clears throat]`).

The prompt allows at most one per turn and asks for a reason, because the effect goes from
human to unsettling in about three repetitions. The tags *do* come back in the character
timestamps, so `stripAudioTags` removes them from the record of what was said — otherwise
the conversation history would show the tutor saying the word "laughs".

## The screen

One sphere, and as little else as the screen can get away with.

- **It breathes on the live audio level**, never on a timer — a loop that runs during
  silence is what makes a voice interface look fake. The raw RMS is spiky, so it goes
  through an envelope follower (`LevelEnvelope`: fast attack, slow release, the shape a
  compressor uses) and is written straight to a CSS custom property rather than through
  React state, which would re-render the component sixty times a second for one number
  only CSS reads.
- **Preparing is its own state**, with the sphere dimmed and two arcs spinning around it.
  It used to be the running screen with the caption changed, which meant a still glowing
  ball and a "Pause" button for something that had not started.
- **One line of transcript**, showing only what the learner said. The tutor's own words are
  already in the room; printing them competes with listening to them.
- **A voice per colour.** Eleven voices, each with its own hue (`voice-colors.ts`), so the
  choice is visible for the whole session rather than being a label that scrolled away.
  Tapping one previews it. The credentials and socket are warmed when the screen opens, so
  a tap costs only the synthesis — measured 605 ms, against ~1.6 s cold. A preview is a
  second speech socket with its own audio context, so anything that takes the room over
  has to end it: **Start stops an audition before it touches the network** (`stopPreview`),
  or the sample keeps playing under the loading state and sounds like the tutor beginning
  in the wrong voice.

## Barge-in## Barge-in

Two signals, used for different things:

1. The **local voice detector** (`VoiceActivityDetector`) fires within ~100 ms and
   ducks the voice to 12%, the way a person trails off.
2. The **recognizer's words** arrive a moment later and decide what that was. An echo
   of the tutor's own voice off a phone speaker (`isEchoOfTutor`) or a cough
   (`isSubstantialInterruption`) lets the voice come back up and the learner never
   knows. A real question takes the floor.

The local half is deliberately not a level meter, because a level meter ducked the
tutor every time somebody turned a page. `SpeechBandAnalyser` splits each 20 ms frame
into three bands with four biquads — under 250 Hz, 300–3000 Hz, over 4 kHz — and a
frame only counts when three things hold at once: it clears a threshold riding
the measured noise floor (so a café and a bedroom both work), the energy is actually in
the voice band rather than beneath it (traffic, a fan, a thump on the desk) or above it
(paper, keyboards, cutlery), and it lasts ~100 ms rather than being a click. The last of
those tolerates gaps, since the closure inside a /p/ is 50 ms of near-silence and an
unbroken run of loud frames is not what a word looks like. The noise floor is the
quietest the voice band has been over the last two to four seconds rather than a
running average, so a fan switched on mid-lesson is learned in a few seconds and speech
never raises the bar against itself. The biquads matter for the same reason the
constants do: the context runs at whatever rate the hardware gives, and a one-pole
highpass at 4 kHz stops being one at 16 kHz.

Both tolerances lean towards ducking, because the mistakes do not cost the same: a
rejected interruption makes the learner say it twice, a needless duck costs a moment of
quiet. So the recovery matters as much. A duck ends the instant the room goes quiet
again with nothing recognized in it (`onVoiceEnd`), and the instant the words turn out
to be the tutor's own voice — the full 1.4 s grace period is only ever waited out while
a sound is still going and might yet become a question.

When it does, what the tutor had already **said** is recorded — not what it had
generated. Synthesis runs faster than speech, so a turn is often complete in the buffer
while the voice is two sentences from the end. `spokenTextBefore` cuts the text at the
last character whose audio had actually played, using the character timestamps Soniox
returns with `return_timestamps`. Recording the generated text instead would silently
skip material the learner never heard.

Only a turn that still holds the floor decides what happens next (`floorTokenRef`);
`turn.finished` resolves both when a turn ends naturally and when something stops it.

## Models

Spoken turns run on their own stage, `tutor_turn`, which is **GLM 5.3 Flash** — the same
model the rest of the product uses. That is a deliberate trade, and both halves of it are
worth knowing.

Measured 2026-09-02 on the `omrezja-sl` fixture. Time to first token, and the Slovenian
graded by having gemini-3.7-flash proofread every sample. "Covered" is how many of the seven
OSI layers a teach turn actually taught, since the topic's points name all of them:

| model | teach ttft | answer ttft | words | covered | errors/100w | $/M |
| --- | --- | --- | --- | --- | --- | --- |
| **glm-5.3-flash** | see below | see below | 150–231 | 7/7 every run | 1.33 | 0.075 / 0.25 |
| gemini-2.5-flash | 536 ms | 470 ms | 84–129 | 7/7 every run | 0.00 | 0.30 / 2.50 |
| gemini-3.5-flash-lite | 793 ms | 711 ms | 100–155 | 7, **1**, 7 | 0.00 | 0.30 / 2.50 |
| gemini-2.5-flash-lite | 567 ms | 564 ms | 47–117 | 7/7 always | — | 0.10 / 0.40 |
| gemini-3.7-flash | 3114 ms | 3047 ms | 140 | — | — | 0.75 / 3.75 |
| gpt-5.6-luna | 3406 ms | 3899 ms | 137 | — | — | 0.20 / 1.20 |

**What GLM buys:** the best teaching of anything measured, at a quarter of the price. Its
turns carry an analogy across topics, build mnemonics, and cover the material fully; the
Gemini turns are correct but thinner.

**What it costs:** spoken correctness — roughly one error every 75 words, and not case slips
a listener forgives but invented words (`faxenco`, `komban`, `pošiljateljnico`, `koca` four
times where *kocka* was meant). A reader repairs those silently; the synthesizer pronounces
them. Both fixes were tried and neither moved the rate: an explicit "write it correctly"
instruction (1.31 vs 1.33) and pinning to Z.AI's own first-party endpoint (1.60) or Novita
(1.28). It is the model, not the prompt and not a bad host.

Keep those two facts together if this is ever revisited: the notes pipeline shows no such
problem *because nobody hears a note*. The same error rate becomes audible the moment the
text is spoken.

**Why not gemini-2.5-flash-lite**, which is the fastest and cheapest of the lot and covers
the material fully once the prompt was fixed: it does not answer reliably enough. Eight
trials each through the same gateway in the same ten minutes — Flash Lite returned a
*completely empty* stream (zero prompt tokens, zero completion tokens) on 3 of 8, plus a
truncated plan; gemini-2.5-flash and GLM were 8 of 8. The retry ladder in `json.ts` would
hide that, but it hides it by paying for a second call and a second wait, on the one stage
where the wait is the product.

**Latency is handled, not accepted.** GLM's spread through the gateway is its real weakness —
an order of magnitude between sessions — so this is the one stage that asks OpenRouter to
sort hosts by latency rather than throughput (`providerSort` in `model-config.ts`):

| routing | teach ttft p50 / p90 | answer ttft p50 |
| --- | --- | --- |
| `sort: throughput` (the default everywhere else) | 6900 ms / 11649 ms | 9576 ms |
| **`sort: latency`** | **938 ms / 2855 ms** | 4078 ms |

A `max_price` cap on top made the tail worse (answer p90 17095 ms) and is not used.

**The running order is on GLM too**, and briefly was not. It was split onto
gemini-2.5-flash on the reasoning that nobody hears the plan, so its quality does not
matter. That was wrong twice. Planning quality is not prose quality — the plan decides
which topics exist, and a topic it omits is one the walkthrough never teaches. Marked
against the `omrezja-sl` fixture's own 23-fact answer key:

| model | coverage | topics | time |
| --- | --- | --- | --- |
| **glm-5.3-flash** | 22, 22, 21 / 23 — **94%** | 6–8 | 7.0 s |
| gemini-2.5-flash | 19, 17, 19, **13** / 23 — 74% | 5–7 | 5.2 s |

Gemini's worst run dropped LAN, WAN and MAN entirely. And the speed argument that justified
the split had stopped being true anyway: the plan is fetched *alongside* the opening turn
rather than before it, so its seven seconds sit behind a greeting that is the better part of
a minute of speech. Nobody waits for it.

If interruption latency ever needs to come down further without giving up GLM's teaching,
the split to reach for is per-turn-kind: teach turns on GLM, answer turns on gemini-2.5-flash.
Override either with `GEMINI_TUTOR_TURN_MODEL`. STT is `stt-rt-v5`
(`SONIOX_STT_REALTIME_MODEL`), TTS is whatever `SONIOX_TTS_MODEL` says.

## Rehearsing it offline

`scripts/tutor-eval.mjs` runs the real prompts, the real streaming call and the real
speech socket over a committed fixture — no database, no production data. It checks the
two things that decide whether this works and that a text log hides: whether what the
model writes is actually **speakable** (a bullet or a LaTeX fragment is read out as
noise), and how long the silence is before the tutor starts talking.

```bash
node scripts/tutor-eval.mjs                     # plan, open, teach, interrupt, resume
node scripts/tutor-eval.mjs --fixture=synapse-en --ask="Explain that like I'm five."
node scripts/tutor-eval.mjs --save              # write the audio to evals/output/
node scripts/tutor-eval.mjs --model=or/openai/gpt-5.6-luna   # compare a candidate
```

It found every language bug this feature had: an English note taught end to end in
Slovenian (the chat language rule assumes the learner types first — a walkthrough starts
before they have said a word); GLM's Slovenian errors; a turn that opened with the formal
*Ustavite me lahko* and then switched to the familiar *Predstavljaj si*; and the learner
addressed as *boš poslala*, feminine, to somebody nobody had asked. The last two are why
`SPOKEN_LANGUAGE` fixes the register and forbids guessing gender.

It also measures **coverage**, which is the thing word counts hide. Asked to teach the
OSI topic, a model can produce a fluent minute that names two of the seven layers — the
note read aloud rather than the note taught. Making the topic's `points` binding ("where
a point lists things, name every one") took gemini-2.5-flash from 3/7 on one run in three
to 7/7 on five of five.

## What a session costs

Measured 2026-09-03 over a full simulated session on the `omrezja-sl` fixture: a five-topic
plan, eleven spoken turns (opening, one per topic, two interruptions with their resumes,
and a closing), 1570 spoken words — about fifteen minutes of audio.

| | amount | cost |
| --- | --- | --- |
| Lesson plan (gemini-2.5-flash) | 2 379 in / 820 out | $0.0028 |
| Spoken turns (glm-5.3-flash) | 58 198 in / 4 299 out over 11 calls | $0.0054 |
| Text-to-speech | 15.0 min at $0.70/hr | **$0.1744** |
| Speech-to-text | 20.2 min of open microphone at $0.12/hr | $0.0404 |
| **Total** | | **≈ $0.22** |

**Synthesis is 78% of it and the language models are 4%.** That is worth holding onto,
because it inverts where optimisation effort belongs: the difference between the cheapest
and dearest model measured here is under two cents a session, which is why the model choice
was settled on Slovenian quality and latency rather than on price.

Two things follow from the shape of that bill:

- **Speech-to-text bills the open socket, not the talking.** The microphone is open for the
  whole session so barge-in works, and 20 minutes is charged even though the learner speaks
  for perhaps one. Gating the audio locally saves nothing; only closing the socket would,
  and that is the feature.
- **The obvious lever is caching the audio, and it is not built.** Teach turns for a given
  note and plan are largely the same every time, so a second listen — or a second student
  on a shared note — could reuse the synthesis and cost almost nothing. What makes it
  awkward is that turns are generated live and adapt to what has been asked, so only the
  uninterrupted ones are cacheable. Worth doing before this is heavily used.

## Known limits

- **Soniox allows three concurrent TTS streams per organization.** A fourth listener
  gets a 429, which the client surfaces as "the voice service is busy". This is shared
  with note read-aloud and is raised in the Soniox console, not in code.
- **There is no voice-minute quota.** Read-aloud meters synthesized seconds; the tutor
  cannot, because the browser talks to Soniox directly. The ceiling today is the turn
  rate limit (60 per 5 min, 240 per hour). A daily allowance needs a product decision.
- **A refused microphone costs barge-in, not the walkthrough.** It still runs, with the
  pause and skip controls; the learner just cannot cut in by speaking.
- The band test rejects everything that is not shaped like a voice, which is most of
  what a room does — but not a dog next door, a television, or somebody else in the
  room talking, all of which are genuinely voice-shaped. Those still cost a duck until
  the recognizer's words come back. A real VAD model (Silero, what Soniox's reference
  app uses) would judge those too; the recognizer-confirmation step means the cost
  today is a moment of quiet, never a wrong interruption.
