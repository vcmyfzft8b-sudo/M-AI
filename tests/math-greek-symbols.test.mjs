import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { normalizeMarkdownMath } from "../src/lib/math-markdown.ts";
import { normalizeMathDelimiters } from "../src/lib/markdown-math-delimiters.ts";
import { normalizeGeneratedNoteMarkdown } from "../src/lib/notes/note-prompts.ts";

test("the PDF circuit-note regression retains the ohm symbol through storage and rendering", () => {
  const note = String.raw`Measured in **ohms (\(\Omega\))**.`;
  const stored = normalizeGeneratedNoteMarkdown(note);
  assert.equal(stored, note);
  const html = renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [[remarkMath, { singleDollarTextMath: false }]],
    rehypePlugins: [rehypeKatex],
  }, normalizeMathDelimiters(stored)));
  assert.match(html, /class="katex"/);
  assert.ok(html.includes("Ω"), html);
});

test("capital and variant Greek commands keep their spelling and math delimiters", () => {
  for (const command of ["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega", "phi", "psi", "xi", "nu", "eta", "zeta", "varepsilon", "vartheta", "varkappa", "varpi", "varrho", "varsigma", "varphi"]) {
    const inline = `Symbol \\(\\${command}\\).`;
    assert.equal(normalizeMarkdownMath(inline), inline, command);
    const display = `$$\\${command}$$`;
    assert.equal(normalizeMarkdownMath(display), display, command);
  }
});

test("Greek prose, currency and fenced command examples stay unchanged", () => {
  for (const text of ["Omega is a Greek letter.", "The prices are $30 and $50.", "```latex\n\\(\\Omega\\)\n```"]) {
    assert.equal(normalizeMarkdownMath(text), text);
  }
});
