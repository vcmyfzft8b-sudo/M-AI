import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMindmapSourceSections,
  mindmapPlanningSections,
  mindmapPlanIssues,
  mindmapFillIssues,
  withMindmapCoverageRepair,
  fillMindmapSections,
  parseCompleteMindmap,
} from "../src/lib/mindmap-generation.ts";
import { MINDMAP_MAX_NODES } from "../src/lib/mindmap-doc.ts";
import { mergeWindowedBranches } from "../src/lib/mindmap-merge.ts";

const sections = buildMindmapSourceSections("## Mikro in makro\nPosamezni trgi in celotno gospodarstvo.\n## Ekonomski problem\nOmejeni viri in izbira.\n## Trg\nPonudba, povpraševanje in cena.\n## Splošno ravnovesje\nTrgi vplivajo drug na drugega.");
const plan = {
  title: "Mikroekonomija", language: "sl",
  topics: sections.map((section) => ({ label: section.heading, brief: section.material, sourceIds: [section.id] })),
};
const answerFor = (topics) => ({ branches: topics.map((topic) => ({
  topic: topic.label,
  children: [{ label: `Pojem ${topic.label}`, detail: topic.brief, sourceIds: topic.sourceIds, children: [{ label: "Razlaga", detail: topic.brief }] }],
})) });

test("every main subject gets its own generation, and missing branches are repaired", async () => {
  const calls = new Map();
  const result = await fillMindmapSections({ plan, sections, fill: async (topics, material, feedback) => {
    const label = topics[0].label;
    calls.set(label, (calls.get(label) ?? 0) + 1);
    assert.equal(topics.length, 1, "one topic gets the whole output budget");
    assert.equal(material.length, 1);
    if (label !== plan.topics[0].label && !feedback.length) return { branches: [] };
    if (calls.get(label) === 2) assert.ok(feedback[0].includes(label));
    return answerFor(topics);
  } });
  assert.equal([...calls.values()].reduce((a, b) => a + b, 0), 7);
  assert.deepEqual(result.branches.map((branch) => branch.label), plan.topics.map((topic) => topic.label));
});

test("a persistently missing branch fails instead of becoming a ready one-branch map", async () => {
  const calls = new Map();
  await assert.rejects(fillMindmapSections({ plan, sections, fill: async (topics) => {
    const label = topics[0].label;
    calls.set(label, (calls.get(label) ?? 0) + 1);
    return label === plan.topics[0].label ? answerFor(topics) : { branches: [] };
  } }), /coverage is incomplete/);
  assert.ok([...calls.values()].every((count) => count <= 2), "coverage repairs must be bounded");
});

test("failed windows are retried and never silently omitted", async () => {
  const longSections = buildMindmapSourceSections(Array.from({ length: 7 }, (_, i) => `## Topic ${i}\n${"content ".repeat(901)}last${i}`).join("\n"));
  const longPlan = { ...plan, topics: [{ label: "All concepts", brief: "", sourceIds: longSections.map((s) => s.id) }] };
  const attempted = new Map();
  const seen = new Set();
  const result = await fillMindmapSections({ plan: longPlan, sections: longSections, fill: async (topics, material, feedback, index) => {
    attempted.set(index, (attempted.get(index) ?? 0) + 1);
    if (index === 1 && !feedback.length) throw new Error("timeout");
    material.forEach((section) => seen.add(section.id));
    return answerFor(topics.map((topic) => ({ ...topic, sourceIds: material.map((section) => section.id) })));
  } });
  assert.ok(result.windowCount > 1);
  assert.equal(attempted.get(1), 2);
  assert.equal(seen.size, longSections.length);
});

test("a planned topic must be filled in every assigned section, even if another window filled it", () => {
  const topics = [{ ...plan.topics[0], sourceIds: ["s1", "s2"] }];
  const answer = answerFor([{ ...topics[0], sourceIds: ["s1"] }]);
  assert.match(mindmapFillIssues(topics, sections, answer).join(" "), /s2/);
});

test("invented source IDs and renamed topics cannot pass the coverage check", () => {
  const answer = answerFor([{ ...plan.topics[0], label: "Unknown", sourceIds: ["fake"] }]);
  const issues = mindmapFillIssues(plan.topics, sections, answer).join(" ");
  assert.match(issues, /Unknown topic/);
  assert.match(issues, /Invalid source/);
});

test("the global plan must account for the last source and cannot pad with duplicate topics", () => {
  assert.deepEqual(mindmapPlanIssues(plan, sections), []);
  assert.match(mindmapPlanIssues({ ...plan, topics: plan.topics.slice(0, 3) }, sections).join(" "), /s4/);
  assert.match(mindmapPlanIssues({ ...plan, topics: [...plan.topics, plan.topics[0]] }, sections).join(" "), /Duplicate/);
});

test("short focused notes need no invented branches, but substantial notes cannot collapse into one", () => {
  const topic = { label: "Topic", brief: "", sourceIds: ["s1"] };
  const short = buildMindmapSourceSections("A short definition.");
  assert.deepEqual(mindmapPlanIssues({ ...plan, topics: [topic] }, short), []);
  const substantial = buildMindmapSourceSections("facts ".repeat(350));
  assert.match(mindmapPlanIssues({ ...plan, topics: [topic] }, substantial).join(" "), /one branch is insufficient/);
});

test("headingless material, bullet-only sections and tables survive planning and filling", () => {
  const source = `${"Unheaded prose. ".repeat(1000)}TAIL_MARKER\n##### Table\n| Price | Quantity |\n| 10 | 20 |\n###### Bullets\n- Opportunity cost\n- Scarcity`;
  const parts = buildMindmapSourceSections(source);
  assert.equal(parts.map((s) => s.material).join(" ").replace(/\s+/g, " "), source.replace(/\s+/g, " "));
  const overview = JSON.stringify(mindmapPlanningSections(parts));
  assert.match(overview, /TAIL_MARKER/);
  assert.match(overview, /Price/);
  assert.match(overview, /Scarcity/);
  assert.ok(parts.every((section) => section.material.split(/\s+/).length <= 900));
});

