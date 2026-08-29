import { z } from "zod";

import { normalizeMarkdownMath, stripBareTextMacrosFromProse } from "../math-markdown.ts";

import {
  buildGeneratedContentLanguageInstruction,
  normalizeNoteLanguage,
  resolveNoteLanguageLabel,
} from "../languages.ts";

// Kept free of "server-only" so the note prompt contract stays testable and measurable
// (scripts/note-eval.mjs) outside the Next.js runtime. Everything here must stay pure:
// no I/O, no env, no "@/" aliases.

export const MATH_FORMATTING_INSTRUCTIONS = `Formula formatting rules:
- Use valid Markdown math for every formula and variable expression.
- Put full equations on one display-math line like $$I_{t/0} = \\frac{Y_t}{Y_0} \\cdot 100$$.
- Use inline math \\(Y_t\\) only for short variables inside a sentence.
- Use LaTeX subscripts, fractions, exponents, roots, functions, Greek letters, inequalities, arrows, sums, and integrals: \\(Y_t\\), \\(Y_{t-1}\\), \\(I_{t/0}\\), \\frac{a}{b}, x^2, \\sqrt{x}, \\sin(x), \\alpha, \\le, \\to, \\sum, and \\int.
- For multi-line derivations, use one display math block with an aligned environment inside: $$\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}$$.
- Never write raw dollar-sign inline math, broken subscripts like $Yt$ or $I{t/0}$, or plain text formulas like Yt / Y0 100.`;

export function getStructuredPlusLabels(outputLanguage?: string | null) {
  const languageCode = normalizeNoteLanguage(outputLanguage);

  if (languageCode === "sl") {
    return {
      overview: "## Hiter pregled",
      keyThings: "## Ključne stvari, ki jih moraš znati",
      topicExample: "## 1. Ime teme",
      coreIdea: "### Glavna ideja",
      detailedNotes: "### Podrobni zapiski",
      keyTerms: "### Ključni pojmi",
      example: "### Primer",
      compare: "### Primerjava",
      process: "### Proces",
      checkYourself: "### Preveri svoje znanje",
      finalReview: "## Končni pregled",
      definition: "Definicija",
      commonMistake: "Pogosta napaka",
      keyTakeaway: "Ključno",
    };
  }

  return {
    overview: "## Quick Overview",
    keyThings: "## Key Things To Know",
    topicExample: "## 1. Topic name",
    coreIdea: "### Core Idea",
    detailedNotes: "### Detailed Notes",
    keyTerms: "### Key Terms",
    example: "### Example",
    compare: "### Compare",
    process: "### Process",
    checkYourself: "### Check Yourself",
    finalReview: "## Final Review",
    definition: "Definition",
    commonMistake: "Common mistake",
    keyTakeaway: "Key takeaway",
  };
}

/* -------------------------------------------------------------------------- */
/* Content-driven note pipeline                                               */
/* -------------------------------------------------------------------------- */

/**
 * Note length is an output of this pipeline, never an input. A source is reduced to the
 * discrete things a learner has to walk away knowing; the note is then exactly long enough
 * to teach that list. A dense source yields many items and a long note, a padded source
 * yields few items and a short note, and no word target is ever sent to the model.
 */

/**
 * Extraction reads far more closely than synthesis does, so its windows are much smaller than the
 * 2200/3200-word windows the legacy pipeline summarised. A large window makes the model skim and
 * silently drop claims, which no later step can recover.
 *
 * The size is measured, not guessed. On a dense source (39 testable facts in 913 words) extraction
 * recall was 59% at 900-word windows and 100% at 400. Raising the thinking level instead makes it
 * worse — a thinking model summarises the window where a fast one enumerates it.
 */
export const KNOWLEDGE_EXTRACTION_WINDOW_WORDS = 400;

/**
 * Extraction is read twice at different granularities and the results are merged. One pass is not
 * stable: the same dense source yielded 29 items on one run and 49 on another, and everything
 * downstream is capped by whatever that single pass happened to catch. Two passes cut differently,
 * so a claim that straddles a boundary in one pass sits inside a window in the other, and
 * dedupeKnowledgeItems collapses the overlap. Extraction is the cheapest stage in the pipeline and
 * the one every other stage depends on, which makes it the right place to spend twice.
 */
export const KNOWLEDGE_EXTRACTION_PASS_WINDOWS = [400, 260];

/**
 * Splits text into pieces no longer than maxChars, breaking at sentence ends where possible and
 * at whitespace otherwise. Transcription can hand back a single segment covering a whole
 * recording (a 17-minute lecture arrived as one 12.8k-char segment), and a window that inherits
 * such a segment whole makes "extract every claim" impossible to fit any output budget — the
 * extraction call then burns its whole retry ladder on ever-larger truncations.
 */
export function splitTextForExtraction(text: string, maxChars: number): string[] {
  const normalized = text.trim();

  if (normalized.length <= maxChars) {
    return normalized.length > 0 ? [normalized] : [];
  }

  const pieces: string[] = [];
  let rest = normalized;

  while (rest.length > maxChars) {
    const slice = rest.slice(0, maxChars);
    const sentenceEnd = Math.max(
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf("\n"),
    );
    const whitespace = slice.lastIndexOf(" ");
    const cut =
      sentenceEnd >= Math.floor(maxChars * 0.5)
        ? sentenceEnd + 1
        : whitespace >= Math.floor(maxChars * 0.5)
          ? whitespace
          : maxChars;

    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }

  if (rest.length > 0) {
    pieces.push(rest);
  }

  return pieces;
}

export const KNOWLEDGE_ITEM_KINDS = [
  "definition",
  "formula",
  "mechanism",
  "comparison",
  "causal",
  "procedure",
  "fact",
  "caveat",
] as const;

export const knowledgeItemSchema = z.object({
  claim: z.string().min(12),
  kind: z.enum(KNOWLEDGE_ITEM_KINDS),
  // 5 = a learner cannot pass without this. 1 = true but disposable.
  importance: z.number().int().min(1).max(5),
  // One character is a real term in a maths lecture: e, x, pi, the base a of a logarithm. A
  // two-character floor rejected the extraction of a production logarithms source outright and
  // burned the retry ladder on every attempt.
  terms: z.array(z.string().min(1)).max(4),
});

