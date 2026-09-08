# Source and speech languages

The interface catalogue supports English, Slovenian, Bosnian, Croatian and Serbian.
The interface locale does not select the language of a learner's documents or generated content.
For example, an Estonian source gets Estonian notes and study content while the interface stays English.

`resolveSourceLanguage` detects the predominant explanatory text rather than trusting an old
`language_hint`. It samples across long documents, checkpoints the detection for the exact material,
and stores the detected code/script with a hash of the generated note. Matching metadata avoids
another model call. Editing a note invalidates that fast path. An unavailable detector uses local
language evidence only; it never treats a provider outage as evidence that unknown text is English.

Notes, flashcards, quizzes, practice tests, mindmaps, tutor grounding and podcasts use the resolved
language. Shortcuts in written chat follow the source; a typed request can still deliberately switch
languages. The memory palace uses the flashcard deck and speed reading uses the original note text.
BCS variants remain distinct, and Serbian Cyrillic remains Cyrillic in written material.

New non-English note passages receive the existing constrained language correction pass during
creation. The pass preserves markdown, is checkpointed, and keeps the original on rejection or a
12-second deadline. It does not add a new wait to spoken tutor answers.

Speech uses Soniox's documented language list in `speech-language.ts`. Estonian and all five interface
languages are supported. Unsupported languages use English tutor/podcast speech and an English
translation for read-aloud; the written source remains untouched. Translated read-aloud has no word
alignment because English timings cannot truthfully highlight words in the original language.
Serbian and Bosnian are transliterated to Latin only for speech. Traditional Chinese and Latin-script
Kazakh read-aloud are converted to the provider's supported scripts.

Provider references, checked 2026-09-08:
- https://soniox.com/docs/tts/concepts/supported-languages
- https://soniox.com/docs/stt/concepts/supported-languages

The fallback concerns generated speech. It cannot make the recognizer transcribe a language the
recognizer does not support. Model language quality also varies; detection and prompts cannot
promise error-free native prose in every language, especially indistinguishable short BCS passages.

Existing written notes/decks are not automatically rewritten. New generations use this policy.
Tutor plans, podcasts and read-aloud caches are versioned so new requests do not reuse audio made
under the old language policy. No schema migration or production data backfill is involved.

## Verification

`npm test` includes source-code/script normalization, BCS hint handling, Estonian versus stale
Slovenian hints, cache invalidation, unsupported-language speech fallback, Cyrillic speech
transliteration/echo rejection, and proofreader rejection/outage behavior. Run `npx tsc --noEmit`
and lint changed files as well.

For integration checks, use the PR's deployment with the shared staging database and synthetic
material. Import the same short explanation in Bosnian, Croatian, Serbian Latin/Cyrillic, Estonian,
Slovenian, English and an unsupported speech language such as Esperanto. Verify the generated text,
then request speech and check its language and audio response. Keep the browser's interface in
English while checking Estonian. Do not infer native-speaker quality from a model judge alone.
