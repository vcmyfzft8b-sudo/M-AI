/**
 * The mindmap a note can be read as, and the only shape the client and the server agree on.
 *
 * Deliberately free of `server-only` and of every Next import: the same parser runs in the
 * generator (validating what a model wrote), in the API route (reading a stored row) and in the
 * browser (before laying anything out), so a tree that reaches the canvas has passed the same
 * checks wherever it came from.
 */

export const MINDMAP_DOC_VERSION = 1;

/** Depth the generator writes and the canvas draws: root, branch, child, leaf. */
export const MINDMAP_MAX_DEPTH = 3;

/*
 * Caps, applied in code rather than on the wire schema. Structured output rejects a schema whose
 * string bounds multiply out across nested arrays ("too many states"), so the model is asked for
 * short labels in words and held to them here.
 */
export const MINDMAP_LABEL_MAX_LENGTH = 90;
export const MINDMAP_DETAIL_MAX_LENGTH = 320;
export const MINDMAP_TITLE_MAX_LENGTH = 120;
/**
 * Beyond this a map stops being a map and becomes the note again, drawn sideways.
 *
 * Raised from 260 with windowed generation: a long note now reaches the map whole, and the old
 * ceiling would have thrown away the last of it after all the work of reading it. The screen
 * copes because a big map opens folded, not because it is small.
 */
export const MINDMAP_MAX_NODES = 520;
/**
 * A label is a handle, not a sentence. Past this the words that will not fit are not dropped —
 * they become the node's detail, where the reader can still get at them.
 */
export const MINDMAP_LABEL_MAX_WORDS = 8;

export type MindmapNode = {
  id: string;
  label: string;
  /** One sentence saying what the label means. Shown when the node is selected, never inline. */
  detail: string | null;
  children: MindmapNode[];
};