/**
 * A 400-word window does not honestly contain more than this many distinct testable claims; an
 * extractor returning more is shredding sentences, not extracting knowledge.
 *
 * Enforced in the instructions and again after parsing rather than in the schema: a maxItems on a
 * nested array pushes Gemini's responseSchema over its complexity limit and the whole call is
 * rejected with "too many states for serving".
 */
export const MAX_ITEMS_PER_EXTRACTION_WINDOW = 30;

/**
 * Sizes the extraction budget from the window instead of guessing a constant.
 *
 * Every other stage already budgets from its work — the outline from item count, the writer from
 * retained items — and extraction was the one place still using a flat 1800, which is a number for
 * an English window of average density. A dense Slovene window blows through it: Slovene costs
 * about 2.2 tokens per word against English's 1.1, and one truncation in nine measured on real
 * lecture recordings walked the whole retry ladder to 5832 tokens and still failed.
 */
export function resolveExtractionMaxOutputTokens(windowWordCount: number) {
  return Math.max(2400, Math.round(windowWordCount * 9));
}

export const knowledgeExtractionSchema = z.object({
  sectionTitle: z.string().min(3),
  // Deliberately allows an empty array: a chunk that is administrative chatter, a learning-goal
  // list or a figure caption must be able to contribute nothing. The previous schema required
  // five bullets, two supporting details and three terms from every chunk, which manufactured
  // filler before any selection could happen.
  items: z.array(knowledgeItemSchema),
});

export const noteOutlineSchema = z.object({
  title: z.string().min(3),
  summary: z.string().min(40),
  keyTopics: z.array(z.string().min(2)).min(3),
  topics: z
    .array(
      z.object({
        title: z.string().min(3),
        itemIds: z.array(z.number().int().nonnegative()).min(1),
      }),
    )
    .min(1),
  droppedItemIds: z.array(z.number().int().nonnegative()),
});

export const noteWriteSchema = z.object({
  structuredNotesMd: z.string().min(200),
});

export type KnowledgeItem = z.infer<typeof knowledgeItemSchema>;
export type IndexedKnowledgeItem = KnowledgeItem & { id: number; sectionTitle: string };

function normalizeClaimKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Tokens are stemmed to their first six characters: Slovenian inflection otherwise makes
// "kalcij" and "kalcija" different tokens, and the same claim worded across two extraction
// passes escapes the merge — which is how duplicate flashcards reached real decks.
function claimTokens(value: string) {
  return new Set(
    normalizeClaimKey(value)
      .split(" ")
      .filter((token) => token.length > 3)
      .map((token) => token.slice(0, 6)),
  );
}

function tokenOverlap(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;

  for (const token of left) {
    if (right.has(token)) {
      shared += 1;
    }
  }

  return shared / Math.min(left.size, right.size);
}

const DUPLICATE_CLAIM_OVERLAP = 0.8;

/**
 * Collapses the same idea into one item, keeping the highest-importance wording.
 *
 * `boostRepeats` decides what a duplicate means. Within a single extraction pass a repeat is
 * evidence the source keeps coming back to the claim, which is a reason to rank it higher. Across
 * passes it means nothing — every item is expected to appear in both readings of the source — and
 * boosting there flattens the scale: it pushed 70% of items to importance 5 and left nothing for
 * a later stage to triage on.
 */
export function dedupeKnowledgeItems<TItem extends IndexedKnowledgeItem>(
  items: TItem[],
  options: { boostRepeats?: boolean } = {},
): TItem[] {
  const boostRepeats = options.boostRepeats ?? false;
  const kept: Array<{ item: TItem; tokens: Set<string> }> = [];

  for (const item of items) {
    const tokens = claimTokens(item.claim);
    const duplicate = kept.find(
      (existing) =>
        existing.item.kind === item.kind &&
        tokenOverlap(existing.tokens, tokens) >= DUPLICATE_CLAIM_OVERLAP,
    );

    if (duplicate) {
      duplicate.item.importance = Math.min(
        5,
        Math.max(duplicate.item.importance, item.importance) + (boostRepeats ? 1 : 0),
      );
      continue;
    }

    // The item is kept whole (spread, not rebuilt field-by-field) so callers that carry extra
    // fields — unit attribution, for one — do not lose them in the merge.
    kept.push({ item: { ...item }, tokens });
  }

  return kept.map((entry) => entry.item);
}

export const duplicateVerdictSchema = z.object({
  verdicts: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      duplicateOf: z.number().int().nullable(),
    }),
  ),
});

export const DUPLICATE_JUDGE_INSTRUCTIONS =
  "For each knowledge item, decide whether it states the SAME single fact as another item in the list — same subject, same relationship, same value, merely worded, spelled or angled differently. If so, duplicateOf is that item's index; otherwise null. Two different facts about the same subject are NOT duplicates: 'X uses base-period quantities' and 'X overstates inflation' are different facts about X. Judge each item independently and be precise.";

/**
 * Collapses items using duplicate links from a judge model. Token overlap cannot see that
 * "eksitatorni postsinaptični potencial" and "ekscitacijski postsynaptični potencial" are one
 * concept, and lowering its threshold would merge EPSP with IPSP; a judge finds exactly the
 * cross-spelling, cross-angle pairs (measured 100% stable on a real lecture's items). Links are
 * treated as undirected and unioned, and each surviving item keeps its group's peak importance.
 * The safety valve returns the input untouched if the judge would collapse more than 60% of it —
 * a judge that eager is wrong, not thorough.
 */
