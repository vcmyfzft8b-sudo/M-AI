/**
 * Where every node of a mindmap sits, worked out from the tree alone.
 *
 * Pure and free of the DOM on purpose. The canvas renders from this, the PNG export draws from
 * the same result, and tests/mindmap-layout.test.mjs asserts on it directly — three consumers
 * that would otherwise each have their own idea of where a node is. Text measurement is injected
 * rather than reached for, so the browser can hand in a real font measurement and a test can hand
 * in a predictable one.
 *
 * The shape is the classic two-sided mindmap: the title in the middle, branches split left and
 * right so a map of ten topics is a page rather than the single tall column the competition
 * draws. Within a side it is a tidy tree — a subtree is as tall as it needs to be and a parent
 * sits centred on its children — which is what stops labels ever overlapping.
 */

import type { MindmapDoc, MindmapNode } from "@/lib/mindmap-doc";

export type MindmapSide = "left" | "right";

export type MindmapLayoutNode = {
  id: string;
  label: string;
  detail: string | null;
  /** 0 for the title, 1 for a branch, and so on. */
  depth: number;
  side: MindmapSide;
  /** Index of the top-level branch this node hangs off, which decides its colour. */
  branchIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The label, already wrapped to the node's width. */
  lines: string[];
  parentId: string | null;
  childCount: number;
  /** True when this node has children that the reader has folded away. */
  collapsed: boolean;
};

export type MindmapLayoutLink = {
  id: string;
  fromId: string;
  toId: string;
  branchIndex: number;
  depth: number;
  path: string;
};

export type MindmapLayout = {
  nodes: MindmapLayoutNode[];
  links: MindmapLayoutLink[];
  bounds: { x: number; y: number; width: number; height: number };
};

/** Measures a single line of text at a given depth's font. Injected; see the module comment. */
export type MindmapMeasure = (text: string, depth: number) => number;

type DepthStyle = {
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  maxTextWidth: number;
  minWidth: number;
  paddingX: number;
  paddingY: number;
  radius: number;
  maxLines: number;
};

/**
 * Type scale down the depths. The root is a title, a branch is a heading, and a leaf is a fact —
 * each one step smaller and lighter, which is what lets a reader see the level of a node without
 * tracing its line back to the middle.
 */
export const MINDMAP_DEPTH_STYLES: readonly DepthStyle[] = [
  {
    fontSize: 19,
    fontWeight: 800,
    lineHeight: 25,
    maxTextWidth: 240,
    minWidth: 132,
    paddingX: 22,
    paddingY: 16,
    radius: 20,
    maxLines: 3,
  },
  {
    fontSize: 15.5,
    fontWeight: 700,
    lineHeight: 21,
    maxTextWidth: 208,
    minWidth: 84,
    paddingX: 16,
    paddingY: 11,
    radius: 15,
    maxLines: 3,
  },
  {
    fontSize: 13.5,
    fontWeight: 600,
    lineHeight: 19,
    maxTextWidth: 196,
    minWidth: 72,
    paddingX: 13,
    paddingY: 9,
    radius: 12,
    maxLines: 4,
  },
  {
    fontSize: 12.5,
    fontWeight: 500,
    lineHeight: 18,
    maxTextWidth: 186,
    minWidth: 64,
    paddingX: 12,
    paddingY: 8,
    radius: 11,
    maxLines: 4,
  },
];

export function mindmapDepthStyle(depth: number): DepthStyle {
  return MINDMAP_DEPTH_STYLES[Math.min(depth, MINDMAP_DEPTH_STYLES.length - 1)];
}

/**
 * One accent per top-level branch, cycled when there are more branches than colours.
 *
 * Hex rather than the stylesheet's `oklch`, because these are also handed to a 2D canvas during
 * the PNG export and `fillStyle` there is not the same parser as CSS.
 */
export const MINDMAP_BRANCH_COLORS = [
  "#f45f5a",
  "#f59e0b",
  "#22c55e",
  "#0ea5e9",
  "#8294da",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
] as const;

export function mindmapBranchColor(branchIndex: number) {
  const palette = MINDMAP_BRANCH_COLORS;

  return palette[((branchIndex % palette.length) + palette.length) % palette.length];
}

