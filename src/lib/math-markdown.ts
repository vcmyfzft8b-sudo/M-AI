function repairDroppedLatexCommandBackslashes(value: string) {
  return value
    .replace(/\f\s*rac\s*\{/gi, "\\frac{")
    .replace(/\t\s*ext\s*\{/gi, "\\text{")
    .replace(/\t\s*imes\b/gi, "\\times")
    .replace(/\t\s*heta\b/gi, "\\theta")
    .replace(/\r\s*ho\b/gi, "\\rho")
    .replace(/\u0008\s*eta\b/gi, "\\beta")
    .replace(/(?<![\\A-Za-z])(?:dfrac|tfrac|frac)\s*\{/gi, (match) => {
      const command = match.match(/[A-Za-z]+/)?.[0] ?? "frac";

      return `\\${command.toLowerCase()}{`;
    })
    .replace(/(?<![\\A-Za-z])rac\s*\{/gi, "\\frac{")
    .replace(/(?<![\\A-Za-z])(?:text|ext)\s*\{/gi, "\\text{")
    .replace(/(?<![\\A-Za-z])sqrt\s*\{/gi, "\\sqrt{")
    .replace(/(?<![\\A-Za-z])imes\b/gi, "\\times")
    .replace(
      /(?<![\\A-Za-z])(?:times|cdot|le|leq|ge|geq|ne|neq|approx|infty|pm|mp|sum|prod|int)\b/gi,
      (match) => `\\${match.toLowerCase() === "neq" ? "ne" : match.toLowerCase()}`,
    );
}

export function isLikelyMathExpression(value: string) {
  const trimmed = repairDroppedLatexCommandBackslashes(value).trim();

  return (
    trimmed.length > 0 &&
    !/^\d+(?:[.,]\d+)?\s*(?:€|eur|usd|gbp|\$)?$/i.test(trimmed) &&
    (/^[A-Za-z](?:_\{[^{}]+\}|_[A-Za-z0-9]+)?$/.test(trimmed) ||
      /\b(?:alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|omega)\b/i.test(
        trimmed,
      ) ||
      /[=^_\\{}≤≥≠≈∞∑∫√]|(?:->|<-|=>|<=|>=|!=)|[A-Za-z0-9]\s*[+\-*/]\s*[A-Za-z0-9]|[A-Za-z]\s*\([^)]*\)|[A-Z][a-z]\b|[A-Z]\d\b/.test(
        trimmed,
      ))
  );
}

function findMatchingOpeningBrace(value: string, closeIndex: number) {
  let depth = 0;

  for (let index = closeIndex; index >= 0; index -= 1) {
    if (value[index] === "}") {
      depth += 1;
    } else if (value[index] === "{") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findMatchingClosingBrace(value: string, openIndex: number) {
  let depth = 0;

  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === "{") {
      depth += 1;
    } else if (value[index] === "}") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function isTopLevelFormulaSlash(value: string, slashIndex: number) {
  let depth = 0;

  for (let index = 0; index < slashIndex; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }

    if (value[index] === "{") {
      depth += 1;
    } else if (value[index] === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth === 0;
}

function findLeftFormulaOperandStart(value: string, slashIndex: number) {
  let endIndex = slashIndex - 1;

  while (endIndex >= 0 && /\s/.test(value[endIndex] ?? "")) {
    endIndex -= 1;
  }

  if (endIndex < 0) {
    return null;
  }

  if (value[endIndex] === "}") {
    const braceStart = findMatchingOpeningBrace(value, endIndex);

    if (braceStart < 0) {
      return null;
    }

    let startIndex = braceStart;

    if (value[startIndex - 1] === "_") {
      startIndex -= 1;
    }

    if (/[A-Za-z0-9)]/.test(value[startIndex - 1] ?? "")) {
      startIndex -= 1;
    }

    return startIndex;
  }

  let startIndex = endIndex;

  while (startIndex > 0 && /[A-Za-z0-9_.\\]/.test(value[startIndex - 1] ?? "")) {
    startIndex -= 1;
  }

  return startIndex;
}

function findRightFormulaOperandEnd(value: string, slashIndex: number) {
  let startIndex = slashIndex + 1;

  while (startIndex < value.length && /\s/.test(value[startIndex] ?? "")) {
    startIndex += 1;
  }

  if (startIndex >= value.length) {
    return null;
  }

  let endIndex = startIndex;

  while (endIndex < value.length && /[A-Za-z0-9_.\\]/.test(value[endIndex] ?? "")) {
    endIndex += 1;
  }

  if (value[endIndex] === "{" && value[endIndex - 1] === "_") {
    const braceEnd = findMatchingClosingBrace(value, endIndex);

    if (braceEnd >= 0) {
      endIndex = braceEnd + 1;
    }
  }

  return endIndex > startIndex ? endIndex : null;
}

function replaceTopLevelFormulaFractions(value: string) {
  let output = value;
  let cursor = 0;

  while (cursor < output.length) {
    const slashIndex = output.indexOf("/", cursor);

    if (slashIndex === -1) {
      break;
    }

    if (!isTopLevelFormulaSlash(output, slashIndex)) {
      cursor = slashIndex + 1;
      continue;
    }

    const leftStart = findLeftFormulaOperandStart(output, slashIndex);
    const rightEnd = findRightFormulaOperandEnd(output, slashIndex);

    if (leftStart == null || rightEnd == null) {
      cursor = slashIndex + 1;
      continue;
    }

    const left = output.slice(leftStart, slashIndex).trim();
    const right = output.slice(slashIndex + 1, rightEnd).trim();

    if (!left || !right) {
      cursor = slashIndex + 1;
      continue;
    }

    const replacement = `\\frac{${left}}{${right}}`;
    output = `${output.slice(0, leftStart)}${replacement}${output.slice(rightEnd)}`;
    cursor = leftStart + replacement.length;
  }

  return output;
}

function normalizeLatexEnvironment(value: string) {
  const trimmed = value.trim();
  const match = /^\\begin\{([A-Za-z*]+)\}([\s\S]*)\\end\{\1\}$/.exec(trimmed);

  if (!match) {
    return trimmed;
  }

  const envName = match[1];
  const body = (match[2] ?? "").replace(/\\label\{[^{}]*\}/g, "").trim();
  const normalizedEnvName = envName.replace(/\*$/, "");

  if (normalizedEnvName === "equation") {
    return body;
  }

  if (normalizedEnvName === "align" || normalizedEnvName === "aligned") {
    return `\\begin{aligned}${body}\\end{aligned}`;
  }

  if (normalizedEnvName === "gather" || normalizedEnvName === "gathered") {
    return `\\begin{gathered}${body}\\end{gathered}`;
  }

  if (normalizedEnvName === "multline") {
    return `\\begin{aligned}${body}\\end{aligned}`;
  }

  return trimmed;
}

function normalizeMathFunctions(value: string) {
  return value
    .replace(/(?<!\\)\bsqrt\s*\(([^()]+)\)/gi, "\\sqrt{$1}")
    .replace(/(?<!\\)√\s*\(([^()]+)\)/g, "\\sqrt{$1}")
    .replace(/(?<!\\)√\s*([A-Za-z0-9_{}]+)/g, "\\sqrt{$1}")
    .replace(
      /(?<!\\)\b(arcsin|arccos|arctan|sin|cos|tan|log|ln|lim|min|max|exp)\b/g,
      "\\$1",
    )
    .replace(
      /(?<!\\)\b(alpha|beta|gamma|delta|epsilon|varepsilon|zeta|eta|theta|vartheta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|varphi|chi|psi|omega)\b/g,
      "\\$1",
    );
}

function hasMarkdownOrSentenceSyntax(value: string) {
  return (
    /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(value) ||
    /(?:\*\*|__|\[[^\]]+\]\(|#{1,6}\s)/.test(value)
  );
}

function getMathSignalCount(value: string) {
  return (
    value.match(
      /[=<>≤≥≠≈+\-*/^_{}∑∫√]|\\(?:begin|frac|dfrac|tfrac|sqrt|text|sum|prod|int|lim|sin|cos|tan|log|ln|exp|min|max|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|rho|sigma|tau|omega|le|ge|ne|approx|infty|pm|mp|cdot|times)\b/g,
    ) ?? []
  ).length;
}

function stripLatexTextCommands(value: string) {
  return value.replace(/\\text\{[^{}]*\}/g, "");
}

function getLongWordCount(value: string) {
  return (value.match(/\p{L}{3,}/gu) ?? []).length;
}

function containsProseKeyword(value: string) {
  return /\b(?:and|are|because|for|from|into|that|the|then|this|where|which|with|formula|value|values|period|change|uses|velja|formula|kjer|kar|kot|med|skozi|glede|količine|kolicine|cene|ceno|uporablja|ustreza|vprašanju|vprasanju|sprememba|vrednost|obdobju)\b/i.test(
    value,
  );
}

function shouldRenderMathExpression(value: string) {
  const repaired = repairDroppedLatexCommandBackslashes(value).trim();

  if (!repaired) {
    return false;
  }

  if (hasMarkdownOrSentenceSyntax(repaired)) {
    return false;
  }

  if (!isLikelyMathExpression(repaired)) {
    return false;
  }

  const withoutText = stripLatexTextCommands(repaired);
  const mathSignalCount = getMathSignalCount(withoutText);
  const longWordCount = getLongWordCount(withoutText.replace(/\\[A-Za-z]+/g, ""));

  if (mathSignalCount === 0) {
    return false;
  }

  if (mathSignalCount <= 1 && longWordCount >= 3) {
    return false;
  }

  if (containsProseKeyword(withoutText) && !/[=<>≤≥≠≈]/.test(withoutText)) {
    return false;
  }

  return true;
}

function normalizeDelimitedMath(
  rawMath: string,
  wrap: (normalizedMath: string) => string,
  fallback?: string,
) {
  if (!shouldRenderMathExpression(rawMath)) {
    return fallback ?? cleanUnwrappedMathText(rawMath);
  }

  return wrap(normalizeFormulaSyntax(rawMath));
}

function cleanUnwrappedMathText(value: string) {
  return value
    .trim()
    .replace(/^[.,;:!?)]\s*/, "")
    .replace(/\s+-\s+(\*\*)/g, "\n- $1");
}

export function normalizeFormulaSyntax(value: string) {
  return replaceTopLevelFormulaFractions(
    normalizeMathFunctions(
      repairDroppedLatexCommandBackslashes(normalizeLatexEnvironment(value)),
    )
      .trim()
      .replace(/[−–—]/g, "-")
      .replace(/≤/g, "\\le ")
      .replace(/≥/g, "\\ge ")
      .replace(/≠/g, "\\ne ")
      .replace(/≈/g, "\\approx ")
      .replace(/∞/g, "\\infty ")
      .replace(/±/g, "\\pm ")
      .replace(/∓/g, "\\mp ")
      .replace(/∑/g, "\\sum ")
      .replace(/∫/g, "\\int ")
      .replace(/↔|⇔|<=>/g, "\\leftrightarrow ")
      .replace(/→|⇒|=>|->/g, "\\to ")
      .replace(/←|<-|⇐/g, "\\leftarrow ")
      .replace(/(?<![<\\])<=/g, "\\le ")
      .replace(/(?<![>\\])>=/g, "\\ge ")
      .replace(/!=/g, "\\ne ")
      .replace(/×|·/g, "\\cdot ")
      .replace(/(?<!\\)\bper\b/g, "/")
      .replace(/(?<!\\)%/g, "\\%")
      .replace(/\b([A-Z])\{([^{}]+)\}/g, "$1_{$2}")
      .replace(/\b([A-Z])([a-z])\b/g, "$1_{$2}")
      .replace(/\b([A-Z])(\d+)\b/g, "$1_{$2}"),
  )
    .replace(/(\})\s+(100(?:\\%)?)/g, "$1 \\cdot $2")
    .replace(/\s+/g, " ")
    .trim();
}

function hasInlineClosingDelimiter(value: string, delimiter: "$$" | "\\]") {
  const startIndex = delimiter === "$$" ? 2 : 2;

  return value.indexOf(delimiter, startIndex) >= 0;
}

function repairUnbalancedDisplayMathLine(line: string) {
  const delimiterMatches = [...line.matchAll(/\$\$/g)];

  if (delimiterMatches.length !== 1) {
    return line;
  }

  const delimiterIndex = delimiterMatches[0].index ?? -1;

  if (delimiterIndex < 0) {
    return line;
  }

  const before = line.slice(0, delimiterIndex);
  const after = line.slice(delimiterIndex + 2);
  const trimmedBefore = before.trim();
  const trimmedAfter = after.trim();

  if (!trimmedBefore && trimmedAfter) {
    return normalizeDelimitedMath(
      trimmedAfter,
      (math) => `$$${math}$$`,
      cleanUnwrappedMathText(after),
    );
  }

  if (trimmedBefore && !trimmedAfter) {
    return normalizeDelimitedMath(trimmedBefore, (math) => `$$${math}$$`, before);
  }

  if (trimmedBefore && trimmedAfter) {
    const normalizedBefore = normalizeDelimitedMath(
      trimmedBefore,
      (math) => `$$${math}$$`,
      before,
    );

    return `${normalizedBefore}${after}`;
  }

  return `${before}${after}`;
}

function normalizeMarkdownMathLine(line: string) {
  return repairUnbalancedDisplayMathLine(line)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, rawMath: string) =>
      normalizeDelimitedMath(rawMath, (math) => `$$${math}$$`),
    )
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, rawMath: string) =>
      normalizeDelimitedMath(rawMath, (math) => `\\(${math}\\)`),
    )
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, rawMath: string) =>
      normalizeDelimitedMath(rawMath, (math) => `$$${math}$$`),
    )
    .replace(/(?<!\\)(?<!\$)\$([^\n$]+?)(?<!\\)\$(?!\$)/g, (match, rawMath: string) => {
      if (!shouldRenderMathExpression(rawMath)) {
        return match;
      }

      return `\\(${normalizeFormulaSyntax(rawMath)}\\)`;
    });
}