test("generic subsections keep their parent subject and headings alone do not demand invented facts", () => {
  const parts = buildMindmapSourceSections("## Supply\n### Example\nA producer offers more.\n## Demand\n### Example\nA buyer purchases less.");
  assert.equal(parts.length, 2);
  assert.equal(parts[0].heading, "Supply > Example");
  assert.equal(parts[1].heading, "Demand > Example");
});

test("duplicate ideas merge new facts, details and source evidence from later windows", () => {
  const idea = (sourceId, leaf, detail) => ({ label: "Elasticity", detail, sourceIds: [sourceId], children: [{ label: leaf, detail: "" }] });
  const branches = mergeWindowedBranches({ topics: [{ label: "Demand", brief: "" }], windows: [
    { branches: [{ topic: "Demand", children: [idea("s1", "Percentage change", "Sensitivity to price")] }] },
    { branches: [{ topic: "Demand", children: [idea("s2", "Revenue effect", "Depends on substitutes")] }] },
  ] });
  assert.equal(branches[0].children.length, 1);
  assert.deepEqual(branches[0].children[0].sourceIds, ["s1", "s2"]);
  assert.deepEqual(branches[0].children[0].children.map((leaf) => leaf.label), ["Percentage change", "Revenue effect", "Depends on substitutes"]);
});

test("repeated fact labels keep a later explanation and informative topic echoes survive", () => {
  const branches = mergeWindowedBranches({ topics: [{ label: "Demand", brief: "" }], windows: [{ branches: [{ topic: "Demand", children: [{
    label: "Elasticity", detail: "", children: [
      { label: "Revenue", detail: "Falls when demand is elastic." },
      { label: "Revenue", detail: "Rises when demand is inelastic." },
      { label: "Demand", detail: "Quantity demanded responds to price." },
    ],
  }] }] }] });
  assert.match(branches[0].children[0].children[0].detail, /Falls.*Rises/);
  assert.equal(branches[0].children[0].children.length, 2);
});

test("an aborted job never starts a coverage repair", async () => {
  let calls = 0;
  await assert.rejects(withMindmapCoverageRepair(async () => {
    calls++;
    throw Object.assign(new Error("aborted"), { name: "WorkAbortedError" });
  }, () => []), /aborted/);
  assert.equal(calls, 1);
});


test("the parser cannot silently discard the end of a generated map", () => {
  const branches = [{ label: "Topic", detail: "", children: Array.from({ length: MINDMAP_MAX_NODES + 1 }, (_, i) => ({ label: `Idea ${i}`, detail: "", children: [] })) }];
  assert.throws(() => parseCompleteMindmap({ ...plan, branches }), /without losing content/);
  assert.equal(parseCompleteMindmap({ ...plan, branches: branches.map((b) => ({ ...b, children: b.children.slice(0, 20) })) }).branches[0].children.length, 20);
});

test("planning keeps every section of a note above the former 60,000-character cutoff", () => {
  const source = Array.from({ length: 40 }, (_, i) => `## Topic ${i}\n${"substantive fact ".repeat(450)}TAIL${i}`).join("\n");
  assert.ok(source.length > 60_000);
  const parts = buildMindmapSourceSections(source);
  const overview = JSON.stringify(mindmapPlanningSections(parts));
  for (let i = 0; i < 40; i++) {
    assert.ok(overview.includes(`Topic ${i}`));
    assert.ok(overview.includes(`TAIL${i}`));
  }
});

test("global deduplication cannot erase coverage accepted by an isolated fill window", async () => {
  const parts = [
    { id: "s1", heading: "First", material: "word ".repeat(1800).trim() },
    { id: "s2", heading: "Second", material: "Other material" },
  ];
  const topics = [
    { label: "First", brief: "", sourceIds: ["s1"] },
    { label: "Second", brief: "", sourceIds: ["s2"] },
  ];
  await assert.rejects(fillMindmapSections({ plan: { ...plan, topics }, sections: parts, fill: async (assigned, source, feedback, index) => {
    if (index === 0) return { branches: [{ topic: "First", children: [{ label: "Second", detail: "", sourceIds: ["s1"], children: [] }] }] };
    return answerFor(assigned);
  } }), /Missing ideas for topic "First"/);
});


test("a long complete map keeps ideas beyond the former 520-node ceiling", () => {
  const branches = plan.topics.map((topic, i) => ({ label: topic.label, detail: "", children: Array.from({ length: 180 }, (_, j) => ({ label: `Idea ${i}.${j}`, detail: "", children: [] })) }));
  const doc = parseCompleteMindmap({ ...plan, branches });
  assert.equal(doc.branches.length, 4);
  assert.equal(doc.branches[3].children[179].label, "Idea 3.179");
});

test("later explanations keep their full text and are not repeated by overlapping windows", () => {
  const detail = "This explanation is longer than a node label and includes the essential condition that the price change must leave all other circumstances unchanged.";
  const answer = (text) => ({ branches: [{ topic: "Demand", children: [{ label: "Law", detail: text, children: [] }] }] });
  const branches = mergeWindowedBranches({ topics: [{ label: "Demand", brief: "" }], windows: [answer("Initial explanation"), answer(detail), answer(detail)] });
  const doc = parseCompleteMindmap({ ...plan, branches });
  assert.equal(doc.branches[0].children[0].children.length, 1);
  assert.equal(doc.branches[0].children[0].children[0].detail, detail);
});
