"use client";

import type { MindmapDoc } from "@/lib/mindmap-doc";

/**
 * The demo's mind map, read off the demo note's own markdown.
 *
 * The real one is written by a model that has read the note; there is no model here and no
 * network, so this does the honest mechanical version instead — headings become topics and
 * bullets become ideas. It is not what production generates, but it is drawn from the same note
 * the visitor is looking at, so nothing on the demo screen is a lie about what the map contains.
 *
 * Anything else — a hand-written map per demo pack — would drift the moment a pack's note was
 * edited, and drift silently, on the one screen that has no signed-in user to notice.
 */

/**
 * Headings that are the note template rather than the material. Their bullets belong to the topic
 * above them; kept as a level of their own they would give every branch of every demo map the
 * same three grey children.
 */
const SCAFFOLD_HEADINGS = ["glavna ideja", "podrobni zapiski", "main idea", "detailed notes"];

const MAX_BRANCHES = 9;
const MAX_CHILDREN = 6;
const MAX_LEAVES = 4;

type DraftNode = { label: string; detail: string; children: DraftNode[] };

/** Markdown stripped back to the words: no bold, no links, no code ticks, no trailing colon. */
function plain(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\[(.+?)\]\(.*?\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[:.]$/, "");
}

/** Strips the "3. 🔁 " a demo heading carries, leaving the topic itself. */
function headingLabel(text: string) {
  return plain(text)
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*\s*/u, "")
    .trim();
}

/**
 * A bullet split into what it is called and what it says.
 *
 * "**Substituti:** dobrini, ki se nadomeščata" is already written that way, so the bold part is
 * the label. A bullet with no such lead is cut at its first natural break instead, which is what
 * keeps a node a phrase rather than a paragraph nobody can read at map scale.
 */
function splitBullet(raw: string): DraftNode {
  const bold = raw.match(/^\s*\*\*(.+?):?\*\*:?\s*(.*)$/);

  if (bold) {
    return { label: plain(bold[1]), detail: plain(bold[2]), children: [] };
  }

  const text = plain(raw);
  const colon = text.indexOf(": ");

  if (colon > 2 && colon < 48) {
    return { label: text.slice(0, colon), detail: text.slice(colon + 2), children: [] };
  }

  const words = text.split(" ");

  return words.length <= 7
    ? { label: text, detail: "", children: [] }
    : { label: words.slice(0, 6).join(" "), detail: text, children: [] };
}

export function buildDemoMindmap(params: { notesMd: string; title: string }): MindmapDoc | null {
  const branches: DraftNode[] = [];
  let branch: DraftNode | null = null;
  /** The `###` section currently open, or null while bullets belong straight to the topic. */
  let section: DraftNode | null = null;

  for (const line of params.notesMd.split("\n")) {
    const heading2 = line.match(/^##\s+(?!#)(.+)$/);
    const heading3 = line.match(/^###\s+(.+)$/);
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);

    if (heading2) {
      const label = headingLabel(heading2[1]);
      branch = label ? { label, detail: "", children: [] } : null;
      section = null;

      if (branch && branches.length < MAX_BRANCHES) {
        branches.push(branch);
      }

      continue;
    }

    if (heading3) {
      const label = headingLabel(heading3[1]);
      section =
        label && !SCAFFOLD_HEADINGS.includes(label.toLowerCase())
          ? { label, detail: "", children: [] }
          : null;

      if (branch && section && branch.children.length < MAX_CHILDREN) {
        branch.children.push(section);
      }

      continue;
    }

    if (!bullet || !branch) {
      continue;
    }

    const node = splitBullet(bullet[1]);

    if (!node.label) {
      continue;
    }

    if (section) {
      if (section.children.length < MAX_LEAVES) {
        section.children.push(node);
      }

      continue;
    }

    if (branch.children.length < MAX_CHILDREN) {
      branch.children.push(node);
    }
  }

  /* A topic with nothing under it is a heading, not a branch of a map. */
  const usable = branches.filter((entry) => entry.children.length > 0);

  if (usable.length < 2) {
    return null;
  }

  return {
    version: 1,
    title: params.title,
    language: "sl",
    branches: usable.map((entry, branchIndex) => withIds(entry, [branchIndex + 1])),
  };
}

/** The same positional ids the real parser assigns, so folding behaves identically here. */
function withIds(node: DraftNode, path: number[]): MindmapDoc["branches"][number] {
  return {
    id: `n${path.join(".")}`,
    label: node.label,
    detail: node.detail || null,
    children: node.children.map((child, index) => withIds(child, [...path, index + 1])),
  };
}
