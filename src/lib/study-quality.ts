// Kept free of "server-only" so the study-quality gate can be measured against generated decks
// (scripts/study-eval.mjs) outside the Next.js runtime. These are pure string predicates.

export const MIN_CONCEPT_QUALITY_SCORE = 6;

/**
 * Why this gate is not just a longer list of phrases.
 *
 * A generated question fails a learner in one specific way: it points at something it does not
 * contain — "the diagram above", "slika 3.1", "the table on the previous page". The list below
 * catches those phrase by phrase, and it was written in English and Slovenian because those were
 * the two languages anyone had in front of them.
 *
 * That is not the set of languages this runs on. The gate reads *generated question text*, which
 * is written in the language of the uploaded material, and a student can upload anything —
 * measured on a hand-labelled set in scripts/jev-eval.mjs, the phrase list scored 0.64 and let
 * five of six broken questions through, every non-English one among them, plus two English
 * shapes nobody had thought to add ("on the previous page", "did the lecturer say").
 *
 * So the phrase list stays for what it is good at, and two structural rules sit beside it. Both
 * key on the fact that a reference to absent material has a *shape*, not a vocabulary: a figure
 * noun carrying a number, or a figure noun next to a word meaning "above". The noun roots are
 * close enough across the languages this product meets (slika / slici / rysunek / figura /
 * figure) to enumerate once, and the shape is what keeps them precise — a bare "slika" is a
 * legitimate subject in an art course, and only "slika 3.1" or "slika zgoraj" is a dangling
 * pointer.
 */

/**
 * Word boundaries that survive diacritics.
 *
 * JavaScript's \b is defined over ASCII word characters, so /\bpowyżej\b/ matches in the middle
 * of a word and /\bslici\b/ is fine only by luck of spelling. Every pattern built here uses
 * Unicode letter lookarounds instead, which is the difference between a rule that works in
 * Slovenian and one that only appears to.
 */
function wordPattern(body: string, flags = "iu") {
  return new RegExp(`(?<!\\p{L})(?:${body})(?!\\p{L})`, flags);
}

/**
 * Figure, table, chart, chapter — the things a question points at instead of containing.
 * Stems rather than full forms, so the Slavic cases (slika/sliki/sliko/sliku) are covered without
 * enumerating every declension of every noun in every language.
 */
/**
 * Things a question points *at* instead of containing. Stems rather than full forms, so the
 * Slavic cases (slika/sliki/sliko/sliku) are covered without enumerating every declension.
 *
 * Split in two because a number means opposite things either side of the line. A numbered
 * picture is always a pointer — nobody writes "figure 3.1" about a figure the reader can see in
 * the question. A numbered chapter, page or section is usually a *citation*: "Kaj ureja poglavje
 * 3 Zakona o delovnih razmerjih?" is an ordinary law question, and "What is Table 1 normal form?"
 * is an ordinary database one. Those are caught by the deictic rule instead, which needs an
 * "above" or a "previous" to fire.
 */
const VISUAL_NOUN =
  "fig(?:ure|ura|\\.)?|diagram\\p{L}*|dijagram\\p{L}*|chart\\p{L}*|graf\\p{L}*|graph\\p{L}*|image|picture|photo|foto\\p{L}*|slik\\p{L}*|rysun\\p{L}*|ilustracij\\p{L}*|illustration|shem\\p{L}*|schemat\\p{L}*|scheme|prikaz\\p{L}*|snimk\\p{L}*|slide|prosojnic\\p{L}*|slajd\\p{L}*";

/** Locations in a document. Only a pointer when something says which way to look. */
const LOCATION_NOUN =
  "table|tabel\\p{L}*|tablic\\p{L}*|chapter|section|poglavj\\p{L}*|poglavlj\\p{L}*|rozdzia\\p{L}*|stran(?:i|a|ic\\p{L}*)?|page";

const FIGURE_NOUN = `${VISUAL_NOUN}|${LOCATION_NOUN}`;

/**
 * "above", "below", "previous", "shown" — and their Slovenian, Croatian/Bosnian/Serbian and
 * Polish equivalents. A figure noun beside one of these is a pointer, whatever the language.
 */
const DEICTIC =
  "above|below|preceding|previous|earlier|shown|depicted|illustrated|attached|zgoraj|spodaj|zgornj\\p{L}*|spodnj\\p{L}*|prejšnj\\p{L}*|prikazan\\p{L}*|ponazorjen\\p{L}*|iznad|ispod|gore|dolje|dole|prethodn\\p{L}*|nave(?:den|dene)\\p{L}*|powy(?:ż|z)ej|poni(?:ż|z)ej|poprzedni\\p{L}*|przedstawion\\p{L}*|wy(?:ż|z)ej";

/**
 * A numbered pointer: "figure 3.1", "slika 3.1", "rysunek 3.2", "tabela 2". The number is what
 * makes this safe to match on the noun alone — a question about images in general never carries
 * one, and a question that does is naming something the student cannot see.
 */
