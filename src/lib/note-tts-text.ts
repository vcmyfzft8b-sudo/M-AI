import {
  isLikelyMathExpression,
  normalizeFormulaSyntax,
  normalizeMarkdownMath,
} from "./math-markdown.ts";

export type NoteTtsWord = {
  index: number;
  text: string;
};

export type NoteTtsInlineToken =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "word";
      text: string;
      wordIndex: number;
    }
  | {
      type: "math";
      text: string;
      display: boolean;
    };

export type NoteTtsTextBlock = {
  id: string;
  kind: "heading" | "paragraph" | "callout";
  level?: number;
  calloutKind?: "definition" | "example" | "common_mistake" | "key_takeaway" | "note";
  tokens: NoteTtsInlineToken[];
};

export type NoteTtsListBlock = {
  id: string;
  kind: "list";
  ordered: boolean;
  items: Array<{
    id: string;
    tokens: NoteTtsInlineToken[];
  }>;
};

export type NoteTtsTableBlock = {
  id: string;
  kind: "table";
  rows: Array<{
    id: string;
    cells: Array<{
      id: string;
      header: boolean;
      tokens: NoteTtsInlineToken[];
    }>;
  }>;
};

export type NoteTtsBlock = NoteTtsTextBlock | NoteTtsListBlock | NoteTtsTableBlock;

export type NoteTtsDocument = {
  blocks: NoteTtsBlock[];
  words: NoteTtsWord[];
};

export type NoteTtsChunkPlan = {
  chunkIndex: number;
  wordStartIndex: number;
  wordEndIndex: number;
  text: string;
  estimatedSeconds: number;
};

// Production measured 1.6-1.9 spoken words per second across languages (p10-p90, tts-rt-v2), so
// 90 words is about a minute of audio. Soniox truncates a request at three minutes of audio, and
// the old 190-word chunks sat at two minutes with a tail that never got spoken on the slowest
// notes — a formula-heavy one reached the cap a third of the way in. A minute also halves the
// wait before an uncached note starts playing, since synthesis runs a little faster than real time.
const DEFAULT_TARGET_WORDS_PER_CHUNK = 90;
// The first chunks are short so an uncached note starts within seconds, and each next chunk is
// sized so it is synthesized before the current one ends. Measured on tts-rt-v2: synthesis takes
// about 0.88x the audio's length plus ~3s of upload, and the player runs two generations at once
// from the first click. So the second chunk may be 1.6x the first (it runs alongside it, and has
// the first chunk's synthesis plus its playback to finish in), and every later one 0.75x the two
// before it (it starts when the earlier of those finishes and has both their playbacks to finish
// in — or, when the first two were made at note creation, starts at the first click and has the
// same two playbacks). The ratios apply to the sizes actually chosen, which snapping may shorten.
const FIRST_CHUNK_TARGET_WORDS = 30;
const SECOND_CHUNK_GROWTH = 1.6;
const LATER_CHUNK_GROWTH = 0.75;
const ESTIMATED_TTS_WORDS_PER_SECOND = 1.7;
// A boundary may move back this far to land on a sentence end; the word cap stays the timing
// guarantee, this only makes the cut natural.
const CHUNK_SNAP_WINDOW = 0.4;
const MIN_CHUNK_WORDS = 12;
// The word count bounds prose, but formulas carry no words and are read at ~4 characters a
// second against ~12 for prose — a chunk of forty-eight words with a formula in every sentence
// came to 1,200 characters, well past the three minutes Soniox stops at. So a chunk is also capped
// by the length of its speech text: 700 characters is under three minutes even if all of it were
// formula, and ordinary prose of 90 words stays under it.
const MAX_CHUNK_SPEECH_CHARS = 700;
const ESTIMATED_TTS_CHARS_PER_SECOND = 12;

// Folded into the cache key of every chunk. A chunk's audio is only valid for the exact word
// range the planner gave it, so any change to how chunks are cut has to retire the cached audio;
// deriving the version from the parameters makes that automatic rather than a thing to remember.
export const NOTE_TTS_CHUNK_PLAN_VERSION = [
  "plan",
  DEFAULT_TARGET_WORDS_PER_CHUNK,
  FIRST_CHUNK_TARGET_WORDS,
  SECOND_CHUNK_GROWTH,
  LATER_CHUNK_GROWTH,
  CHUNK_SNAP_WINDOW,
  MIN_CHUNK_WORDS,
  MAX_CHUNK_SPEECH_CHARS,
].join("-");