/**
 * How far the map may be scaled, and the air left around it when it is framed. These live beside
 * the layout rather than in the canvas because the opening-fold heuristic below has to ask the
 * same question the viewport will — "at what zoom does this end up?" — and two copies of the
 * answer would let the map open folded for a frame that would have fitted it anyway.
 */
export const MINDMAP_MIN_ZOOM = 0.18;
export const MINDMAP_MAX_ZOOM = 2.6;
/** A map that fits easily is framed at roughly 1:1 rather than blown up to fill the frame. */
export const MINDMAP_MAX_FIT_ZOOM = 1.15;
export const MINDMAP_FIT_PADDING = 36;

export function clampMindmapZoom(value: number) {
  return Math.min(MINDMAP_MAX_ZOOM, Math.max(MINDMAP_MIN_ZOOM, value));
}

/** The view that frames `bounds` inside a frame of `size`, centred. */
export function fitMindmapView(
  bounds: MindmapLayout["bounds"],
  size: { width: number; height: number },
) {
  if (size.width < 2 || size.height < 2 || bounds.width < 1 || bounds.height < 1) {
    return { x: 0, y: 0, k: 1 };
  }

  const k = clampMindmapZoom(
    Math.min(
      (size.width - MINDMAP_FIT_PADDING * 2) / bounds.width,
      (size.height - MINDMAP_FIT_PADDING * 2) / bounds.height,
      MINDMAP_MAX_FIT_ZOOM,
    ),
  );

  return {
    k,
    x: size.width / 2 - (bounds.x + bounds.width / 2) * k,
    y: size.height / 2 - (bounds.y + bounds.height / 2) * k,
  };
}

/** Horizontal air between a node and its children. Widens near the middle so the map breathes. */
const COLUMN_GAP = 44;
const ROOT_GAP = 58;
/** Vertical air between siblings, and the extra a whole subtree gets from the next one. */
const SIBLING_GAP = 14;
const SUBTREE_GAP = 22;

function wrapLabel(params: {
  label: string;
  depth: number;
  measure: MindmapMeasure;
}): { lines: string[]; textWidth: number } {
  const style = mindmapDepthStyle(params.depth);
  const words = params.label.split(" ").filter(Boolean);

  if (words.length === 0) {
    return { lines: [""], textWidth: 0 };
  }

  /* One line whenever it fits: a two-word label broken in half reads as two nodes. */
  const single = params.measure(params.label, params.depth);

  if (single <= style.maxTextWidth) {
    return { lines: [params.label], textWidth: single };
  }

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;

    if (params.measure(candidate, params.depth) <= style.maxTextWidth || !current) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current) {
    lines.push(current);
  }

  /*
   * A label that still will not fit is cut rather than allowed to grow the node past its
   * column — the full text is a click away in the detail card, and a node three times the
   * height of its siblings wrecks the tidy layout for everything around it.
   */
  if (lines.length > style.maxLines) {
    const kept = lines.slice(0, style.maxLines);
    kept[kept.length - 1] = `${kept[kept.length - 1].replace(/[\s,;:.–-]+$/, "")}…`;
    lines.length = 0;
    lines.push(...kept);
  }

  const textWidth = lines.reduce(
    (widest, line) => Math.max(widest, params.measure(line, params.depth)),
    0,
  );

  return { lines, textWidth: Math.min(textWidth, style.maxTextWidth) };
}

type SizedNode = {
  source: MindmapNode;
  depth: number;
  branchIndex: number;
  parentId: string | null;
  width: number;
  height: number;
  lines: string[];
  children: SizedNode[];
  collapsed: boolean;
  /** How tall this node and everything under it needs to be. */
  extent: number;
  x: number;
  y: number;
};

