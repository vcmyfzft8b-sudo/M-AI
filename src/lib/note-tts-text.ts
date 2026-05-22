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
      expression: string;
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

export type NoteTtsMathBlock = {
  id: string;
  kind: "math";
  expression: string;
  tokens: NoteTtsInlineToken[];
};

export type NoteTtsBlock =
  | NoteTtsTextBlock
  | NoteTtsListBlock
  | NoteTtsTableBlock
  | NoteTtsMathBlock;

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
  return line
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
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

function stripMathDelimiters(value: string) {
  return value
    .trim()
    .replace(/^\$\$\s*/, "")
    .replace(/\s*\$\$$/, "")
    .replace(/^\$\s*/, "")
    .replace(/\s*\$$/, "")
    .trim();
}

function isInlineMathLine(value: string) {
  return /^\$[^$\n]+\$$/.test(value.trim()) && /[=\\_^{}]/.test(value);
}

function isLikelyMathExpression(value: string) {
  return /[=\\_^{}]|(?:\b(?:sqrt|frac|rac|sum|times|imes|cdot|bar)\b)/.test(value);
}

function isLikelyMarkdownBlockStart(value: string) {
  const trimmed = value.trim();

  return (
    /^#{1,6}\s+/.test(trimmed) ||
    /^[-*+]\s+/.test(trimmed) ||
    /^\d+[.)]\s+/.test(trimmed) ||
    /^>\s+/.test(trimmed) ||
    trimmed.includes("|")
  );
}

function stripOpeningMathDelimiter(value: string) {
  return value.trim().replace(/^\${2,3}\s*/, "");
}

function stripClosingMathDelimiter(value: string) {
  return value.trim().replace(/\s*\${2,3}$/, "");
}

function splitLeadingMathDelimiter(value: string) {
  const trimmed = value.trim();
  const match = /^(\${2,3})([\s\S]*)$/.exec(trimmed);

  if (!match) {
    return null;
  }

  return {
    delimiter: match[1],
    rest: match[2].trim(),
  };
}

function cleanFormulaExplanation(value: string) {
  return cleanMarkdownLine(value.replace(/\$\s*([^$\n]+?)\s*\$/g, "$1"))
    .replace(/^[,.;:\s]+/, "")
    .trim();
}

function splitMalformedTrailingMathDelimiter(value: string) {
  const dollarIndex = value.indexOf("$");

  if (dollarIndex <= 0) {
    return null;
  }

  const expression = value.slice(0, dollarIndex).trim();
  const explanation = value.slice(dollarIndex + 1);

  if (!expression || !isLikelyMathExpression(expression)) {
    return null;
  }

  return {
    expression: stripMathDelimiters(expression),
    explanation: cleanFormulaExplanation(explanation),
  };
}

function extractFormulaPartsFromLine(value: string) {
  const trimmed = value.trim();
  const labeledInlineMathMatch = /^(?:[-*+]\s+)?(?:\*\*)?(?:Formula|Enačba|Equation)\b(?:\*\*)?[^$\n]*\$\s*([^$\n]{3,700}?)\s*\$(.*)$/iu.exec(
    trimmed,
  );

  if (labeledInlineMathMatch?.[1] && isLikelyMathExpression(labeledInlineMathMatch[1])) {
    return {
      expression: labeledInlineMathMatch[1].trim(),
      explanation: cleanFormulaExplanation(labeledInlineMathMatch[2] ?? ""),
    };
  }

  const standaloneInlineMathMatch = /^\$\s*([^$\n]{3,700}?)\s*\$(.*)$/u.exec(trimmed);

  if (standaloneInlineMathMatch?.[1] && isLikelyMathExpression(standaloneInlineMathMatch[1])) {
    return {
      expression: standaloneInlineMathMatch[1].trim(),
      explanation: cleanFormulaExplanation(standaloneInlineMathMatch[2] ?? ""),
    };
  }

  if (/\$[^$\n]+\$/.test(trimmed)) {
    return null;
  }

  const labeledPlainMatch = /^(?:[-*+]\s+)?(?:\*\*)?(?:Formula|Enačba|Equation)\s*:?(?:\*\*)?\s*(.{3,700})$/iu.exec(
    trimmed,
  );

  if (labeledPlainMatch?.[1] && isLikelyMathExpression(labeledPlainMatch[1])) {
    const malformedDelimitedFormula = splitMalformedTrailingMathDelimiter(labeledPlainMatch[1]);

    if (malformedDelimitedFormula) {
      return malformedDelimitedFormula;
    }

    return {
      expression: stripMathDelimiters(labeledPlainMatch[1]),
      explanation: "",
    };
  }

  const plainEquationMatch = /^(?:[-*+]\s+)?(.{1,700}=.{1,700})$/u.exec(trimmed);

  if (
    plainEquationMatch?.[1] &&
    isLikelyMathExpression(plainEquationMatch[1])
  ) {
    const malformedDelimitedFormula = splitMalformedTrailingMathDelimiter(plainEquationMatch[1]);

    if (malformedDelimitedFormula) {
      return malformedDelimitedFormula;
    }

    return {
      expression: stripMathDelimiters(plainEquationMatch[1]),
      explanation: "",
    };
  }

  return null;
}

