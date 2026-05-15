"use client";

import { Extension } from "@tiptap/core";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TableRow from "@tiptap/extension-table-row";
import Underline from "@tiptap/extension-underline";
import { Plugin } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  Eraser,
  Highlighter,
  ImagePlus,
  Italic,
  Loader2,
  Underline as UnderlineIcon,
} from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NoteReadAloud } from "@/components/note-read-aloud";
import type { LectureArtifactRow } from "@/lib/database.types";
import {
  getEditableNotesRevision,
  getEffectiveStructuredNotesMd,
  getInitialNoteEditorDocument,
  markdownToNoteEditorDocument,
  type NoteEditorDocument,
} from "@/lib/note-editor";
import { stripLeadingRedundantHeading } from "@/lib/note-tts-text";

type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";

const AUTOSAVE_DELAY_MS = 900;

const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute("data-media-id"),
        renderHTML: (attributes) =>
          attributes.mediaId
            ? {
                "data-media-id": attributes.mediaId,
              }
            : {},
      },
    };
  },
});

const SelectedNoteBlock = Extension.create({
  name: "selectedNoteBlock",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const { selection } = state;

            if (!selection.empty || selection.$from.depth < 1) {
              return null;
            }

            const from = selection.$from.before(1);
            const to = selection.$from.after(1);

            return DecorationSet.create(state.doc, [
              Decoration.node(from, to, {
                class: "editable-note-selected-block",
              }),
            ]);
          },
        },
      }),
    ];
  },
});

function parseInitialDocument(
  artifact: LectureArtifactRow,
  lectureTitle: string | null,
): NoteEditorDocument {
  const savedDocument = getInitialNoteEditorDocument(artifact);

  if (artifact.editable_notes_doc) {
    return savedDocument;
  }

  return savedDocument.content.length > 0
    ? savedDocument
    : markdownToNoteEditorDocument(
        stripLeadingRedundantHeading(getEffectiveStructuredNotesMd(artifact), lectureTitle),
      );
}

function getSaveLabel(state: SaveState) {
  if (state === "saving") {
    return "Shranjujem";
  }

  if (state === "unsaved") {
    return "Neshranjene spremembe";
  }

  if (state === "conflict") {
    return "Osveži zapisek";
  }

  if (state === "error") {
    return "Napaka pri shranjevanju";
  }

  return "Shranjeno";
}

