import type { Json, LectureArtifactRow } from "@/lib/database.types";

export type NoteEditorMark = {
  type: string;
  attrs?: Record<string, Json | undefined>;
};

export type NoteEditorNode = {
  type: string;
  attrs?: Record<string, Json | undefined>;
  content?: NoteEditorNode[];
  text?: string;
  marks?: NoteEditorMark[];
};

export type NoteEditorDocument = {
  type: "doc";
  content: NoteEditorNode[];
};

export type EffectiveLectureArtifact =
  | (Pick<LectureArtifactRow, "structured_notes_md" | "editable_notes_md"> &
      Partial<Pick<LectureArtifactRow, "model_metadata">>)
  | null;

type EditableNotesMetadata = {
  doc?: unknown;
  markdown?: unknown;
  plainText?: unknown;
  revision?: unknown;
  updatedAt?: unknown;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_MEDIA_SRC_PATTERN = /\/api\/lectures\/[^/]+\/note-media\/([0-9a-f-]{36})(?:[?#].*)?$/i;
const MAX_NOTE_EDITOR_NODES = 2_000;
const MAX_NOTE_EDITOR_TEXT_LENGTH = 120_000;
const MAX_NOTE_EDITOR_JSON_BYTES = 900_000;

const ALLOWED_NODE_TYPES = new Set([
  "doc",
  "paragraph",
  "text",
  "heading",
  "bulletList",
  "orderedList",
  "listItem",
  "blockquote",
  "horizontalRule",
  "hardBreak",
  "codeBlock",
  "table",
  "tableRow",
  "tableCell",
  "tableHeader",
  "image",
]);

const ALLOWED_MARK_TYPES = new Set(["bold", "italic", "underline", "highlight", "strike", "code"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getEditableNotesMetadata(
  artifact: Partial<Pick<LectureArtifactRow, "model_metadata">> | null | undefined,
): EditableNotesMetadata {
  const metadata = isRecord(artifact?.model_metadata) ? artifact.model_metadata : {};
  const editableNotes = metadata.editableNotes;

  if (isRecord(editableNotes)) {
    return editableNotes;
  }

  return {};
}

export function getEditableNotesRevision(artifact: LectureArtifactRow) {
  if (typeof artifact.editable_notes_revision === "number") {
    return artifact.editable_notes_revision;
  }

  const metadataRevision = getEditableNotesMetadata(artifact).revision;
  return typeof metadataRevision === "number" && Number.isInteger(metadataRevision)
    ? metadataRevision
    : 0;
}

function isNoteEditorNode(value: unknown): value is NoteEditorNode {
  return isRecord(value) && typeof value.type === "string";
}

function escapeMarkdown(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/`/g, "\\`");
}

function escapeTableCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function getTextContent(nodes: NoteEditorNode[] | undefined): string {
  if (!nodes) {
    return "";
  }

  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.text ?? "";
      }

      if (node.type === "hardBreak") {
        return "\n";
      }

      if (node.type === "image") {
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        return alt ? `[${alt}]` : "";
      }

      return getTextContent(node.content);
    })
    .join("");
}

function markText(text: string, marks: NoteEditorMark[] | undefined) {
  if (!marks || marks.length === 0) {
    return escapeMarkdown(text);
  }

  return marks.reduce((current, mark) => {
    if (mark.type === "bold") {
      return `**${current}**`;
    }

    if (mark.type === "italic") {
      return `_${current}_`;
    }

    if (mark.type === "underline") {
      return `<u>${current}</u>`;
    }

    if (mark.type === "highlight") {
      return `<mark>${current}</mark>`;
    }

    if (mark.type === "strike") {
      return `~~${current}~~`;
    }

    if (mark.type === "code") {
      return `\`${current.replace(/`/g, "\\`")}\``;
    }

    return current;
  }, escapeMarkdown(text));
}

function inlineMarkdown(nodes: NoteEditorNode[] | undefined): string {
  if (!nodes) {
    return "";
  }

  return nodes
    .map((node) => {
      if (node.type === "text") {
        return markText(node.text ?? "", node.marks);
      }

      if (node.type === "hardBreak") {
        return "  \n";
      }

      if (node.type === "image") {
        const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
        const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
        return src ? `![${alt.replace(/\]/g, "\\]")}](${src})` : "";
      }

      return inlineMarkdown(node.content);
    })
    .join("");
}