export function getTargetWordsForChunk(previousChunkSizes: number[], targetWordsPerChunk: number) {
  const count = previousChunkSizes.length;

  if (count === 0) {
    return Math.min(FIRST_CHUNK_TARGET_WORDS, targetWordsPerChunk);
  }

  if (count === 1) {
    return Math.min(targetWordsPerChunk, Math.floor(previousChunkSizes[0] * SECOND_CHUNK_GROWTH));
  }

  return Math.min(
    targetWordsPerChunk,
    Math.floor((previousChunkSizes[count - 1] + previousChunkSizes[count - 2]) * LATER_CHUNK_GROWTH),
  );
}

const SENTENCE_END_PATTERN = /[.!?…;:]/u;

// Word indexes after which the reader hears a pause anyway: the last word of a block, list item
// or table cell (the speech text puts a full stop there), and any word followed by sentence
// punctuation. A chunk boundary on one of these is inaudible; one in the middle of a sentence
// ends the phrase with a falling tone and restarts it as a new sentence.
function collectSentenceEndWordIndexes(blocks: NoteTtsBlock[]) {
  const ends = new Set<number>();
  const tokenLists: NoteTtsInlineToken[][] = [];

  for (const block of blocks) {
    if (block.kind === "list") {
      tokenLists.push(...block.items.map((item) => item.tokens));
    } else if (block.kind === "table") {
      tokenLists.push(...block.rows.flatMap((row) => row.cells.map((cell) => cell.tokens)));
    } else {
      tokenLists.push(block.tokens);
    }
  }

  for (const tokens of tokenLists) {
    let lastWordIndex: number | null = null;

    for (const token of tokens) {
      if (token.type === "word") {
        lastWordIndex = token.wordIndex;
        continue;
      }

      if (token.type === "text" && lastWordIndex !== null && SENTENCE_END_PATTERN.test(token.text)) {
        ends.add(lastWordIndex);
      }
    }

    if (lastWordIndex !== null) {
      ends.add(lastWordIndex);
    }
  }

  return ends;
}
const WORD_PATTERN = /[\p{L}\p{N}]+(?:[.'’_-][\p{L}\p{N}]+)*/gu;
const SPEECH_BLOCK_SEPARATOR = "\n\n";
const SPEECH_LIST_ITEM_SEPARATOR = "\n";
const SPEECH_TERMINAL_PATTERN = /[.!?…:;)]["')\]]*$/u;

function normalizeHeadingText(value: string) {
  return value
    .toLowerCase()
    .replace(/["'“”‘’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Always returns trimmed text: every caller hashes the result into the chunk cache key, and the
// strip path trimmed while the pass-through path did not, so the same note hashed two ways
// depending on which route asked and cached audio went unfound.
export function stripLeadingRedundantHeading(markdown: string, title?: string | null) {
  const lines = markdown.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex === -1) {
    return markdown.trim();
  }

  const match = lines[firstContentIndex].match(/^#{1,6}\s+(.+)$/);

  if (!match) {
    return markdown.trim();
  }

  const heading = normalizeHeadingText(match[1] ?? "");
  const normalizedTitle = normalizeHeadingText(title ?? "");
  const genericHeadings = new Set(["notes", "lecture notes", "structured notes"]);

  if (!genericHeadings.has(heading) && heading !== normalizedTitle) {
    return markdown.trim();
  }

  const remainingLines = lines.slice(firstContentIndex + 1);

  while (remainingLines[0]?.trim() === "") {
    remainingLines.shift();
  }

  return remainingLines.join("\n").trim();
}

function cleanMarkdownLine(line: string) {
  const mathSpans: string[] = [];
  const protectedLine = line.replace(
    /(\$\$[\s\S]+?\$\$|\\\([\s\S]+?\\\)|\\\[[\s\S]+?\\\]|(?<!\\)(?<!\$)\$[^\n$]+?(?<!\\)\$(?!\$))/g,
    (match) => {
      const placeholder = `\uE000${mathSpans.length}\uE001`;
      mathSpans.push(match);
      return placeholder;
    },
  );

  return protectedLine
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\uE000(\d+)\uE001/g, (_match, index: string) => mathSpans[Number(index)] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHeading(line: string) {
  const trimmed = line.trim();
  const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);

  if (!heading) {
    return null;
  }

  return {
    level: heading[1].length,
    text: cleanMarkdownLine(heading[2]),
  };
}

function parseListItem(line: string): { ordered: boolean; text: string } | null {
  const trimmed = line.trim();
  const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);

  if (unordered) {
    return {
      ordered: false,
      text: cleanMarkdownLine(unordered[1]),
    };
  }

  const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);

  if (ordered) {
    return {
      ordered: true,
      text: cleanMarkdownLine(ordered[1]),
    };
  }

  return null;
}

function getCalloutKind(text: string): NoteTtsTextBlock["calloutKind"] {
  const normalized = text.toLowerCase();

  if (normalized.startsWith("definition:") || normalized.startsWith("definicija:")) {
    return "definition";
  }

  if (normalized.startsWith("example:") || normalized.startsWith("primer:")) {
    return "example";
  }

  if (
    normalized.startsWith("common mistake:") ||
    normalized.startsWith("pogosta napaka:")
  ) {
    return "common_mistake";
  }

  if (normalized.startsWith("key takeaway:") || normalized.startsWith("ključno:")) {
    return "key_takeaway";
  }

  return "note";
}

function isTableSeparator(line: string) {
  const cells = splitTableCells(line);

  return (
    cells.length > 0 &&
    cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()))
  );
}

function splitTableCells(line: string) {
  const trimmed = line.trim();

  if (!trimmed.includes("|")) {
    return [];
  }

  const withoutOuterPipes = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let mathCloseDelimiter: "$$" | "\\)" | "\\]" | null = null;

  for (let index = 0; index < withoutOuterPipes.length; index += 1) {
    if (mathCloseDelimiter) {
      if (withoutOuterPipes.startsWith(mathCloseDelimiter, index)) {
        current += mathCloseDelimiter;
        index += mathCloseDelimiter.length - 1;
        mathCloseDelimiter = null;
      } else {
        current += withoutOuterPipes[index];
      }

      continue;
    }

    if (withoutOuterPipes[index] === "\\" && withoutOuterPipes[index + 1] === "|") {
      current += "|";
      index += 1;
      continue;
    }

    if (withoutOuterPipes.startsWith("$$", index)) {
      current += "$$";
      mathCloseDelimiter = "$$";
      index += 1;
      continue;
    }

    if (withoutOuterPipes.startsWith("\\(", index)) {
      current += "\\(";
      mathCloseDelimiter = "\\)";
      index += 1;
      continue;
    }

    if (withoutOuterPipes.startsWith("\\[", index)) {
      current += "\\[";
      mathCloseDelimiter = "\\]";
      index += 1;
      continue;
    }

    if (withoutOuterPipes[index] === "|") {
      cells.push(current);
      current = "";
      continue;
    }

    current += withoutOuterPipes[index];
  }

  cells.push(current);

  return cells.map((cell) => cleanMarkdownLine(cell));
}

function tokenizePlainText(text: string, nextWordIndex: number) {
  const tokens: NoteTtsInlineToken[] = [];
  const words: NoteTtsWord[] = [];
  let lastIndex = 0;
  let wordIndex = nextWordIndex;

  for (const match of text.matchAll(WORD_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const word = match[0];

    if (matchIndex > lastIndex) {
      tokens.push({
        type: "text",
        text: text.slice(lastIndex, matchIndex),
      });
    }

    tokens.push({
      type: "word",
      text: word,
      wordIndex,
    });
    words.push({
      index: wordIndex,
      text: word,
    });

    wordIndex += 1;
    lastIndex = matchIndex + word.length;
  }

  if (lastIndex < text.length) {
    tokens.push({
      type: "text",
      text: text.slice(lastIndex),
    });
  }

  return {
    tokens,
    words,
    nextWordIndex: wordIndex,
  };
}

function isEscapedDelimiter(text: string, index: number) {
  let slashCount = 0;

  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function isSingleDollarDelimiter(text: string, index: number) {
  return (
    text[index] === "$" &&
    text[index - 1] !== "$" &&
    text[index + 1] !== "$" &&
    !isEscapedDelimiter(text, index)
  );
}

function findInlineDollarMathDelimiter(text: string, startIndex: number) {
  let openIndex = text.indexOf("$", startIndex);

  while (openIndex >= 0) {
    if (!isSingleDollarDelimiter(text, openIndex)) {
      openIndex = text.indexOf("$", openIndex + 1);
      continue;
    }

    let closeIndex = text.indexOf("$", openIndex + 1);

    while (closeIndex >= 0 && !isSingleDollarDelimiter(text, closeIndex)) {
      closeIndex = text.indexOf("$", closeIndex + 1);
    }

    if (closeIndex === -1) {
      return null;
    }

    if (isLikelyMathExpression(text.slice(openIndex + 1, closeIndex))) {
      return { open: "$", close: "$", index: openIndex };
    }

    openIndex = text.indexOf("$", closeIndex + 1);
  }

  return null;
}

function findNextMathDelimiter(text: string, startIndex: number) {
  const inlineDollarMath = findInlineDollarMathDelimiter(text, startIndex);
  const candidates = [
    { open: "$$", close: "$$", index: text.indexOf("$$", startIndex) },
    { open: "\\(", close: "\\)", index: text.indexOf("\\(", startIndex) },
    { open: "\\[", close: "\\]", index: text.indexOf("\\[", startIndex) },
    ...(inlineDollarMath ? [inlineDollarMath] : []),
  ].filter((candidate) => candidate.index >= 0);

  return candidates.sort((left, right) => left.index - right.index)[0] ?? null;
}

function tokenizeLine(text: string, nextWordIndex: number) {
  const tokens: NoteTtsInlineToken[] = [];
  const words: NoteTtsWord[] = [];
  const trimmed = text.trim();
  let cursor = 0;
  let wordIndex = nextWordIndex;

  while (cursor < text.length) {
    const delimiter = findNextMathDelimiter(text, cursor);

    if (!delimiter) {
      const tokenized = tokenizePlainText(text.slice(cursor), wordIndex);
      tokens.push(...tokenized.tokens);
      words.push(...tokenized.words);
      wordIndex = tokenized.nextWordIndex;
      break;
    }

    if (delimiter.index > cursor) {
      const tokenized = tokenizePlainText(text.slice(cursor, delimiter.index), wordIndex);
      tokens.push(...tokenized.tokens);
      words.push(...tokenized.words);
      wordIndex = tokenized.nextWordIndex;
    }

    const mathStart = delimiter.index + delimiter.open.length;
    const mathEnd = text.indexOf(delimiter.close, mathStart);

    if (mathEnd === -1) {
      const tokenized = tokenizePlainText(text.slice(delimiter.index), wordIndex);
      tokens.push(...tokenized.tokens);
      words.push(...tokenized.words);
      wordIndex = tokenized.nextWordIndex;
      break;
    }

    const rawMath = text.slice(mathStart, mathEnd).trim();

    if (rawMath) {
      const fullMathSpan = text.slice(delimiter.index, mathEnd + delimiter.close.length).trim();

      tokens.push({
        type: "math",
        text: normalizeFormulaSyntax(rawMath),
        display:
          delimiter.open !== "$" &&
          delimiter.open !== "\\(" &&
          trimmed === fullMathSpan &&
          delimiter.index === text.indexOf(trimmed),
      });
    }

    cursor = mathEnd + delimiter.close.length;
  }

  return {
    tokens,
    words,
    nextWordIndex: wordIndex,
  };
}

export function parseNoteTtsDocument(markdown: string): NoteTtsDocument {
  const blocks: NoteTtsBlock[] = [];
  const words: NoteTtsWord[] = [];
  let nextWordIndex = 0;
  let inCodeBlock = false;
  let pendingList: NoteTtsListBlock | null = null;
  const lines = normalizeMarkdownMath(markdown).split(/\r?\n/);

  function tokenizeText(text: string) {
    const tokenized = tokenizeLine(text, nextWordIndex);

    if (tokenized.tokens.length === 0) {
      return null;
    }

    nextWordIndex = tokenized.nextWordIndex;
    words.push(...tokenized.words);

    return tokenized.tokens;
  }

  function flushList() {
    if (!pendingList) {
      return;
    }

    blocks.push(pendingList);
    pendingList = null;
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const rawLine = lines[lineIndex];
    const trimmed = rawLine.trim();

    if (trimmed.startsWith("```")) {
      flushList();
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (inCodeBlock) {
      continue;
    }

    if (!trimmed || /^[-:| ]+$/.test(trimmed)) {
      flushList();
      continue;
    }

    const tableSeparator = lines[lineIndex + 1] ? isTableSeparator(lines[lineIndex + 1]) : false;

    if (trimmed.includes("|") && tableSeparator) {
      flushList();

      const tableLines = [rawLine];
      lineIndex += 2;

      while (lineIndex < lines.length && lines[lineIndex].trim().includes("|")) {
        tableLines.push(lines[lineIndex]);
        lineIndex += 1;
      }

      lineIndex -= 1;

      const rows = tableLines
        .map((line, rowIndex) => {
          const cells = splitTableCells(line)
            // An empty cell stays a cell: a comparison table's header often starts with one
            // ("| | 2025 | 2030 |"), and dropping it shifted every header label one column
            // left. Empty tokens add no words, so annotation word indexes are untouched.
            .map((cell, cellIndex) => ({
              id: `note-tts-block-${blocks.length}-row-${rowIndex}-cell-${cellIndex}`,
              header: rowIndex === 0,
              tokens: tokenizeText(cell) ?? [],
            }));

          if (cells.length === 0) {
            return null;
          }

          return {
            id: `note-tts-block-${blocks.length}-row-${rowIndex}`,
            cells,
          };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (rows.length > 0) {
        blocks.push({
          id: `note-tts-block-${blocks.length}`,
          kind: "table",
          rows,
        });
      }

      continue;
    }

    const heading = parseHeading(rawLine);

    if (heading) {
      flushList();
      const tokens = tokenizeText(heading.text);

      if (tokens) {
        blocks.push({
          id: `note-tts-block-${blocks.length}`,
          kind: "heading",
          level: heading.level,
          tokens,
        });
      }

      continue;
    }

    const listItem = parseListItem(rawLine);

    if (listItem) {
      const tokens = tokenizeText(listItem.text);

      if (!tokens) {
        continue;
      }

      if (!pendingList || pendingList.ordered !== listItem.ordered) {
        flushList();
        pendingList = {
          id: `note-tts-block-${blocks.length}`,
          kind: "list",
          ordered: listItem.ordered,
          items: [],
        };
      }

      pendingList.items.push({
        id: `${pendingList.id}-item-${pendingList.items.length}`,
        tokens,
      });

      continue;
    }

    flushList();

    if (trimmed.startsWith(">")) {
      const calloutLines = [cleanMarkdownLine(trimmed.replace(/^>\s?/, ""))];

      while (lines[lineIndex + 1]?.trim().startsWith(">")) {
        lineIndex += 1;
        calloutLines.push(cleanMarkdownLine(lines[lineIndex].trim().replace(/^>\s?/, "")));
      }

      const text = calloutLines.filter(Boolean).join(" ");
      const tokens = tokenizeText(text);

      if (tokens) {
        blocks.push({
          id: `note-tts-block-${blocks.length}`,
          kind: "callout",
          calloutKind: getCalloutKind(text),
          tokens,
        });
      }

      continue;
    }

    const text = cleanMarkdownLine(rawLine);
    const tokens = tokenizeText(text);

    if (!tokens) {
      continue;
    }

    blocks.push({
      id: `note-tts-block-${blocks.length}`,
      kind: "paragraph",
      tokens,
    });
  }

  flushList();

  return { blocks, words };
}

export function buildNoteTtsChunks(
  document: NoteTtsDocument,
  targetWordsPerChunk = DEFAULT_TARGET_WORDS_PER_CHUNK,
): NoteTtsChunkPlan[] {
  const chunks: NoteTtsChunkPlan[] = [];
  const firstBlock = document.blocks[0];
  const secondBlock = document.blocks[1];
  const shouldSkipDuplicatedPageTitle =
    firstBlock?.kind === "heading" &&
    secondBlock?.kind === "heading" &&
    /^\d+[\s.)]/.test(secondBlock.tokens.map((token) => token.text).join("").trim());
  const wordStartOffset = shouldSkipDuplicatedPageTitle
    ? firstBlock.tokens.filter(
        (token): token is Extract<NoteTtsInlineToken, { type: "word" }> =>
          token.type === "word",
      ).length
    : 0;

  const sentenceEnds = collectSentenceEndWordIndexes(document.blocks);
  const chunkSizes: number[] = [];

  for (
    let wordStartIndex = wordStartOffset, chunkIndex = 0;
    wordStartIndex < document.words.length;
    chunkIndex += 1
  ) {
    const targetWords = getTargetWordsForChunk(chunkSizes, targetWordsPerChunk);
    let wordEndIndex = Math.min(wordStartIndex + targetWords, document.words.length);

    if (wordEndIndex < document.words.length) {
      const earliestEnd =
        wordStartIndex + Math.max(MIN_CHUNK_WORDS, Math.ceil(targetWords * (1 - CHUNK_SNAP_WINDOW)));

      for (let candidate = wordEndIndex; candidate >= earliestEnd; candidate -= 1) {
        if (sentenceEnds.has(document.words[candidate - 1].index)) {
          wordEndIndex = candidate;
          break;
        }
      }
    }

    let text = buildChunkSpeechText(document.blocks, wordStartIndex, wordEndIndex);

    // Too much speech for the words it holds (formulas): pull the end back, to a sentence end
    // when one exists, else a few words at a time, until it fits or the chunk is at its minimum.
    while (
      text.length > MAX_CHUNK_SPEECH_CHARS &&
      wordEndIndex - wordStartIndex > MIN_CHUNK_WORDS
    ) {
      const floor = wordStartIndex + MIN_CHUNK_WORDS;
      let shorter = Math.max(floor, wordEndIndex - 5);

      for (let candidate = wordEndIndex - 1; candidate > floor; candidate -= 1) {
        if (sentenceEnds.has(document.words[candidate - 1].index)) {
          shorter = candidate;
          break;
        }
      }

      wordEndIndex = shorter;
      text = buildChunkSpeechText(document.blocks, wordStartIndex, wordEndIndex);
    }

    const chunkWords = document.words.slice(wordStartIndex, wordEndIndex);
    const estimatedSeconds = Math.max(
      1,
      Math.ceil(chunkWords.length / ESTIMATED_TTS_WORDS_PER_SECOND),
      Math.ceil(text.length / ESTIMATED_TTS_CHARS_PER_SECOND),
    );

    chunks.push({
      chunkIndex,
      wordStartIndex,
      wordEndIndex,
      text,
      estimatedSeconds,
    });
    chunkSizes.push(wordEndIndex - wordStartIndex);
    wordStartIndex = wordEndIndex;
  }

  return chunks;
}

const SPEAKABLE_MATH_SYMBOLS: Record<string, string> = {
  ne: "≠",
  neq: "≠",
  le: "≤",
  leq: "≤",
  ge: "≥",
  geq: "≥",
  pm: "±",
  mp: "∓",
  infty: "∞",
  cdot: "·",
  times: "×",
  div: "÷",
  approx: "≈",
  to: "→",
  rightarrow: "→",
  leftarrow: "←",
  leftrightarrow: "↔",
  Rightarrow: "⇒",
  Leftrightarrow: "⇔",
  sum: "∑",
  prod: "∏",
  int: "∫",
  partial: "∂",
  nabla: "∇",
  degree: "°",
  circ: "°",
  ldots: "…",
  cdots: "…",
  dots: "…",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  epsilon: "ε",
  varepsilon: "ε",
  zeta: "ζ",
  eta: "η",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  nu: "ν",
  xi: "ξ",
  pi: "π",
  rho: "ρ",
  sigma: "σ",
  tau: "τ",
  phi: "φ",
  varphi: "φ",
  chi: "χ",
  psi: "ψ",
  omega: "ω",
  Gamma: "Γ",
  Delta: "Δ",
  Theta: "Θ",
  Lambda: "Λ",
  Pi: "Π",
  Sigma: "Σ",
  Phi: "Φ",
  Omega: "Ω",
};

const FRACTION_PATTERN = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g;
const ROOT_WITH_INDEX_PATTERN = /\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g;
const ROOT_PATTERN = /\\sqrt\s*\{([^{}]*)\}/g;

// Innermost first: a pass rewrites the fractions and roots whose arguments hold no braces, which
// unwraps one level of nesting, and repeats until nothing changes — so a root inside a fraction
// and a fraction inside a root both resolve rather than leaving "frac" to be read as a word.
function rewriteFractionsAndRoots(value: string) {
  let current = value;

  for (let pass = 0; pass < 8; pass += 1) {
    const next = current
      .replace(FRACTION_PATTERN, (_match, a: string, b: string) => ` ${a} / ${b} `)
      .replace(ROOT_WITH_INDEX_PATTERN, (_match, index: string, a: string) => ` ${index}√(${a}) `)
      .replace(ROOT_PATTERN, (_match, a: string) => ` √(${a}) `);

    if (next === current) {
      break;
    }

    current = next;
  }

  return current;
}

// What a formula sounds like. The note keeps its LaTeX for the page; the speech text gets symbols
// and plain words instead, because the model read "\frac{x)}{Q}" and "\text{st}(P)" letter by
// letter — a formula-heavy chunk took over three minutes and hit Soniox's per-request cap.
export function speakableMath(latex: string) {
  let value = latex
    .replace(/\\(?:left|right|big|Big|bigg|Bigg|,|;|!|quad|qquad)\b/g, " ")
    .replace(/\\(?:text|textrm|textit|textbf|mathrm|mathit|mathbf|operatorname|mathcal|mathbb)\s*\{([^{}]*)\}/g, " $1 ");

  // Scripts first: "x^{2}" inside a root or a fraction would otherwise hide the group's braces
  // from the command rewrites below.
  value = value.replace(/\^\{([^{}]*)\}/g, "^$1").replace(/_\{([^{}]*)\}/g, "_$1");
  value = rewriteFractionsAndRoots(value)
    .replace(/\\([A-Za-z]+)/g, (_match, command: string) => {
      const symbol = SPEAKABLE_MATH_SYMBOLS[command];

      return symbol ? ` ${symbol} ` : ` ${command} `;
    })
    .replace(/\\([^A-Za-z])/g, "$1")
    .replace(/[{}]/g, " ")
    .replace(/\s+([_^])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

function normalizeSpeechText(value: string) {
  return value
    .replace(/\s*(?:-{1,2}>|→|⇒|➜|➡)\s*/g, ". ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?…])/g, "$1")
    .replace(/([,.;:!?…])(?=\S)/g, "$1 ")
    .trim();
}

function ensureSpeechPause(value: string) {
  const text = normalizeSpeechText(value);

  if (!text || SPEECH_TERMINAL_PATTERN.test(text)) {
    return text;
  }

  return `${text}.`;
}

function tokensToSpeechText(
  tokens: NoteTtsInlineToken[],
  wordStartIndex: number,
  wordEndIndex: number,
) {
  let text = "";
  let pendingText = "";
  let hasIncludedWord = false;

  for (const token of tokens) {
    if (token.type === "text") {
      if (hasIncludedWord) {
        text += token.text;
      } else {
        pendingText += token.text;
      }
      continue;
    }

    if (token.type === "math") {
      const spoken = speakableMath(token.text);

      if (hasIncludedWord) {
        text += spoken;
      } else {
        pendingText += spoken;
      }
      continue;
    }

    if (token.wordIndex >= wordEndIndex) {
      break;
    }

    if (token.wordIndex < wordStartIndex) {
      pendingText = "";
      continue;
    }

    text += hasIncludedWord ? pendingText : pendingText.replace(/^\s+/, "");
    text += token.text;
    pendingText = "";
    hasIncludedWord = true;
  }

  return normalizeSpeechText(text);
}

function buildBlockSpeechText(
  block: NoteTtsBlock,
  wordStartIndex: number,
  wordEndIndex: number,
) {
  if (block.kind === "list") {
    return block.items
      .map((item) => ensureSpeechPause(tokensToSpeechText(item.tokens, wordStartIndex, wordEndIndex)))
      .filter(Boolean)
      .join(SPEECH_LIST_ITEM_SEPARATOR);
  }

  if (block.kind === "table") {
    return block.rows
      .map((row) =>
        ensureSpeechPause(
          row.cells
            .map((cell) => tokensToSpeechText(cell.tokens, wordStartIndex, wordEndIndex))
            .filter(Boolean)
            .join(", "),
        ),
      )
      .filter(Boolean)
      .join(SPEECH_LIST_ITEM_SEPARATOR);
  }

  return ensureSpeechPause(tokensToSpeechText(block.tokens, wordStartIndex, wordEndIndex));
}

function buildChunkSpeechText(
  blocks: NoteTtsBlock[],
  wordStartIndex: number,
  wordEndIndex: number,
) {
  return (
    blocks
      .map((block) => buildBlockSpeechText(block, wordStartIndex, wordEndIndex))
      .filter(Boolean)
      .join(SPEECH_BLOCK_SEPARATOR) || ""
  );
}
