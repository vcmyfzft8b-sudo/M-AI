// Kept free of imports so the relevance contract stays unit-testable
// (tests/note-image-relevance.test.mjs).
//
// Scoring an image against a note paragraph used to be a raw sum of keyword hits, which measured
// paragraph length as much as relevance: the longest section in a note accumulates the most hits
// and therefore won every image in the document. Measured on a three-page biology handout, the
// heart diagram and the mitosis diagram both landed under the enzymes section because that
// section was the longest. The sum is now divided by the size of the block it matched against,
// so an image goes where it fits best rather than where there is the most text.

/**
 * Slovene declines almost every noun, so the same idea appears as celica/celice/celico and
 * kromosomi/kromosome. Those match neither by equality nor as substrings of one another, which
 * left an image scoring zero against the very paragraph that explained it. Comparing a fixed-
 * length prefix is the same trick study-item dedupe already relies on for the same reason.
 */
const STEM_LENGTH = 6;

function stem(word: string) {
  return word.slice(0, STEM_LENGTH);
}

/** Floor on the length divisor, so a two-word heading cannot win on one lucky match. */
const MIN_BLOCK_KEYWORDS_FOR_SCORING = 8;

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "this",
  "that",
  "into",
  "they",
  "their",
  "image",
  "document",
  "visual",
  "nearby",
  "related",
  "from",
  "page",
  "slide",
  "source",
  "material",
  "notes",
  "study",
  "stran",
  "slika",
  "dokument",
  "prosojnica",
  "vizual",
  "gradivo",
  "zapiski",
  "študij",
  "studij",
  "povezano",
  "prikazuje",
  "vsebuje",
  "ima",
  "lahko",
  "smo",
  "bomo",
  "in",
  "ali",
  "kot",
  "pri",
  "ter",
  "tudi",
  "kaj",
  "kako",
  "zakaj",
]);

export function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function keywords(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !STOP_WORDS.has(word))
    .slice(0, 80);
}

function keywordSet(value: string) {
  return new Set(keywords(value));
}

export function scoreBlockForImage(params: {
  blockText: string;
  image: { description?: string | null; contextText?: string | null };
}) {
  const imageKeywords = keywordSet(
    [
      params.image.description,
      params.image.contextText,
    ]
      .filter(Boolean)
      .join(" "),
  );

  if (imageKeywords.size === 0) {
    return 0;
  }

  const text = normalizeText(params.blockText);
  const blockKeywords = keywordSet(params.blockText);
  const blockStems = new Set([...blockKeywords].map(stem));
  let hits = 0;

  for (const keyword of imageKeywords) {
    if (blockKeywords.has(keyword)) {
      // A long word carries more meaning than a short one.
      hits += keyword.length >= 7 ? 3 : 2;
    } else if (blockStems.has(stem(keyword))) {
      hits += keyword.length >= 7 ? 2 : 1;
    } else if (text.includes(keyword)) {
      hits += 1;
    }
  }

  // Divided by the square root of the block's own vocabulary: a paragraph twice as long needs
  // appreciably more matches to win, without short blocks becoming unbeatable on a single hit.
  return hits / Math.sqrt(Math.max(blockKeywords.size, MIN_BLOCK_KEYWORDS_FOR_SCORING));
}

