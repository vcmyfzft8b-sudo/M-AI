"use client";

import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { normalizeMathDelimiters } from "@/lib/markdown-math-delimiters";

/**
 * A chat answer, rendered as the structure it was written in.
 *
 * The tutor has always been allowed to answer with a list — "name the seven
 * layers", "give me three exam questions" — and the panel printed the markdown
 * it wrote: literal hyphens down the left margin, asterisks around the term it
 * meant to emphasise, and paragraphs run together because `white-space:
 * pre-wrap` on one `<p>` is not the same thing as paragraphs.
 *
 * Not `MarkdownRenderer`: that one dresses a note in the legacy Tailwind layer
 * (`text-stone-700`), which is a fixed colour in a bubble that has to work on
 * two backgrounds in two themes. The plugin set is deliberately identical to
 * it, though — a learner asking a maths question in the chat gets the same
 * formulas they would read in the note, and the same `$30`-is-not-maths
 * protection.
 *
 * Everything about how it looks lives in `.memo-prose` (redesign.css), so the
 * two chats share one answer style and neither carries CSS of its own.
 */
export function ChatMarkdown({
  content,
  /**
   * While an answer streams, the caret is drawn after the last thing rendered
   * (see `.memo-prose.is-streaming`). It is CSS rather than an element because
   * markdown ends in a block: a sibling `<span>` after a `<p>` is a new line,
   * which makes the caret jump to the left margin on every token.
   */
  streaming = false,
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className={`memo-prose${streaming ? " is-streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        // A formula KaTeX cannot parse renders as its source rather than in red:
        // half-written maths is normal here, because this renders mid-stream.
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", errorColor: "inherit" }]]}
        components={{
          /*
           * A link in a chat answer is a model's suggestion, not ours. It opens
           * away from the app and carries no referrer or ranking signal.
           * react-markdown already refuses javascript: and data: hrefs.
           *
           * The two attributes are named rather than spread: react-markdown also
           * hands a component its own AST node, and React warns about that as an
           * unknown prop the moment it reaches a DOM element.
           */
          a: ({ children, href, title }) => (
            <a href={href} title={title} target="_blank" rel="noreferrer nofollow">
              {children}
            </a>
          ),
        }}
      >
        {normalizeMathDelimiters(content)}
      </ReactMarkdown>
    </div>
  );
}
