import { z } from "zod";

import { buildGeneratedContentLanguageInstruction } from "@/lib/languages";

/**
 * The one call that turns a finished note into a map of it.
 *
 * The tree is written out at a fixed depth rather than recursively, because structured output has
 * no way to express "a node containing nodes" — a self-referencing schema is rejected outright.
 * Four levels is not a compromise made to fit that limit, though: a map deeper than
 * title → topic → idea → fact stops being glanceable, which is the only thing a map is for.
 *
 * Free-text fields carry no `.max()`. Gemini rejects a wire schema whose string bounds multiply
 * out across nested arrays ("too many states"), and this schema nests three deep — the caps live
 * in mindmap-doc.ts and are applied to what comes back.
 */

const leafSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe(
      "The fact itself, in two to seven words. A number, a name, a definition, a step — " +
        "something a reader can check they know.",
    ),
  detail: z
    .string()
    .describe(
      "One short sentence explaining the label, or an empty string when the label already " +
        "says everything. Never a repeat of the label.",
    ),
});

const childSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("One idea inside this topic, named in two to six words."),
  detail: z
    .string()
    .describe("One short sentence saying what this idea is, or an empty string."),
  children: z
    .array(leafSchema)
    .describe(
      "The two to five facts that make up this idea. Empty when the idea has no parts worth " +
        "splitting out.",
    ),
});

const branchSchema = z.object({
  label: z
    .string()
    .min(1)
    .describe("A main topic of the material, named in one to four words."),
  detail: z
    .string()
    .describe("One short sentence saying what this topic covers."),
  children: z
    .array(childSchema)
    .min(1)
    .describe("The two to six ideas this topic breaks into."),
});

export const mindmapWireSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe(
      "The subject at the centre of the map, in one to five words. Name the material, do not " +
        "describe it: \"Endogena rast\", not \"Zapiski o endogeni rasti\".",
    ),
  language: z
    .string()
    .min(2)
    .describe(
      "The language the material is written in, as a short code like \"sl\", \"en\", \"de\" " +
        "or \"pl\". Read it off the material. Never take it from these instructions, which " +
        "are always in English.",
    ),
  branches: z
    .array(branchSchema)
    .min(3)
    .describe("The main topics, in the order the material covers them."),
});

export type MindmapWireDoc = z.infer<typeof mindmapWireSchema>;

/**
 * Deliberately not "summarise the note". A summary drops the small things — the numbers, the
 * conditions, the exceptions — and those are exactly what a learner comes back to a map for.
 * The instruction is to re-shape the note, keeping its facts, not to compress it.
 */
export function buildMindmapInstructions() {
  return [
    "You turn a set of study notes into a mind map: the same material, arranged as a tree a " +
      "learner can see the whole shape of at once.",
    "",
    buildGeneratedContentLanguageInstruction(),
    "",
    "How to build it:",
    "- Six to ten main topics. Fewer than six and each one is doing too much; more than ten " +
      "and the map is the table of contents again.",
    "- Follow the material's own structure where it has one. Its headings are usually the " +
      "topics and its bullet points are usually the ideas — do not invent a different " +
      "organisation because it looks tidier.",
    "- Carry the specifics down to the leaves: formulas, numbers, dates, names, the exact " +
      "conditions under which something holds. A leaf reading \"advantages\" is worthless; " +
      "one reading \"Lower cost per unit above 10,000 units\" is the map earning its place.",
    "- Labels are phrases, not sentences. No trailing full stops, no \"The\", no \"How to\", " +
      "no numbering — the tree already carries the order.",
    "- Never repeat a label anywhere else in the map. Two nodes with the same words are two " +
      "nodes a reader cannot tell apart.",
    "- `detail` is the one sentence you would say if the reader tapped the node and asked what " +
      "it means. Leave it empty rather than restating the label in longer words.",
    "",
    "What not to do:",
    "- Do not add anything the material does not contain, and do not fill a thin topic with " +
      "general knowledge to make it match the others.",
    "- Do not write study questions, exercises or advice. This is a map of the material, not a " +
      "lesson about it.",
    "- Do not copy tables in as nodes. Turn each row that matters into a leaf that names its " +
      "subject and its number.",
  ].join("\n");
}
