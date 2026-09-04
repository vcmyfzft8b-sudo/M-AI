/**
 * The parts of windowed map-building that are decisions rather than calls.
 *
 * Free of `server-only` so `tests/mindmap-coverage.test.mjs` can assert on them directly: whether
 * a long note's outline survives being reduced to a skeleton, and whether four windows' worth of
 * answers merge into one map or into four, are exactly the questions that decide whether the map
 * covers the material — and neither is worth discovering from a screenshot.
 */

/**
 * Ideas per topic once every window has contributed.
 *
 * A ceiling rather than a target, and a generous one: it is here so a topic every window wanted
 * to fill cannot run away with the map, not to trim a topic that genuinely has this much in it.
 * The screen copes with the size by folding and focusing, which is cheaper than dropping material
 * the reader came here to find.
 */
export const MINDMAP_MAX_CHILDREN_PER_TOPIC = 10;

export type MindmapWireChild = {
  label: string;
  detail: string;
  children?: { label: string; detail: string }[];
};

export type MindmapWindowAnswer = {
  branches: { topic: string; children: MindmapWireChild[] }[];
};

/**
 * The note reduced to its own outline: every heading, and the first line of prose under each.
 *
 * This is what the topic phase reads, and the reason it can be trusted with a note of any length
 * — a 120,000-character note has perhaps eighty headings, so the skeleton is a couple of thousand
 * characters whatever the body does.
 */
export function buildNoteSkeleton(notes: string) {
  const lines = notes.split("\n");
  const output: string[] = [];
  let wantsLead = false;

  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);

    if (heading) {
      output.push(`${heading[1]} ${heading[2]}`);
      wantsLead = true;
      continue;
    }

    if (!wantsLead || line.length === 0) {
      continue;
    }

    /* Tables, quotes and fences say nothing about what a section is about. */
    if (/^[|>`:-]/.test(line)) {
      continue;
    }

    output.push(line.slice(0, 240));
    wantsLead = false;
  }

  return output.join("\n");
}

function normaliseLabelKey(label: string) {
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

  const seen = new Set<string>();

  for (const window of params.windows) {
    for (const branch of window?.branches ?? []) {
      /* A model that reworded a topic label still meant that topic. */
      const topicKey = normaliseLabelKey(branch.topic ?? "");
      const bucket = byTopic.get(topicKey);

      if (!bucket) {
        continue;
      }

      for (const child of branch.children ?? []) {
        const key = `${topicKey}::${normaliseLabelKey(child?.label ?? "")}`;

        if (!child?.label || seen.has(key) || bucket.length >= MINDMAP_MAX_CHILDREN_PER_TOPIC) {
          continue;
        }

        seen.add(key);
        bucket.push(child);
      }
    }
  }

  return topics
    .map((topic) => ({
      label: topic.label,
      detail: topic.brief,
      children: byTopic.get(topic.key) ?? [],
    }))
    /* A topic no window said anything about was a topic the note did not have. */
    .filter((branch) => branch.children.length > 0);
}

