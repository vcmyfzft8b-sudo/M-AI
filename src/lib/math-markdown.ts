export function isLikelyMathExpression(value: string) {
  const trimmed = value.trim();

  return (
    trimmed.length > 0 &&
    !trimmed.includes("\n") &&
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

export function normalizeFormulaSyntax(value: string) {
  return replaceTopLevelFormulaFractions(
    normalizeMathFunctions(normalizeLatexEnvironment(value))
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

function normalizeMarkdownMathLine(line: string) {
  return line
    .replace(/\$\$([\s\S]+?)\$\$/g, (_match, rawMath: string) =>
      `$$${normalizeFormulaSyntax(rawMath)}$$`,
    )
    .replace(/\\\(([\s\S]+?)\\\)/g, (_match, rawMath: string) =>
      `\\(${normalizeFormulaSyntax(rawMath)}\\)`,
    )
    .replace(/\\\[([\s\S]+?)\\\]/g, (_match, rawMath: string) =>
      `$$${normalizeFormulaSyntax(rawMath)}$$`,
    )
    .replace(/(?<!\\)(?<!\$)\$([^\n$]+?)(?<!\\)\$(?!\$)/g, (match, rawMath: string) => {
      if (!isLikelyMathExpression(rawMath)) {
        return match;
      }

      return `\\(${normalizeFormulaSyntax(rawMath)}\\)`;
    });
}

function getDisplayMathBlockStart(line: string) {
  const dollarMatch = /^(\s*)\$\$\s*(.*)$/.exec(line);

  if (dollarMatch && !hasInlineClosingDelimiter(line.trim(), "$$")) {
    return {
      indent: dollarMatch[1] ?? "",
      close: "$$" as const,
      firstContent: dollarMatch[2] ?? "",
    };
  }

  const bracketMatch = /^(\s*)\\\[\s*(.*)$/.exec(line);

  if (bracketMatch && !hasInlineClosingDelimiter(line.trim(), "\\]")) {
    return {
      indent: bracketMatch[1] ?? "",
      close: "\\]" as const,
      firstContent: bracketMatch[2] ?? "",
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

function isStandaloneFormulaLine(line: string) {
  const trimmed = line.trim();

  if (
    trimmed.length < 3 ||
    /^[#>\-*\d.)\s]/.test(trimmed) ||
    /[.!?][\])}"']?$/.test(trimmed) ||
    /\s(?:je|is|are|was|were|and|or|in|on|for|with|kjer|kar|kot)\s/i.test(` ${trimmed} `)
  ) {
    return false;
  }

  return (
    isLikelyMathExpression(trimmed) &&
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

      normalizedLines.push(
        `${displayBlock.indent}$$${normalizeFormulaSyntax(contentLines.join(" "))}$$`,
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
