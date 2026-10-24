/**
 * Replays one failed production note offline, with the current prompts, and says whether it would
 * now produce a note. Used by the note-triage automation (.claude/skills/note-triage/SKILL.md) and
 * by hand.
 *
 *   node --experimental-strip-types scripts/replay-failed-note.mjs <lectureId> [--out=<dir>] [--no-note]
 *   node --experimental-strip-types scripts/replay-failed-note.mjs <lectureId> --from=<dir> [--out=<dir>]
 *
 * --from replays a folder an earlier run downloaded (record.json + the files), with no database
 * access; only the model keys are needed.
 *
 * It reads what production kept of the upload -- generation_failure_captures, which survives the
 * learner deleting the note, and the copies of their files under failure-captures/ -- then runs
 * the same reading steps production runs (photos: verbatim read, rescue read, restatement; PDFs:
 * the text layer when legible, else extraction, restatement), and finally the note pipeline with topic notes. Writes the
 * material and the resulting note to --out (default /tmp/note-replay/<id>), never into the repo:
 * it is a learner's own material.
 *
 * Env (read-only use of production): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * GEMINI_API_KEY, OPENROUTER_API_KEY. NOTE_TRIAGE_ENV may point at a file holding them.
 *
 * Not replayed: transcription (the capture already holds the transcript) and link fetching (run
 * the URL through fetchLinkSource's rules by hand: `curl -A "Mozilla/5.0 (compatible; MemoAI/1.0;
 * +https://memoai.eu)" -H "Accept: text/html,*\/*"`).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";

import {
  IMAGE_OCR_INSTRUCTIONS,
  IMAGE_RESTATE_INSTRUCTIONS,
  PDF_EXTRACT_INSTRUCTIONS,
  PDF_RESTATE_INSTRUCTIONS,
} from "../src/lib/ocr-prompts.ts";
import { pickPageArticleHtml, pickRoleMainHtml } from "../src/lib/link-main-article.ts";
import {
  DOCX_TEXT_PICTURE_EXTENSIONS,
  docxTextNeedsPictures,
  orderDocxPicturePaths,
  readEmfText,
} from "../src/lib/docx-pictures.ts";
import { isLegiblePdfTextLayer, isPdfTextLayerTheDocument } from "../src/lib/pdf-text-layer.ts";
import { isLabelOnlyOcrReading } from "../src/lib/scan-ocr-text.ts";
import { hasEnoughSourceTextToTeach } from "../src/lib/source-text-gate.ts";
import { runCase } from "./lib/note-replay.mjs";
import { countWords, ledger, loadEnv } from "./lib/eval-runtime.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (process.env.NOTE_TRIAGE_ENV && fs.existsSync(process.env.NOTE_TRIAGE_ENV)) {
  for (const line of fs.readFileSync(process.env.NOTE_TRIAGE_ENV, "utf8").split("\n")) {
    const index = line.indexOf("=");
    if (index > 0 && !process.env[line.slice(0, index)]) {
      process.env[line.slice(0, index)] = line.slice(index + 1).replace(/^"|"$/g, "");
    }
  }
}
loadEnv(ROOT);

const args = process.argv.slice(2);
const lectureId = args.find((arg) => !arg.startsWith("--"));
const argValue = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.split("=")[1];
const outDir = argValue("out") ?? path.join(os.tmpdir(), "note-replay", lectureId ?? "none");
const writeNote = !args.includes("--no-note");

if (!lectureId) {
  console.error("usage: replay-failed-note.mjs <lectureId> [--out=<dir>] [--no-note]");
  process.exit(2);
}

const SUPABASE = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
// Same names and fallbacks as server-env.ts.
// A blank variable counts as unset, as in server-env.ts.
const firstSetEnv = (...names) => names.map((name) => process.env[name]?.trim()).find(Boolean);
const OCR_LITE_MODEL = firstSetEnv("GEMINI_OCR_LITE_MODEL", "GEMINI_OCR_MODEL") ?? "gemini-3.5-flash-lite";
const OCR_STRONG_MODEL = firstSetEnv("GEMINI_OCR_STRONG_MODEL", "GEMINI_OCR_RESCUE_MODEL") ?? "gemini-3-flash-preview";
const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function rest(pathname) {
  const response = await fetch(`${SUPABASE}${pathname}`, { headers });
  if (!response.ok) throw new Error(`${pathname.split("?")[0]} -> ${response.status}`);
  return response.json();
}

async function download(objectPath) {
  const response = await fetch(`${SUPABASE}/storage/v1/object/lecture-audio/${objectPath}`, { headers });
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null;
}

async function readWithGemini({ model, instructions, bytes, mimeType, maxOutputTokens, mediaResolution }) {
  // Production reads every photo at high resolution; a replay at the API default would read a
  // different picture of the same page.
  const image = { inlineData: { mimeType, data: bytes.toString("base64") } };
  const response = await gemini.models.generateContent({
    model,
    contents: [
      { role: "user", parts: [mediaResolution ? { ...image, mediaResolution: { level: mediaResolution } } : image, { text: instructions }] },
    ],
    config: { maxOutputTokens, thinkingConfig: { thinkingLevel: "minimal" } },
  });
  const candidate = response.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? "").join("").trim();

  return { finishReason: candidate?.finishReason ?? null, text };
}

/** Production's order: stronger verbatim, lite verbatim, restatement (stronger reader first). */
async function readPhoto(bytes) {
  let normalized = bytes;
  try {
    normalized = await sharp(bytes, { failOn: "none" }).rotate().resize({ width: 3072, height: 3072, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  } catch {
    // HEIC without a decoder here: send it as it is, like production's fallback.
  }
  const attempts = [];
  let shortText = "";
  for (const [stage, model, instructions] of [
    ["ocr_primary", OCR_STRONG_MODEL, IMAGE_OCR_INSTRUCTIONS],
    ["ocr_rescue", OCR_LITE_MODEL, IMAGE_OCR_INSTRUCTIONS],
    ["ocr_restate", OCR_STRONG_MODEL, IMAGE_RESTATE_INSTRUCTIONS],
    ["ocr_restate", OCR_LITE_MODEL, IMAGE_RESTATE_INSTRUCTIONS],
  ]) {
    const result = await readWithGemini({ model, instructions, bytes: normalized, mimeType: "image/jpeg", maxOutputTokens: 6000, mediaResolution: "MEDIA_RESOLUTION_HIGH" });
    attempts.push({ stage, model, finishReason: result.finishReason, chars: result.text.length });
    if (result.text.length >= 120) return { text: result.text, attempts };
    if (result.text.length > shortText.length) shortText = result.text;
    // Real but thin text will not grow when restated, unless it is only a diagram's labels;
    // production keeps it and stops here too.
    if (shortText && stage === "ocr_rescue" && !isLabelOnlyOcrReading(shortText)) break;
  }
  return { text: shortText, attempts };
}

/** The embedded text, read and joined the way extractTextFromPdf does. */
async function readPdfTextLayer(bytes) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const document = await loadingTask.promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const content = await (await document.getPage(pageNumber)).getTextContent();
      const parts = content.items.flatMap((item) => (typeof item.str === "string" && item.str.trim() ? [item.hasEOL ? `${item.str.trim()}\n` : item.str.trim()] : []));
      pages.push(parts.join(" ").replace(/[ \t]+/g, " ").trim());
    }
    return { text: pages.filter(Boolean).join("\n\n").trim(), pageCount: document.numPages };
  } catch {
    return { text: "", pageCount: 0 };
  } finally {
    await loadingTask.destroy();
  }
}