export function collapseDuplicateItems<TItem extends IndexedKnowledgeItem>(
  items: TItem[],
  links: Array<{ index: number; duplicateOf: number | null }>,
): TItem[] {
  const parent = items.map((_item, index) => index);

  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }

    return index;
  };

  for (const link of links) {
    if (
      link.duplicateOf == null ||
      link.index === link.duplicateOf ||
      link.index < 0 ||
      link.index >= items.length ||
      link.duplicateOf < 0 ||
      link.duplicateOf >= items.length
    ) {
      continue;
    }

    parent[find(link.index)] = find(link.duplicateOf);
  }

  const byRoot = new Map<number, TItem[]>();

  for (let index = 0; index < items.length; index += 1) {
    const root = find(index);
    byRoot.set(root, [...(byRoot.get(root) ?? []), items[index]]);
  }

  const collapsed = [...byRoot.values()].map((group) => {
    const keeper = group.reduce((best, item) => (item.importance > best.importance ? item : best));

    return {
      ...keeper,
      importance: Math.max(...group.map((item) => item.importance)),
    };
  });

  if (collapsed.length < items.length * 0.4) {
    return items;
  }

  return collapsed.sort((left, right) => left.id - right.id);
}

export function buildKnowledgeExtractionInstructions(params: {
  outputLanguage?: string | null;
  sourceType: "audio" | "document";
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const sourceNoun = params.sourceType === "audio" ? "spoken lecture transcript" : "course material";

  return `${languageInstruction}

Extract every distinct testable claim in this chunk of ${sourceNoun}. One item per claim, written so it stands on its own without the chunk in front of you.

Be exhaustive about substance. A later step decides what the finished note keeps, and it can only choose from what you return — a claim you leave out is lost for good. Split a sentence carrying two facts into two items. Two spellings of the same fact are fine; duplicates are merged later.

A chunk may span several unrelated topics — scanned pages and slide photos often do. Extract every topic's claims, not just the first one's; sectionTitle then names the topics together. Never treat a topic change as the end of the chunk.

Be ruthless about non-substance. Return an empty items array for a chunk that is only administrative announcements, deadlines, chapter goals, "what you will learn" lists, figure and slide captions, chapter summaries, pointers to exercises, or transitions. Never turn those into items to avoid returning nothing.

Rate importance honestly, because that rating is what the later step triages on: 5 = a learner fails without it, 3 = worth knowing, 1 = true but disposable.

Every claim names its subject explicitly. A chunk that says "he later taught history" yields "Gogolj je pozneje predaval zgodovino" when the chunk identifies him — and no claim at all when it does not. A claim about an unnamed someone can never become a usable study question.

Never invent a claim the chunk does not support.

Return at most ${MAX_ITEMS_PER_EXTRACTION_WINDOW} items. A chunk this size does not honestly hold more; if you are heading past that you are splitting sentences rather than finding claims, and the ones after the limit are discarded anyway.

${MATH_FORMATTING_INSTRUCTIONS}`;
}

export function buildNoteOutlineInstructions(params: { outputLanguage?: string | null }) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);

  return `${languageInstruction}

You are given every knowledge item extracted from one source, each with an id. Decide what the finished study note covers and how it is organised.

Group the items that belong to the same concept into topics, ordered the way they should be learned rather than the order they appeared. Merge thin topics into their neighbours.

Your job is to choose, and choosing means leaving things out. The extraction deliberately over-collects — it takes every claim it can find, including the incidental ones — and you are the step that decides which of them a learner actually needs. A note that keeps nearly everything is not a note, it is the source again.

Keep an item only if a learner would be worse off not knowing it: the definitions the subject is built on, the distinctions that are examined, the mechanisms, the formulas, the numbers that matter. Drop the rest into droppedItemIds — the passing example, the aside, the restatement of something already kept, the detail that is true but that nobody is tested on, the item that only makes sense with the original slide in front of you.

Expect to drop far more than you keep. Ask of every item: if this were missing, would the learner fail a question or misunderstand the subject? If not, it goes. When two items say nearly the same thing, keep the sharper one and drop the other.

The importance rating is your starting point, not your answer — the extractor inflates it. Judge the item against the subject as a whole: in a source about property law, "ownership is the most complete power over a thing" is the subject, and "the seminar covered this in week three" is not.

Let the material decide the shape. A source with few real ideas gets few topics. A dense source gets many. Do not aim for any particular number of topics.

Every retained id must appear in exactly one topic, and every id must be either retained or dropped.

Also return a title, a summary of 2-3 sentences covering the whole source, and the key topics.`;
}

/**
 * The reference note the user supplied on 2026-08-29 (files.zip): every generated note is asked
 * to match its density, heading style, bolding rhythm, tables and level of explanation. Embedded
 * in the instructions rather than described by them, because a concrete exemplar anchors style
 * far harder than any list of rules — at GLM's input price it costs a fraction of a cent.
 */