function sizeNode(params: {
  node: MindmapNode;
  depth: number;
  branchIndex: number;
  parentId: string | null;
  collapsedIds: ReadonlySet<string>;
  measure: MindmapMeasure;
}): SizedNode {
  const style = mindmapDepthStyle(params.depth);
  const { lines, textWidth } = wrapLabel({
    label: params.node.label,
    depth: params.depth,
    measure: params.measure,
  });
  const collapsed = params.collapsedIds.has(params.node.id) && params.node.children.length > 0;
  const children = collapsed
    ? []
    : params.node.children.map((child) =>
        sizeNode({
          node: child,
          depth: params.depth + 1,
          branchIndex: params.branchIndex,
          parentId: params.node.id,
          collapsedIds: params.collapsedIds,
          measure: params.measure,
        }),
      );

  const height = Math.round(lines.length * style.lineHeight + style.paddingY * 2);
  /*
   * The fold badge is drawn outside the node, sitting on the stub of the link it is hiding, so
   * it takes no width here. Reserving room for it inside would make a node jump wider the moment
   * it was folded — the one moment the reader is looking straight at it.
   */
  const width = Math.round(Math.max(style.minWidth, textWidth + style.paddingX * 2));

  const childExtent = children.reduce(
    (total, child, index) => total + child.extent + (index > 0 ? SIBLING_GAP : 0),
    0,
  );

  return {
    source: params.node,
    depth: params.depth,
    branchIndex: params.branchIndex,
    parentId: params.parentId,
    width,
    height,
    lines,
    children,
    collapsed,
    extent: Math.max(height, childExtent),
    x: 0,
    y: 0,
  };
}

/** Places a subtree in right-facing coordinates: `x` is its left edge, `top` its first pixel. */
function placeNode(node: SizedNode, x: number, top: number) {
  node.x = x;

  if (node.children.length === 0) {
    node.y = top + (node.extent - node.height) / 2;
    return;
  }

  const childExtent = node.children.reduce(
    (total, child, index) => total + child.extent + (index > 0 ? SIBLING_GAP : 0),
    0,
  );
  const childX = x + node.width + COLUMN_GAP;
  let childTop = top + (node.extent - childExtent) / 2;

  for (const child of node.children) {
    placeNode(child, childX, childTop);
    childTop += child.extent + SIBLING_GAP;
  }

  /*
   * Centred between the first and last child rather than on the middle of their block. With
   * uneven subtrees the two differ, and the eye follows the outermost lines: a parent level with
   * the middle of a lopsided block looks attached to the wrong child.
   */
  const first = node.children[0];
  const last = node.children[node.children.length - 1];
  const centre = (first.y + first.height / 2 + (last.y + last.height / 2)) / 2;

  node.y = Math.min(
    Math.max(centre - node.height / 2, top),
    top + node.extent - node.height,
  );
}

/** Mirrors a placed subtree about x = 0, turning a right-facing side into a left-facing one. */
function mirrorNode(node: SizedNode) {
  node.x = -(node.x + node.width);

  for (const child of node.children) {
    mirrorNode(child);
  }
}

function linkPath(params: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}) {
  const dx = params.toX - params.fromX;
  /*
   * A curve that leaves and arrives horizontally, so a line meets its node square rather than
   * at an angle. Two-thirds of the run is the flattest control offset that still reads as one
   * continuous stroke when a child sits far above or below its parent.
   */
  const control = Math.abs(dx) * 0.62;
  const c1 = params.fromX + Math.sign(dx || 1) * control;
  const c2 = params.toX - Math.sign(dx || 1) * control;

  return `M ${round(params.fromX)} ${round(params.fromY)} C ${round(c1)} ${round(
    params.fromY,
  )}, ${round(c2)} ${round(params.toY)}, ${round(params.toX)} ${round(params.toY)}`;
}