const NUMBERED_FIGURE_REFERENCE = wordPattern(
  `(?:(?:${VISUAL_NOUN})\\s*\\.?\\s*\\d+(?:[.,]\\d+)*` +
    // A location noun needs the number to close the phrase — "na temelju tablice 4.2," points at
    // a table, while "Table 1 normal form" names a concept and carries on into the sentence.
    `|(?:${LOCATION_NOUN})\\s*\\.?\\s*\\d+(?:[.,]\\d+)*(?!\\s+\\p{L}))`,
);

/**
 * A figure noun within a few words of a deictic, in either order — "the diagram above", "na slici
 * iznad", "prikazano na prethodnoj stranici". The window is short so that two unrelated sentences
 * in one prompt do not combine into a false positive.
 */
const DEICTIC_FIGURE_REFERENCE = wordPattern(
  `(?:(?:${FIGURE_NOUN})(?:\\W+\\w+){0,3}\\W+(?:${DEICTIC})|(?:${DEICTIC})(?:\\W+\\w+){0,3}\\W+(?:${FIGURE_NOUN}))`,
);

/**
 * Attribution to the person or session the material came from: "did the lecturer say", "kaj je
 * rekel predavatelj". The answer lives in an event the student is not being shown, so it is the
 * same defect as a dangling figure reference wearing different clothes.
 */
const SOURCE_AUTHORITY_REFERENCE = wordPattern(
  "lecturer|lecture|teacher|professor|predavatelj\\p{L}*|predavanj\\p{L}*|profesor\\p{L}*|u(?:č|c)itelj\\p{L}*|wyk(?:ł|l)adowc\\p{L}*|nauczyciel\\p{L}*|author|avtor\\p{L}*|autor\\p{L}*",
);

/**
 * The verb that turns a mention of the lecturer into a dependency on them. Without one, naming a
 * person is just a question about a person.
 */
const ATTRIBUTED_CLAIM = wordPattern(
  "say|said|says|mention\\p{L}*|state[ds]?|told|explain\\p{L}*|cover\\p{L}*|rekel|rekla|dejal\\p{L}*|omenil\\p{L}*|pove(?:dal)?\\p{L}*|razlo(?:ž|z)il\\p{L}*|kazao|rekao|spomenu\\p{L}*|obja(?:š|s)nio|powiedzia\\p{L}*|wspomnia\\p{L}*|wyja(?:ś|s)ni\\p{L}*",
);

const MISSING_CONTEXT_PATTERNS = [
  /\bthe lecture\b/i,
  /\bthe notes\b/i,
  /\bthe source material\b/i,
  /*
   * "the source" only when the answer depends on reading it. The bare phrase rejected
   * "Which statement correctly describes the source of a synapse's excitatory effect?" — a
   * question about where an effect comes from, which is what "source" usually means in a
   * lecture. "according to the source" and "based on the source" have their own entries below.
   */
  /\bthe source\s*(?:[?.,;:]|$|(?:say|says|said|state|states|show|shows|mention|tell|list|contain)\w*)/i,
  /\bthe text above\b/i,
  /\bthe text below\b/i,
  /\bthe table above\b/i,
  /\bthe table below\b/i,
  /\bthe figure above\b/i,
  /\bthe figure below\b/i,
  /\bthe diagram above\b/i,
  /\bthe diagram below\b/i,
  /\bthe illustration above\b/i,
  /\bas shown\b/i,
  /\bas illustrated\b/i,
  /\bas depicted\b/i,
  /\bshown in the\b/i,
  /\bdepicted in the\b/i,
  /\baccording to the source\b/i,
  /\bbased on the source\b/i,
  /\baccording to the material\b/i,
  /\bbased on the material\b/i,
  /\bin the material\b/i,
  /\bin the lecture\b/i,
  /\bin the notes\b/i,
  /*
   * Tightened from `/what (?:does|did|is|are).*(material|lecture|...|table|example)/`, which had
   * no bound on the `.*` and so rejected any English "what is" question containing one of those
   * nouns anywhere in it — "What is a table in a relational database?", "What is an image
   * sensor?", "What is the diagram method?" were all being dropped from real decks. The defect it
   * is actually for is the *definite* reference whose answer requires seeing the thing — "what
   * does THE diagram show" — so it now needs both the determiner and a verb of depiction after
   * the noun. Without the second half, "What is the diagram method used for in project planning?"
   * matches too, because "the" there attaches to the compound "diagram method" and not to any
   * particular diagram.
   */
  /\bwhat (?:does|did|is|are)\s+(?:the|this|that|these|those)\s+(?:material|lecture|source|text|image|figure|diagram|table|example)\s*(?:[?.,;:]|$|(?:show|display|illustrat|depict|list|contain|say|tell|mean|represent|indicat)\w*)/i,
  /\bv\s+predavanj[ueiuom]?\b/i,
  /\bpo\s+predavanj[ueiuom]?\b/i,
  /\bv\s+zapisk(?:ih|u|om|a|ih)?\b/i,
  /\bpo\s+zapisk(?:ih|u|om|a|ih)?\b/i,
  /\bv\s+gradiv[auoem]?\b/i,
  /\bpo\s+gradiv[auoem]?\b/i,
  /\bglede na\s+gradiv[aoeuim]?\b/i,
  /\bglede na\s+vir\b/i,
  /\bna\s+slik[ie]\b/i,
  /\bv\s+slik[ie]\b/i,
  /\bna\s+tabel[ie]\b/i,
  /\bv\s+tabel[ie]\b/i,
  /\bna\s+diagramu\b/i,
  /\bv\s+diagramu\b/i,
  /\bna\s+grafu\b/i,
  /\bv\s+grafu\b/i,
  /\bv\s+ilustracij[ie]\b/i,
  /\bna\s+ilustracij[ie]\b/i,
  /*
   * "above" and "below", but not the direction words they are half of. Slovenian builds
   * "od spodaj navzgor" (from the bottom upwards) out of the same token, and that rejected a
   * perfectly good question asking for the order of the OSI layers. A genuine pointer — "kot je
   * prikazano spodaj" — still matches, there and through DEICTIC_FIGURE_REFERENCE.
   */
  /\bzgoraj\b(?!\s+\S*navz)/i,
  /\bspodaj\b(?!\s+\S*navz)/i,
  /\bkot je prikazano\b/i,
  /\bkot je ponazorjeno\b/i,
  /\bv prikazu\b/i,
  /\bv ilustraciji\b/i,
];