/** Production's order: the text layer when it is legible, then extraction, then restatement. */
async function readPdf(bytes) {
  const attempts = [];
  const { text: layer, pageCount } = await readPdfTextLayer(bytes);
  if (layer.split(/\s+/).filter(Boolean).length >= 40) {
    const legible = isLegiblePdfTextLayer(layer);
    const taken = isPdfTextLayerTheDocument({ text: layer, pageCount });
    attempts.push({ stage: "pdf_text_layer", legible, taken, pages: pageCount, chars: layer.length });
    if (taken) return { text: layer, attempts };
  }
  for (const [stage, model, instructions] of [
    ["pdf_extract", OCR_LITE_MODEL, PDF_EXTRACT_INSTRUCTIONS],
    ["pdf_restate", OCR_STRONG_MODEL, PDF_RESTATE_INSTRUCTIONS],
    ["pdf_restate", OCR_LITE_MODEL, PDF_RESTATE_INSTRUCTIONS],
  ]) {
    const result = await readWithGemini({ model, instructions, bytes, mimeType: "application/pdf", maxOutputTokens: 24000 });
    attempts.push({ stage, model, finishReason: result.finishReason, chars: result.text.length });
    if (result.text.trim()) return { text: result.text, attempts };
  }
  return { text: "", attempts };
}

