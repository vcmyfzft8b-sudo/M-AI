"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { normalizeMathDelimiters } from "@/lib/markdown-math-delimiters";

/**
 * Two realities of generated study notes drive this configuration:
 *
 * - Sources are full of real prices ("$30", "prej $150"). With single-dollar math on, remark-math
 *   pairs two currency amounts in a paragraph or table row and renders everything between them
 *   as LaTeX — the classic exploded-table bug. Single-dollar math is therefore off; the note
 *   pipeline's contract is that real math arrives delimited, never as bare $...$.
 *
 * - The pipeline's inline delimiter is \(...\), which remark-math does not parse — markdown
 *   escape processing eats the backslash and the formula silently renders as plain text.
 *   Inline \(...\) is rewritten to $$...$$ here: remark-math parses in-line $$ pairs as inline
 *   math, while $$ blocks on their own lines stay display math, so both forms render correctly.
 */
export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="markdown text-sm text-stone-700 sm:text-[15px]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        // A formula KaTeX cannot parse renders as its source in the surrounding colour — an
        // imperfect formula reads as text, it does not scream in red at a learner mid-revision.
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "inherit" }]]}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}
