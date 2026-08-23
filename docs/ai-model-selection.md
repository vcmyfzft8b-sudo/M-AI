# Model selection: what was measured, and how to measure it again

Every model in this pipeline was chosen by running it against real learner uploads and grading the
result. This document records those measurements so the next person to revisit them — most likely
when a price changes or a model is retired — can see what was tested, what it cost, and what the
numbers actually said, rather than starting over.

Measured 2026-08-23. Re-measure before overturning anything here; the harnesses exist for exactly
that and a full sweep takes about fifteen minutes.

## The one thing to know first

**The tuning fixtures flatter everything.** `evals/fixtures/` holds the five fixtures these prompts
were developed against. Scores there run about ten points high, and on that set the candidate
writers looked interchangeable. On unseen material they were not. Any decision made only on the
committed fixtures is a decision made on the training set.

Out-of-sample fixtures live in `evals/fixtures-private/`, which is gitignored: they are built from
real staging and production uploads, and an eval fixture is a public file. Rebuild them from the
database rather than expecting them in a checkout.

## The shipped stack

| Stage | Model | Why |
| --- | --- | --- |
| Note writing | `or/google/gemini-3.7-flash` (OpenRouter, Google fallback) | Only writer holding recall on long sources |
| Extraction, outline, dedupe | `gemini-2.5-flash-lite` | Four candidates scored the same; this is the cheapest |
| Flashcards, quiz, practice | `gemini-2.5-flash-lite` | Ties the most expensive candidate on recall at a third of the cost |
| OCR | `gemini-3.5-flash-lite` (rescue `gemini-3-flash-preview`) | Earlier handwriting benchmark, unchanged |
| Transcription | Soniox | Not an LLM decision |

Measured end to end on a 43-page Slovene law PDF through the deployed preview: 145 items, a note at
122% of source, 95 flashcards, 95 quiz questions, 98 practice questions, **$0.0714 per lecture**,
one retry in 78 calls.

## This pipeline against the one it replaces

Nine unseen documents — a 5,000-word student paper, two lecture recordings, law and accounting
slides, a maths PDF, an English link — from staging and production.

| | Production (`v1`) | This pipeline (`v2-pedagogy`) |
| --- | --- | --- |
| Note fact recall | 81.7% | **94.0%** |
| Notes scoring below 90% | 4 of 9 | **1 of 9** |
| Worst single document | 55% | 62% |
| Cost, 9 documents | $0.0519 | $0.6369 (**12×**) |
| Deck fact recall | 90.9% | **96.9%** |
| Deck cost, 9 documents | $0.1359 | $0.4878 (**3.6×**) |

The quality gain is real and large. So is the cost: the new pipeline reads the source twice to
extract claims, judges duplicates, outlines, then writes, where the old one summarised each chunk
once and stitched. Roughly 22 model calls per document against 4.

Deck sizes in the study harness are not production sizes — `study-eval.mjs` generates from every
extracted item, while production filters through `selectDeckWorthyItems` first.

## Writers, out of sample

Only the writer varied; extraction ran on `gemini-2.5-flash-lite` throughout.

| Writer | Mean recall | Sources ≥3,000 words | Cost (9 docs) |
| --- | --- | --- | --- |
| **`gemini-3.7-flash`** | **97.3%** | **96.5%** | $0.5403 |
| `gemini-3.5-flash-lite` | 95.2% | 91.5% | $0.6202 |
| `gemini-2.5-flash-lite` | 94.9% | 93.5% | $0.3802 |

The gap is concentrated in long documents. On the 5,000-word paper the cheaper writers lost 15 and
23 points **during writing** — extraction had found everything, the writer could not hold it.
3.7 Flash lost 8. Short documents do not separate the candidates at all.

`gemini-3.6-flash` was tested and rejected: 94% mean, one run at 76% ±24, and the most expensive of
the four.

## Deck generators, out of sample