export const SOURCE_NOTE_REFERENCE_EXAMPLE = `# Poslovna informatika in konkurenčnost podjetja

## 1. Informacija

Informacija je vezana na živa bitja, ki jo:
- **sprejemajo** z receptorji (vid, sluh, vonj, tip, okus)
- **skladiščijo** v spominu (začasni, trajni)
- **ustvarjajo** z miselnimi procesi
- **oddajajo** v okolje

Vpliva na odzivanje na spremembe v okolju (krčenje mišic v skladu s cilji).

**Informacija je za odločanje.** Elementi odločanja: objekt odločanja, problem, cilj, odločitev, upravljalno dejanje. Za odločanje potrebujemo *model objekta odločanja*, ki je lahko miselni, matematični ali fizični. Informacijo dobimo neposredno s čutili ali posredno s podatki.

## 2. Podatki

Informacijo fizično izrazimo s podatki, analogno ali digitalno. Za digitalno predstavitev potrebujemo **jezik**, ki ga določajo abeceda ter leksična, sintaktična in semantična pravila.

Pet tipov podatkov: strukturirani (formatirani), besedilo, slike, zvok, video.

**Ključna razlika:**
- *Podatki* = nevtralna dejstva o stanjih, predstavljena z zaporedjem znakov.
- *Informacija* = zaporedje znakov, ki je hkrati:
  1. sintaktično pravilno → podatki
  2. razumljivo → obvestilo, sporočilo
  3. ima za prejemnika uporabno vrednost → informacija

Uporabno vrednost ima takrat, ko **vpliva na prejemnikove odločitve**.

**Prenos:** pošiljatelj (informacija) → komunikacijski kanal (podatki, izpostavljen motnjam) → prejemnik (informacija). Podatki so torej nosilci informacije.

Formula za zapomnit: **podatki + obdelava = informacije** (surova tabela nabav ni uporabna, izračunani povprečni rok dobave in delež zamujenih dobav pa so informacija).

## 3. Količina, kakovost in vrednost informacije

**Količina** je večja, čim več novega nam informacija pove, torej čim bolj zmanjša nedoločenost opazovane stvarnosti. Merska enota je **bit** (dve vrednosti: da/ne). Dejstvo, da prejemnik informacijo dobi in razume, še ne pomeni, da jo bo uspešno uporabil.

**Kakovost** se kaže v prispevku k boljšemu odločanju. Sodila: dostopnost, točnost, pravočasnost, popolnost, zgoščenost, ustreznost, objektivnost.

**Vrednost** = vrednost spremembe v obnašanju prejemnika, zmanjšana za stroške pridobitve. S časom se manjša.

*Primer iz prosojnic:* z nepopolno informacijo (A 20, B 30, C 15) izberemo B, ki dejansko prinese 22. S popolno informacijo (A 15, B 22, C 31) izberemo C = 31. Razlika je 9, stroški popolne informacije 3, neto ekonomska korist **6**.

## 4. Znanje

- Informacije so model objekta odločanja oziroma njegovo **stanje** v danem trenutku.
- Znanje je povezano z **obnašanjem** objekta, torej z njegovim odzivanjem na upravljalna dejanja.

Definiciji: znanje je povezava informacij s kontekstom, predhodnim znanjem in izkušnjami; znanje ima tisti, ki je sposoben pravilnega ravnanja. Eksplicitno ga izražamo z **Če ..., potem ...** (vzrok in posledica).

## 5. Poslovna informatika

**informacija + avtomatika = informatika**

Informatika omogoča avtomatizacijo prenosa podatkov, ročne obdelave podatkov ter obdelav, ki ročno ne bi bile ekonomsko upravičene.

**Delitev informatike:**
- **Tehnična informatika** = računalništvo (computer science), proučuje predvsem zgradbo računalnikov
- **Uporabna informatika** = informacijski sistemi (information systems)
  - IS = sistem, v katerem se shranjujejo, obdelujejo in pretakajo podatki in informacije za določen namen
  - IS vključuje: računalnike, programe, podatke, postopke in **ljudi**
  - veje: poslovna, medicinska, kemijska informatika ...

**Poslovna informatika** je znanstvena disciplina, ki se ukvarja z oblikovanjem, izdelavo, uvajanjem in izvajanjem poslovnih informacijskih sistemov v organizacijah.

## 6. Računalniška in informacijska pismenost

Informacijski delavci morajo vedeti: kateri so notranji in zunanji viri podatkov, kako in zakaj se podatki zbirajo, katero vrsto podatkov zbrati, kako se pretvorijo v informacije, kako jih posodabljati in kako jih uporabiti za konkurenčno prednost.

- **Računalniška pismenost:** veščina uporabe programske opreme (urejevalniki besedil, preglednice, SUPB, predstavitve) plus osnovno znanje strojne opreme, interneta in orodij za sodelovanje.
- **Informacijska pismenost** (pomembnejša): razumevanje vloge informacij pri izboljševanju poslovnih procesov ter pri ustvarjanju in uporabi **poslovne inteligence (BI)**. BI daje zgodovinske, trenutne in napovedne poglede na poslovanje in okolje.

## 7. Informacijska družba

Zaporedje revolucij: **agrarna → industrijska → informacijska**.

Informacijska družba = težišče ekonomskih aktivnosti in tehnoloških sprememb je obdelava informacij. Sloni na IT in informacijskih storitvah, poganja pa jo digitalna ekonomija oziroma ekonomija znanja.

Vpliv informatike na rast: eksponentna rast, podvojitev znanja v vedno krajših obdobjih (danes 5 do 8 let), večja vrednost v obliki informacij, delo na daljavo, avtomatizacija proizvodnje (industrija 4.0).

Zaposlenost v ZDA se je premaknila iz kmetijstva in industrije v storitve in informacijsko področje (ZDA 2018: kmetijstvo 1,4 %, industrija 12,8 %, storitve 79,7 %; Slovenija 2024: v kmetijstvu okoli 2 %).

**Avtomatizacija dela (WEF 2025):**

| | zaposleni sam | človek + tehnologija | tehnologija |
|---|---|---|---|
| 2025 | 50 % | 33 % | 17 % |
| 2030 | 33 % | 33 % | 33 % |

Do 2030 se bo 27 % zaposlenih moralo dodatno usposabljati za trenutno delovno mesto, 16 % pa preusposobiti oziroma zamenjati zaposlitev.

**Informacijski poklici:** delovna mesta, kjer je cilj ustvarjanje, shranjevanje in posredovanje sporočil in informacij ter razvoj tehnologije za obdelavo in prenos podatkov.

**Zmagovalci** (svet): kmetje, dostavljavci, razvijalci programske opreme, gradbeni delavci, prodajalci, zdravstveno osebje. V Sloveniji: strokovnjaki za UI in strojno učenje, strokovnjaki za poslovni razvoj, računovodje, revizorji.
**Poraženci:** poštni in bančni uradniki, vnašalci podatkov, blagajniki, administratorji, tajnice, knjigovodje, delavci za obračun plač.

## 8. Gospodarske organizacije v informacijski družbi

Viri v industrijski dobi: zaposleni, kapital, stroji in oprema. **Dodaten vir v informacijski družbi: informacije.** Med ključnimi viri konkurenčne prednosti prihaja informacija na prvo mesto, ker IT doživlja najhitrejšo rast in najbolj dinamične spremembe.

IT je temelj boljšega odločanja, ker:
- skrajšuje čase (ciklične, razvojne, proizvodne)
- zmanjšuje potrebo po zalogah, denarju in ljudeh
- izboljšuje delo s strankami in dobavitelji ter omogoča hitrejše sledenje trgu
- povečuje znanje organizacije, ustvarja pogoje za učenje in delitev znanja
- prenaša poslovanje na splet
- olajšuje pretakanje informacij med organizacijskimi nivoji (posledica: **splošenje organizacijske strukture**, manj vmesnih nivojev)

## 9. Konkurenčnost: trije modeli

**Porterjev model petih tekmovalnih sil:**
1. stopnja tekmovalnosti v panogi (v sredini)
2. pretnja novincev
3. pritisk nadomestnih izdelkov
4. pogajalska moč dobaviteljev
5. pogajalska moč kupcev

*Paradoks interneta:* internet je vsem enako dostopen, zato krepi vse sile hkrati (kupci laže primerjajo cene, vstop novincev je cenejši), kar lahko konkurenčno prednost prej zmanjša kot poveča. IT sama po sebi torej ni avtomatsko vir prednosti.

**Tržne strategije organizacije:**

| | nižji stroški | razločevanje (diferenciacija) |
|---|---|---|
| **razpršenost** | strategija nižjih stroškov | razločevanje |
| **segmentiranost** | nižji stroški znotraj izbranega segmenta | razločevanje znotraj izbranega segmenta |

**Vrednostna veriga (Porter):**
- *Primarne aktivnosti:* vhodna logistika → proizvodnja → izhodna logistika → prodaja in trženje → vzdrževanje in poprodajne aktivnosti
- *Podporne aktivnosti:* nabavljanje potrebnih virov, razvijanje proizvodov in tehnologije, obvladovanje kadrovskih virov, zagotavljanje poslovne infrastrukture
- **dodana vrednost - stroški = dobiček**

*Vrednostni sistem* je širša veriga: vrednostna veriga dobaviteljev → notranja vrednostna veriga podjetja → vrednostna veriga distribucijskih kanalov → potrošnik. Informatika podpira posamezne člene in povezave med njimi.`;