const INLINE_MATH_PATTERN =
  /\$([^$\n]{1,180})\$|\\(?:bar|frac|sum|sqrt|cdot|Delta|delta|alpha|beta|gamma|lambda|mu|sigma|theta|pi)\{[^{}\n]+\}(?:[_^](?:\{[^{}\n]+\}|[\p{L}\p{N}-]+))?|[\p{L}][\p{L}\p{N}]*(?:_\{[^{}\n]+\}|_[\p{L}\p{N}-]+)(?:\^\{[^{}\n]+\}|\^[\p{L}\p{N}-]+)?/gu;

function normalizeInlineMathExpression(value: string) {
  return stripMathDelimiters(value)
    .replace(/\u000c(?=rac)/g, "\\f")
    .replace(/\u0008(?=ar)/g, "\\b")
    .replace(/\brac\{/g, "\\frac{")
    .replace(/\\bar\{/g, "\\bar{")
    .replace(/([A-Za-z])\\bar\{\}/g, "\\bar{$1}")
    .replace(/I_\{p\\bar\{\}\}/g, "I_{\\bar{p}}")
    .replace(/\bimes\b/g, "\\times")
    .replace(/\s+\*\s+/g, " \\cdot ")
    .trim();
}

function tokenizeLine(text: string, nextWordIndex: number) {
  const tokens: NoteTtsInlineToken[] = [];
  const words: NoteTtsWord[] = [];
  let wordIndex = nextWordIndex;

  function pushPlainText(value: string) {
    let lastIndex = 0;

    for (const match of value.matchAll(WORD_PATTERN)) {
      const matchIndex = match.index ?? 0;
      const word = match[0];

      if (matchIndex > lastIndex) {
        tokens.push({
          type: "text",
          text: value.slice(lastIndex, matchIndex),
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

    if (lastIndex < value.length) {
      tokens.push({
        type: "text",
        text: value.slice(lastIndex),
      });
    }
  }

  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_MATH_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const rawExpression = match[1] ?? match[0];
    const expression = normalizeInlineMathExpression(rawExpression);
    const wasDollarDelimited = Boolean(match[1]);

    if (!expression || (!wasDollarDelimited && !/[\\_^{}=]/.test(expression))) {
      continue;
    }

    if (matchIndex > lastIndex) {
      pushPlainText(text.slice(lastIndex, matchIndex));
    }

    tokens.push({
      type: "math",
      text: expression,
      expression,
      wordIndex,
    });
    words.push({
      index: wordIndex,
      text: expression,
    });

    wordIndex += 1;
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    pushPlainText(text.slice(lastIndex));
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

  function pushMathBlock(expression: string) {
    const cleanedExpression = expression.trim();

    if (!cleanedExpression) {
      return;
    }

    const speechText = cleanedExpression
      .replace(/\\/g, " ")
      .replace(/[{}_$^]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const tokens = tokenizeText(speechText);

    blocks.push({
      id: `note-tts-block-${blocks.length}`,
      kind: "math",
      expression: cleanedExpression,
      tokens: tokens ?? [],
    });
  }

  function pushParagraph(text: string) {
    const cleanedText = cleanMarkdownLine(text);
    const tokens = tokenizeText(cleanedText);

    if (!tokens) {
      return;
    }

    blocks.push({
      id: `note-tts-block-${blocks.length}`,
      kind: "paragraph",
      tokens,
    });
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

    const formulaParts = extractFormulaPartsFromLine(trimmed);

    if (formulaParts) {
      flushList();
      pushMathBlock(formulaParts.expression);
      pushParagraph(formulaParts.explanation);
      continue;
    }

    if (trimmed.startsWith("$$")) {
      flushList();

      const opening = splitLeadingMathDelimiter(trimmed);
      const openingRest = opening?.rest ?? "";

      if (openingRest && !isLikelyMathExpression(openingRest)) {
        lines.splice(lineIndex + 1, 0, openingRest);
        continue;
      }

      if (openingRest && /\${2,3}\s*$/.test(openingRest)) {
        pushMathBlock(stripClosingMathDelimiter(openingRest));
        continue;
      }

      const mathLines: string[] = [];

      if (openingRest) {
        mathLines.push(stripClosingMathDelimiter(openingRest));
      }

      let foundClosingDelimiter = false;

      while (lineIndex + 1 < lines.length) {
        lineIndex += 1;
        const mathLine = lines[lineIndex].trim();
        const leadingClose = splitLeadingMathDelimiter(mathLine);

        if (leadingClose) {
          foundClosingDelimiter = true;

          if (leadingClose.rest) {
            lines.splice(lineIndex + 1, 0, leadingClose.rest);
          }

          break;
        }

        if (isLikelyMarkdownBlockStart(mathLine) && mathLines.some((line) => line.trim())) {
          lineIndex -= 1;
          break;
        }

        if (/\${2,3}\s*$/.test(mathLine)) {
          foundClosingDelimiter = true;
          mathLines.push(stripClosingMathDelimiter(mathLine));
          break;
        }

        mathLines.push(mathLine);
      }

      if (mathLines.some((line) => line.trim())) {
        pushMathBlock(mathLines.filter(Boolean).join(" "));
      } else if (!foundClosingDelimiter) {
        pushParagraph(stripOpeningMathDelimiter(trimmed));
      }

      continue;
    }

    if (isInlineMathLine(trimmed)) {
      flushList();
      pushMathBlock(stripMathDelimiters(trimmed));
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
        (token): token is Extract<NoteTtsInlineToken, { type: "word" | "math" }> =>
          token.type === "word" || token.type === "math",
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

  if (block.kind === "math") {
    return ensureSpeechPause(tokensToSpeechText(block.tokens, wordStartIndex, wordEndIndex));
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
