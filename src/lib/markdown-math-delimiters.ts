// Kept free of "server-only" and JSX so the math-delimiter contract stays unit-testable
// (tests/markdown-math-rendering.test.mjs) outside the Next.js runtime.

/**
 * The note pipeline's inline math delimiter is \(...\), which remark-math does not parse —
 * markdown escape processing eats the backslash and the formula silently renders as plain text.
 * Rewriting to in-line $$...$$ makes remark-math parse it as inline math, while $$ blocks on
 * their own lines remain display math. Single-dollar math stays disabled in the renderers, so
 * real prices ("$30", "prej $150") can never pair up and swallow half a table as LaTeX.
 */
const INLINE_PAREN_MATH_PATTERN = /\\\(([\s\S]+?)\\\)/g;

export function normalizeMathDelimiters(content: string) {
  // Fenced code blocks must keep their bytes; split on fences and only rewrite outside them.
  return content
    .split(/(```[\s\S]*?```)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(INLINE_PAREN_MATH_PATTERN, (_match, math: string) => `$$${math}$$`),
    )
    .join("");
}