/**
 * The note-writing contract since 2026-08-29, supplied by the user as a system prompt and kept
 * near-verbatim: the writer reads the RAW SOURCE (not the outline) and reorganises it into
 * exam-ready notes — numbered sections following the source's own argument, prose setting up
 * bullets, tables for two-dimensional data, worked examples completed, every figure preserved,
 * nothing invented, no emojis, at most ~60% of the source's length. Extraction and the outline
 * still run before this (the study decks and the note's title live off them), but the note text
 * itself no longer passes through them.
 */
export function buildSourceNoteInstructions(params: {
  outputLanguage?: string | null;
  /** Set when the source is split into consecutive parts; see planSourceWriteWindows. */
  window?: { index: number; count: number };
}) {
  const languageInstruction = buildGeneratedContentLanguageInstruction(params.outputLanguage);
  const labels = getStructuredPlusLabels(params.outputLanguage);
  const window = params.window;
  const windowed = window && window.count > 1;
  // The renderer recognises these exact bold labels (note-tts-text.ts getCalloutKind) and turns
  // the blockquote into a coloured box; any other label falls back to the plain blue one.
  const calloutBudget = windowed ? "at most 2 callouts in this part" : "at most 4 callouts in the whole note";

  const outputContract = windowed
    ? window.index === 0
      ? `- Return Markdown only. No preamble, no closing commentary, no meta-talk about the source document. Never wrap the output in a code fence.
- This source is split into ${window.count} consecutive parts and you are writing part 1. Do NOT write an H1 title — the app already displays the note's title above the note. Start immediately with the first numbered "## N. Section" heading for this part's material. Later parts continue after your last section. Do not summarise or preview material that is not in this part.`
      : `- Return Markdown only. No preamble, no closing commentary, no meta-talk about the source document. Never wrap the output in a code fence.
- This source is split into ${window.count} consecutive parts and you are writing part ${window.index + 1}. Do NOT write an H1 title. Start immediately with the first "## N. Section" heading for this part's material; number sections starting from 1 (numbering is corrected mechanically when the parts are joined). Do not re-explain material from earlier parts.`
    : `- Return Markdown only. No preamble, no "Here are your notes", no closing commentary, no meta-talk about the source document.
- Do NOT write an H1 title — the app already displays the note's title above the note. Start immediately with the first numbered "## N. Section" heading.
- Nothing after the last content line.
- Never wrap the whole output in a code fence.`;

  const sectionTarget = windowed
    ? `Target 3 to 6 sections for this part. Merge thin sections rather than leaving stubs.`
    : `Target 6 to 10 sections for a typical lecture deck. Merge thin sections rather than leaving stubs.`;

  return `${languageInstruction}

ROLE

You turn raw study material (lecture slides, PDF chapters, transcripts, textbook excerpts) into clean, exam-ready study notes. You are not a summarizer that shortens text. You are a student's smartest classmate who reorganizes messy source material into something someone can actually learn from and revise before an exam.

INPUT

You receive raw extracted text from a document. It may be badly ordered, contain OCR noise, duplicated slide titles, broken table rows, chart labels with no context, page numbers, headers, footers and source URLs. Handle all of that silently.

OUTPUT CONTRACT

${outputContract}

LANGUAGE

Keep original technical terms and any English terms the source itself uses in brackets (for example: "uporabna informatika - informacijski sistemi (information systems)"). Never translate terminology the student will be tested on.

STRUCTURE

1. Numbered "## N. Section" headings, following the logical flow of the source. Merge slides that cover one idea into one section. Do not create one section per slide.
2. ${sectionTarget}
3. Order sections the way the source builds the argument, not the way the raw text happened to be extracted.
4. Optional final section only if the source supports it: a short set of comparisons or models grouped together.

CONTENT RULES

- Every fact must come from the source. Never add outside facts, dates, statistics or examples.
- You may add one short connective sentence that explains a relationship the source only implies visually (a diagram with no caption, a chart with no explanation, a term on a slide with no body text). Keep it to one sentence, keep it plainly derivable from the material, and never invent numbers.
- Complete the worked examples. If the source shows an example with the arithmetic left out, do the arithmetic and show the reasoning in one line. This is one of the highest-value things you do.
- Preserve exact figures, percentages, years and units as given. Keep the source's decimal convention (1,4 % stays 1,4 %).
- Definitions must be quoted in substance, not diluted. If the source defines a term, the note must let a student reproduce that definition.
- Keep contrasts explicit. When the source distinguishes two things (data vs information, computer literacy vs information literacy, state vs behaviour), state the distinction as a labelled contrast, not as two separate paragraphs.
- Drop pure decoration: stock photos, logos, slide numbers, accreditation badges, "Cilji poglavja" style agenda slides (fold their content into the real sections instead).
- Keep source citations only when the number would be meaningless without them (for example "WEF 2025", "ZDA 2018"). Drop bare URLs.

FORMATTING RULES

- Mix prose and bullets. A wall of bullets is a failure. Use a short prose sentence to set up a list, then the list.
- Bold for defined terms, key labels and the one number that matters in a paragraph. Do not bold whole sentences.
- Italics for example markers ("*Primer:*") and for secondary terms.
- Use "→" for processes, flows and cause-chains (sender → channel → receiver).
- Use a Markdown table whenever the source data has two dimensions: comparisons, matrices, before/after, year-by-year splits. Never render a matrix as nested bullets.
- Use a numbered list only for genuinely ordered or enumerated things (steps, the 5 forces, the 3 conditions). Everything else is a dash list.
- Nest at most two levels deep.
- Mnemonic word-equations go on their own bolded line: **podatki + obdelava = informacije**
- No emojis. No em dashes; use a comma, a colon or the word "to" instead.
- Paragraphs stay under 4 lines. Break anything longer.

CALLOUTS

The app renders blockquotes of the form "> **Label:** text" as coloured highlight boxes. Use them to lift the few things a student must not miss, and you are the judge of what earns one: a make-or-break definition, the distinction everyone gets wrong on the exam, the one takeaway a section exists for. You are also the judge of whether a note needs any at all — a note can have zero callouts. Use ${calloutBudget}, each 1-2 lines, never two in a row, and never for material that is merely interesting. A callout must not restate a sentence that already appears in the surrounding text; it replaces it. Use exactly these labels:
- "> **${labels.definition}:** ..." for a foundational definition the subject is built on
- "> **${labels.commonMistake}:** ..." for the confusion or error students are tested on
- "> **${labels.keyTakeaway}:** ..." for the single most important consequence or rule of a section

WHAT NOT TO DO

- Do not open with a restatement of the note's title.
- Do not write "the slides show", "this presentation covers", "as we can see in the diagram". Write the content directly.
- Do not pad with generic advice, motivation or filler transitions.
- Do not skip a section of the source because it looked like an image. Charts carry numbers; extract them.
- Do not exceed roughly 60% of the source's word count for text-heavy sources, and do not go under a level of detail where the student would still have to open the original.

QUALITY BAR

Before returning, check:
1. Could a student pass a question on every source slide using only these notes?
2. Is every number from the source present and correct?
3. Is there at least one table if the source had any two-dimensional data?
4. Are the worked examples actually worked through?
5. Is there zero invented content?

REFERENCE OUTPUT

The example below is the gold standard. Match its density, heading style, bolding rhythm, use of tables and level of explanation. Do not copy its content, and write in the output language stated at the top even though the example is Slovene.

--- BEGIN REFERENCE EXAMPLE ---
${SOURCE_NOTE_REFERENCE_EXAMPLE}
--- END REFERENCE EXAMPLE ---

${MATH_FORMATTING_INSTRUCTIONS}`;
}

