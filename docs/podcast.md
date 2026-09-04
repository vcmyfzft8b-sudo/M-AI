# The podcast

An AI-generated episode about one note. Two hosts talking it through, or one host
briefing you on it, in the language the note itself is written in.

It sits third in the note's pill row (`Podcast`), after the notes and the spoken
walkthrough — because it is the third way of taking in the note itself, rather than a
fourth kind of practice material.

## Why it is built the way it is

An episode is two completely different jobs, and separating them is the whole design.

**The script** is one model call over the note. It is slow — a couple of thousand
words from a writer that runs at 20-60 tokens a second — and the listener waits
through it once, watching a progress bar, exactly as they do in every other product
that does this.

**The audio** is one Soniox request per spoken turn, made when the player is about to
reach it rather than up front. That is the part worth defending:

- Ten minutes of speech cannot be synthesized inside one Vercel invocation. The
  stream runs at roughly the length of the audio, so producing a whole episode
  eagerly would need a job split across invocations, with all the resumption
  machinery that implies.
- Producing it lazily means the first words play seconds after the script lands,
  instead of after every minute of the episode has been made.
- An episode nobody finishes is never paid for past the point they stopped.

The script is deliberately **voice-independent**: the hosts have no names and never
address each other by name (`podcast-prompt.ts`). That is what makes changing one
host's voice cost only that host's turns rather than a fresh generation — one
"thanks, Bennett" would tie the words to a voice.

## The pieces

| File | What it is |
| --- | --- |
| `src/lib/podcast-settings.ts` | The four shows, the three lengths, the voice pairing rules. Shared by the screen and the server, and loadable outside Next. |
| `src/lib/ai/podcast-prompt.ts` | What each show is, how to write for the ear, and the wire schema. |
| `src/lib/podcast-script.ts` | Turning what the model wrote into turns the synthesizer can take. Unit-tested in `tests/podcast-script.test.mjs`. |
| `src/lib/podcast.ts` | Reads the note, claims and writes the script, synthesizes one turn on demand. |
| `src/components/lecture-podcast.tsx` | The screen: choosing a show, waiting for the script, and the player. |
| `src/app/api/lectures/[id]/podcast/route.ts` | `GET` what exists, `POST` to write it. |
| `src/app/api/lectures/[id]/podcast/segments/route.ts` | `POST` one turn's audio. |

## The cast decides the words, not just the sound

Slovenian, Croatian, Serbian and Bosnian agree past-tense verbs, participles and adjectives with
the gender of whoever they are about. So a host saying "kot si rekel" to a woman is not informal,
it is wrong — and in a conversation between two people it is wrong every few sentences. English
never notices; these languages notice immediately.

The writer is therefore told the hosts' genders, and the stored script depends on them. Not on
the voices: swapping Grace for Emma changes nothing a writer would write, and making it a
different script would throw away an episode for no reason. The **cast key** is the gender pair,
and it is folded into `content_hash` rather than added as a column — the note's hash stays its
prefix, so the library still finds every episode of a note by matching that prefix alone.

`scripts/podcast-eval.mjs` checks agreement on every run, reporting rather than asserting: an
expository episode can run five minutes without one gendered form, and that is not a failure.
What it must never contain is one that disagrees. Measured on the omrezja-sl fixture:

| cast | forms | result |
| --- | --- | --- |
| Bennett (m) + Grace (f) | 2 | all agree |
| Grace (f) + Emma (f) | 3 | all agree — "sem si jih morala", "si lepo povedala" |

## Three screens, and how you get between them

The tab lands on one of two, never the third:

- **Library** — the episodes this note already has, when it has any.
- **Chooser** — the shows, lengths and voices, reached by "New episode".
- **Player** — reached only by pressing Create or tapping an episode, and it starts playing
  by itself when it was opened by either of those: waiting through a generation is asking for
  the episode, and landing in a paused player is being asked twice.

The player used to appear on its own whenever a finished episode happened to match the saved
show and length, which meant somebody opening the tab to make a new one was dropped into an
old one with the chooser hidden behind a button. `openedEpisodeId` is what makes opening the
player an act rather than a coincidence.

Picking an episode points the variant at it and waits for the script to arrive, matching on
id — `pendingEpisodeIdRef`. A **ref**, not state, and that is load-bearing: the request is
fired in the same tick as the tap, so a `loadStatus` closed over the previous render would
read the previous value (null) and quietly decline to open the episode just tapped.

