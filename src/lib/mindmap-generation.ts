import { isWorkAbortedError } from "./abort-context.ts";
import { mergeWindowedBranches, normaliseLabelKey, type MindmapWindowAnswer } from "./mindmap-merge.ts";
import { countMindmapNodes, parseMindmapDoc } from "./mindmap-doc.ts";

export type MindmapSourceSection = { id: string; heading: string; material: string };
export type MindmapPlannedTopic = { label: string; brief: string; sourceIds: string[] };
export type MindmapPlan = { title: string; language: string; topics: MindmapPlannedTopic[] };

/** Every heading and every part of headingless prose reaches both planning and filling. */
export function buildMindmapSourceSections(notes: string, maxWords = 900): MindmapSourceSection[] {
  if (!Number.isInteger(maxWords) || maxWords < 1) throw new Error("Source section size must be a positive integer.");
  const sections: MindmapSourceSection[] = [];
  let heading = "";
  const headingPath: string[] = [];
  let lines: string[] = [];
  const flush = () => {
    const material = lines.join("\n").trim();
    lines = [];
    if (!material) return;
    // Bound even a single paragraph or table; the old paragraph windows had no hard bound.
    const words = material.match(/\S+\s*/g) ?? [];
    for (let start = 0; start < words.length; start += maxWords) {
      sections.push({
        id: `s${sections.length + 1}`,
        heading,
        material: words.slice(start, start + maxWords).join("").trim(),
      });
    }
  };
  for (const line of notes.split("\n")) {
    const match = /^\s*(#{1,6})\s+(.+)/.exec(line);
    if (match) {
      if (lines.some((entry) => entry.trim() && !/^\s*#{1,6}\s/.test(entry))) flush();
      headingPath.length = match[1].length - 1;
      headingPath.push(match[2]);
      heading = headingPath.filter(Boolean).join(" > ");
    }
    lines.push(line);
  }
  flush();
  return sections;
}

/** One global overview, including table/bullet-only sections and the end of unheaded prose. */
export function mindmapPlanningSections(sections: MindmapSourceSection[]) {
  const short = sections.reduce((sum, section) => sum + section.material.length, 0) <= 32_000;
  return sections.map((section) => ({
    id: section.id,
    heading: section.heading,
    material: short || section.material.length <= 800
      ? section.material
      : `${section.material.slice(0, 400)}\n[…]\n${section.material.slice(-400)}`,
  }));
}

export function mindmapPlanIssues(plan: MindmapPlan, sections: MindmapSourceSection[]): string[] {
  const known = new Set(sections.map((section) => section.id));
  const covered = new Set<string>();
  const labels = new Set<string>();
  const issues: string[] = [];
  for (const topic of plan.topics) {
    const key = normaliseLabelKey(topic.label);
    if (!key || labels.has(key)) issues.push(`Duplicate or blank topic: ${topic.label}`);
    labels.add(key);
    if (!topic.sourceIds.length) issues.push(`No source for topic: ${topic.label}`);
    for (const id of topic.sourceIds) {
      if (!known.has(id)) issues.push(`Unknown source: ${id}`);
      covered.add(id);
    }
  }
  for (const id of known) {
    if (!covered.has(id)) issues.push(`Unassigned source section: ${id}`);
  }
  // A broad note must have more than an introductory branch. Short single-concept notes
  // can still have one; do not pad them with invented topics to meet an arbitrary quota.
  const wordCount = sections.reduce((sum, section) => sum + section.material.split(/\s+/).length, 0);
  if (wordCount >= 300 && labels.size < 2) issues.push("Split the material's main concepts into distinct topics; one branch is insufficient for this note.");
  return issues;
}

export function mindmapFillIssues(
  topics: MindmapPlannedTopic[],
  sections: MindmapSourceSection[],
  answer: MindmapWindowAnswer,
): string[] {
  const issues: string[] = [];
  const known = new Set(sections.map((section) => section.id));
  const branches = mergeWindowedBranches({ topics, windows: [answer] });
  for (const topic of topics) {
    const branch = branches.find((entry) => normaliseLabelKey(entry.label) === normaliseLabelKey(topic.label));
    const covered = new Set(branch?.children.flatMap((child) => child.sourceIds ?? []) ?? []);
    for (const id of topic.sourceIds.filter((id) => known.has(id))) {
      if (!covered.has(id)) issues.push(`Missing ideas for topic "${topic.label}" from source ${id}`);
    }
  }
  for (const branch of answer.branches) {
    if (!topics.some((topic) => normaliseLabelKey(topic.label) === normaliseLabelKey(branch.topic))) {
      issues.push(`Unknown topic: ${branch.topic}. Copy a supplied topic label.`);
    }
    for (const child of branch.children) {
      if (!child.sourceIds?.length || child.sourceIds.some((id) => !known.has(id))) {
        issues.push(`Invalid source references for idea: ${child.label}`);
      }
    }
  }
  return issues;
}

/** A bounded repair, shared by planning and filling. An incomplete answer is never success. */
export async function withMindmapCoverageRepair<T>(
  generate: (feedback: string[]) => Promise<T>,
  inspect: (answer: T) => string[],
): Promise<T> {
  let feedback: string[] = [];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const answer = await generate(feedback);
      feedback = inspect(answer);
      if (!feedback.length) return answer;
    } catch (error) {
      if (isWorkAbortedError(error)) throw error;
      if (attempt === 1) throw error;
      feedback = ["The previous attempt failed. Return the complete requested content."];
    }
  }
  throw new Error(`Mindmap coverage is incomplete: ${feedback.slice(0, 5).join("; ")}`);
}

/** Fill small source windows against ONE validated global topic plan, four calls at a time. */
export async function fillMindmapSections(params: {
  plan: MindmapPlan;
  sections: MindmapSourceSection[];
  fill: (topics: MindmapPlannedTopic[], sections: MindmapSourceSection[], feedback: string[], index: number) => Promise<MindmapWindowAnswer>;
}) {
  // Give each topic its own output budget. Only a long topic is split across calls, all
  // using the same plan. A broad lecture cannot spend the whole response on its first topic.
  const windows: { topics: MindmapPlannedTopic[]; sections: MindmapSourceSection[] }[] = [];
  for (const topic of params.plan.topics) {
    let window: MindmapSourceSection[] = [];
    let words = 0;
    const assigned = new Set(topic.sourceIds);
    for (const section of params.sections.filter((section) => assigned.has(section.id))) {
      const size = section.material.split(/\s+/).length;
      if (window.length && words + size > 1_800) {
        windows.push({ topics: [topic], sections: window });
        window = [];
        words = 0;
      }
      window.push(section);
      words += size;
    }
    if (window.length) windows.push({ topics: [topic], sections: window });
  }
  const answers: MindmapWindowAnswer[] = new Array(windows.length);
  let next = 0;
  let failed = false;
  const runner = async () => {
    while (!failed && next < windows.length) {
      const index = next++;
      const { topics, sections } = windows[index];
      try {
        answers[index] = await withMindmapCoverageRepair(
          (feedback) => params.fill(topics, sections, feedback, index),
          (answer) => mindmapFillIssues(topics, sections, answer),
        );
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  // Wait for all active workers before reporting failure, so no provider calls outlive the job.
  const results = await Promise.allSettled(Array.from({ length: Math.min(4, windows.length) }, runner));
  for (const result of results) if (result.status === "rejected") throw result.reason;
  // Global deduplication knows about topics outside an individual window. Check again after
  // that merge, so pruning an echo cannot erase an otherwise validated source contribution.
  const issues = mindmapFillIssues(params.plan.topics, params.sections, {
    branches: answers.flatMap((answer) => answer.branches),
  });
  if (issues.length) throw new Error(`Mindmap coverage is incomplete: ${issues.slice(0, 5).join("; ")}`);
  return { branches: mergeWindowedBranches({ topics: params.plan.topics, windows: answers }), windowCount: windows.length };
}

/** The defensive storage parser must not turn a complete generation into a partial map. */
export function parseCompleteMindmap(generated: {
  title: string;
  language: string;
  branches: ReturnType<typeof mergeWindowedBranches>;
}) {
  const doc = parseMindmapDoc(generated);
  if (!doc) throw new Error("The model returned a map with no usable branches.");
  const generatedNodeCount = generated.branches.reduce(
    (sum, branch) => sum + 1 + branch.children.reduce(
      (children, child) => children + 1 + (child.children?.length ?? 0), 0,
    ), 0,
  );
  if (countMindmapNodes(doc) !== generatedNodeCount) {
    throw new Error("The generated mindmap could not be saved without losing content. Please try drawing it again.");
  }
  return doc;
}
