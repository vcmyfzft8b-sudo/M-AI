import "server-only";

import { z } from "zod";

import { generateStructuredObject } from "@/lib/ai/json";
import type { NoteTtsHighlightColorId } from "@/lib/note-tts-settings";
import {
  MAX_NOTE_ANNOTATIONS,
  parseStoredNoteDoc,
  readLectureArtifactForNoteDoc,
  saveEditableNoteDoc,
} from "@/lib/note-doc-server";
import {
  parseNoteTtsDocument,
  type NoteTtsBlock,
  type NoteTtsInlineToken,
} from "@/lib/note-tts-text";
import type { NoteAnnotation } from "@/lib/note-doc";

const AUTO_ANNOTATION_ID_PREFIX = "auto-note-";
const AUTO_HIGHLIGHT_COLOR_ID: NoteTtsHighlightColorId = "green";
const AUTO_ANNOTATION_SAFETY_LIMIT = Math.min(MAX_NOTE_ANNOTATIONS, 120);
const MAX_SPAN_WORDS = 12;
const MIN_SPAN_TEXT_LENGTH = 2;
const sectionAnnotationPlanSchema = z.object({
  annotations: z.array(
    z.object({
      exactText: z.string().min(MIN_SPAN_TEXT_LENGTH).max(140),
      importance: z.number().int().min(1).max(10),
    }),
  ).max(AUTO_ANNOTATION_SAFETY_LIMIT),
});
const noteAnnotationReviewSchema = z.object({
  selectedCandidateIds: z.array(z.string().min(1)).max(AUTO_ANNOTATION_SAFETY_LIMIT),
});

type PlannedAnnotation = z.infer<typeof sectionAnnotationPlanSchema>["annotations"][number] & {
  sectionIndex: number;
};
type ReviewableAnnotation = PlannedAnnotation & {
  candidateId: string;
  sectionTitle: string;
};

type AnnotationSourceSection = {
  sectionIndex: number;
  title: string;
  text: string;
  words: Array<Extract<NoteTtsInlineToken, { type: "word" }>>;
};