/** Production's order: the raw text, then the pictures in page order when the text is thin. */
async function readDocx(bytes) {
  const { default: mammoth } = await import("mammoth");
  const { default: JSZip } = await import("jszip");
  const text = (await mammoth.extractRawText({ buffer: bytes })).value.replace(/\s+/g, " ").trim();
  const attempts = [{ stage: "docx_text", chars: text.length }];
  if (!docxTextNeedsPictures(text)) return { text, attempts };
  const zip = await JSZip.loadAsync(bytes);
  const documentXml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  const relsXml = (await zip.file("word/_rels/document.xml.rels")?.async("string")) ?? "";
  const texts = [text];
  for (const picturePath of orderDocxPicturePaths({ documentXml, relsXml }).slice(0, 8)) {
    const picture = await zip.file(picturePath)?.async("nodebuffer");
    const isMetafile = DOCX_TEXT_PICTURE_EXTENSIONS.has(path.extname(picturePath).slice(1).toLowerCase());
    if (!picture || (!isMetafile && picture.length < 4 * 1024) || picture.length > 8 * 1024 * 1024) continue;
    if (isMetafile) {
      const metafileText = readEmfText(picture);
      attempts.push({ stage: "docx_metafile", picture: path.basename(picturePath), chars: metafileText.length });
      texts.push(metafileText);
      continue;
    }
    const read = await readPhoto(picture);
    attempts.push({ stage: "docx_picture", picture: path.basename(picturePath), attempts: read.attempts, chars: read.text.length });
    texts.push(read.text);
  }
  return { text: texts.filter(Boolean).join("\n\n"), attempts };
}

