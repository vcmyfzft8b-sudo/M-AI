/**
 * Non-layered tidy tree placement for nodes of different sizes, in linear time.
 *
 * This is A.J. van der Ploeg's 2013 algorithm ("Drawing Non-layered Tidy Trees in Linear Time"),
 * which is the same one the good tree-layout libraries use — `d3-flextree` is a port of the
 * author's own Java, and `entitree-flex` is another. Neither is worth taking as a dependency
 * here: d3-flextree pins `d3-hierarchy@1` and has not been touched since 2022, entitree-flex
 * carries no licence, and both would still need wrapping for the two-sided root split, the
 * mirroring and the fold state that make this a mind map rather than an org chart. So the
 * algorithm is here and the dependency is not.
 *
 * What it buys over stacking bounding boxes — which is what this did first — is *contours*. A
 * subtree that is deep and narrow no longer reserves the full height of its bounding box against
 * its neighbour; the two are pushed together until their actual outlines touch, so a tall thin
 * branch nests into the gap beside a short wide one. On a real map that is the difference between
 * a level fitting on screen and being folded away.
 *
 * Axes: the paper draws top-down, so its `x` is the sibling axis and its `y` the depth axis. This
 * map grows sideways, so the names below stay the paper's — `position` is along the sibling axis
 * (the caller's y) and `depth`/`thickness` along the depth axis (the caller's x). Keeping the
 * paper's structure makes it checkable against the paper; renaming it would not.
 */

export type TidyNode<T> = {
  value: T;
  /** Extent along the sibling axis, gaps included. */
  size: number;
  /** Extent along the depth axis. */
  thickness: number;
  children: TidyNode<T>[];
};

type Placed<T> = {
  node: TidyNode<T>;
  children: Placed<T>[];
  /** Fixed before the walk: where this node starts along the depth axis. */
  depth: number;
  /** Result: where this node starts along the sibling axis. */
  position: number;
  prelim: number;
  mod: number;
  shift: number;
  change: number;
  /** Threads: the next node along a contour once the real children run out. */
  threadLeft: Placed<T> | null;
  threadRight: Placed<T> | null;
  /** The extreme nodes of this subtree's two contours, and their modifier sums. */
  extremeLeft: Placed<T>;
  extremeRight: Placed<T>;
  modExtremeLeft: number;
  modExtremeRight: number;
};

/** The "index/lowest-Y" list the paper threads through `separate` to spread shifts fairly. */
type LowestList = { low: number; index: number; next: LowestList | null };

function build<T>(node: TidyNode<T>, depth: number, gap: number): Placed<T> {
  const placed = {
    node,
    children: [] as Placed<T>[],
    depth,
    position: 0,
    prelim: 0,
    mod: 0,
    shift: 0,
    change: 0,
    threadLeft: null,
    threadRight: null,
    modExtremeLeft: 0,
    modExtremeRight: 0,
  } as unknown as Placed<T>;

  placed.extremeLeft = placed;
  placed.extremeRight = placed;
  placed.children = node.children.map((child) =>
    build(child, depth + node.thickness + gap, gap),
  );

  return placed;
}

function bottom<T>(node: Placed<T>) {
  return node.depth + node.node.thickness;
}

function nextLeftContour<T>(node: Placed<T>) {
  return node.children.length === 0 ? node.threadLeft : node.children[0];
}

function nextRightContour<T>(node: Placed<T>) {
  return node.children.length === 0
    ? node.threadRight
    : node.children[node.children.length - 1];
}

function setExtremes<T>(node: Placed<T>) {
  if (node.children.length === 0) {
    node.extremeLeft = node;
    node.extremeRight = node;
    node.modExtremeLeft = 0;
    node.modExtremeRight = 0;
    return;
  }

  const first = node.children[0];
  const last = node.children[node.children.length - 1];

  node.extremeLeft = first.extremeLeft;
  node.modExtremeLeft = first.modExtremeLeft;
  node.extremeRight = last.extremeRight;
  node.modExtremeRight = last.modExtremeRight;
}

/**
 * Spreads a shift over the subtrees between the one that caused it and the one that moved, so a
 * child pushed aside by a distant sibling does not leave a visible gap beside its neighbour.
 */
function distributeExtra<T>(node: Placed<T>, index: number, sourceIndex: number, distance: number) {
  if (sourceIndex === index - 1) {
    return;
  }

  const span = index - sourceIndex;

  node.children[sourceIndex + 1].shift += distance / span;
  node.children[index].shift -= distance / span;
  node.children[index].change -= distance - distance / span;
}

function moveSubtree<T>(node: Placed<T>, index: number, sourceIndex: number, distance: number) {
  node.children[index].mod += distance;
  node.children[index].modExtremeLeft += distance;
  node.children[index].modExtremeRight += distance;
  distributeExtra(node, index, sourceIndex, distance);
}