function normalizeWords(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .match(/[\p{L}\p{N}]+(?:[.'’_-][\p{L}\p{N}]+)*/gu) ?? [];
}

function wordTokens(tokens: NoteTtsInlineToken[]) {
  return tokens.filter(
    (token): token is Extract<NoteTtsInlineToken, { type: "word" }> => token.type === "word",
  );
}

function tokenText(tokens: NoteTtsInlineToken[]) {
  return tokens.map((token) => token.text).join("");
}

function blockText(block: NoteTtsBlock) {
  if (block.kind === "table") {
    return block.rows
      .flatMap((row) => row.cells.map((cell) => tokenText(cell.tokens)))
      .join(" ");
  }

  if (block.kind === "list") {
    return block.items.map((item) => tokenText(item.tokens)).join(" ");
  }

  return tokenText(block.tokens);
}

function blockWords(block: NoteTtsBlock) {
  if (block.kind === "table") {
    return block.rows.flatMap((row) => row.cells.flatMap((cell) => wordTokens(cell.tokens)));
  }

  if (block.kind === "list") {
    return block.items.flatMap((item) => wordTokens(item.tokens));
  }

  return wordTokens(block.tokens);
}

function buildAnnotationSourceSections(markdown: string): AnnotationSourceSection[] {
  const document = parseNoteTtsDocument(markdown);
  const sections: AnnotationSourceSection[] = [];
  let current: AnnotationSourceSection | null = null;

  function pushCurrent() {
    if (!current || current.words.length === 0 || current.text.trim().length < 40) {
      current = null;
      return;
    }

    sections.push({
      ...current,
      text: current.text.replace(/\s+/g, " ").trim().slice(0, 1800),
    });
    current = null;
  }

  for (const block of document.blocks) {
    if (block.kind === "heading" && (block.level ?? 3) <= 2) {
      pushCurrent();
      current = {
        sectionIndex: sections.length,
        title: tokenText(block.tokens).trim() || `Section ${sections.length + 1}`,
        text: "",
        words: [],
      };
      continue;
    }

    if (!current) {
      current = {
        sectionIndex: sections.length,
        title: "Uvod",
        text: "",
        words: [],
      };
    }

    current.text = `${current.text}\n${blockText(block)}`;
    current.words.push(...blockWords(block));
  }

  pushCurrent();

  return sections;
}

function findExactTextRange(params: {
  words: Array<Extract<NoteTtsInlineToken, { type: "word" }>>;
  exactText: string;
  startAfterWordIndex?: number;
}) {
  const needle = normalizeWords(params.exactText);

  if (needle.length === 0 || needle.length > MAX_SPAN_WORDS) {
    return null;
  }

  const haystack = params.words.map((word) => normalizeWords(word.text)[0] ?? "");
  const startAfterWordIndex = params.startAfterWordIndex;
  const startIndex =
    typeof startAfterWordIndex === "number"
      ? Math.max(
          0,
          params.words.findIndex((word) => word.wordIndex > startAfterWordIndex),
        )
      : 0;

  for (let index = startIndex; index <= haystack.length - needle.length; index += 1) {
    let matches = true;

    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return {
        startWordIndex: params.words[index].wordIndex,
        endWordIndex: params.words[index + needle.length - 1].wordIndex,
      };
    }
  }

  return null;
}

async function planAiSectionAnnotations(section: AnnotationSourceSection) {
  return generateStructuredObject({
    schema: sectionAnnotationPlanSchema,
    maxOutputTokens: 700,
    instructions: `You grade and select the most important short highlight spans from one section of generated study notes.

Return only exact text spans that appear verbatim in this section. The app maps exactText back to editable highlights, so every exactText must be copied from the section exactly, without paraphrasing.

Annotation policy:
- Select only the smallest important phrase, term, name, formula label, concept name, method name, category name, or short cause/effect phrase.
- Do not annotate whole sentences, whole bullets, whole paragraphs, or generic filler.
- Select short exact spans, not long blocks of text.
- Every annotation will be displayed as a highlight. Do not return underline annotations.
- You decide how many highlights this section needs. Return every span that is genuinely important enough for a learner to remember.
- Do not pad the result with weak candidates, but do not skip important spans because of any count.
- Use importance as your own judgment score for how central the span is.
- Avoid annotating headings unless the heading itself is the key concept.
- Avoid duplicate or near-duplicate annotations.
- Be selective about what matters, but annotate all core terms, names, categories, process names, system types, formulas, variables, and critical relationships that should stand out while studying.
- Do not highlight every ordinary list item, component, or repeated keyword. A span should be useful as a study anchor on its own.
- If there are formulas, annotate the formula name or variable names if they appear as normal text; do not return raw markdown math unless it appears exactly as ordinary text.

Return JSON only.`,
    input: JSON.stringify({
      sectionIndex: section.sectionIndex,
      title: section.title,
      text: section.text,
    }),
  });
}

async function reviewAiNoteAnnotations(candidates: ReviewableAnnotation[]) {
  if (candidates.length === 0) {
    return candidates;
  }

  const review = await generateStructuredObject({
    schema: noteAnnotationReviewSchema,
    maxOutputTokens: 1200,
    instructions: `You are doing the final highlight pass for a complete generated study note.

You will receive candidate highlights from all note sections. Decide which candidates should remain highlighted in the final note.

Final highlight policy:
- You decide how many highlights the note needs. There is no target count.
- Keep a candidate only when it marks something genuinely important for studying the whole note.
- Prefer concepts, definitions, named systems, formula names, variables, process names, classifications, and critical cause/effect relationships.
- Remove generic single words, filler, weak supporting words, duplicates, and repeated concepts that are already highlighted better elsewhere.
- Do not keep highlights just because they were proposed by a section pass.
- Do not remove an important candidate because of any count. Judge importance and usefulness.
- Every selected candidate will be displayed as a highlight. No underlines are used.

Return JSON only with selectedCandidateIds.`,
    input: JSON.stringify({
      candidates: candidates.map((candidate) => ({
        candidateId: candidate.candidateId,
        sectionTitle: candidate.sectionTitle,
        exactText: candidate.exactText,
        importance: candidate.importance,
      })),
    }),
  });

  const selectedIds = new Set(review.selectedCandidateIds);

  return candidates.filter((candidate) => selectedIds.has(candidate.candidateId));
}

async function planAiNoteAnnotations(markdown: string) {
  const sections = buildAnnotationSourceSections(markdown);
  const planned: ReviewableAnnotation[] = [];

  for (const section of sections) {
    const sectionPlan = await planAiSectionAnnotations(section);

    planned.push(
      ...sectionPlan.annotations.map((annotation, annotationIndex) => ({
        ...annotation,
        candidateId: `${section.sectionIndex}:${annotationIndex}:${annotation.exactText}`,
        sectionIndex: section.sectionIndex,
        sectionTitle: section.title,
      })),
    );
  }

  return reviewAiNoteAnnotations(planned);
}

function buildAnnotationsFromPlan(params: {
  markdown: string;
  plan: PlannedAnnotation[];
}) {
  const sections = buildAnnotationSourceSections(params.markdown);
  const sectionByIndex = new Map(sections.map((section) => [section.sectionIndex, section]));
  const createdAt = new Date().toISOString();
  const usedRanges = new Set<string>();
  const usedWordIndices = new Set<number>();
  const annotations: NoteAnnotation[] = [];

  for (const planned of params.plan) {
    if (annotations.length >= AUTO_ANNOTATION_SAFETY_LIMIT) {
      break;
    }

    const section = sectionByIndex.get(planned.sectionIndex);

    if (!section) {
      continue;
    }

    const range = findExactTextRange({
      words: section.words,
      exactText: planned.exactText,
    });

    if (!range) {
      continue;
    }

    const rangeKey = `${range.startWordIndex}:${range.endWordIndex}`;

    if (usedRanges.has(rangeKey)) {
      continue;
    }

    let overlapsExistingAnnotation = false;

    for (let wordIndex = range.startWordIndex; wordIndex <= range.endWordIndex; wordIndex += 1) {
      if (usedWordIndices.has(wordIndex)) {
        overlapsExistingAnnotation = true;
        break;
      }
    }

    if (overlapsExistingAnnotation) {
      continue;
    }

    usedRanges.add(rangeKey);

    for (let wordIndex = range.startWordIndex; wordIndex <= range.endWordIndex; wordIndex += 1) {
      usedWordIndices.add(wordIndex);
    }

    annotations.push({
      id: `${AUTO_ANNOTATION_ID_PREFIX}${annotations.length + 1}`,
      kind: "highlight",
      colorId: AUTO_HIGHLIGHT_COLOR_ID,
      createdAt,
      ...range,
    });
  }

  return annotations.sort((left, right) => left.startWordIndex - right.startWordIndex);
}

export async function buildAutomaticNoteAnnotations(markdown: string) {
  const plan = await planAiNoteAnnotations(markdown);

  return buildAnnotationsFromPlan({
    markdown,
    plan,
  });
}

export async function attachAutomaticNoteAnnotations(params: {
  lectureId: string;
  structuredNotesMd: string;
}) {
  const automaticAnnotations = await buildAutomaticNoteAnnotations(params.structuredNotesMd);
  const artifact = await readLectureArtifactForNoteDoc(params.lectureId);

  if (!artifact) {
    return;
  }

  const storedDoc = parseStoredNoteDoc(artifact);
  const userAnnotations = storedDoc.annotations.filter(
    (annotation) => !annotation.id.startsWith(AUTO_ANNOTATION_ID_PREFIX),
  );
  const nextAnnotations = [...userAnnotations, ...automaticAnnotations].slice(
    0,
    MAX_NOTE_ANNOTATIONS,
  );

  await saveEditableNoteDoc({
    lectureId: params.lectureId,
    expectedRevision: artifact.editable_notes_revision ?? 0,
    doc: {
      ...storedDoc,
      annotations: nextAnnotations,
    },
  });
}