const VAGUE_REFERENCE_PATTERNS = [
  /^(?:what|which|why|how)\s+(?:is|are|does|do|can|should|would)?\s*(?:this|that|it|these|those)\b/i,
  /^(?:explain|describe|define)\s+(?:this|that|it|these|those)\b/i,
  /^(?:kaj|kateri|katera|katero|zakaj|kako)\s+(?:je|so|pomeni|pomenijo)?\s*(?:to|ta|te|ti|tisto)\b/i,
  /^(?:pojasni|opiši|definiraj)\s+(?:to|ta|te|ti|tisto)\b/i,
];

const WEAK_GENERIC_PATTERNS = [
  /\b(?:what|which)\s+(?:is|are)\s+(?:the\s+)?(?:main|important|key)\s+(?:thing|point|idea|topic)\b/i,
  /\b(?:what|which)\s+(?:is|are)\s+mentioned\b/i,
  /\b(?:kaj|kateri|katera|katero)\s+(?:je|so)\s+(?:glavn[aioue]|pomembn[aioue]|ključn[aioue])\s+(?:stvar|točka|ideja|tema)\b/i,
  /\b(?:kaj|kateri|katera|katero)\s+(?:je|so)\s+omenjen[oaie]?\b/i,
];

const BAD_OPTION_PATTERNS = [
  /\ball of the above\b/i,
  /\bnone of the above\b/i,
  /\bvse navedeno\b/i,
  /\bnič od navedenega\b/i,
  /\bnobena od navedenih\b/i,
];

export function normalizeStudyQualityText(value: string) {
  return value
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStudyQualityKey(value: string) {
  return normalizeStudyQualityText(value)
    .toLowerCase()
    .replace(/["'`]/g, "")
    .replace(/[^a-z0-9ščžćđ\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dependsOnMissingStudyContext(value: string) {
  if (MISSING_CONTEXT_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  if (NUMBERED_FIGURE_REFERENCE.test(value) || DEICTIC_FIGURE_REFERENCE.test(value)) {
    return true;
  }

  /*
   * Naming the lecturer is only a defect when the question turns on what they did or said. "Who
   * was the author of the Communist Manifesto" is a perfectly good question about an author; "what
   * did the lecturer say about it" is not answerable from the material at all.
   */
  return SOURCE_AUTHORITY_REFERENCE.test(value) && ATTRIBUTED_CLAIM.test(value);
}

export function hasVagueStandaloneReference(value: string) {
  return VAGUE_REFERENCE_PATTERNS.some((pattern) => pattern.test(normalizeStudyQualityText(value)));
}

export function hasWeakGenericStudyShape(value: string) {
  return WEAK_GENERIC_PATTERNS.some((pattern) => pattern.test(value));
}

export function isHighQualityStudyPrompt(value: string) {
  const normalized = normalizeStudyQualityText(value);

  return (
    normalized.length >= 6 &&
    !dependsOnMissingStudyContext(normalized) &&
    !hasVagueStandaloneReference(normalized) &&
    !hasWeakGenericStudyShape(normalized)
  );
}

export function areHighQualityQuizOptions(options: string[]) {
  const normalizedOptions = options.map(normalizeStudyQualityText);

  if (normalizedOptions.length !== 4) {
    return false;
  }

  if (normalizedOptions.some((option) => option.length === 0)) {
    return false;
  }

  if (normalizedOptions.some((option) => BAD_OPTION_PATTERNS.some((pattern) => pattern.test(option)))) {
    return false;
  }

  return new Set(normalizedOptions.map(normalizeStudyQualityKey)).size === normalizedOptions.length;
}

export function isHighQualityFlashcard(front: string, back: string) {
  const normalizedBack = normalizeStudyQualityText(back);

  return (
    isHighQualityStudyPrompt(front) &&
    normalizedBack.length > 0 &&
    normalizeStudyQualityKey(front) !== normalizeStudyQualityKey(normalizedBack)
  );
}