function setLeftThread<T>(node: Placed<T>, index: number, contour: Placed<T>, modSum: number) {
  const first = node.children[0];
  const target = first.extremeLeft;

  target.threadLeft = contour;

  const difference = modSum - contour.mod - first.modExtremeLeft;
  target.mod += difference;
  target.prelim -= difference;
  first.extremeLeft = node.children[index].extremeLeft;
  first.modExtremeLeft = node.children[index].modExtremeLeft;
}

function setRightThread<T>(node: Placed<T>, index: number, contour: Placed<T>, modSum: number) {
  const current = node.children[index];
  const target = current.extremeRight;

  target.threadRight = contour;

  const difference = modSum - contour.mod - current.modExtremeRight;
  target.mod += difference;
  target.prelim -= difference;
  current.extremeRight = node.children[index - 1].extremeRight;
  current.modExtremeRight = node.children[index - 1].modExtremeRight;
}

function updateLowest(low: number, index: number, list: LowestList | null): LowestList {
  let head = list;

  while (head !== null && low >= head.low) {
    head = head.next;
  }

  return { low, index, next: head };
}

/**
 * Walks the right contour of everything to the left against the left contour of the subtree at
 * `index`, pushing the latter right until the two outlines clear each other everywhere they
 * overlap in depth. This is the whole point of the algorithm; everything else is bookkeeping.
 */
function separate<T>(node: Placed<T>, index: number, initialList: LowestList) {
  let list = initialList;
  let left: Placed<T> | null = node.children[index - 1];
  let leftMod = left.mod;
  let right: Placed<T> | null = node.children[index];
  let rightMod = right.mod;

  while (left !== null && right !== null) {
    if (bottom(left) > list.low) {
      list = list.next as LowestList;
    }

    const distance = leftMod + left.prelim + left.node.size - (rightMod + right.prelim);

    if (distance > 0) {
      rightMod += distance;
      moveSubtree(node, index, list.index, distance);
    }

    const leftBottom = bottom(left);
    const rightBottom = bottom(right);

    if (leftBottom <= rightBottom) {
      left = nextRightContour(left);

      if (left !== null) {
        leftMod += left.mod;
      }
    }

    if (leftBottom >= rightBottom) {
      right = nextLeftContour(right);

      if (right !== null) {
        rightMod += right.mod;
      }
    }
  }

  if (left === null && right !== null) {
    setLeftThread(node, index, right, rightMod);
  } else if (left !== null && right === null) {
    setRightThread(node, index, left, leftMod);
  }
}

function positionRoot<T>(node: Placed<T>) {
  const first = node.children[0];
  const last = node.children[node.children.length - 1];

  node.prelim =
    (first.prelim + first.mod + last.mod + last.prelim + last.node.size) / 2 - node.node.size / 2;
}

function firstWalk<T>(node: Placed<T>) {
  if (node.children.length === 0) {
    setExtremes(node);
    return;
  }

  firstWalk(node.children[0]);

  let list = updateLowest(bottom(node.children[0].extremeLeft), 0, null);

  for (let index = 1; index < node.children.length; index += 1) {
    firstWalk(node.children[index]);

    /* Read before `separate` re-points the extremes at the merged contour. */
    const low = bottom(node.children[index].extremeRight);
    separate(node, index, list);
    list = updateLowest(low, index, list);
  }

  positionRoot(node);
  setExtremes(node);
}

function addChildSpacing<T>(node: Placed<T>) {
  let shift = 0;
  let delta = 0;

  for (const child of node.children) {
    shift += child.shift;
    delta += shift + child.change;
    child.mod += delta;
  }
}

function secondWalk<T>(node: Placed<T>, modSum: number) {
  const sum = modSum + node.mod;

  node.position = node.prelim + sum;
  addChildSpacing(node);

  for (const child of node.children) {
    secondWalk(child, sum);
  }
}

export type TidyPlacement<T> = {
  value: T;
  /** Along the depth axis: where this node starts. */
  depth: number;
  /** Along the sibling axis: where this node's slot starts. */
  position: number;
  size: number;
};

/**
 * Places `root` and everything under it, and hands back one entry per node.
 *
 * `depthGap` is the air between a node and its children along the depth axis; sibling-axis air is
 * the caller's business, added into each node's `size`, because a mind map wants different gaps
 * between siblings than between whole branches and only the caller knows which is which.
 */
export function tidyLayout<T>(root: TidyNode<T>, depthGap: number): TidyPlacement<T>[] {
  const placed = build(root, 0, depthGap);

  firstWalk(placed);
  secondWalk(placed, 0);

  const output: TidyPlacement<T>[] = [];
  const collect = (node: Placed<T>) => {
    output.push({
      value: node.node.value,
      depth: node.depth,
      position: node.position,
      size: node.node.size,
    });

    for (const child of node.children) {
      collect(child);
    }
  };

  collect(placed);

  return output;
}