function listItemMarkdown(item: NoteEditorNode, ordered: boolean, index: number) {
  const lines = (item.content ?? [])
    .map((child) => nodeToMarkdown(child))
    .filter(Boolean)
    .join("\n")
    .split("\n");
  const prefix = ordered ? `${index + 1}. ` : "- ";

  return lines
    .map((line, lineIndex) => `${lineIndex === 0 ? prefix : "  "}${line}`)
    .join("\n");
}

function tableToMarkdown(node: NoteEditorNode) {
  const rows = (node.content ?? []).filter((row) => row.type === "tableRow");

  if (rows.length === 0) {
    return "";
  }

  const cellsByRow = rows.map((row) =>
    (row.content ?? [])
      .filter((cell) => cell.type === "tableCell" || cell.type === "tableHeader")
      .map((cell) => escapeTableCell(getTextContent(cell.content))),
  );
  const columnCount = Math.max(...cellsByRow.map((row) => row.length));

  if (columnCount === 0) {
    return "";
  }

  const normalizedRows = cellsByRow.map((row) => [
    ...row,
    ...Array.from({ length: columnCount - row.length }, () => ""),
  ]);
  const [header, ...body] = normalizedRows;
  const separator = Array.from({ length: columnCount }, () => "---");

  return [header, separator, ...body]
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
}

function nodeToMarkdown(node: NoteEditorNode): string {
  if (node.type === "paragraph") {
    return inlineMarkdown(node.content);
  }

  if (node.type === "heading") {
    const level = typeof node.attrs?.level === "number" ? Math.min(Math.max(node.attrs.level, 1), 6) : 2;
    return `${"#".repeat(level)} ${inlineMarkdown(node.content)}`;
  }

  if (node.type === "blockquote") {
    return (node.content ?? [])
      .map((child) => nodeToMarkdown(child))
      .filter(Boolean)
      .join("\n")
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const ordered = node.type === "orderedList";
    return (node.content ?? [])
      .filter((item) => item.type === "listItem")
      .map((item, index) => listItemMarkdown(item, ordered, index))
      .join("\n");
  }

  if (node.type === "codeBlock") {
    return `\`\`\`\n${getTextContent(node.content)}\n\`\`\``;
  }

  if (node.type === "horizontalRule") {
    return "---";
  }

  if (node.type === "table") {
    return tableToMarkdown(node);
  }

  if (node.type === "image") {
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    const alt = typeof node.attrs?.alt === "string" ? node.attrs.alt : "";
    return src ? `![${alt.replace(/\]/g, "\\]")}](${src})` : "";
  }

  return inlineMarkdown(node.content);
}