function round(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Splits the branches between the two sides, keeping the sides the same height rather than
 * the same count. Ten branches where one carries half the map are not five and five.
 */
function splitBranches(branches: readonly SizedNode[]) {
  const right: SizedNode[] = [];
  const left: SizedNode[] = [];
  let rightExtent = 0;
  let leftExtent = 0;

  for (const branch of branches) {
    if (rightExtent <= leftExtent) {
      right.push(branch);
      rightExtent += branch.extent + SUBTREE_GAP;
    } else {
      left.push(branch);
      leftExtent += branch.extent + SUBTREE_GAP;
    }
  }

  return { left, right };
}

function collectNodes(
  node: SizedNode,
  side: MindmapSide,
  output: MindmapLayoutNode[],
) {
  output.push({
    id: node.source.id,
    label: node.source.label,
    detail: node.source.detail,
    depth: node.depth,
    side,
    branchIndex: node.branchIndex,
    x: round(node.x),
    y: round(node.y),
    width: node.width,
    height: node.height,
    lines: node.lines,
    parentId: node.parentId,
    childCount: node.source.children.length,
    collapsed: node.collapsed,
  });

  for (const child of node.children) {
    collectNodes(child, side, output);
  }
}

function collectLinks(node: SizedNode, side: MindmapSide, output: MindmapLayoutLink[]) {
  const fromX = side === "right" ? node.x + node.width : node.x;

  for (const child of node.children) {
    output.push({
      id: `${node.source.id}->${child.source.id}`,
      fromId: node.source.id,
      toId: child.source.id,
      branchIndex: node.branchIndex,
      depth: child.depth,
      path: linkPath({
        fromX,
        fromY: node.y + node.height / 2,
        toX: side === "right" ? child.x : child.x + child.width,
        toY: child.y + child.height / 2,
      }),
    });

    collectLinks(child, side, output);
  }
}

export function layoutMindmap(params: {
  doc: MindmapDoc;
  /** Ids whose children are folded away. */
  collapsedIds?: ReadonlySet<string>;
  measure: MindmapMeasure;
  /** Falls back to the doc's own title; empty means the root is drawn as a dot-less hub. */
  title?: string;
}): MindmapLayout {
  const collapsedIds = params.collapsedIds ?? new Set<string>();
  const rootLabel = (params.title ?? params.doc.title ?? "").trim() || params.doc.title;
  const rootStyle = mindmapDepthStyle(0);
  const rootWrap = wrapLabel({ label: rootLabel, depth: 0, measure: params.measure });
  const rootWidth = Math.round(
    Math.max(rootStyle.minWidth, rootWrap.textWidth + rootStyle.paddingX * 2),
  );
  const rootHeight = Math.round(
    rootWrap.lines.length * rootStyle.lineHeight + rootStyle.paddingY * 2,
  );

  const branches = params.doc.branches.map((branch, index) =>
    sizeNode({
      node: branch,
      depth: 1,
      branchIndex: index,
      parentId: "__root__",
      collapsedIds,
      measure: params.measure,
    }),
  );

  const { left, right } = splitBranches(branches);

  const placeSide = (side: readonly SizedNode[], mirrored: boolean) => {
    const extent = side.reduce(
      (total, branch, index) => total + branch.extent + (index > 0 ? SUBTREE_GAP : 0),
      0,
    );
    let top = -extent / 2;

    for (const branch of side) {
      placeNode(branch, rootWidth / 2 + ROOT_GAP, top);
      top += branch.extent + SUBTREE_GAP;
    }

    if (mirrored) {
      for (const branch of side) {
        mirrorNode(branch);
      }
    }
  };

  placeSide(right, false);
  placeSide(left, true);

  /*
   * Neither side is re-centred against the other on purpose. Both are already centred on y = 0,
   * and nudging the root off the sides' shared centre line to balance their mass is exactly what
   * makes a map look tilted; framing is the viewport's job, not the layout's.
   */

  const nodes: MindmapLayoutNode[] = [
    {
      id: "__root__",
      label: rootLabel,
      detail: null,
      depth: 0,
      side: "right",
      branchIndex: -1,
      x: round(-rootWidth / 2),
      y: round(-rootHeight / 2),
      width: rootWidth,
      height: rootHeight,
      lines: rootWrap.lines,
      parentId: null,
      childCount: params.doc.branches.length,
      collapsed: false,
    },
  ];
  const links: MindmapLayoutLink[] = [];

  for (const [side, group] of [
    ["right", right],
    ["left", left],
  ] as const) {
    for (const branch of group) {
      links.push({
        id: `__root__->${branch.source.id}`,
        fromId: "__root__",
        toId: branch.source.id,
        branchIndex: branch.branchIndex,
        depth: 1,
        path: linkPath({
          fromX: side === "right" ? rootWidth / 2 : -rootWidth / 2,
          fromY: 0,
          toX: side === "right" ? branch.x : branch.x + branch.width,
          toY: branch.y + branch.height / 2,
        }),
      });

      collectNodes(branch, side, nodes);
      collectLinks(branch, side, links);
    }
  }

  const minX = Math.min(...nodes.map((node) => node.x));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));

  return {
    nodes,
    links,
    bounds: {
      x: round(minX),
      y: round(minY),
      width: round(maxX - minX),
      height: round(maxY - minY),
    },
  };
}

