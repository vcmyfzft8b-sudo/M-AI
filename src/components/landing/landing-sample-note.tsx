"use client";

import type { CSSProperties, ReactNode } from "react";

import { Emoji } from "@/components/msym";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

/*
 * The landing's sample note, in the markup the note tab renders.
 *
 * `NoteReadAloud` draws a note as blocks of spoken words — `.markdown.lecture-markdown` around
 * `.note-read-content`, one `.note-read-block` per block and one `.note-read-word` per word, so
 * read-aloud can mark each word as it is spoken. This is that tree, transcribed, with the flow
 * demo's sample lecture (`flowDemo.note.*`) in it. Headings wear `.lecture-heading-highlight`,
 * the takeaway is a `blockquote[data-callout-kind="key_takeaway"]`, exactly as a generated note
 * comes out.
 *
 * - `written` reveals the blocks one at a time, for the flow demo's note being written.
 * - `readWord` is read-aloud's position: every word before it is read, it is the current one.
 */

type SampleBlock = { kind: "h2" | "p" | "callout" | "li"; text: string };

function sampleBlocks(t: Translate<MessageKey>): SampleBlock[] {
  return [
    { kind: "h2", text: t("flowDemo.note.overview") },
    {
      kind: "p",
      text: `${t("flowDemo.note.leadA")} ${t("flowDemo.note.leadMid")} ${t("flowDemo.note.leadB")}.`,
    },
    { kind: "callout", text: `${t("flowDemo.note.keyLabel")}: ${t("flowDemo.note.keyBody")}` },
    { kind: "h2", text: t("flowDemo.note.typesHeading") },
    { kind: "li", text: `${t("flowDemo.note.bullet1Term")} ${t("flowDemo.note.bullet1Rest")}` },
    { kind: "li", text: `${t("flowDemo.note.bullet2Term")} ${t("flowDemo.note.bullet2Rest")}` },
    { kind: "li", text: `${t("flowDemo.note.bullet3Term")} ${t("flowDemo.note.bullet3Rest")}` },
  ];
}

/** How many blocks the note is written out in. */
export const SAMPLE_NOTE_BLOCKS = 7;

/** How many words read-aloud walks through, headings included, as the app counts them. */
export function sampleNoteWordCount(t: Translate<MessageKey>): number {
  return sampleBlocks(t).reduce((total, block) => total + splitWords(block.text).length, 0);
}

function splitWords(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

const WRITE_IN = "memo-note-in 260ms cubic-bezier(0.22,1,0.36,1) both";

export function LandingSampleNote({
  t,
  emoji,
  title,
  meta,
  written = SAMPLE_NOTE_BLOCKS,
  readWord = null,
}: {
  t: Translate<MessageKey>;
  emoji: string;
  title: string;
  meta: string;
  written?: number;
  readWord?: number | null;
}) {
  let wordIndex = 0;

  /* Every block is in the layout from the start and only becomes visible when it is
     written, so the note fills in downwards and nothing already on screen moves. */
  const shown = (index: number): CSSProperties => ({
    visibility: index < written ? "visible" : "hidden",
    animation: index < written ? WRITE_IN : "none",
  });

  const words = (text: string): ReactNode[] =>
    splitWords(text).flatMap((word, i) => {
      const index = wordIndex++;
      const state =
        readWord === null ? "" : index < readWord ? "read" : index === readWord ? "current" : "";
      const span = (
        <span key={`w${index}`} className={`note-read-word ${state}`.trim()} data-word-index={index}>
          {word}
        </span>
      );
      return i === 0 ? [span] : [<span key={`s${index}`}> </span>, span];
    });

  const blocks = sampleBlocks(t);
  const groups: ReactNode[] = [];
  let list: ReactNode[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    groups.push(
      <div key={`list${groups.length}`} className="note-read-block-group">
        <div className="note-read-block">
          <ul>{list}</ul>
        </div>
      </div>,
    );
    list = [];
  };

  blocks.forEach((block, index) => {
    if (block.kind === "li") {
      list.push(
        <li key={index} style={shown(index)}>
          {words(block.text)}
        </li>,
      );
      return;
    }

    flushList();
    const body =
      block.kind === "h2" ? (
        <h2>
          <span className="lecture-heading-highlight">{words(block.text)}</span>
        </h2>
      ) : block.kind === "callout" ? (
        <blockquote data-callout-kind="key_takeaway">{words(block.text)}</blockquote>
      ) : (
        <p>{words(block.text)}</p>
      );

    groups.push(
      <div key={index} className="note-read-block-group" style={shown(index)}>
        <div className="note-read-block">{body}</div>
      </div>,
    );
  });
  flushList();

  /* The title and date arrive with the first block, not before it: an empty note is an empty screen. */
  const head: CSSProperties = { visibility: written > 0 ? "visible" : "hidden" };

  return (
    <>
      <div className="memo-note-head" style={head}>
        <span className="memo-note-head-emoji">
          <Emoji symbol={emoji} size="1.45rem" />
        </span>
        <h1>{title}</h1>
      </div>
      <div className="memo-note-date" style={head}>
        <span>{meta}</span>
      </div>
      <div className="memo-note-body">
        <div className="markdown lecture-markdown">
          <div className="note-read-content">
            <div className="markdown text-sm text-stone-700 sm:text-[15px]">{groups}</div>
          </div>
        </div>
      </div>
    </>
  );
}