| Model | Completed | Fact recall | Distractors | Cost (9 docs) |
| --- | --- | --- | --- | --- |
| **`gemini-2.5-flash-lite`** | 8/9 | **98.2%** | 95.0% | **$0.438** |
| `gpt-5-nano` | 9/9 | 96.6% | 95.1% | $0.548 |
| `gemini-3.7-flash` | 9/9 | 98.2% | 97.3% | $1.398 |
| `gemini-3.5-flash-lite` | 5/9 | 96.4% | 97.6% | did not finish |

Paying more buys nothing here. The shared item list already guarantees coverage, so the deck
generator only has to phrase what it is handed. 3.7 Flash buys 2.3 points of distractor quality for
3.2× the price.

## GPT-5

Tested through the same harness, same prompts, same schemas, same grader.

- **`gpt-5-mini`**: timed out repeatedly at 180s per call on Slovene sources. Unusable here.
- **`gpt-5-nano`**: competitive on recall (98.5% on the tuning set) but spends **6× the reasoning
  tokens** — 44,000 per note against ~7,000. Reasoning bills as output, so the $0.05/M input
  advantage is spent several times over. Timed out on 2 of 7 note runs. Its decks are good and
  cheap, but 2.5-flash-lite is cheaper still at the same quality.
- Reducing nano's reasoning effort recovers the cost but collapses quality on Slovene: the contract
  fixture fell to **33%**, one run producing a 63-word note at 10% recall. English held up. The
  failure concentrates in the primary language.

Anthropic models and larger GPTs were not tested; on price alone they are 5–10× this stack.

## Prices as read on 2026-08-23

Per million tokens, standard tier. Batch halves every rate at Google, OpenAI and Anthropic.

| Model | Input | Output |
| --- | --- | --- |
| `gemini-2.5-flash-lite` | $0.10 | $0.40 |
| `gemini-3.1-flash-lite` | $0.25 | $1.50 |
| `gemini-3.5-flash-lite` | $0.30 | $2.50 |
| `gemini-3.7-flash` (Google) | $0.75 | $3.75 |
| `gemini-3.7-flash` (OpenRouter) | $0.375 | $1.875 |
| `gpt-5-nano` | $0.05 | $0.40 |
| `gpt-5-mini` | $0.25 | $2.00 |
| `claude-haiku-4-5` | $1.00 | $5.00 |

**Dates that matter.** OpenRouter's extra 50% on 3.7 Flash ends **27 August 2026**, taking a lecture
from $0.079 to $0.114 — keep the model, the long-document gap is worth $0.035. Google's own 50%
promo ends **31 December 2026**, doubling it again to $1.50/$7.50 and taking a lecture to ~$0.183.
That is the real cliff. Re-run the out-of-sample sweep against whatever exists then; 3.7 Flash
itself only launched on 13 August.

Switching writers needs no deploy — `GEMINI_NOTE_WRITE_MODEL` overrides the stage default, and
`or/` routes through OpenRouter with an automatic fallback to the provider direct.

Google's deprecation page lists **no shutdown date** for 2.5-flash-lite, 2.5-flash or
3.5-flash-lite. A widely-cited blog claiming 2.5-flash-lite retires in October 2026 is wrong; check
`ai.google.dev/gemini-api/docs/deprecations` rather than a search result.

## Token efficiency

Slovene costs roughly **twice** what English costs, on both tokenizers, measured on real source
text: Gemini 2.21 tokens/word against 1.08 for English (2.11×), OpenAI `o200k_base` 2.11 against
1.11 (1.96×). Every price above is effectively doubled for this product. There is no tokenizer
arbitrage worth switching providers for — 4.5% is noise next to a 3× difference in headline rate.

Thinking tokens bill as output and come out of `maxOutputTokens`. On the shipped stack, note
writing spends about 9,000 thinking tokens against 3,000 written, which is roughly half the cost of
a lecture from a single call.

## Things that were tried and did not work

- **Batch API.** Half price, but Google targets 24-hour turnaround and states it is unsuitable for
  user-facing requests. A learner waits ~2.5 minutes for notes. Only viable behind a deliberate
  "prepare overnight" flow.
- **A word budget for the writer.** Cut length from 123% to 90% of source but cost recall,
  including 100% → 94.5% on the Slovene contract fixture. A coverage objective with no numbers got
  the same density without the loss, and is what ships.