The library lists only episodes written from the note **as it stands now**: the content hash
is part of a variant's identity, so an episode made from an earlier draft is not an episode of
this note, and offering it would hand somebody a recording of text they have since changed.

## It has to fit the screen

Choosing a show is one decision, and a decision you have to scroll to finish is one you make
badly. Measured with the panel and the note screen's own chrome together, across seven sizes
from a 375x667 phone to a desktop: everything fits, bar 9px on the very smallest phone — where
the sibling tabs on the same screen overflow by 126 to 176px.

The compaction is keyed to **width**, not height. Phones are narrow whatever their length, and
keying it to height left a tall phone with the roomy desktop sizing and an overflowing screen.
What gives ground is only what carries no information: the artwork while a choice is being made
(kept in the player, where it is the subject), the standfirst, a sentence of description under
names that already say what they are, and the air between rows.

One trap worth naming, since it cost an hour: **a media query adds no specificity**. The first
version of this compaction was written next to the rules it shrinks, which put it above the base
sizes in the file, and it did nothing at all on the phones it was written for.

## Playing without seams

Two `<audio>` elements, not one. With a single element every hand-off is `src = next; play()`,
and even from a blob already in memory the browser still loads and decodes before the first
sample — audible every time the conversation changes hands, which on a two-hander is every
twenty seconds. The next turn is loaded into the idle element while this one is still speaking,
so the hand-off is a bare `play()` on something already decoded.

The first turn is fetched when the player opens rather than when Play is pressed. Synthesis is
the whole wait, so starting it while the listener is reading the title makes the press instant.

There is no speed control. It played at 1x for everyone in practice, and the rates were three
more things on a screen that has to fit a phone.

## What is cached against what

Two tables (`supabase/migrations/0043_lecture_podcasts.sql`).

That file is also on `main` already, restored there after this branch pushed it to production
before merging — which left production holding a version `main` had no file for, and that aborts
`supabase db push` for every branch, not just this one. Migrations reach production from `main`
through `.github/workflows/supabase-migrations.yml` after merge, and never from a branch. The two
follow-ups this branch briefly added and removed again are gone rather than kept as a net-zero
pair, so the only schema it carries is the one already live.

`lecture_podcasts` is unique on **(lecture, note content hash, format, length,
language)**. Editing the note retires its episodes the same way it retires read-aloud
audio; changing the show or the length is a different episode, not a regeneration of
this one.

`lecture_podcast_segments` is unique on **(podcast, segment index, voice, model)**.
The voice is in the key on purpose: switching one host re-synthesizes that host's
turns and leaves the other half of the episode alone.

## Two things that must not happen twice

Both are guarded the same way — by a unique index, not by a lock.

**Writing the same script twice.** `claimPodcastRow` races on the variant's unique
index; whoever loses reads the row and acts on its status. A row left saying
`generating` by an invocation the platform killed is taken over after
`PODCAST_GENERATION_STALE_MS`, and not before.

**Charging for the same turn twice.** Podcast audio draws on the same daily allowance
as the note's read-aloud, through the same ledger — `claimTtsGeneration`,
`settleTtsGeneration` and `abandonTtsGeneration` in `src/lib/note-tts.ts`. The ledger
names a piece of audio by `(user, lecture, contentHash, chunkIndex, language, voice,
model)`; read-aloud puts a note's hash and chunk there, and the podcast puts
`podcast:<id>` and the turn index.

## What the synthesizer actually performs

Measured on tts-rt-v2 with the podcast voices, because the difference between a device that is
performed and one that is read out loud is not guessable. Each was spoken with and without, and
the audio transcribed back to see what a listener hears:

| device | adds | heard back as |
| --- | --- | --- |
| `…` | +0.77s | nothing — a real pause |
| `—` | +0.70s | nothing — a real pause |
| `[laughs]` | +1.46s | "Hehe," — an actual laugh |
| `[clears throat]` | +1.37s | "Hm," — an actual sound |
| `[sighs]` | +0.70s | an audible breath, no words |
| `[breathes]` | +0.53s | no words |
| `[whispers]` | +0.60s | nothing — the delivery changes |
| `[pause]` | +0.53s | nothing — performed, not read |