export type MindmapDoc = {
  version: typeof MINDMAP_DOC_VERSION;
  /** The centre of the map. The note's own title unless the model found a better one. */
  title: string;
  /** The language the map is written in, as the generator read it off the note. */
  language: string;
  branches: MindmapNode[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Collapses the whitespace a model's line breaks leave behind and clamps to a cap. */
export function tidyMindmapText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  const collapsed = value.replace(/\s+/g, " ").trim();

  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  /* Cut on a word boundary when there is one near the end, so a clamp does not split a word. */
  const hard = collapsed.slice(0, maxLength - 1);
  const lastSpace = hard.lastIndexOf(" ");

  return `${(lastSpace > maxLength * 0.6 ? hard.slice(0, lastSpace) : hard).trimEnd()}…`;
}

/**
 * Cuts a label back to a handful of words, on a natural break where there is one.
 *
 * The prompt asks for phrases and mostly gets them; this is for the run that comes back with a
 * sentence. Cutting here rather than in the layout matters because the layout's own cut is by
 * pixels — it would clip a label to fit a box, where this keeps whole words and hands the rest
 * to the detail card.
 */
function shortenLabel(label: string) {
  const words = label.split(" ");

  if (words.length <= MINDMAP_LABEL_MAX_WORDS) {
    return label;
  }

  const kept = words.slice(0, MINDMAP_LABEL_MAX_WORDS).join(" ");
  const clause = kept.search(/[,;:–—]/);

  return (clause > 8 ? kept.slice(0, clause) : kept).replace(/[\s,;:.–—-]+$/, "");
}

/**
 * Node ids are positional (`b2.1.3`) rather than random.
 *
 * Which matters more than it looks: the canvas remembers which branches the reader collapsed and
 * which node they selected across a re-render, and a map re-parsed from the same row has to hand
 * back the same ids or every one of those memories points at nothing.
 */
function buildNodeId(path: readonly number[]) {
  return `n${path.join(".")}`;
}

function parseNode(value: unknown, path: number[], budget: { remaining: number }): MindmapNode | null {
  if (budget.remaining <= 0) {
    return null;
  }

  const record = asRecord(value);
  const label = tidyMindmapText(record.label, MINDMAP_LABEL_MAX_LENGTH);

  if (!label) {
    return null;
  }

  budget.remaining -= 1;

  const shortened = shortenLabel(label);
  const detail = tidyMindmapText(
    /* An over-long label keeps its full text as the detail rather than losing its tail. */
    shortened === label ? record.detail : record.detail || label,
    MINDMAP_DETAIL_MAX_LENGTH,
  );
  const rawChildren = path.length >= MINDMAP_MAX_DEPTH || !Array.isArray(record.children)
    ? []
    : record.children;
  const children: MindmapNode[] = [];

  for (const child of rawChildren) {
    const parsed = parseNode(child, [...path, children.length + 1], budget);

    if (parsed) {
      children.push(parsed);
    }
  }

  return {
    id: buildNodeId(path),
    label: shortened,
    detail: detail || null,
    children,
  };
}

/**
 * A stored or freshly generated tree, or null when there is nothing worth drawing.
 *
 * Null rather than an empty map is the point: a map with no branches is a blank canvas with
 * zoom controls, and the screen has a real empty state to show instead.
 */
export function parseMindmapDoc(value: unknown): MindmapDoc | null {
  const record = asRecord(value);
  const rawBranches = Array.isArray(record.branches) ? record.branches : [];
  const budget = { remaining: MINDMAP_MAX_NODES };
  const branches: MindmapNode[] = [];

  for (const branch of rawBranches) {
    const parsed = parseNode(branch, [branches.length + 1], budget);

    if (parsed) {
      branches.push(parsed);
    }
  }

  if (branches.length === 0) {
    return null;
  }

  const title = tidyMindmapText(record.title, MINDMAP_TITLE_MAX_LENGTH);
  const language = tidyMindmapText(record.language, 8).toLowerCase();

  return {
    version: MINDMAP_DOC_VERSION,
    title: title || "",
    language: language || "",
    branches,
  };
}

/**
 * Which top-level branch a node belongs to, read straight off its id.
 *
 * The ids are positional (`n3.1.2` is the second child of the first child of the third branch),
 * so the branch — and therefore the colour the whole subtree is drawn in — is the first segment.
 * Reading it beats walking the tree, and beats prefix-matching the id, which quietly puts every
 * node of branch 11 into branch 1.
 */
export function mindmapBranchIndexOf(nodeId: string): number {
  const first = Number.parseInt(nodeId.replace(/^n/, "").split(".")[0] ?? "", 10);

  return Number.isFinite(first) && first > 0 ? first - 1 : 0;
}

export function countMindmapNodes(doc: MindmapDoc): number {
  const count = (nodes: readonly MindmapNode[]): number =>
    nodes.reduce((total, node) => total + 1 + count(node.children), 0);

  return count(doc.branches);
}

export function mindmapDepth(doc: MindmapDoc): number {
  const depth = (nodes: readonly MindmapNode[]): number =>
    nodes.reduce((deepest, node) => Math.max(deepest, 1 + depth(node.children)), 0);

  return depth(doc.branches);
}

/** Every node in reading order, flattened — what search and keyboard navigation walk. */
export function flattenMindmap(doc: MindmapDoc): MindmapNode[] {
  const output: MindmapNode[] = [];
  const walk = (nodes: readonly MindmapNode[]) => {
    for (const node of nodes) {
      output.push(node);
      walk(node.children);
    }
  };

  walk(doc.branches);

  return output;
}

/**
 * The ids from the root down to `nodeId`, that node last, or an empty array when it is not in
 * this map. Search uses it to open whatever the match is hiding behind.
 */
export function mindmapPathTo(doc: MindmapDoc, nodeId: string): string[] {
  const walk = (nodes: readonly MindmapNode[], trail: string[]): string[] | null => {
    for (const node of nodes) {
      const here = [...trail, node.id];

      if (node.id === nodeId) {
        return here;
      }

      const found = walk(node.children, here);

      if (found) {
        return found;
      }
    }

    return null;
  };

  return walk(doc.branches, []) ?? [];
}

/**
 * The map re-rooted on one node: that node becomes the centre and its children the branches.
 *
 * What makes a big map navigable rather than merely foldable. Folding takes things away; this
 * takes you *in*, and the ids are untouched by it — a node keeps the same positional id whether
 * it is being drawn as a leaf of the whole map or as a branch of a focused one, so a fold, a
 * selection and a search survive the trip in and back out.
 *
 * Null for a node with nothing under it: there is no map to be had of a leaf.
 */
export function focusMindmapOn(doc: MindmapDoc, nodeId: string): MindmapDoc | null {
  const node = flattenMindmap(doc).find((entry) => entry.id === nodeId);

  if (!node || node.children.length === 0) {
    return null;
  }

  return {
    version: MINDMAP_DOC_VERSION,
    title: node.label,
    language: doc.language,
    branches: node.children,
  };
}

/** The labels from the whole map's centre down to `nodeId`, for the trail above a focused map. */
export function mindmapTrail(doc: MindmapDoc, nodeId: string): { id: string; label: string }[] {
  const byId = new Map(flattenMindmap(doc).map((entry) => [entry.id, entry]));

  return mindmapPathTo(doc, nodeId).flatMap((id) => {
    const node = byId.get(id);

    return node ? [{ id, label: node.label }] : [];
  });
}