/**
 * A single write call handles this many source words comfortably at the writer's measured speed
 * (~60-80 tokens/s at low effort) inside its 200s leash: ≤60% of 4,500 words is ~4,000 output
 * tokens, or roughly 60-90s. Sources above it are split on paragraph boundaries into consecutive
 * parts, each written with the same instructions and joined by assembleSourceNoteParts.
 */
export const SOURCE_WRITE_WINDOW_MAX_WORDS = 4_500;

export function planSourceWriteWindows(sourceText: string, maxWords = SOURCE_WRITE_WINDOW_MAX_WORDS) {
  const paragraphs = sourceText.split(/\n\n+/).filter((paragraph) => paragraph.trim());
  const windows: string[] = [];
  let current: string[] = [];
  let currentWords = 0;

  for (const paragraph of paragraphs) {
    const words = countWords(paragraph);

    if (currentWords + words > maxWords && current.length > 0) {
      windows.push(current.join("\n\n"));
      current = [];
      currentWords = 0;
    }

    current.push(paragraph);
    currentWords += words;
  }

  if (current.length > 0) {
    windows.push(current.join("\n\n"));
  }

  return windows;
}

/**
 * Joins windowed note parts into one document: no part may carry an H1 (the app displays the
 * note's title above the note, so an H1 in the body doubled it — 2026-08-29), and "## N."
 * section numbers are rewritten into one continuous sequence — each part numbers locally from 1,
 * because no part can know how many sections the parts before it produced.
 */