export function noteEditorDocumentToMarkdown(doc: NoteEditorDocument) {
  return doc.content
    .map((node) => nodeToMarkdown(node).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

export function noteEditorDocumentToPlainText(doc: NoteEditorDocument) {
  return doc.content
    .map((node) => getTextContent([node]).trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function textNode(text: string, marks?: NoteEditorMark[]): NoteEditorNode | null {
  if (!text) {
    return null;
  }

  return marks?.length ? { type: "text", text, marks } : { type: "text", text };
}

function parseInlineMarkdown(value: string): NoteEditorNode[] {
  const nodes: NoteEditorNode[] = [];
  const pattern = /(!\[([^\]]*)\]\(([^)]+)\))|(\*\*([^*]+)\*\*)|(__([^_]+)__)|(<u>(.*?)<\/u>)|(<mark>(.*?)<\/mark>)|(`([^`]+)`)/gi;
  let index = 0;

  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0;
    const plain = textNode(value.slice(index, start));

    if (plain) {
      nodes.push(plain);
    }

    if (match[1]) {
      const src = match[3] ?? "";
      const alt = match[2] ?? "";
      nodes.push({
        type: "image",
        attrs: {
          src,
          alt,
          title: null,
        },
      });
    } else if (match[5]) {
      nodes.push({ type: "text", text: match[5], marks: [{ type: "bold" }] });
    } else if (match[7]) {
      nodes.push({ type: "text", text: match[7], marks: [{ type: "bold" }] });
    } else if (match[9]) {
      nodes.push({ type: "text", text: match[9], marks: [{ type: "underline" }] });
    } else if (match[11]) {
      nodes.push({ type: "text", text: match[11], marks: [{ type: "highlight" }] });
    } else if (match[13]) {
      nodes.push({ type: "text", text: match[13], marks: [{ type: "code" }] });
    }

    index = start + match[0].length;
  }

  const trailing = textNode(value.slice(index));

  if (trailing) {
    nodes.push(trailing);
  }

  return nodes;
}

function paragraphNode(value: string): NoteEditorNode {
  return {
    type: "paragraph",
    content: parseInlineMarkdown(value),
  };
}

function parseMarkdownTable(lines: string[]): NoteEditorNode | null {
  if (lines.length < 2) {
    return null;
  }

  const rows = [lines[0], ...lines.slice(2)].map((line, rowIndex) => {
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());

    return {
      type: "tableRow",
      content: cells.map((cell) => ({
        type: rowIndex === 0 ? "tableHeader" : "tableCell",
        attrs: {
          colspan: 1,
          rowspan: 1,
          colwidth: null,
        },
        content: [paragraphNode(cell)],
      })),
    };
  });

  return {
    type: "table",
    content: rows,
  };
}

function isTableSeparator(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

export function markdownToNoteEditorDocument(markdown: string): NoteEditorDocument {
  const content: NoteEditorNode[] = [];
  const lines = markdown.split(/\r?\n/);
  let index = 0;

  while (index < lines.length) {
    const rawLine = lines[index] ?? "";
    const trimmed = rawLine.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const tableLines = [rawLine, lines[index + 1] ?? ""];
      index += 2;

      while (index < lines.length && lines[index]?.trim().includes("|")) {
        tableLines.push(lines[index] ?? "");
        index += 1;
      }

      const table = parseMarkdownTable(tableLines);

      if (table) {
        content.push(table);
      }

      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);

    if (heading) {
      content.push({
        type: "heading",
        attrs: { level: heading[1].length },
        content: parseInlineMarkdown(heading[2]),
      });
      index += 1;
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];

      while (index < lines.length && lines[index]?.trim().startsWith(">")) {
        quoteLines.push((lines[index] ?? "").trim().replace(/^>\s?/, ""));
        index += 1;
      }

      content.push({
        type: "blockquote",
        content: [paragraphNode(quoteLines.join(" "))],
      });
      continue;
    }

    const unordered = /^[-*+]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);

    if (unordered || ordered) {
      const listType = ordered ? "orderedList" : "bulletList";
      const items: NoteEditorNode[] = [];

      while (index < lines.length) {
        const listLine = (lines[index] ?? "").trim();
        const match = listType === "orderedList"
          ? /^\d+[.)]\s+(.+)$/.exec(listLine)
          : /^[-*+]\s+(.+)$/.exec(listLine);

        if (!match) {
          break;
        }

        items.push({
          type: "listItem",
          content: [paragraphNode(match[1])],
        });
        index += 1;
      }

      content.push({
        type: listType,
        content: items,
      });
      continue;
    }

    const paragraphLines = [trimmed];
    index += 1;

    while (index < lines.length && lines[index]?.trim()) {
      const nextLine = lines[index]?.trim() ?? "";

      if (
        /^#{1,6}\s+/.test(nextLine) ||
        nextLine.startsWith(">") ||
        /^[-*+]\s+/.test(nextLine) ||
        /^\d+[.)]\s+/.test(nextLine) ||
        (nextLine.includes("|") && lines[index + 1] && isTableSeparator(lines[index + 1]))
      ) {
        break;
      }

      paragraphLines.push(nextLine);
      index += 1;
    }

    content.push(paragraphNode(paragraphLines.join(" ")));
  }

  return {
    type: "doc",
    content: content.length > 0 ? content : [paragraphNode("")],
  };
}

function collectValidation(
  node: NoteEditorNode,
  state: {
    nodeCount: number;
    textLength: number;
    errors: string[];
  },
) {
  state.nodeCount += 1;

  if (!ALLOWED_NODE_TYPES.has(node.type)) {
    state.errors.push(`Unsupported note node: ${node.type}`);
  }

  if (node.type === "text") {
    state.textLength += (node.text ?? "").length;
  }

  for (const mark of node.marks ?? []) {
    if (!ALLOWED_MARK_TYPES.has(mark.type)) {
      state.errors.push(`Unsupported note mark: ${mark.type}`);
    }
  }

  for (const child of node.content ?? []) {
    if (!isNoteEditorNode(child)) {
      state.errors.push("Invalid note child node.");
      continue;
    }

    collectValidation(child, state);
  }
}

export function validateNoteEditorDocument(value: unknown): {
  success: true;
  document: NoteEditorDocument;
} | {
  success: false;
  error: string;
} {
  if (!isRecord(value) || value.type !== "doc" || !Array.isArray(value.content)) {
    return { success: false, error: "Invalid note document." };
  }

  const jsonBytes = new TextEncoder().encode(JSON.stringify(value)).length;

  if (jsonBytes > MAX_NOTE_EDITOR_JSON_BYTES) {
    return { success: false, error: "Note is too large." };
  }

  const state = {
    nodeCount: 0,
    textLength: 0,
    errors: [] as string[],
  };

  for (const child of value.content) {
    if (!isNoteEditorNode(child)) {
      state.errors.push("Invalid note child node.");
      continue;
    }

    collectValidation(child, state);
  }

  if (state.nodeCount > MAX_NOTE_EDITOR_NODES) {
    state.errors.push("Note has too many blocks.");
  }

  if (state.textLength > MAX_NOTE_EDITOR_TEXT_LENGTH) {
    state.errors.push("Note text is too long.");
  }

  if (state.errors.length > 0) {
    return { success: false, error: state.errors[0] ?? "Invalid note document." };
  }

  return {
    success: true,
    document: value as NoteEditorDocument,
  };
}

export function collectNoteEditorMediaIds(doc: NoteEditorDocument) {
  const mediaIds = new Set<string>();

  function visit(node: NoteEditorNode) {
    if (node.type === "image") {
      const attrMediaId = typeof node.attrs?.mediaId === "string" ? node.attrs.mediaId : null;
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : null;
      const srcMediaId = src ? NOTE_MEDIA_SRC_PATTERN.exec(src)?.[1] ?? null : null;
      const mediaId = attrMediaId ?? srcMediaId;

      if (mediaId && UUID_PATTERN.test(mediaId)) {
        mediaIds.add(mediaId);
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  }

  for (const node of doc.content) {
    visit(node);
  }

  return Array.from(mediaIds);
}

export function getEffectiveStructuredNotesMd(artifact: EffectiveLectureArtifact) {
  const edited = artifact?.editable_notes_md?.trim();

  if (edited) {
    return edited;
  }

  const metadataMarkdown = getEditableNotesMetadata(artifact).markdown;

  if (typeof metadataMarkdown === "string" && metadataMarkdown.trim()) {
    return metadataMarkdown;
  }

  return artifact?.structured_notes_md ?? "";
}

export function getInitialNoteEditorDocument(artifact: LectureArtifactRow): NoteEditorDocument {
  const saved = validateNoteEditorDocument(artifact.editable_notes_doc);

  if (saved.success) {
    return saved.document;
  }

  const metadataSaved = validateNoteEditorDocument(getEditableNotesMetadata(artifact).doc);

  if (metadataSaved.success) {
    return metadataSaved.document;
  }

  return markdownToNoteEditorDocument(getEffectiveStructuredNotesMd(artifact));
}

export function noteEditorImageAttrs(params: {
  lectureId: string;
  mediaId: string;
  alt?: string | null;
}) {
  return {
    src: `/api/lectures/${params.lectureId}/note-media/${params.mediaId}`,
    mediaId: params.mediaId,
    alt: params.alt ?? "",
    title: null,
  };
}
