/**
 * The parts of windowed map-building that are decisions rather than calls.
 *
 * Free of `server-only` so `tests/mindmap-coverage.test.mjs` can assert on them directly: whether
 * a long note's outline survives being reduced to a skeleton, and whether four windows' worth of
 * answers merge into one map or into four, are exactly the questions that decide whether the map
 * covers the material — and neither is worth discovering from a screenshot.
 */

export type MindmapWireChild = {
  label: string;
  detail: string;
  sourceIds?: string[];
  children?: { label: string; detail: string }[];
};

export type MindmapWindowAnswer = {
  branches: { topic: string; children: MindmapWireChild[] }[];
};

/**
 * Drops the facts under an idea that only repeat something already on the map: the idea itself,
 * or a topic that has its own limb. A map earns its space by saying each thing once.
 */
function pruneEchoes(
  child: MindmapWireChild,
  topicKey: string,
  topics: ReadonlyMap<string, unknown>,
): MindmapWireChild["children"] {
  const own = normaliseLabelKey(child.label ?? "");
  const seen = new Map<string, { label: string; detail: string }>();

  for (const leaf of child.children ?? []) {
    const key = normaliseLabelKey(leaf?.label ?? "");
    if (!key || (!leaf.detail && (key === own || key === topicKey || topics.has(key)))) continue;
    const existing = seen.get(key);
    if (existing) {
      if (leaf.detail && !existing.detail.includes(leaf.detail)) {
        existing.detail = [existing.detail, leaf.detail].filter(Boolean).join(" ");
      }
    } else {
      seen.set(key, { ...leaf });
    }
  }
  return [...seen.values()];
}

export function normaliseLabelKey(label: string) {
  return label
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

/**
 * Folds every window's contribution into the one agreed topic list.
 *
 * Ordered by the plan rather than by which window answered first, so the map reads in the note's
 * own order however the windows came back. Deduplicated by label because two windows describing
 * the same idea from either side of a page break is the normal case, not the exception.
 */
export function mergeWindowedBranches(params: {
  topics: { label: string; brief: string }[];
  windows: readonly (MindmapWindowAnswer | null)[];
}) {
  /*
   * Keyed on the normalised label throughout, and the topic list deduplicated against it first.
   * Nothing stops a plan naming the same topic twice, and keyed on the raw label that put both
   * of them on the same array — two identical branches, drawn side by side with the same subtree
   * under each.
   */
  const topics: { key: string; label: string; brief: string }[] = [];
  const byTopic = new Map<string, MindmapWireChild[]>();

  for (const topic of params.topics) {
    const key = normaliseLabelKey(topic.label);

    if (!key || byTopic.has(key)) {
      continue;
    }

    byTopic.set(key, []);
    topics.push({ key, label: topic.label, brief: topic.brief });
  }

  const seen = new Map<string, MindmapWireChild>();

  for (const window of params.windows) {
    for (const branch of window?.branches ?? []) {
      /* A model that reworded a topic label still meant that topic. */
      const topicKey = normaliseLabelKey(branch.topic ?? "");
      const bucket = byTopic.get(topicKey);

      if (!bucket) {
        continue;
      }

      for (const child of branch.children ?? []) {
        const childKey = normaliseLabelKey(child?.label ?? "");
        const key = `${topicKey}::${childKey}`;

        if (!childKey) {
          continue;
        }

        const existing = seen.get(key);
        if (existing) {
          existing.sourceIds = [...new Set([...(existing.sourceIds ?? []), ...(child.sourceIds ?? [])])];
          const additionalDetails = existing.detail && child.detail && child.detail !== existing.detail
            ? [{ label: child.detail, detail: child.detail }]
            : [];
          if (!existing.detail) existing.detail = child.detail;
          existing.children = pruneEchoes({
            ...existing,
            children: [...(existing.children ?? []), ...(child.children ?? []), ...additionalDetails],
          }, topicKey, byTopic);
          continue;
        }

        /*
         * An idea that restates a topic is that topic, written twice. A real map came back with
         * "Informacija" and "Znanje" both as their own limbs *and* as leaves under a third
         * topic's "overview of concepts" — which tells a reader nothing they cannot see by
         * looking at the middle of the map, and costs two nodes to say it.
         */
        if (byTopic.has(childKey) && !child.detail && !child.children?.length) {
          continue;
        }

        const merged = { ...child, children: pruneEchoes(child, topicKey, byTopic) };
        seen.set(key, merged);
        bucket.push(merged);
      }
    }
  }

  return topics
    .map((topic) => ({
      label: topic.label,
      detail: topic.brief,
      children: byTopic.get(topic.key) ?? [],
    }))
    /* The generation coverage check repairs missing topics before accepting the result. */
    .filter((branch) => branch.children.length > 0);
}