export function assembleSourceNoteParts(parts: string[]) {
  let sectionNumber = 0;

  const cleaned = parts.map((part) => {
    const withoutStrayH1 = part
      .trim()
      .split("\n")
      .filter((line, lineIndex) => !(lineIndex < 3 && /^#\s[^#]/.test(line + " ")))
      .join("\n")
      .trim();

    return withoutStrayH1.replace(/^##\s+\d+[.)]?\s+/gm, () => `## ${++sectionNumber}. `);
  });

  return cleaned.join("\n\n");
}

/**
 * The outline as one write window sees it: full item detail for the topics this window writes,
 * titles only for every other topic — enough to know what is taught elsewhere (so nothing is
 * duplicated "for completeness") without paying to resend material another window owns.
 */
export function formatOutlineForWindowWriting(params: {
  outline: z.infer<typeof noteOutlineSchema>;
  items: IndexedKnowledgeItem[];
  topicIndexes: number[];
}) {
  const included = new Set(params.topicIndexes);
  const full = formatOutlineForWriting(params);

  return full.map((topic, index) =>
    included.has(index) ? topic : { position: topic.position, title: topic.title, coveredElsewhere: true },
  );
}

export function formatOutlineForWriting(params: {
  outline: z.infer<typeof noteOutlineSchema>;
  items: IndexedKnowledgeItem[];
}) {
  const itemById = new Map(params.items.map((item) => [item.id, item]));

  return params.outline.topics.map((topic, index) => ({
    position: index + 1,
    title: topic.title,
    items: topic.itemIds
      .map((id) => itemById.get(id))
      .filter((item): item is IndexedKnowledgeItem => Boolean(item))
      .map((item) => ({ claim: item.claim, kind: item.kind, importance: item.importance })),
  }));
}

export function resolveNoteLanguageContext(outputLanguage?: string | null) {
  return {
    languageCode: normalizeNoteLanguage(outputLanguage),
    languageLabel: resolveNoteLanguageLabel(outputLanguage),
  };
}

/* -------------------------------------------------------------------------- */
/* Legacy note pipeline (kept so the eval harness can measure the baseline)    */
/* -------------------------------------------------------------------------- */

export const legacyChunkSummarySchema = z.object({
  heading: z.string().min(3),
  summary: z.string().min(60),
  bulletPoints: z.array(z.string().min(12)).min(5),
  supportingDetails: z.array(z.string().min(12)).min(2),
  examples: z.array(z.string().min(12)),
  terminology: z.array(z.string().min(2)).min(3),
});

export function buildLegacyNoteTargets(sourceWordCount: number, chunkCount: number) {
  const targetNoteWordCount = Math.max(700, Math.min(3200, Math.round(sourceWordCount * 0.42)));

  return {
    targetNoteWordCount,
    minNoteWordCount: Math.max(700, Math.round(targetNoteWordCount * 0.88)),
    maxNoteWordCount: Math.max(900, Math.min(2400, Math.round(targetNoteWordCount * 1.18))),
    minSectionCount: Math.max(4, Math.min(12, chunkCount)),
    recommendedTopicCount: Math.max(4, Math.min(9, Math.ceil(chunkCount / 1.8))),
  };
}

export function buildLegacyAudioNoteTargets(sourceWordCount: number, chunkCount: number) {
  const targetNoteWordCount = Math.max(1200, Math.min(5200, Math.round(sourceWordCount * 0.58)));

  return {
    targetNoteWordCount,
    minNoteWordCount: Math.max(1100, Math.round(targetNoteWordCount * 0.86)),
    maxNoteWordCount: Math.max(1500, Math.min(5600, Math.round(targetNoteWordCount * 1.18))),
    minSectionCount: Math.max(6, Math.min(18, Math.ceil(chunkCount * 1.15))),
    recommendedTopicCount: Math.max(6, Math.min(14, Math.ceil(chunkCount / 1.5))),
  };
}

export function buildLegacyStructuredPlusInstructions(params: {
  outputLanguage?: string | null;
  recommendedTopicCount: number;
}) {
  const labels = getStructuredPlusLabels(params.outputLanguage);

  return `Use a selective expert study-notes style: read the source section by section, decide what the learner actually needs to know, and turn that into clear summarized notes with explanations. Cover the material by concepts and learning value, not by rewriting every sentence.

Selection rules:
- For each source section or chunk, identify the important learning points: central concepts, definitions, rules, formulas, processes, comparisons, causes and effects, exceptions, caveats, and source examples that make a concept easier to understand.
- Omit filler, repeated explanations, transitions, obvious restatements, low-value details, and examples that do not add new understanding.
- Merge duplicate ideas across chunks. If a later section repeats an idea that is already explained, only add genuinely new nuance.
- If a source section is mostly low-value, skip or merge it after preserving any useful concept it contains.
- Summarize meaningfully. Do not copy every fact, sentence, bullet, or tiny detail from the source.
- Do not use a fixed word-count target. The note should be as long as needed to explain the important material well and no longer. Dense material can produce longer notes; simple material should stay short.
- Prefer clear explanations plus a few useful bullets over long prose. Include examples only when they support understanding and are grounded in the source.
- Preserve mathematical notation as formulas when the source supports it. ${MATH_FORMATTING_INSTRUCTIONS}

Use this stable Structured Plus markdown format with these exact heading labels:
- Start with "${labels.overview}" containing 2-3 concise sentences that explain the whole material.
- Immediately after "${labels.overview}", add exactly one semantic blockquote callout in this form: "> **${labels.keyTakeaway}:** ...".
- Add "${labels.keyThings}" with 5-8 complete bullet points for the main ideas.
- After "${labels.keyThings}", include exactly one concise GFM markdown table when the source contains at least three comparable concepts, categories, systems, components, terms, steps, or cause-effect relationships.
- Then create about ${params.recommendedTopicCount} numbered topic sections such as "${labels.topicExample}". Never create more than ${params.recommendedTopicCount + 1} numbered topic sections.
- Inside each substantial topic, use "${labels.coreIdea}" and "${labels.detailedNotes}". Use "${labels.keyTerms}", "${labels.example}", "${labels.compare}", "${labels.process}", or "${labels.checkYourself}" only when they add real study value.
- "${labels.coreIdea}" must be exactly 1 sentence.
- "${labels.detailedNotes}" should usually contain 1 short explanatory paragraph plus 2-3 hyphen bullets.
- For unordered lists, always use "- " as the Markdown bullet marker.
- Use semantic blockquote callouts where it actually helps learning: exactly 2 in a normal note and at most 3 in a complex note.
- Add "${labels.checkYourself}" only once near the end. Format it as a hyphen bullet list with 3-5 short questions.
- End with "${labels.finalReview}" formatted as a hyphen bullet list containing 4-7 tight takeaways.

Return markdown only. Do not use HTML tags. Use 2-5 logical emojis total in major section headings.`;
}

/* -------------------------------------------------------------------------- */
/* Post-processing applied to every generated note                            */
/* -------------------------------------------------------------------------- */

export function countWords(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtmlFromNotes(value: string) {
  const normalized = value.trim();

  if (!/<\/?(h[1-6]|p|ul|ol|li|strong|em|blockquote|br)\b/i.test(normalized)) {
    return normalized;
  }

  return decodeHtmlEntities(
    normalized
      .replace(/\r\n/g, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<p[^>]*>/gi, "")
      .replace(/<\/h1>/gi, "\n\n")
      .replace(/<h1[^>]*>/gi, "# ")
      .replace(/<\/h2>/gi, "\n\n")
      .replace(/<h2[^>]*>/gi, "## ")
      .replace(/<\/h3>/gi, "\n\n")
      .replace(/<h3[^>]*>/gi, "### ")
      .replace(/<\/h4>/gi, "\n\n")
      .replace(/<h4[^>]*>/gi, "#### ")
      .replace(/<\/h5>/gi, "\n\n")
      .replace(/<h5[^>]*>/gi, "##### ")
      .replace(/<\/h6>/gi, "\n\n")
      .replace(/<h6[^>]*>/gi, "###### ")
      .replace(/<\/li>/gi, "\n")
      .replace(/<li[^>]*>/gi, "- ")
      .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
      .replace(/<\/strong>/gi, "**")
      .replace(/<strong[^>]*>/gi, "**")
      .replace(/<\/em>/gi, "*")
      .replace(/<em[^>]*>/gi, "*")
      .replace(/<\/blockquote>/gi, "\n")
      .replace(/<blockquote[^>]*>/gi, "> ")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
}

function normalizeStudyListSections(markdown: string) {
  const listSectionHeadings = new Set([
    "Preveri svoje znanje",
    "Končni pregled",
    "Check Yourself",
    "Final Review",
  ]);
  const lines = markdown.split("\n");
  const normalizedLines: string[] = [];
  let inListSection = false;
  let keptCalloutCount = 0;

  for (const line of lines) {
    const blockquote = /^>\s+(.+)$/.exec(line.trim());

    if (blockquote) {
      const content = blockquote[1];
      const normalizedContent = content
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "");
      const isExample = /^\*\*(primer|example):\*\*/.test(normalizedContent);
      const shouldKeepCallout = keptCalloutCount < 3 && (!isExample || keptCalloutCount === 0);

      if (shouldKeepCallout) {
        keptCalloutCount += 1;
        normalizedLines.push(line);
      } else {
        normalizedLines.push(content);
      }

      continue;
    }

    const unorderedListItem = /^(\s*)[*+]\s+(.+)$/.exec(line);

    if (unorderedListItem) {
      normalizedLines.push(`${unorderedListItem[1]}- ${unorderedListItem[2]}`);
      continue;
    }

    const fixedLine = line
      .replace(/^(#{2,3}\s+)Podrobni zapisk\s*$/i, "$1Podrobni zapiski")
      .replace(/^(#{2,3}\s+)Detailed Note\s*$/i, "$1Detailed Notes");
    const heading = /^#{2,3}\s+(.+)$/.exec(fixedLine.trim());

    if (heading) {
      const headingText = heading[1]
        .replace(/[\u{1F300}-\u{1FAFF}]/gu, "")
        .trim();
      inListSection = listSectionHeadings.has(headingText);
      normalizedLines.push(fixedLine);
      continue;
    }

    if (
      inListSection &&
      line.trim().length > 0 &&
      !/^(\s*[-*+]\s+|\s*\d+[.)]\s+|>\s+|\|)/.test(line)
    ) {
      normalizedLines.push(`- ${line.trim()}`);
      continue;
    }

    normalizedLines.push(fixedLine);
  }

  return normalizedLines.join("\n");
}

/**
 * The exact normalisation the pipeline applies before a note is stored, so anything that renders
 * a note outside the pipeline (the eval harness, a preview page) shows what a learner would see
 * rather than the raw model output.
 */
export function normalizeGeneratedNoteMarkdown(value: string) {
  return stripBareTextMacrosFromProse(
    normalizeMarkdownMath(normalizeStudyListSections(stripHtmlFromNotes(value))),
  );
}

/** The kinds a subject is built on; the outline never gets the last word on these. */
const OUTLINE_BACKBONE_KINDS = new Set(["definition", "formula"]);

/**
 * Mechanical guardrails on the outline's selection, applied after the model has chosen.
 *
 * Measured 2026-08-23 on real uploads, the same instruction produced retention anywhere from 11
 * of 48 items to 82 of 129 — one note missed exam material, the other was 86% as long as its
 * source. The judgment of what to keep stays with the model; the bounds on that judgment are
 * enforced here, the way the deck pipeline already does with selectDeckWorthyItems.
 *
 * Restores: any dropped definition or formula rated 3+, and any dropped item rated 5 — the things
 * an examiner asks first — each into the topic whose section it came from, or the last topic.
 * Trims: while more than 60% of the deduped items survive, the lowest-rated non-backbone item is
 * dropped, so a note can never again be a rewrite of its source.
 */
export function enforceOutlineRetentionBounds<
  TItem extends { id: number; kind: string; importance: number; sectionTitle: string },
  TOutline extends { topics: Array<{ title: string; itemIds: number[] }>; droppedItemIds: number[] },
>(outline: TOutline, items: TItem[]) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const isBackbone = (item: TItem) =>
    (OUTLINE_BACKBONE_KINDS.has(item.kind) && item.importance >= 3) || item.importance >= 5;
  const topics = outline.topics.map((topic) => ({ ...topic, itemIds: [...topic.itemIds] }));
  const retained = new Set(topics.flatMap((topic) => topic.itemIds));
  const dropped = outline.droppedItemIds.filter((id) => !retained.has(id));

  const restoredIds = new Set<number>();

  for (const id of dropped) {
    const item = itemById.get(id);

    if (!item || !isBackbone(item)) {
      continue;
    }

    const home =
      topics.find((topic) => topic.title === item.sectionTitle) ?? topics[topics.length - 1];

    if (home) {
      home.itemIds.push(id);
      retained.add(id);
      restoredIds.add(id);
    }
  }

  const ceiling = Math.max(20, Math.ceil(items.length * 0.6));

  if (retained.size > ceiling) {
    const removable = [...retained]
      .map((id) => itemById.get(id))
      .filter((item): item is TItem => Boolean(item) && !isBackbone(item as TItem))
      .sort((left, right) => left.importance - right.importance);

    for (const item of removable) {
      if (retained.size <= ceiling) {
        break;
      }

      retained.delete(item.id);

      for (const topic of topics) {
        topic.itemIds = topic.itemIds.filter((id) => id !== item.id);
      }
    }
  }

  return {
    ...outline,
    topics: topics.filter((topic) => topic.itemIds.length > 0),
    droppedItemIds: items.map((item) => item.id).filter((id) => !retained.has(id)),
    restoredItemCount: restoredIds.size,
  };
}
