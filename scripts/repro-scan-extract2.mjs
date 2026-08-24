/** One-off: replicate the exact production extraction input for the scan lecture. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, loadEnv } from "./lib/eval-runtime.mjs";
import { buildKnowledgeExtractionInstructions, knowledgeExtractionSchema } from "../src/lib/notes/note-prompts.ts";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);
const segments = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const windowText = segments.map((s) => `[${s.speaker_label}] ${s.text}`).join("\n");
console.log("window chars:", windowText.length);
for (let run = 0; run < 2; run += 1) {
  const v = await generate({
    schema: knowledgeExtractionSchema, model: "gemini-2.5-flash-lite", maxOutputTokens: 1800,
    instructions: buildKnowledgeExtractionInstructions({ outputLanguage: "sl", sourceType: "document" }),
    input: `Chunk 1 of 1.\n\n${windowText}`,
  });
  const topics = { synapse: 0, index: 0 };
  for (const item of v.items) {
    if (/sinaps|receptor|epsp|ipsp|akson|serotonin|kalcij|nevron/i.test(item.claim)) topics.synapse += 1;
    else if (/indeks|laspeyres|paasche|fisher|cpi|bdp|inflac|geometrijska|uteži/i.test(item.claim)) topics.index += 1;
  }
  console.log(`run ${run}: items=${v.items.length} synapse=${topics.synapse} index=${topics.index} section="${v.sectionTitle}"`);
}
