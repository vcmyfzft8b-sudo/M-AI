/** One-off: reproduce the mixed-topic scan to find which stage drops the second topic. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generate, loadEnv, buildWindows, mapWithConcurrency } from "./lib/eval-runtime.mjs";
import {
  buildKnowledgeExtractionInstructions, buildNoteOutlineInstructions,
  dedupeKnowledgeItems, KNOWLEDGE_EXTRACTION_PASS_WINDOWS,
  knowledgeExtractionSchema, noteOutlineSchema,
} from "../src/lib/notes/note-prompts.ts";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(ROOT);
const source = fs.readFileSync(process.argv[2], "utf8");
const passes = KNOWLEDGE_EXTRACTION_PASS_WINDOWS.flatMap((w,pi)=>buildWindows(source,w).map((t,i,a)=>({t,pi,label:`Chunk ${i+1} of ${a.length}`})));
const ex = await mapWithConcurrency(passes, 3, ({t,pi,label}) =>
  generate({schema:knowledgeExtractionSchema,model:"gemini-2.5-flash-lite",maxOutputTokens:1800,
    instructions:buildKnowledgeExtractionInstructions({outputLanguage:"sl",sourceType:"document"}),
    input:`${label}.\n\n${t}`}).then(v=>({...v,pi})));
const byPass=new Map();
for(const e of ex){byPass.set(e.pi,[...(byPass.get(e.pi)??[]),...e.items.map((it,id)=>({...it,id,sectionTitle:e.sectionTitle}))]);}
const perPass=[...byPass.values()].flatMap(items=>dedupeKnowledgeItems(items.map((it,id)=>({...it,id})),{boostRepeats:true}));
const items=dedupeKnowledgeItems(perPass.map((it,id)=>({...it,id}))).map((it,id)=>({...it,id}));
console.log("ITEMS:",items.length);
for(const it of items)console.log(` [${it.importance}] (${it.kind}) ${it.claim.slice(0,90)}`);
const outline = await generate({schema:noteOutlineSchema,model:"gemini-2.5-flash-lite",maxOutputTokens:Math.max(2600,items.length*60),
  instructions:buildNoteOutlineInstructions({outputLanguage:"sl"}),
  input:JSON.stringify({sourceType:"document",items:items.map(({id,claim,kind,importance,sectionTitle})=>({id,claim,kind,importance,sectionTitle}))},null,2)});
console.log("\nOUTLINE topics:");
for(const t of outline.topics)console.log(" -",t.title,"items:",t.itemIds.join(","));
console.log("dropped:",outline.droppedItemIds.join(","));