/**
 * A measurement good enough to lay out with before a font has loaded, and the one tests use.
 *
 * Per-character averages taken from Inter at each depth's weight: wide enough that a real
 * measurement almost always comes in narrower, so the first paint is never too small for its
 * text — which would be visible, where a little extra padding is not.
 */
export function approximateMindmapMeasure(text: string, depth: number) {
  const style = mindmapDepthStyle(depth);
  let width = 0;

  for (const character of text) {
    if (character === " ") {
      width += 0.29;
    } else if (/[iljItf.,;:'!|]/.test(character)) {
      width += 0.31;
    } else if (/[mwMW—–]/.test(character)) {
      width += 0.87;
    } else if (/[A-ZČŠŽĐĆ0-9]/.test(character)) {
      width += 0.63;
    } else {
      width += 0.545;
    }
  }

  return width * style.fontSize;
}

/**
 * The frames the opening fold is judged against: the note panel on a laptop, and the stage on a
 * phone. They differ by more than a factor of two, so judging a phone against the laptop's frame
 * opens every map on a phone at a quarter scale — which is the whole failure this exists to
 * avoid, reproduced on the device where it hurts most.
 */
export const MINDMAP_REFERENCE_FRAMES = {
  /* Measured on a 1440x900 laptop with the chat column stood down: 799 x 564. */
  desktop: { width: 800, height: 560 },
  /* Measured on a 375x812 phone: 336 x 556. */
  phone: { width: 336, height: 556 },
} as const;
/**
 * Below this, a depth-3 label is under nine pixels tall and the map is decoration.
 *
 * This is the number that separates this implementation from the one it was asked to beat. A map
 * that opens showing everything at 40% has technically drawn the note and practically shown the
 * reader nothing — and it is the state the competing product leaves you in, with only a zoom
 * button for company.
 */
const READABLE_ZOOM = 0.72;
/**
 * The floor for the middle state — topics and their ideas, with only the leaves folded away.
 *
 * It is deliberately lower than READABLE_ZOOM. Falling all the way back to six topic boxes is a
 * table of contents, not a map, and it is the right opening view only for a map that would be
 * unusable at any other. Between the two, the middle state wins even when it is a little tight:
 * a reader can see it and zoom, where they cannot see what is not drawn.
 */
const USEFUL_ZOOM = 0.5;

/**
 * Which branches a map should open with folded, so that what it opens on can actually be read.
 *
 * Everything, when everything fits. Otherwise the leaves go first — the level whose absence costs
 * the least, since a folded node keeps its count badge and unfolds on a tap — and only if that is
 * still not enough does it fall back to the topics alone. The reader is never shown a map they
 * have to zoom into before they can tell what it says.
 */
export function suggestMindmapFold(
  doc: MindmapDoc,
  options?: { frame?: { width: number; height: number }; measure?: MindmapMeasure },
): Set<string> {
  const measure = options?.measure ?? approximateMindmapMeasure;
  const frame = options?.frame ?? MINDMAP_REFERENCE_FRAMES.desktop;
  const zoomOf = (collapsedIds: Set<string>) =>
    fitMindmapView(layoutMindmap({ doc, collapsedIds, measure }).bounds, frame).k;

  const nothing = new Set<string>();

  if (zoomOf(nothing) >= READABLE_ZOOM) {
    return nothing;
  }

  const withoutLeaves = new Set<string>();
  const collectParentsOfLeaves = (nodes: readonly MindmapNode[], depth: number) => {
    for (const node of nodes) {
      if (depth >= 2 && node.children.length > 0) {
        withoutLeaves.add(node.id);
      }

      collectParentsOfLeaves(node.children, depth + 1);
    }
  };

  collectParentsOfLeaves(doc.branches, 1);

  if (withoutLeaves.size > 0 && zoomOf(withoutLeaves) >= USEFUL_ZOOM) {
    return withoutLeaves;
  }

  const topicsOnly = new Set(
    doc.branches.filter((branch) => branch.children.length > 0).map((branch) => branch.id),
  );

  return topicsOnly.size > 0 ? topicsOnly : withoutLeaves;
}