None of the bracket text is ever spoken, so the risk in using them is not that they leak — it
is that they become a tic. The pause is punctuation rather than a tag: an ellipsis buys the
longest one and is the ordinary way to write a beat.

## Three rules the prompt states and the code enforces

Each of these fails silently if it is only asked for, which is why
`normalizePodcastTurns` settles them rather than trusting the model.

- **Turns alternate.** Consecutive turns from one host are merged; left alone they
  play as the same voice stopping and starting for no reason.
- **Turns are substantial.** Every turn is one HTTP request, one synthesis and one
  `<audio>` element, so a script made of "Right." and "Exactly." costs a request per
  syllable and plays with a gap between each. Reactions are asked for as the opening
  of the next real contribution, which is also how people talk on a podcast.
- **Turns fit the synthesizer.** Soniox truncates past three minutes of audio with a
  200 and no warning, so an over-long turn is split at a sentence boundary before it
  is ever sent.

## What it costs a listener

Gated on the same entitlement as read-aloud (`canUseLectureFeatures(..., "study")`),
and drawing on the same daily seconds. Measured over twelve turns of the omrezja-sl
rehearsal (both voices, Slovenian), a host speaks **2.10 words a second** — so the three
lengths run about four, seven and twelve minutes, and a standard episode is roughly a
sixth of a paid day's audio, charged only for the part actually played.

That rate is measured on episodes, not borrowed. Read-aloud's 1.6-1.9 is a rate over
notes, which carry formulas and lists that are read slowly; prose runs faster, and using
the borrowed figure had the buttons promising nine minutes and delivering seven.

Two rates, not one: the display rate above, and a deliberately slower
`PODCAST_RESERVED_WORDS_PER_SECOND` for holding the allowance before synthesis. Over-
reserving costs a listener nothing because the ledger is corrected once the audio
exists; under-reserving lets a run of slow turns settle past the daily cap after the fact.

## What it costs to run, and where it stops scaling

| | measured |
| --- | --- |
| Script | ~3,000 tokens in, ~2,300 out on the shared writer, in 13-20s |
| Synthesis | **0.81x** the length of the audio it produces (0.79-0.82 over twelve turns) |
| First frame | 291-389ms from opening the stream |
| Audio size | 64 kbps mono MP3 — about 480 KB per minute |
| Invocations | one per turn, so a seven-minute episode is ~23 of them |

**The binding constraint is Soniox's concurrent-stream cap, which is org-wide, and this
feature shares it with read-aloud and with the voice tutor.** The tutor is speaking to
somebody in real time and cannot queue, so a listener's share of that cap is a product
decision, not a client-side nicety.

Because synthesis runs at 0.81x, **one stream stays ahead of one listener**: it makes
1.25 seconds of audio per second against the 1 second they consume. So a listener takes
one stream in steady state, and a second only while the buffer is thin or playback is
faster than 1x — see `SEGMENT_REQUESTS_WHILE_BUFFERED` in `lecture-podcast.tsx`. Sizing
that at a flat two would have halved how many people can listen at once.

When the cap is reached the route answers 202 rather than failing, and the client asks
again on a backoff. Those requests do no work, which is why podcast segments have their
own rate-limit preset instead of read-aloud's — see `podcastSegment` in `rate-limit.ts`.

## Known limits

- There is no download. Every turn is a separate object, and stitching them is only
  possible once the whole episode has been synthesized — which would mean paying for
  the parts a listener never reached.
- The episode is written in one call. The longest length is sized to fit that call
  inside one invocation with room for the fallback model behind it; a genuinely long
  episode would need the script windowed the way note writing is.
- **Audio is never reclaimed.** A segment is cached per `(podcast, index, voice, model)`
  and a podcast per `(note, format, length, language)`, so a listener who tries three
  shows and two voice pairs on one note leaves every combination in the bucket for good.
  At ~480 KB a minute that is tens of megabytes per curious note, growing without bound.
  Nothing needs it on the read path — it is a cache — so the fix is a retention sweep
  over `lecture_podcast_segments` by `generated_at`, which is not built.
- Generation quality varies run to run. Over four graded runs of the same fixture, recall
  was 21-23 of 23 facts, and two runs strengthened a claim past its source ("covers a
  continent", "the only one that works the other way"). The grounding rules name that
  failure, but nothing enforces it — `scripts/podcast-eval.mjs` is how you check.
