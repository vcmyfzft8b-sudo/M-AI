import {
  isLikelyMathExpression,
  normalizeFormulaSyntax,
  normalizeMarkdownMath,
} from "@/lib/math-markdown";

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

const DEFAULT_TARGET_WORDS_PER_CHUNK = 190;
const ESTIMATED_TTS_WORDS_PER_SECOND = 2.35;
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

export function stripLeadingRedundantHeading(markdown: string, title?: string | null) {
  const lines = markdown.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim().length > 0);

  if (firstContentIndex === -1) {
    return markdown;
  }

  const match = lines[firstContentIndex].match(/^#{1,6}\s+(.+)$/);

  if (!match) {
    return markdown;
  }

  const heading = normalizeHeadingText(match[1] ?? "");
  const normalizedTitle = normalizeHeadingText(title ?? "");
  const genericHeadings = new Set(["notes", "lecture notes", "structured notes"]);

  if (!genericHeadings.has(heading) && heading !== normalizedTitle) {
    return markdown;
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

  if (
    normalized.startsWith("definition:") ||
    normalized.startsWith("definicija:") ||
    normalized.startsWith("definizione:")
  ) {
    return "definition";
  }

  if (
    normalized.startsWith("example:") ||
    normalized.startsWith("primer:") ||
    normalized.startsWith("primjer:") ||
    normalized.startsWith("beispiel:") ||
    normalized.startsWith("esempio:")
  ) {
    return "example";
  }

  if (
    normalized.startsWith("common mistake:") ||
    normalized.startsWith("pogosta napaka:") ||
    normalized.startsWith("česta pogreška:") ||
    normalized.startsWith("häufiger fehler:") ||
    normalized.startsWith("errore comune:")
  ) {
    return "common_mistake";
  }

  if (
    normalized.startsWith("key takeaway:") ||
    normalized.startsWith("ključno:") ||
    normalized.startsWith("kernaussage:") ||
    normalized.startsWith("punto chiave:")
  ) {
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
            .map((cell, cellIndex) => {
              const tokens = tokenizeText(cell);

              if (!tokens) {
                return null;
              }

              return {
                id: `note-tts-block-${blocks.length}-row-${rowIndex}-cell-${cellIndex}`,
                header: rowIndex === 0,
                tokens,
              };
            })
            .filter((cell): cell is NonNullable<typeof cell> => Boolean(cell));

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

  for (
    let wordStartIndex = wordStartOffset, chunkIndex = 0;
    wordStartIndex < document.words.length;
    wordStartIndex += targetWordsPerChunk, chunkIndex += 1
  ) {
    const wordEndIndex = Math.min(wordStartIndex + targetWordsPerChunk, document.words.length);
    const chunkWords = document.words.slice(wordStartIndex, wordEndIndex);
    const estimatedSeconds = Math.max(
      1,
      Math.ceil(chunkWords.length / ESTIMATED_TTS_WORDS_PER_SECOND),
    );

    chunks.push({
      chunkIndex,
      wordStartIndex,
      wordEndIndex,
      text: buildChunkSpeechText(document.blocks, wordStartIndex, wordEndIndex),
      estimatedSeconds,
    });
  }

  return chunks;
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
      if (hasIncludedWord) {
        text += token.text;
      } else {
        pendingText += token.text;
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
