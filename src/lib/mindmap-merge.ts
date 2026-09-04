/**
 * The parts of windowed map-building that are decisions rather than calls.
 *
 * Free of `server-only` so `tests/mindmap-coverage.test.mjs` can assert on them directly: whether
 * a long note's outline survives being reduced to a skeleton, and whether four windows' worth of
 * answers merge into one map or into four, are exactly the questions that decide whether the map
 * covers the material — and neither is worth discovering from a screenshot.
 */

/** Ideas per topic once every window has contributed. Beyond this a branch is a list, not a limb. */
export const MINDMAP_MAX_CHILDREN_PER_TOPIC = 8;

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
  const byTopic = new Map<string, MindmapWireChild[]>();
  const topicKeys = new Map<string, string>();

  for (const topic of params.topics) {
    byTopic.set(topic.label, []);
    topicKeys.set(normaliseLabelKey(topic.label), topic.label);
  }

  const seen = new Set<string>();

  for (const window of params.windows) {
    for (const branch of window?.branches ?? []) {
      /* A model that reworded a topic label still meant that topic. */
      const label = topicKeys.get(normaliseLabelKey(branch.topic ?? ""));
      const bucket = label ? byTopic.get(label) : undefined;

      if (!bucket) {
        continue;
      }

      for (const child of branch.children ?? []) {
        const key = `${label}::${normaliseLabelKey(child?.label ?? "")}`;

        if (!child?.label || seen.has(key) || bucket.length >= MINDMAP_MAX_CHILDREN_PER_TOPIC) {
          continue;
        }

        seen.add(key);
        bucket.push(child);
      }
    }
  }

  return params.topics
    .map((topic) => ({
      label: topic.label,
      detail: topic.brief,
      children: byTopic.get(topic.label) ?? [],
    }))
    /* A topic no window said anything about was a topic the note did not have. */
    .filter((branch) => branch.children.length > 0);
}

