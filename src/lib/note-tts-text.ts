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
  return line
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]{1,3}([^*_~]+)[*_~]{1,3}/g, "$1")
    .replace(/<[^>]+>/g, " ")
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

  return withoutOuterPipes.split("|").map((cell) => cleanMarkdownLine(cell));
}

function tokenizeLine(text: string, nextWordIndex: number) {
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

export function parseNoteTtsDocument(markdown: string): NoteTtsDocument {
  const blocks: NoteTtsBlock[] = [];
  const words: NoteTtsWord[] = [];
  let nextWordIndex = 0;
  let inCodeBlock = false;
  let pendingList: NoteTtsListBlock | null = null;
  const lines = markdown.split(/\r?\n/);

  function tokenizeText(text: string) {
    const tokenized = tokenizeLine(text, nextWordIndex);

    if (tokenized.words.length === 0) {
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
      text: chunkWords.map((word) => word.text).join(" "),
      estimatedSeconds,
    });
  }

  return chunks;
}