export function EditableLectureNotes({
  lectureId,
  lectureTitle,
  artifact,
}: {
  lectureId: string;
  lectureTitle: string | null;
  artifact: LectureArtifactRow;
}) {
  const initialDocument = useMemo(
    () => parseInitialDocument(artifact, lectureTitle),
    [artifact, lectureTitle],
  );
  const initialMarkdown = useMemo(
    () => stripLeadingRedundantHeading(getEffectiveStructuredNotesMd(artifact), lectureTitle),
    [artifact, lectureTitle],
  );
  const shellRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const revisionRef = useRef(getEditableNotesRevision(artifact));
  const latestSavedJsonRef = useRef(JSON.stringify(initialDocument));
  const pendingDocumentRef = useRef<NoteEditorDocument | null>(null);
  const isSavingRef = useRef(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [selectedBlockIndex, setSelectedBlockIndex] = useState<number | null>(null);
  const [blockMenuStyle, setBlockMenuStyle] = useState<CSSProperties | null>(null);
  const selectedBlockIndexRef = useRef<number | null>(null);

  useEffect(() => {
    selectedBlockIndexRef.current = selectedBlockIndex;
  }, [selectedBlockIndex]);

  const saveDocument = useCallback(async (document: NoteEditorDocument) => {
    const serialized = JSON.stringify(document);

    if (serialized === latestSavedJsonRef.current || isSavingRef.current) {
      pendingDocumentRef.current = serialized === latestSavedJsonRef.current ? null : document;
      return;
    }

    isSavingRef.current = true;
    pendingDocumentRef.current = null;
    setSaveState("saving");
    setError(null);

    try {
      const response = await fetch(`/api/lectures/${lectureId}/notes`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          document,
          revision: revisionRef.current,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        code?: string;
        revision?: number;
        markdown?: string;
      } | null;

      if (!response.ok) {
        if (response.status === 409 || payload?.code === "revision_conflict") {
          setSaveState("conflict");
        } else {
          setSaveState("error");
        }

        setError(payload?.error ?? "Zapiska ni bilo mogoče shraniti.");
        return;
      }

      revisionRef.current = payload?.revision ?? revisionRef.current + 1;
      latestSavedJsonRef.current = serialized;
      setSavedMarkdown((current) => payload?.markdown ?? current);
      setSaveState("saved");
    } catch {
      setSaveState("error");
      setError("Zapiska ni bilo mogoče shraniti.");
    } finally {
      isSavingRef.current = false;

      if (pendingDocumentRef.current) {
        const nextDocument = pendingDocumentRef.current;
        pendingDocumentRef.current = null;
        window.setTimeout(() => {
          void saveDocument(nextDocument);
        }, 0);
      }
    }
  }, [lectureId]);

  const scheduleSave = useCallback((document: NoteEditorDocument) => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    setSaveState((current) => (current === "conflict" ? current : "unsaved"));
    saveTimerRef.current = window.setTimeout(() => {
      void saveDocument(document);
    }, AUTOSAVE_DELAY_MS);
  }, [saveDocument]);

  const syncSelectedBlock = useCallback((activeEditor: Editor) => {
    if (!activeEditor.state.selection.empty) {
      setSelectedBlockIndex(null);
      return;
    }

    setSelectedBlockIndex(activeEditor.state.selection.$from.index(0));
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4],
        },
      }),
      SelectedNoteBlock,
      Underline,
      Highlight,
      NoteImage.configure({
        allowBase64: false,
        inline: false,
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: initialDocument,
    editorProps: {
      attributes: {
        class: "editable-note-editor",
      },
      handleDOMEvents: {
        pointerdown: (view, event) => {
          const pointerEvent = event as PointerEvent;
          const position = view.posAtCoords({
            left: pointerEvent.clientX,
            top: pointerEvent.clientY,
          });

          if (position) {
            const nextBlockIndex = view.state.doc.resolve(position.pos).index(0);

            if (selectedBlockIndexRef.current === nextBlockIndex) {
              setSelectedBlockIndex(null);
              view.dom.blur();
              event.preventDefault();
              return true;
            }

            setSelectedBlockIndex(nextBlockIndex);
          }

          return false;
        },
      },
      handleClick: (view, position) => {
        setSelectedBlockIndex(view.state.doc.resolve(position).index(0));
        return false;
      },
    },
    onUpdate: ({ editor: updatedEditor }) => {
      scheduleSave(updatedEditor.getJSON() as NoteEditorDocument);
    },
    onSelectionUpdate: ({ editor: updatedEditor }) => {
      syncSelectedBlock(updatedEditor);
    },
    onTransaction: ({ editor: updatedEditor }) => {
      syncSelectedBlock(updatedEditor);
    },
    onFocus: ({ editor: focusedEditor }) => {
      syncSelectedBlock(focusedEditor);
    },
  });

  const closeBlockMenu = useCallback(() => {
    setSelectedBlockIndex(null);
    editor?.commands.blur();
  }, [editor]);

  const updateSelectedBlockChrome = useCallback(() => {
    const shell = shellRef.current;
    const editorRoot = shell?.querySelector(".editable-note-editor");

    if (!shell || !editorRoot) {
      setBlockMenuStyle(null);
      return;
    }

    const blocks = Array.from(editorRoot.children) as HTMLElement[];
    const selectedBlock =
      selectedBlockIndex === null ? null : blocks[selectedBlockIndex] ?? null;

    if (!selectedBlock) {
      setBlockMenuStyle(null);
      return;
    }

    setBlockMenuStyle({
      top: `${Math.max(0, selectedBlock.offsetTop)}px`,
    });
  }, [selectedBlockIndex]);

  useEffect(() => {
    updateSelectedBlockChrome();
    window.addEventListener("resize", updateSelectedBlockChrome);
    window.addEventListener("scroll", updateSelectedBlockChrome, true);

    return () => {
      window.removeEventListener("resize", updateSelectedBlockChrome);
      window.removeEventListener("scroll", updateSelectedBlockChrome, true);
    };
  }, [updateSelectedBlockChrome]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    function handleOutsidePointerDown(event: PointerEvent) {
      if (selectedBlockIndexRef.current === null) {
        return;
      }

      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      if (target.closest(".editable-note-block-menu") || target.closest(".editable-note-editor")) {
        return;
      }

      closeBlockMenu();
    }

    document.addEventListener("pointerdown", handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    };
  }, [closeBlockMenu]);

  const uploadImage = useCallback(async (file: File) => {
    if (!editor) {
      return;
    }

    setIsUploadingImage(true);
    setError(null);

    try {
      const body = new FormData();
      body.append("file", file);

      const response = await fetch(`/api/lectures/${lectureId}/note-media`, {
        method: "POST",
        body,
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        id?: string;
        src?: string;
        mediaId?: string;
        alt?: string;
        title?: string | null;
      } | null;

      if (!response.ok || !payload?.src) {
        setSaveState("error");
        setError(payload?.error ?? "Slike ni bilo mogoče dodati.");
        return;
      }

      const imageNode = {
        type: "image",
        attrs: {
          src: payload.src,
          mediaId: payload.mediaId ?? payload.id,
          alt: payload.alt ?? file.name,
          title: payload.title ?? null,
        },
      };

      if (selectedBlockIndex !== null && editor.state.doc.childCount > 0) {
        const targetIndex = Math.min(selectedBlockIndex, editor.state.doc.childCount - 1);
        let insertPosition = 0;

        for (let index = 0; index <= targetIndex; index += 1) {
          insertPosition += editor.state.doc.child(index).nodeSize;
        }

        editor.chain().focus().insertContentAt(insertPosition, imageNode).run();
        setSelectedBlockIndex(Math.min(targetIndex + 1, editor.state.doc.childCount));
      } else {
        editor.chain().focus().insertContent(imageNode).run();
      }
    } finally {
      setIsUploadingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }, [editor, lectureId, selectedBlockIndex]);

  const moveActiveBlock = useCallback((direction: -1 | 1) => {
    if (!editor) {
      return;
    }

    const json = editor.getJSON() as NoteEditorDocument;
    const content = [...(json.content ?? [])];
    const index = selectedBlockIndex ?? editor.state.selection.$from.index(0);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= content.length) {
      return;
    }

    const [node] = content.splice(index, 1);
    content.splice(nextIndex, 0, node);
    editor.commands.setContent(
      {
        ...json,
        content,
      },
      { emitUpdate: true },
    );
    setSelectedBlockIndex(nextIndex);
  }, [editor, selectedBlockIndex]);

  const canUseEditor = Boolean(editor) && saveState !== "conflict";
  const blockCount = editor?.state.doc.childCount ?? initialDocument.content.length;
  const canMoveSelectedBlockUp =
    canUseEditor && selectedBlockIndex !== null && selectedBlockIndex > 0;
  const canMoveSelectedBlockDown =
    canUseEditor && selectedBlockIndex !== null && selectedBlockIndex < blockCount - 1;

  return (
    <div
      ref={shellRef}
      className={`editable-notes-shell ${selectedBlockIndex !== null ? "is-block-menu-open" : ""}`}
    >
      <NoteReadAloud
        lectureId={lectureId}
        content={savedMarkdown}
        renderContent={false}
        toolbarClassName="editable-note-read-toolbar"
      />
      {editor && selectedBlockIndex !== null && blockMenuStyle ? (
        <div
          className="editable-note-block-menu"
          style={blockMenuStyle}
          aria-label="Urejanje izbranega dela zapiska"
          onMouseDown={(event) => event.preventDefault()}
        >
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => editor.chain().focus().toggleBold().run()}
              disabled={!canUseEditor}
              aria-label="Krepko"
              title="Krepko"
            >
              <Bold className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => editor.chain().focus().toggleItalic().run()}
              disabled={!canUseEditor}
              aria-label="Ležeče"
              title="Ležeče"
            >
              <Italic className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              disabled={!canUseEditor}
              aria-label="Podčrtaj"
              title="Podčrtaj"
            >
              <UnderlineIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => editor.chain().focus().toggleHighlight().run()}
              disabled={!canUseEditor}
              aria-label="Označi"
              title="Označi"
            >
              <Highlighter className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => editor.chain().focus().unsetAllMarks().run()}
              disabled={!canUseEditor}
              aria-label="Počisti oblikovanje"
              title="Počisti oblikovanje"
            >
              <Eraser className="h-4 w-4" />
            </button>
            <span className="editable-note-toolbar-separator" aria-hidden="true" />
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canUseEditor || isUploadingImage}
              aria-label="Dodaj sliko"
              title="Dodaj sliko"
            >
              {isUploadingImage ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ImagePlus className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => moveActiveBlock(-1)}
              disabled={!canMoveSelectedBlockUp}
              aria-label="Premakni blok gor"
              title="Premakni blok gor"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              className="editable-note-tool"
              onClick={() => moveActiveBlock(1)}
              disabled={!canMoveSelectedBlockDown}
              aria-label="Premakni blok dol"
              title="Premakni blok dol"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <span className={`editable-note-save-state ${saveState}`} title={getSaveLabel(saveState)}>
              {saveState === "saving" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : saveState === "error" || saveState === "conflict" ? (
                <AlertTriangle className="h-3.5 w-3.5" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              <span>{getSaveLabel(saveState)}</span>
            </span>
        </div>
      ) : null}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="editable-note-file-input"
        onChange={(event) => {
          const file = event.target.files?.[0];

          if (file) {
            void uploadImage(file);
          }
        }}
      />
      {editor ? (
        <BubbleMenu
          editor={editor}
          shouldShow={({ editor: bubbleEditor, state }) =>
            bubbleEditor.isEditable && !state.selection.empty
          }
        >
          <div className="editable-note-bubble-menu">
            <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} aria-label="Krepko">
              <Bold className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} aria-label="Ležeče">
              <Italic className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} aria-label="Podčrtaj">
              <UnderlineIcon className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={() => editor.chain().focus().toggleHighlight().run()} aria-label="Označi">
              <Highlighter className="h-3.5 w-3.5" />
            </button>
          </div>
        </BubbleMenu>
      ) : null}
      {error ? <p className="editable-note-error">{error}</p> : null}
      <EditorContent
        editor={editor}
        className="editable-note-content lecture-markdown"
      />
    </div>
  );
}