function getDisplayMathBlockStart(line: string) {
  const dollarMatch = /^(\s*)\$\$\s*(.*)$/.exec(line);

  if (dollarMatch && !hasInlineClosingDelimiter(line.trim(), "$$")) {
    const firstContent = dollarMatch[2] ?? "";

    if (firstContent.trim() && !shouldRenderMathExpression(firstContent)) {
      return null;
    }

    return {
      indent: dollarMatch[1] ?? "",
      close: "$$" as const,
      firstContent,
    };
  }

  const bracketMatch = /^(\s*)\\\[\s*(.*)$/.exec(line);

  if (bracketMatch && !hasInlineClosingDelimiter(line.trim(), "\\]")) {
    const firstContent = bracketMatch[2] ?? "";

    if (firstContent.trim() && !shouldRenderMathExpression(firstContent)) {
      return null;
    }

    return {
      indent: bracketMatch[1] ?? "",
      close: "\\]" as const,
      firstContent,
    };
  }

  return null;
}

function getLatexEnvironmentStart(line: string) {
  const match = /^(\s*)\\begin\{([A-Za-z*]+)\}([\s\S]*)$/.exec(line);

  if (!match) {
    return null;
  }

  const envName = match[2];
  const normalizedEnvName = envName.replace(/\*$/, "");
  const supportedBlockEnvironments = new Set([
    "equation",
    "align",
    "aligned",
    "gather",
    "gathered",
    "multline",
    "cases",
    "matrix",
    "pmatrix",
    "bmatrix",
    "vmatrix",
    "Vmatrix",
  ]);

  if (!supportedBlockEnvironments.has(normalizedEnvName)) {
    return null;
  }

  return {
    indent: match[1] ?? "",
    envName,
  };
}

/// A GitHub-flavoured markdown table row or its `|---|---|` separator.
///
/// These must never be promoted to display math: a data row often contains a
/// slash (a date range like `1848/1850`, a ratio, a unit), which reads as a
/// fraction, and wrapping the row in `$$…$$` destroys the whole table — the
/// remaining rows lose their alignment row and degrade to loose paragraphs.
function isMarkdownTableLine(value: string) {
  return value.startsWith("|") || /^[\s:|-]+$/.test(value);
}

function isStandaloneFormulaLine(line: string) {
  const trimmed = line.trim();

  if (
    trimmed.length < 3 ||
    /(?:\$\$|\\\(|\\\[|(?<!\\)\$)/.test(trimmed) ||
    /^[#>\-*\d.)\s]/.test(trimmed) ||
    isMarkdownTableLine(trimmed) ||
    /[.!?][\])}"']?$/.test(trimmed) ||
    /\s(?:je|is|are|was|were|and|or|in|on|for|with|kjer|kar|kot)\s/i.test(` ${trimmed} `)
  ) {
    return false;
  }

  return (
    shouldRenderMathExpression(trimmed) &&
    /[=<>≤≥≠≈+\-*/^_\\]|(?:->|<-|=>|<=|>=|!=)/.test(trimmed)
  );
}

export function normalizeMarkdownMath(markdown: string) {
  let inCodeBlock = false;
  const lines = markdown.split("\n");
  const normalizedLines: string[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];

    if (/^\s*```/.test(line)) {
      inCodeBlock = !inCodeBlock;
      normalizedLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      normalizedLines.push(line);
      continue;
    }

    const displayBlock = getDisplayMathBlockStart(line);

    if (displayBlock) {
      const contentLines = [displayBlock.firstContent];

      while (lineIndex + 1 < lines.length) {
        lineIndex += 1;
        const nextLine = lines[lineIndex];
        const closeIndex = nextLine.indexOf(displayBlock.close);

        if (closeIndex >= 0) {
          contentLines.push(nextLine.slice(0, closeIndex));
          break;
        }

        contentLines.push(nextLine);
      }

      const content = contentLines.join(" ");

      normalizedLines.push(
        `${displayBlock.indent}${normalizeDelimitedMath(content, (math) => `$$${math}$$`)}`,
      );
      continue;
    }

    const environmentBlock = getLatexEnvironmentStart(line);

    if (environmentBlock && !line.includes(`\\end{${environmentBlock.envName}}`)) {
      const contentLines = [line.trim()];
      const close = `\\end{${environmentBlock.envName}}`;

      while (lineIndex + 1 < lines.length) {
        lineIndex += 1;
        const nextLine = lines[lineIndex];
        contentLines.push(nextLine.trim());

        if (nextLine.includes(close)) {
          break;
        }
      }

      normalizedLines.push(
        `${environmentBlock.indent}$$${normalizeFormulaSyntax(contentLines.join(" "))}$$`,
      );
      continue;
    }

    const normalizedLine = normalizeMarkdownMathLine(line);

    normalizedLines.push(
      isStandaloneFormulaLine(normalizedLine)
        ? `$$${normalizeFormulaSyntax(normalizedLine)}$$`
        : normalizedLine,
    );
  }

  return normalizedLines.join("\n");
}