- **Extra concision rules** ("write like a revision sheet, delete any sentence that teaches
  nothing"). Cut length, cost recall on every writer except 3.7 Flash: 96.9% → 93% on the
  then-current stack, 95.6% → 81% on the cheap one, one note compressed to 59% of source at 43%
  recall. Squeezing a weaker writer makes it drop content, not compress it. Reverted.
- **Lowering `note_write` thinking from high to medium.** Looked better on one run (100% vs 97%) and
  did not replicate: over two runs per fixture, high scored 97.5% and medium 96.0%. One run is not a
  measurement.
- **YouTube captions.** Not a model problem. From Vercel `iad1` every innertube client returns
  `LOGIN_REQUIRED`, with and without `visitorData`, and the player response carries neither caption
  tracks nor `streamingData` — so a transcription provider cannot help either, as there is no audio
  to fetch. Works from a residential IP. Needs a residential proxy or a transcript API; the feature
  is gated off behind `NEXT_PUBLIC_YOUTUBE_IMPORT` until one exists.

## Bugs the out-of-sample material found

None of these could surface on the committed fixtures. They are listed because they are the kind of
thing a fixture set never catches.

- **Prose-length floors rejected mathematics**, three times over: knowledge-item `terms` required
  two characters (so `e`, `x`, the base `a` were invalid), a flashcard `back` required two (so the
  answer `1` was invalid), a practice marking point required three. Each rejection failed a whole
  batch and burned the retry ladder. Trigonometry, logarithms and geometry are among the most
  common uploads.
- **The quiz explanation cap** was 400 characters, which fitted when it only said why the right
  answer was right. It now also names why the tempting wrong option is wrong, and in Slovene that
  does not fit. Raised to 900.
- **The extraction budget was a flat 1800 tokens**, the only stage not sized from its work. That is
  a number for an average English window; one Slovene recording in nine walked the retry ladder to
  5832 and still truncated. Now scaled from the window.
- **A `maxItems` on the extraction schema is a trap.** Bounding `items` there pushes Gemini's
  `responseSchema` past its complexity limit and the call returns `400 too many states for
  serving`. Bound it in the instructions and after parsing instead. There is a test pinning this,
  because the obvious fix is the one that breaks it.
- **The maths normaliser corrupted Slovene prose.** `\b` is ASCII-only in JavaScript, so the rule
  turning a capital-plus-lowercase into a subscript saw a word boundary between the `a` and the `č`
  of `Začetno` and produced `Z_{a}četno`, which made KaTeX reject the formula and print it in red.
  Rules now skip `\text{}` spans entirely and use Unicode-aware boundaries.
- **The link size cap measured markup, not content.** 1 MB of raw HTML rejected a Wikipedia article
  whose readable text was well within limits. Now 8 MB, and oversized pages are truncated rather
  than refused.

## Running the measurements

```bash
node --experimental-strip-types scripts/derive-fixture-keys.mjs
node --experimental-strip-types scripts/note-eval.mjs --variant=v2-pedagogy --repeat=2
node --experimental-strip-types scripts/study-eval.mjs --variant=v2-2.5-lite
```

`note-eval.mjs` and `study-eval.mjs` read both fixture directories and speak to Gemini, OpenAI and
OpenRouter against the same schemas and the same grader. A fixture with no hand-written `keyFacts`
gets one derived from its source and cached, so every candidate answers to the identical standard.

Override a single stage to compare writers: `GEMINI_NOTE_WRITE_MODEL=gemini-3.5-flash-lite`.
Prefix a model with `or/` to route it through OpenRouter.

Run the candidates as **separate concurrent processes**, one per configuration. Sequentially the
sweep takes hours; in parallel it takes fifteen minutes. Drop `long-mixed` from any comparison — it
has no answer key and only burns wall-clock.

Rebuild the out-of-sample fixtures from real uploads by pulling `transcript_segments` for a lecture
and joining the segments with blank lines. **Truncate by whole paragraphs**: slicing a word array
flattens the blank lines the windower splits on, which turns a 4,000-word source into one
unsplittable chunk and makes every model look 40 points worse than it is. That mistake was made
here and nearly reported as a product defect.
