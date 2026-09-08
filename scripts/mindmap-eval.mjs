/** Synthetic source only; calls the configured model, never a database.
 * node --experimental-strip-types scripts/mindmap-eval.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, ledger, loadEnv } from "./lib/eval-runtime.mjs";
import { resolveStageModelConfig, applyOutputHeadroom } from "../src/lib/ai/model-config.ts";
import { buildMindmapSourceSections, mindmapPlanningSections, mindmapPlanIssues, withMindmapCoverageRepair, fillMindmapSections, parseCompleteMindmap } from "../src/lib/mindmap-generation.ts";
import { buildMindmapFillInstructions, buildMindmapTopicPlanInstructions, mindmapFillSchema, mindmapTopicPlanSchema } from "../src/lib/ai/mindmap-prompt.ts";
import { countMindmapNodes } from "../src/lib/mindmap-doc.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(root);
const config = resolveStageModelConfig({ stage: "mindmap", env: process.env, fallbackModel: process.env.GEMINI_TEXT_MODEL });
const source = fs.readFileSync(path.join(root, "evals/fixtures/mindmap/microeconomics-sl.md"), "utf8");
const sections = buildMindmapSourceSections(source);
const started = Date.now();
console.log(JSON.stringify({ model: config.model, sourceSections: sections.length }));
const call = (schema, instructions, input, tokens) => generate({ schema, instructions, input: JSON.stringify(input), model: config.model, thinkingLevel: config.thinkingLevel, providerSort: config.providerSort ?? "throughput", maxOutputTokens: applyOutputHeadroom(tokens, config) });
const plan = await withMindmapCoverageRepair(
  (coverageFeedback) => call(mindmapTopicPlanSchema, buildMindmapTopicPlanInstructions(), { noteTitle: "Mikroekonomija: ekonomski problem, trg in splošno ravnovesje", sections: mindmapPlanningSections(sections), coverageFeedback }, 8000),
  (answer) => mindmapPlanIssues(answer, sections),
);
console.log(JSON.stringify({ topics: plan.topics.map((topic) => topic.label) }));
const filled = await fillMindmapSections({ plan, sections, fill: (topics, sections, coverageFeedback) => call(mindmapFillSchema, buildMindmapFillInstructions(), { topics, sections, coverageFeedback }, 14000) });
const doc = parseCompleteMindmap({ ...plan, branches: filled.branches });
if (!doc) throw new Error("No drawable map");
const text = JSON.stringify(doc).normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
const required = {
  microAndMacro: /mikro/.test(text) && /makro/.test(text),
  scarcityAndChoice: /omejen|redkost/.test(text) && /oportunitetn/.test(text),
  productionPossibilities: /proizvodn/.test(text) && /meja|meje|meji|krivulj/.test(text),
  demand: /povprasevan/.test(text) && /substitut/.test(text),
  supply: /ponudb/.test(text) && /tehnologij/.test(text),
  marketEquilibrium: /ravnoves/.test(text) && /presez/.test(text),
  elasticity: /elastic/.test(text) && /prihod/.test(text),
  generalEquilibriumAndEfficiency: /paret/.test(text) && /eksternal/.test(text),
};
const result = { branches: doc.branches.length, nodes: countMindmapNodes(doc), required, seconds: Math.round((Date.now() - started) / 1000), ledger, plan, doc };
fs.mkdirSync(path.join(root, "evals/output"), { recursive: true });
fs.writeFileSync(path.join(root, "evals/output/mindmap-microeconomics-sl.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, plan: undefined, doc: undefined }, null, 2));
if (doc.branches.length < 4 || Object.values(required).some((covered) => !covered)) process.exitCode = 1;