// A saved web page. Production's htmlToText (manual-lectures.ts) is server-only; this takes the
// same region (article, else role="main", else the page) and drops the same chrome, which is
// enough to tell an empty read from a page with something to teach.
function readHtml(bytes) {
  const html = bytes.toString("utf8");
  const region = pickPageArticleHtml(html) ?? pickRoleMainHtml(html) ?? html;
  const text = region
    .replace(/<(script|style|noscript|svg|header|footer|nav|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return { text, attempts: [{ stage: "html_main_region", chars: text.length }] };
}

// --from=<dir>: replay a folder an earlier (online) run downloaded, with no database access at
// all. The note-triage workflow downloads everything first and hands the agent only this.
const fromDir = argValue("from");
let capture;
let lecture;

if (fromDir) {
  ({ capture, lecture } = JSON.parse(fs.readFileSync(path.join(fromDir, "record.json"), "utf8")));
} else {
  [capture] = await rest(`/rest/v1/generation_failure_captures?lecture_id=eq.${lectureId}&select=*`);
  [lecture] = await rest(`/rest/v1/lectures?id=eq.${lectureId}&select=id,user_id,source_type,status,storage_path,processing_metadata`);
}

if (!capture && !lecture) {
  console.log(JSON.stringify({ lectureId, verdict: "gone", detail: "no lecture and no capture (older than 30 days, or never captured)" }));
  process.exit(0);
}

fs.mkdirSync(outDir, { recursive: true });
if (!fromDir) {
  fs.writeFileSync(path.join(outDir, "record.json"), JSON.stringify({ capture: capture ?? null, lecture: lecture ?? null }));
}
const metadata = lecture?.processing_metadata ?? capture?.processing_metadata ?? {};
const sourceType = lecture?.source_type ?? capture?.source_type ?? "text";
const report = { lectureId, sourceType, code: metadata?.failure?.code ?? null, message: capture?.error_message ?? null, reads: [] };
let sourceText = capture?.source_text ?? "";

// Photos and documents are re-read: the capture's text is what the OLD readers produced.
const files = (capture?.captured_files ?? []).map((file) => file.capturedPath);
const pendingDocument = metadata?.pendingDocument?.path;
// The capture keeps its own copy of the pending document ("0-source.html" for "source.html").
if (pendingDocument && !files.some((file) => file.endsWith(path.basename(pendingDocument)))) files.push(pendingDocument);
const pendingPhotos = Array.isArray(metadata?.pendingScanImages) ? metadata.pendingScanImages.map((image) => image.path) : [];
for (const photo of pendingPhotos) if (!files.some((file) => file.endsWith(path.basename(photo)))) files.push(photo);

async function loadFile(objectPath) {
  if (fromDir) {
    const local = path.join(fromDir, path.basename(objectPath));
    return fs.existsSync(local) ? fs.readFileSync(local) : null;
  }
  return download(objectPath);
}

const readTexts = [];
for (const objectPath of files) {
  const bytes = await loadFile(objectPath);
  const name = path.basename(objectPath);
  if (!bytes) {
    report.reads.push({ file: name, missing: true });
    continue;
  }
  if (path.resolve(outDir) !== path.resolve(fromDir ?? "")) fs.writeFileSync(path.join(outDir, name), bytes);
  if (/\.(jpe?g|png|webp|heic|heif)$/i.test(name)) {
    const read = await readPhoto(bytes);
    report.reads.push({ file: name, ...read, text: undefined });
    if (read.text) readTexts.push(read.text);
  } else if (/\.pdf$/i.test(name)) {
    const read = await readPdf(bytes);
    report.reads.push({ file: name, ...read, text: undefined });
    if (read.text) readTexts.push(read.text);
  } else if (/\.html?$/i.test(name)) {
    const read = readHtml(bytes);
    report.reads.push({ file: name, ...read, text: undefined });
    if (read.text) readTexts.push(read.text);
  } else if (/\.docx$/i.test(name)) {
    const read = await readDocx(bytes);
    report.reads.push({ file: name, ...read, text: undefined });
    if (read.text) readTexts.push(read.text);
  } else {
    report.reads.push({ file: name, bytes: bytes.length, note: "audio: the capture holds its transcript" });
  }
}

if (readTexts.length) sourceText = readTexts.join("\n\n");
report.sourceChars = sourceText.length;
report.linkUrl = metadata?.pendingLinkUrl ?? metadata?.manualImport?.modelMetadata?.sourceUrl ?? null;
fs.writeFileSync(path.join(outDir, "source.txt"), sourceText);

if (!sourceText.trim()) {
  report.verdict = files.length ? "unreadable" : "no-material";
} else if (!hasEnoughSourceTextToTeach(sourceText.replace(/\s+/g, " ").trim())) {
  // Production stops here with source_too_short before the notes stage ever runs.
  report.verdict = "no-learnable-topic";
  report.gate = "source_too_short";
} else if (writeNote) {
  const result = await runCase({
    id: lectureId,
    language: null,
    sourceType: sourceType === "audio" ? "audio" : "document",
    title: null,
    source: sourceText,
  });
  report.verdict = result.outcome === "note" ? "would-succeed" : "no-learnable-topic";
  report.topic = result.topic ? { materialKind: result.topic.materialKind, topicTitle: result.topic.topicTitle } : null;
  report.noteWords = result.note ? countWords(result.note) : 0;
  if (result.note) fs.writeFileSync(path.join(outDir, "note.md"), result.note);
} else {
  report.verdict = "readable";
}

report.costUsd = Number(ledger.costUsd.toFixed(4));
report.outDir = outDir;
fs.writeFileSync(path.join(outDir, fromDir ? "report.replayed.json" : "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
