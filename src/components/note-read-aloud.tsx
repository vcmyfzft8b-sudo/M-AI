"use client";

import { ArrowDown, ArrowUp, Loader2, MoreHorizontal, Pause, Play, X } from "lucide-react";
import Image from "next/image";
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { EmojiIcon } from "@/components/emoji-icon";
import { ViewportPortal } from "@/components/viewport-portal";
import {
  DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID,
  DEFAULT_NOTE_TTS_PLAYBACK_RATE,
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_HIGHLIGHT_COLORS,
  NOTE_TTS_PLAYBACK_RATES,
  NOTE_TTS_VOICES,
  type NoteTtsHighlightColorId,
  type NoteTtsPlaybackRate,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";
import {
  buildNoteTtsChunks,
  parseNoteTtsDocument,
  type NoteTtsBlock,
  type NoteTtsDocument,
  type NoteTtsInlineToken,
} from "@/lib/note-tts-text";
import type { NoteAnnotation, NoteMediaAsset, NoteMediaBlock } from "@/lib/note-doc";

type NoteReadMediaBlock = NoteMediaBlock & {
  media: NoteMediaAsset | null;
};

const NOTE_MEDIA_MIN_WIDTH_PERCENT = 35;
const NOTE_MEDIA_MAX_WIDTH_PERCENT = 100;
const NOTE_MEDIA_CENTER_X_PERCENT = 50;

type NoteMediaBlockLayoutUpdate = {
  widthPercent?: number;
  xPercent?: number;
};

type NoteMediaResizeSession = {
  pointerId: number;
  parentLeft: number;
  parentWidth: number;
  startLeft: number;
};

type NoteMediaXDragSession = {
  pointerId: number;
  startClientX: number;
  parentWidth: number;
  startLeft: number;
  widthPercent: number;
  moved: boolean;
};

type NoteWordAnnotation = {
  highlight: boolean;
  highlightColorId?: string;
  underline: boolean;
  underlineColorId?: string;
};

const NOTE_USER_HIGHLIGHT_COLORS = Object.fromEntries(
  NOTE_TTS_HIGHLIGHT_COLORS.map((color) => [color.id, color.currentBackground]),
) as Record<string, string>;

NOTE_USER_HIGHLIGHT_COLORS.yellow = NOTE_USER_HIGHLIGHT_COLORS.orange ?? "#fb923c";

function getUserHighlightColor(colorId: string | undefined) {
  return (
    NOTE_USER_HIGHLIGHT_COLORS[colorId ?? DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID] ??
    NOTE_USER_HIGHLIGHT_COLORS[DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID] ??
    "#fb923c"
  );
}

type TtsStatusResponse = {
  available: boolean;
  reason: string | null;
  tier: "paid" | "free";
  limitSeconds: number;
  secondsUsed: number;
  remainingSeconds: number;
  hasUnlimitedUsage?: boolean;
  chunkCount: number;
  totalWords: number;
  error?: string;
};

type TtsChunkResponse = {
  audioUrl: string;
  chunkIndex: number;
  chunkCount: number;
  wordStartIndex: number;
  wordEndIndex: number;
  durationMs: number;
  alignment: Array<{
    wordIndex: number;
    startMs: number;
    endMs: number;
  }>;
  limitSeconds: number;
  secondsUsed: number;
  remainingSeconds: number;
  hasUnlimitedUsage?: boolean;
  error?: string;
  code?: string;
};

type ActiveChunk = TtsChunkResponse;

const AUTO_SCROLL_IDLE_MS = 5_000;
const NOTE_TTS_VOICE_STORAGE_KEY = "memo-note-tts-voice";
const NOTE_TTS_RATE_STORAGE_KEY = "memo-note-tts-rate";
const NOTE_TTS_COLOR_STORAGE_KEY = "memo-note-tts-color";
const TTS_DAILY_LIMIT_MESSAGE = "Porabil si današnje poslušanje.";
const TTS_FREE_DAILY_LIMIT_MESSAGE =
  "Porabil si današnje brezplačno poslušanje. Nadgradi za več poslušanja.";
const TTS_PAID_DAILY_LIMIT_MESSAGE =
  "Porabil si današnje poslušanje. Znova lahko poslušaš po ponastavitvi ob 00:00.";
const READ_SETTINGS_SHEET_CLOSE_MS = 180;
const TTS_GENERATION_PROGRESS_LABEL = "Ustvarjam zvok";

function getTtsGenerationProgressPercent(startedAt: number) {
  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000);

  if (elapsedSeconds < 5) {
    return 5 + (elapsedSeconds / 5) * 14;
  }

  if (elapsedSeconds < 18) {
    return 19 + ((elapsedSeconds - 5) / 13) * 31;
  }

  if (elapsedSeconds < 42) {
    return 50 + ((elapsedSeconds - 18) / 24) * 28;
  }

  return Math.min(89, 78 + (1 - Math.exp(-(elapsedSeconds - 42) / 28)) * 11);
}

function createReadSessionId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getStoredVoice(): NoteTtsVoice {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_VOICE;
  }

  const storedVoice = window.localStorage.getItem(NOTE_TTS_VOICE_STORAGE_KEY);

  return NOTE_TTS_VOICES.find((voice) => voice === storedVoice) ?? DEFAULT_NOTE_TTS_VOICE;
}

function getStoredPlaybackRate(): NoteTtsPlaybackRate {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_PLAYBACK_RATE;
  }

  const storedRate = Number(window.localStorage.getItem(NOTE_TTS_RATE_STORAGE_KEY));

  return (
    NOTE_TTS_PLAYBACK_RATES.find((rate) => rate === storedRate) ??
    DEFAULT_NOTE_TTS_PLAYBACK_RATE
  );
}

function getStoredHighlightColorId(): NoteTtsHighlightColorId {
  if (typeof window === "undefined") {
    return DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID;
  }

  const storedColor = window.localStorage.getItem(NOTE_TTS_COLOR_STORAGE_KEY);

  return (
    NOTE_TTS_HIGHLIGHT_COLORS.find((color) => color.id === storedColor)?.id ??
    DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID
  );
}

function getChunkCacheKey(voice: NoteTtsVoice, chunkIndex: number) {
  return `${voice}:${chunkIndex}`;
}

function getDailyLimitDisplayMessage(status: TtsStatusResponse | null) {
  return status?.tier === "free" ? TTS_FREE_DAILY_LIMIT_MESSAGE : TTS_PAID_DAILY_LIMIT_MESSAGE;
}

function getPlaybackWordState(activeChunk: ActiveChunk, currentMs: number) {
  const firstTiming = activeChunk.alignment[0];

  if (!firstTiming) {
    return {
      completedWordIndex: activeChunk.wordStartIndex - 1,
      currentWordIndex: null,
    };
  }

  let completedWordIndex = activeChunk.wordStartIndex - 1;
  let currentWordIndex = firstTiming.wordIndex;

  for (const timing of activeChunk.alignment) {
    if (timing.startMs <= currentMs) {
      if (timing.wordIndex !== currentWordIndex) {
        completedWordIndex = currentWordIndex;
      }

      currentWordIndex = timing.wordIndex;
      continue;
    }

    break;
  }

  return {
    completedWordIndex,
    currentWordIndex,
  };
}

function getQuotaRemainingPercent(status: TtsStatusResponse | null) {
  if (!status) {
    return 0;
  }

  if (status.hasUnlimitedUsage) {
    return 100;
  }

  return Math.min(
    100,
    Math.max(0, Math.round((status.remainingSeconds / status.limitSeconds) * 100)),
  );
}

function QuotaUsageMenu({
  status,
  playbackRate,
  selectedVoice,
  highlightColorId,
  onPlaybackRateChange,
  onVoiceChange,
  onHighlightColorChange,
}: {
  status: TtsStatusResponse | null;
  playbackRate: NoteTtsPlaybackRate;
  selectedVoice: NoteTtsVoice;
  highlightColorId: NoteTtsHighlightColorId;
  onPlaybackRateChange: (rate: NoteTtsPlaybackRate) => void;
  onVoiceChange: (voice: NoteTtsVoice) => void;
  onHighlightColorChange: (colorId: NoteTtsHighlightColorId) => void;
}) {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const dragStartYRef = useRef<number | null>(null);
  const dragOffsetRef = useRef(0);
  const suppressClickRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isMenuClosing, setIsMenuClosing] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);

  const closeMenu = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    dragStartYRef.current = null;
    dragOffsetRef.current = 0;
    setDragOffset(0);
    setIsMenuOpen(false);
    setIsMenuClosing(false);
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  }, []);

  const animateCloseMenu = useCallback(() => {
    if (isMenuClosing) {
      return;
    }

    dragStartYRef.current = null;
    dragOffsetRef.current = window.innerHeight;
    setIsMenuClosing(true);
    setDragOffset(window.innerHeight);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      closeMenu();
    }, READ_SETTINGS_SHEET_CLOSE_MS);
  }, [closeMenu, isMenuClosing]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  function handleSheetPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;
    const interactiveTarget =
      target instanceof Element
        ? target.closest("button, input, textarea, select, a, .app-close-button")
        : null;
    const dragHandleTarget =
      target instanceof Element ? target.closest(".note-read-usage-drag-handle") : null;

    if (
      interactiveTarget &&
      !dragHandleTarget
    ) {
      return;
    }

    suppressClickRef.current = false;
    dragStartYRef.current = event.clientY;
    if (!interactiveTarget || dragHandleTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateDragOffset(clientY: number) {
    if (dragStartYRef.current === null) {
      return;
    }

    const nextOffset = Math.max(0, clientY - dragStartYRef.current);
    dragOffsetRef.current = nextOffset;
    if (nextOffset > 8) {
      suppressClickRef.current = true;
    }
    setDragOffset(nextOffset);
  }

  function handleSheetClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!suppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    suppressClickRef.current = false;
  }

  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      updateDragOffset(event.clientY);
    }

    function handleWindowPointerEnd() {
      if (dragOffsetRef.current > 80) {
        animateCloseMenu();
        return;
      }

      dragStartYRef.current = null;
      dragOffsetRef.current = 0;
      setDragOffset(0);
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [animateCloseMenu, isMenuOpen]);

  if (!status) {
    return null;
  }

  const remainingPercent = getQuotaRemainingPercent(status);
  const usedPercent = 100 - remainingPercent;
  const isLimitReached = !status.hasUnlimitedUsage && status.remainingSeconds <= 0;
  const remainingLabel = status.hasUnlimitedUsage ? "∞" : `${remainingPercent}%`;

  const menuContent = (
    <>
      <button
        type="button"
        className="mobile-sheet-drag-handle note-read-usage-drag-handle"
        aria-label="Povleci navzdol za zapiranje"
      />
      <div
        className="note-read-usage-bar"
        role="progressbar"
        aria-label={
          isLimitReached
            ? "Limit poslušanja dosežen"
            : status.hasUnlimitedUsage
              ? "Brez dnevne omejitve poslušanja"
              : `Preostalo ${remainingPercent} % dnevnega poslušanja, porabljeno ${usedPercent} %`
        }
        aria-valuetext={
          status.hasUnlimitedUsage
            ? "Brez dnevne omejitve poslušanja"
            : `${remainingPercent} % preostalo, ${usedPercent} % porabljeno`
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remainingPercent}
      >
        <span className="note-read-usage-fill" style={{ width: `${remainingPercent}%` }} />
        <span className="note-read-usage-bar-label">{remainingLabel}</span>
      </div>
      <div className="note-read-usage-reset">
        {status.hasUnlimitedUsage ? "Brez dnevne omejitve" : "Ponastavi se ob 00:00"}
      </div>
      <div className="note-read-settings-divider" />
      <div className="note-read-setting-group">
        <span className="note-read-setting-label">Hitrost</span>
        <div className="note-read-rate-options" role="group" aria-label="Hitrost branja">
          {NOTE_TTS_PLAYBACK_RATES.map((rate) => (
            <button
              key={rate}
              type="button"
              className={`note-read-rate-option ${playbackRate === rate ? "active" : ""}`}
              onClick={() => onPlaybackRateChange(rate)}
            >
              {rate}x
            </button>
          ))}
        </div>
      </div>
      <label className="note-read-setting-group">
        <span className="note-read-setting-label">Glas</span>
        <span className="note-read-setting-select-wrap">
          <select
            className="note-read-setting-select"
            value={selectedVoice}
            onChange={(event) => {
              const nextVoice = NOTE_TTS_VOICES.find((voice) => voice === event.target.value);

              if (nextVoice) {
                onVoiceChange(nextVoice);
              }
            }}
          >
            {NOTE_TTS_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </span>
      </label>
      <div className="note-read-setting-group">
        <span className="note-read-setting-label">Barva</span>
        <div className="note-read-color-options" role="group" aria-label="Barva označevanja">
          {NOTE_TTS_HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              className={`note-read-color-option ${
                highlightColorId === color.id ? "active" : ""
              }`}
              onClick={() => onHighlightColorChange(color.id)}
              aria-label={color.label}
              title={color.label}
              style={{ "--note-read-swatch-color": color.currentBackground } as CSSProperties}
            />
          ))}
        </div>
      </div>
    </>
  );

  return (
    <>
      <details
        ref={menuRef}
        className={`note-read-usage-menu ${isLimitReached ? "limit" : ""}`}
        onToggle={(event) => {
          const isOpen = event.currentTarget.open;
          setIsMenuOpen(isOpen);
          if (isOpen) {
            setIsMenuClosing(false);
            dragStartYRef.current = null;
            dragOffsetRef.current = 0;
            setDragOffset(0);
          }
        }}
      >
        <summary
          className="note-read-usage-trigger"
          aria-label={
            isLimitReached
              ? "Limit poslušanja dosežen"
              : status.hasUnlimitedUsage
                ? "Brez dnevne omejitve poslušanja"
              : `Preostalo ${remainingPercent} % dnevnega poslušanja`
          }
          title="Poraba poslušanja"
        >
          <EmojiIcon
            className="library-folder-chevron note-read-usage-chevron"
            symbol="▾"
            size="0.95rem"
          />
        </summary>
        <div className="note-read-usage-popover note-read-usage-inline-popover">
          {menuContent}
        </div>
      </details>
      {isMenuOpen ? (
        <ViewportPortal>
          <button
            type="button"
            className="note-read-usage-mobile-backdrop"
            onClick={animateCloseMenu}
            aria-label="Zapri nastavitve poslušanja"
          />
          <div
            className="note-read-usage-popover note-read-usage-mobile-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Nastavitve poslušanja"
            onPointerDown={handleSheetPointerDown}
            onClickCapture={handleSheetClickCapture}
            style={
              dragOffset > 0
                ? { transform: `translateY(${dragOffset}px)` }
                : undefined
            }
          >
            {menuContent}
          </div>
        </ViewportPortal>
      ) : null}
    </>
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    code?: string;
    error?: string;
  };

  if (!response.ok) {
    const message = payload.error || "Poslušanja ni bilo mogoče pripraviti.";

    if (payload.code === "tts_daily_limit_reached") {
      throw new Error(TTS_DAILY_LIMIT_MESSAGE);
    }

    if (response.status === 429 || message.includes("HTTP 429")) {
      throw new Error("Poslušanje se še pripravlja. Poskusi znova čez trenutek.");
    }

    throw new Error(message);
  }

  return payload;
}

function WordToken({
  token,
  completedWordIndex,
  currentWordIndex,
  annotation,
  renderHighlight = true,
}: {
  token: Extract<NoteTtsInlineToken, { type: "word" }>;
  completedWordIndex: number;
  currentWordIndex: number | null;
  annotation?: NoteWordAnnotation;
  renderHighlight?: boolean;
}) {
  const stateClass =
    token.wordIndex === currentWordIndex
      ? "current"
      : token.wordIndex <= completedWordIndex
        ? "read"
        : "";
  const annotationClass = [
    annotation?.highlight && renderHighlight ? "user-highlight" : "",
    annotation?.underline ? "user-underline" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      className={`note-read-word ${stateClass} ${annotationClass}`}
      style={
        (annotation?.highlight && renderHighlight) || annotation?.underline
          ? ({
              ...(annotation.highlight && renderHighlight
                ? {
                    "--note-user-highlight-bg": getUserHighlightColor(annotation.highlightColorId),
                  }
                : {}),
              ...(annotation.underline
                ? {
                    "--note-user-underline-color": getUserHighlightColor(annotation.underlineColorId),
                  }
                : {}),
            } as CSSProperties)
          : undefined
      }
      data-word-index={token.wordIndex}
    >
      {token.text}
    </span>
  );
}

function renderTokens(params: {
  tokens: NoteTtsInlineToken[];
  completedWordIndex: number;
  currentWordIndex: number | null;
  wordAnnotations: Map<number, NoteWordAnnotation>;
}) {
  const rendered: ReactNode[] = [];
  let index = 0;

  while (index < params.tokens.length) {
    const token = params.tokens[index];

    if (token.type === "word") {
      const annotation = params.wordAnnotations.get(token.wordIndex);

      if (annotation?.highlight) {
        const runTokens: NoteTtsInlineToken[] = [token];
        let cursor = index + 1;

        while (cursor < params.tokens.length) {
          const candidate = params.tokens[cursor];
          const following = params.tokens[cursor + 1];

          if (
            candidate?.type === "text" &&
            following?.type === "word" &&
            params.wordAnnotations.get(following.wordIndex)?.highlight
          ) {
            runTokens.push(candidate, following);
            cursor += 2;
            continue;
          }

          break;
        }

        const colorId = annotation.highlightColorId;
        rendered.push(
          <span
            key={`highlight-run-${token.wordIndex}`}
            className="note-read-highlight-range user-highlight"
            style={
              {
                "--note-user-highlight-bg": getUserHighlightColor(colorId),
              } as CSSProperties
            }
          >
            {runTokens.map((runToken, runIndex) =>
              runToken.type === "text" ? (
                <span key={`highlight-text-${index + runIndex}`}>{runToken.text}</span>
              ) : (
                <WordToken
                  key={`highlight-word-${runToken.wordIndex}`}
                  token={runToken}
                  completedWordIndex={params.completedWordIndex}
                  currentWordIndex={params.currentWordIndex}
                  annotation={params.wordAnnotations.get(runToken.wordIndex)}
                  renderHighlight={false}
                />
              ),
            )}
          </span>,
        );
        index = cursor;
        continue;
      }

      rendered.push(
        <WordToken
          key={`word-${token.wordIndex}`}
          token={token}
          completedWordIndex={params.completedWordIndex}
          currentWordIndex={params.currentWordIndex}
          annotation={annotation}
        />,
      );
      index += 1;
      continue;
    }

    if (token.type === "text") {
      rendered.push(<span key={`text-${index}`}>{token.text}</span>);
      index += 1;
      continue;
    }
  }

  return rendered;
}

function getLeadingLabelTokenEnd(tokens: NoteTtsInlineToken[]) {
  let text = "";
  let wordCount = 0;
  let labelEnd: number | null = null;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    text += token.text;

    if (token.type === "word") {
      wordCount += 1;
    }

    if (token.text.includes(":")) {
      labelEnd = text.length <= 72 && wordCount <= 8 ? index + 1 : null;
      break;
    }

    if (text.length > 72 || wordCount > 8) {
      return null;
    }
  }

  if (!labelEnd) {
    return null;
  }

  const label = text
    .replace(/[:\s]+$/g, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const importantLabelPattern =
    /^(definicija|kljucno|pomembno|pazi|pogosta napaka|primer|razlika|proces|korak|formula|pravilo|cilj|vzrok|posledica|prednost|slabost|problem|resitev|definition|key takeaway|important|common mistake|example|difference|process|step|formula|rule|goal|cause|effect|benefit|risk|problem|solution)\b/;

  return importantLabelPattern.test(label) ? labelEnd : null;
}

function renderListItemTokens(params: {
  tokens: NoteTtsInlineToken[];
  completedWordIndex: number;
  currentWordIndex: number | null;
  wordAnnotations: Map<number, NoteWordAnnotation>;
}) {
  const labelEnd = getLeadingLabelTokenEnd(params.tokens);

  if (!labelEnd) {
    return renderTokens(params);
  }

  return (
    <>
      <span className="note-read-leading-label">
        {renderTokens({
          ...params,
          tokens: params.tokens.slice(0, labelEnd),
        })}
      </span>
      {renderTokens({
        ...params,
        tokens: params.tokens.slice(labelEnd),
      })}
    </>
  );
}

function ReadAlongBlock({
  block,
  completedWordIndex,
  currentWordIndex,
  wordAnnotations,
}: {
  block: NoteTtsBlock;
  completedWordIndex: number;
  currentWordIndex: number | null;
  wordAnnotations: Map<number, NoteWordAnnotation>;
}) {
  if (block.kind === "heading") {
    const children = renderTokens({
      tokens: block.tokens,
      completedWordIndex,
      currentWordIndex,
      wordAnnotations,
    });

    return block.level && block.level <= 2 ? (
      <h2>
        <span className="lecture-heading-highlight">{children}</span>
      </h2>
    ) : (
      <h3>{children}</h3>
    );
  }

  if (block.kind === "callout") {
    const children = renderTokens({
      tokens: block.tokens,
      completedWordIndex,
      currentWordIndex,
      wordAnnotations,
    });

    return <blockquote data-callout-kind={block.calloutKind}>{children}</blockquote>;
  }

  if (block.kind === "list") {
    const ListTag = block.ordered ? "ol" : "ul";

    return (
      <ListTag>
        {block.items.map((item) => (
          <li key={item.id}>
            {renderListItemTokens({
              tokens: item.tokens,
              completedWordIndex,
              currentWordIndex,
              wordAnnotations,
            })}
          </li>
        ))}
      </ListTag>
    );
  }

  if (block.kind === "table") {
    return (
      <div className="note-read-table-wrap">
        <table>
          <tbody>
            {block.rows.map((row) => (
              <tr key={row.id}>
                {row.cells.map((cell) => {
                  const CellTag = cell.header ? "th" : "td";

                  return (
                    <CellTag key={cell.id}>
                      {renderTokens({
                        tokens: cell.tokens,
                        completedWordIndex,
                        currentWordIndex,
                        wordAnnotations,
                      })}
                    </CellTag>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const children = renderTokens({
    tokens: block.tokens,
    completedWordIndex,
    currentWordIndex,
    wordAnnotations,
  });

  return <p>{children}</p>;
}

function InlineNoteMedia({
  block,
  selected,
  deleting,
  onSelect,
  onMove,
  onLayoutChange,
  onDelete,
}: {
  block: NoteReadMediaBlock;
  selected: boolean;
  deleting?: boolean;
  onSelect?: (blockId: string) => void;
  onMove?: (blockId: string, direction: "up" | "down") => void;
  onLayoutChange?: (blockId: string, update: NoteMediaBlockLayoutUpdate) => void;
  onDelete?: (mediaId: string) => void;
}) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [liveLayout, setLiveLayout] = useState<NoteMediaBlockLayoutUpdate | null>(null);
  const mediaRef = useRef<HTMLElement | null>(null);
  const liveLayoutRef = useRef<NoteMediaBlockLayoutUpdate | null>(null);
  const resizeSessionRef = useRef<NoteMediaResizeSession | null>(null);
  const xDragSessionRef = useRef<NoteMediaXDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const isSavingPreview = block.media?.signedUrl.startsWith("blob:") ?? false;
  const actionsDisabled = deleting || isSavingPreview;
  const storedWidthPercent = liveLayout?.widthPercent ?? block.widthPercent;
  const storedXPercent = liveLayout?.xPercent ?? block.xPercent;
  const widthPercent = Math.min(
    NOTE_MEDIA_MAX_WIDTH_PERCENT,
    Math.max(NOTE_MEDIA_MIN_WIDTH_PERCENT, storedWidthPercent ?? NOTE_MEDIA_MAX_WIDTH_PERCENT),
  );
  const xPercent =
    widthPercent >= NOTE_MEDIA_MAX_WIDTH_PERCENT
      ? NOTE_MEDIA_CENTER_X_PERCENT
      : Math.min(100, Math.max(0, storedXPercent ?? NOTE_MEDIA_CENTER_X_PERCENT));
  const marginLeftPercent = ((NOTE_MEDIA_MAX_WIDTH_PERCENT - widthPercent) * xPercent) / 100;
  const canDragHorizontally = !actionsDisabled && widthPercent < NOTE_MEDIA_MAX_WIDTH_PERCENT;
  const useCompactActions = widthPercent <= 55;

  const commitLayout = useCallback(
    (update: NoteMediaBlockLayoutUpdate) => {
      liveLayoutRef.current = null;
      setLiveLayout(null);
      onLayoutChange?.(block.id, {
        widthPercent: Math.round(update.widthPercent ?? widthPercent),
        xPercent: Math.round(update.xPercent ?? xPercent),
      });
    },
    [block.id, onLayoutChange, widthPercent, xPercent],
  );
  const updateLiveLayout = (update: NoteMediaBlockLayoutUpdate) => {
    liveLayoutRef.current = update;
    setLiveLayout(update);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (actionsDisabled) {
      return;
    }

    const mediaElement = mediaRef.current;
    const parentElement = mediaElement?.parentElement;

    if (!mediaElement || !parentElement) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect?.(block.id);

    const mediaRect = mediaElement.getBoundingClientRect();
    const parentRect = parentElement.getBoundingClientRect();
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      parentLeft: parentRect.left,
      parentWidth: parentRect.width,
      startLeft: mediaRect.left - parentRect.left,
    };
    suppressClickRef.current = true;
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    if (event.pointerType !== "touch" && (event.buttons & 1) !== 1) {
      resizeSessionRef.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      commitLayout(liveLayoutRef.current ?? { widthPercent, xPercent });
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const minWidth = (session.parentWidth * NOTE_MEDIA_MIN_WIDTH_PERCENT) / 100;
    const maxWidth = session.parentWidth;
    const requestedWidth = event.clientX - session.parentLeft - session.startLeft;
    const nextWidth = Math.min(maxWidth, Math.max(minWidth, requestedWidth));
    const nextWidthPercent = Math.round((nextWidth / session.parentWidth) * 100);
    const remainingWidth = Math.max(0, session.parentWidth - nextWidth);
    const nextXPercent =
      remainingWidth > 0
        ? Math.min(100, Math.max(0, Math.round((session.startLeft / remainingWidth) * 100)))
        : NOTE_MEDIA_CENTER_X_PERCENT;

    updateLiveLayout({
      widthPercent: nextWidthPercent,
      xPercent: nextXPercent,
    });
  };

  const handleResizePointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const session = resizeSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    resizeSessionRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    commitLayout(liveLayoutRef.current ?? { widthPercent, xPercent });
  };

  const handleMediaPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (!canDragHorizontally) {
      return;
    }

    if (event.target instanceof Element && event.target.closest("button")) {
      return;
    }

    const mediaElement = mediaRef.current;
    const parentElement = mediaElement?.parentElement;

    if (!mediaElement || !parentElement) {
      return;
    }

    const mediaRect = mediaElement.getBoundingClientRect();
    const parentRect = parentElement.getBoundingClientRect();
    const availableWidth = Math.max(0, parentRect.width - mediaRect.width);

    if (availableWidth <= 1) {
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect?.(block.id);
    xDragSessionRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      parentWidth: parentRect.width,
      startLeft: mediaRect.left - parentRect.left,
      widthPercent,
      moved: false,
    };
  };

  const handleMediaPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const session = xDragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - session.startClientX;

    if (Math.abs(deltaX) > 2) {
      session.moved = true;
      suppressClickRef.current = true;
    }

    const widthPx = (session.parentWidth * session.widthPercent) / 100;
    const availableWidth = Math.max(0, session.parentWidth - widthPx);
    const nextLeft = Math.min(availableWidth, Math.max(0, session.startLeft + deltaX));
    const nextXPercent =
      availableWidth > 0
        ? Math.min(100, Math.max(0, Math.round((nextLeft / availableWidth) * 100)))
        : NOTE_MEDIA_CENTER_X_PERCENT;

    updateLiveLayout({
      widthPercent: session.widthPercent,
      xPercent: nextXPercent,
    });
  };

  const handleMediaPointerEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const session = xDragSessionRef.current;

    if (!session || session.pointerId !== event.pointerId) {
      return;
    }

    xDragSessionRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);

    if (session.moved) {
      event.preventDefault();
      event.stopPropagation();
      commitLayout(liveLayoutRef.current ?? { widthPercent, xPercent });
      return;
    }

    liveLayoutRef.current = null;
    setLiveLayout(null);
  };

  const renderMediaActions = (compact = false) => (
    <>
      <button
        type="button"
        disabled={actionsDisabled}
        onClick={(event) => {
          event.stopPropagation();
          setIsActionMenuOpen(false);
          if (actionsDisabled) {
            return;
          }
          onMove?.(block.id, "up");
        }}
        aria-label="Premakni gor"
        title="Premakni gor"
      >
        <ArrowUp aria-hidden="true" />
        {compact ? <span>Gor</span> : null}
      </button>
      <button
        type="button"
        disabled={actionsDisabled}
        onClick={(event) => {
          event.stopPropagation();
          setIsActionMenuOpen(false);
          if (actionsDisabled) {
            return;
          }
          onMove?.(block.id, "down");
        }}
        aria-label="Premakni dol"
        title="Premakni dol"
      >
        <ArrowDown aria-hidden="true" />
        {compact ? <span>Dol</span> : null}
      </button>
      <button
        type="button"
        className="danger"
        disabled={actionsDisabled}
        onClick={(event) => {
          event.stopPropagation();
          setIsActionMenuOpen(false);
          if (actionsDisabled) {
            return;
          }
          onDelete?.(block.mediaId);
        }}
        aria-label={deleting ? "Brišem fotografijo" : "Izbriši fotografijo"}
        aria-busy={deleting}
      >
        {deleting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        <span>{deleting ? "Brišem" : "Izbriši"}</span>
      </button>
    </>
  );

  if (!block.media?.signedUrl) {
    return null;
  }

  return (
    <figure
      ref={mediaRef}
      className={`note-inline-media ${selected ? "selected" : ""}`}
      data-note-media-block-id={block.id}
      style={
        {
          "--note-inline-media-width": `${widthPercent}%`,
          marginLeft: `${marginLeftPercent}%`,
        } as CSSProperties
      }
      onPointerDown={handleMediaPointerDown}
      onPointerMove={handleMediaPointerMove}
      onPointerUp={handleMediaPointerEnd}
      onPointerCancel={handleMediaPointerEnd}
      onClick={(event) => {
        event.stopPropagation();
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          return;
        }
        onSelect?.(block.id);
        setIsPreviewOpen(true);
      }}
    >
      <Image
        src={block.media.signedUrl}
        alt={block.media.original_file_name ?? "Dodana fotografija"}
        width={1200}
        height={800}
        draggable={false}
        unoptimized
      />
      <figcaption>
        <span
          className={`note-inline-media-actions ${
            useCompactActions ? "compact-hidden" : ""
          }`}
        >
          {renderMediaActions(false)}
        </span>
        <span
          className={`note-inline-media-menu ${useCompactActions ? "compact-visible" : ""}`}
        >
          <button
            type="button"
            className="note-inline-media-menu-trigger"
            onClick={(event) => {
              event.stopPropagation();
              setIsActionMenuOpen((current) => !current);
            }}
            aria-label="Možnosti fotografije"
            title="Možnosti fotografije"
            aria-expanded={isActionMenuOpen}
          >
            <MoreHorizontal aria-hidden="true" />
          </button>
          {isActionMenuOpen ? (
            <span className="note-inline-media-action-popover">{renderMediaActions(true)}</span>
          ) : null}
        </span>
      </figcaption>
      <button
        type="button"
        className="note-inline-media-resize-handle"
        disabled={actionsDisabled}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        aria-label="Spremeni velikost fotografije"
        title="Spremeni velikost fotografije"
      />
      {isPreviewOpen ? (
        <ViewportPortal>
          <div
            className="note-media-preview"
            role="dialog"
            aria-modal="true"
            aria-label="Pregled fotografije"
            onClick={(event) => {
              event.stopPropagation();
              setIsPreviewOpen(false);
            }}
          >
            <button
              type="button"
              className="note-media-preview-close"
              onClick={(event) => {
                event.stopPropagation();
                setIsPreviewOpen(false);
              }}
              aria-label="Zapri fotografijo"
            >
              <X aria-hidden="true" />
            </button>
            <Image
              src={block.media.signedUrl}
              alt={block.media.original_file_name ?? "Dodana fotografija"}
              width={1600}
              height={1200}
              draggable={false}
              unoptimized
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </ViewportPortal>
      ) : null}
    </figure>
  );
}

function ReadAlongMarkdown({
  document,
  completedWordIndex,
  currentWordIndex,
  annotations,
  mediaBlocks,
  selectedBlockId,
  selectedMediaBlockId,
  deletingMediaIds,
  onBlockSelect,
  onMediaBlockSelect,
  onMoveMediaBlock,
  onLayoutMediaBlock,
  onDeleteMedia,
}: {
  document: NoteTtsDocument;
  completedWordIndex: number;
  currentWordIndex: number | null;
  annotations: NoteAnnotation[];
  mediaBlocks: NoteReadMediaBlock[];
  selectedBlockId?: string | null;
  selectedMediaBlockId?: string | null;
  deletingMediaIds?: ReadonlySet<string>;
  onBlockSelect?: (blockId: string) => void;
  onMediaBlockSelect?: (blockId: string) => void;
  onMoveMediaBlock?: (blockId: string, direction: "up" | "down") => void;
  onLayoutMediaBlock?: (blockId: string, update: NoteMediaBlockLayoutUpdate) => void;
  onDeleteMedia?: (mediaId: string) => void;
}) {
  const wordAnnotations = useMemo(() => {
    const map = new Map<number, NoteWordAnnotation>();

    for (const annotation of annotations) {
      for (let wordIndex = annotation.startWordIndex; wordIndex <= annotation.endWordIndex; wordIndex += 1) {
        const current = map.get(wordIndex) ?? { highlight: false, underline: false };
        map.set(wordIndex, {
          highlight: current.highlight || annotation.kind === "highlight",
          highlightColorId:
            annotation.kind === "highlight"
              ? annotation.colorId ?? current.highlightColorId ?? DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID
              : current.highlightColorId,
          underline: current.underline || annotation.kind === "underline",
          underlineColorId:
            annotation.kind === "underline"
              ? annotation.colorId ?? current.underlineColorId ?? DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID
              : current.underlineColorId,
        });
      }
    }

    return map;
  }, [annotations]);

  return (
    <div className="markdown text-sm text-stone-700 sm:text-[15px]">
      {document.blocks.map((block) => {
        const blockMedia = mediaBlocks.filter((mediaBlock) => mediaBlock.afterBlockId === block.id);

        return (
          <div key={block.id} className="note-read-block-group">
            <div
              className={`note-read-block ${selectedBlockId === block.id ? "selected" : ""}`}
              data-note-block-id={block.id}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest("button, a")) {
                  return;
                }
                onBlockSelect?.(block.id);
              }}
            >
              <ReadAlongBlock
                block={block}
                completedWordIndex={completedWordIndex}
                currentWordIndex={currentWordIndex}
                wordAnnotations={wordAnnotations}
              />
            </div>
            {blockMedia.map((mediaBlock) => (
              <InlineNoteMedia
                key={mediaBlock.id}
                block={mediaBlock}
                selected={selectedMediaBlockId === mediaBlock.id}
                deleting={deletingMediaIds?.has(mediaBlock.mediaId) ?? false}
                onSelect={onMediaBlockSelect}
                onMove={onMoveMediaBlock}
                onLayoutChange={onLayoutMediaBlock}
                onDelete={onDeleteMedia}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
}

export function NoteReadAloud({
  lectureId,
  content,
  annotationToolbar,
  toolbarAccessory,
  annotationActive = false,
  annotations = [],
  mediaBlocks = [],
  noteMedia = [],
  selectedBlockId,
  selectedMediaBlockId,
  deletingMediaIds,
  onBlockSelect,
  onMediaBlockSelect,
  onMoveMediaBlock,
  onLayoutMediaBlock,
  onDeleteMedia,
}: {
  lectureId: string;
  content: string;
  annotationToolbar?: ReactNode;
  toolbarAccessory?: ReactNode;
  annotationActive?: boolean;
  annotations?: NoteAnnotation[];
  mediaBlocks?: NoteMediaBlock[];
  noteMedia?: NoteMediaAsset[];
  selectedBlockId?: string | null;
  selectedMediaBlockId?: string | null;
  deletingMediaIds?: ReadonlySet<string>;
  onBlockSelect?: (blockId: string) => void;
  onMediaBlockSelect?: (blockId: string) => void;
  onMoveMediaBlock?: (blockId: string, direction: "up" | "down") => void;
  onLayoutMediaBlock?: (blockId: string, update: NoteMediaBlockLayoutUpdate) => void;
  onDeleteMedia?: (mediaId: string) => void;
}) {
  const document = useMemo(() => parseNoteTtsDocument(content), [content]);
  const chunks = useMemo(() => buildNoteTtsChunks(document), [document]);
  const mediaById = useMemo(() => new Map(noteMedia.map((media) => [media.id, media])), [noteMedia]);
  const renderedMediaBlocks = useMemo(
    () =>
      mediaBlocks.map((block) => ({
        ...block,
        media: mediaById.get(block.mediaId) ?? null,
      })),
    [mediaBlocks, mediaById],
  );
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const lastAutoScrolledWordRef = useRef<number | null>(null);
  const lastUserInteractionRef = useRef(Date.now());
  const ignoreScrollUntilRef = useRef(0);
  const pendingArrowMovedMediaBlockIdRef = useRef<string | null>(null);
  const pendingArrowMoveFromRectRef = useRef<DOMRect | null>(null);
  const prefetchedChunksRef = useRef(new Map<string, TtsChunkResponse>());
  const pendingChunkRequestsRef = useRef(new Map<string, Promise<TtsChunkResponse | null>>());
  const prefetchQueueRef = useRef<Promise<void>>(Promise.resolve());
  const playbackRequestIdRef = useRef(0);
  const generationProgressIntervalRef = useRef<number | null>(null);
  const generationProgressDismissRef = useRef<number | null>(null);
  const generationProgressStartedAtRef = useRef(0);
  const playbackWordStateRef = useRef<{
    completedWordIndex: number;
    currentWordIndex: number | null;
  }>({
    completedWordIndex: -1,
    currentWordIndex: null,
  });
  const sessionIdRef = useRef<string>(createReadSessionId());
  const [status, setStatus] = useState<TtsStatusResponse | null>(null);
  const [activeChunk, setActiveChunk] = useState<ActiveChunk | null>(null);
  const [activeChunkIndex, setActiveChunkIndex] = useState(0);
  const [completedWordIndex, setCompletedWordIndex] = useState(-1);
  const [currentWordIndex, setCurrentWordIndex] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState<NoteTtsPlaybackRate>(
    DEFAULT_NOTE_TTS_PLAYBACK_RATE,
  );
  const [selectedVoice, setSelectedVoice] =
    useState<NoteTtsVoice>(DEFAULT_NOTE_TTS_VOICE);
  const [highlightColorId, setHighlightColorId] =
    useState<NoteTtsHighlightColorId>(DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID);
  const [hasHydratedSettings, setHasHydratedSettings] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isFetchingChunk, setIsFetchingChunk] = useState(false);
  const [ttsGenerationProgress, setTtsGenerationProgress] = useState<{
    label: string;
    percent: number;
  } | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isStartingPlayback, setIsStartingPlayback] = useState(false);

  const handleMoveMediaBlock = useCallback(
    (blockId: string, direction: "up" | "down") => {
      const mediaElement = contentRef.current?.querySelector<HTMLElement>(
        `[data-note-media-block-id="${blockId}"]`,
      );

      pendingArrowMoveFromRectRef.current = mediaElement?.getBoundingClientRect() ?? null;
      pendingArrowMovedMediaBlockIdRef.current = blockId;
      ignoreScrollUntilRef.current = Date.now() + 900;
      onMoveMediaBlock?.(blockId, direction);
    },
    [onMoveMediaBlock],
  );

  useLayoutEffect(() => {
    const pendingBlockId = pendingArrowMovedMediaBlockIdRef.current;

    if (!pendingBlockId) {
      return;
    }

    if (!renderedMediaBlocks.some((block) => block.id === pendingBlockId)) {
      pendingArrowMovedMediaBlockIdRef.current = null;
      return;
    }

    let cleanupTimeout = 0;
    let animatedElement: HTMLElement | null = null;
    let moveAnimation: Animation | null = null;

    const clearAnimatedElementStyles = () => {
      if (!animatedElement) {
        return;
      }

      animatedElement.style.backfaceVisibility = "";
      animatedElement.style.transformOrigin = "";
      animatedElement.style.willChange = "";
      animatedElement.style.zIndex = "";
    };

    const mediaElement = contentRef.current?.querySelector<HTMLElement>(
      `[data-note-media-block-id="${pendingBlockId}"]`,
    );

    if (!mediaElement) {
      return;
    }

    const fromRect = pendingArrowMoveFromRectRef.current;
    const toRect = mediaElement.getBoundingClientRect();
    pendingArrowMovedMediaBlockIdRef.current = null;
    pendingArrowMoveFromRectRef.current = null;
    ignoreScrollUntilRef.current = Date.now() + 900;

    if (fromRect) {
      const deltaX = fromRect.left - toRect.left;
      const deltaY = fromRect.top - toRect.top;

      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        animatedElement = mediaElement;
        mediaElement.style.backfaceVisibility = "hidden";
        mediaElement.style.transformOrigin = "center center";
        mediaElement.style.willChange = "transform";
        mediaElement.style.zIndex = "3";
        moveAnimation = mediaElement.animate(
          [
            {
              transform: `translate3d(${deltaX}px, ${deltaY}px, 0)`,
              offset: 0,
            },
            {
              transform: "translate3d(0, 0, 0)",
              offset: 1,
            },
          ],
          {
            duration: 460,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            composite: "replace",
          },
        );
        moveAnimation.addEventListener("finish", clearAnimatedElementStyles, { once: true });

        cleanupTimeout = window.setTimeout(() => {
          clearAnimatedElementStyles();
        }, 540);
      }
    }

    return () => {
      window.clearTimeout(cleanupTimeout);
      moveAnimation?.cancel();

      clearAnimatedElementStyles();
    };
  }, [renderedMediaBlocks]);

  const [error, setError] = useState<string | null>(null);
  const highlightColor =
    NOTE_TTS_HIGHLIGHT_COLORS.find((color) => color.id === highlightColorId) ??
    NOTE_TTS_HIGHLIGHT_COLORS[0];
  const readAlongStyle = {
    "--note-read-read-bg-light": highlightColor.readBackground,
    "--note-read-read-color-light": highlightColor.readColor,
    "--note-read-current-bg-light": highlightColor.currentBackground,
    "--note-read-current-color-light": highlightColor.currentColor,
    "--note-read-current-ring-light": highlightColor.currentRing,
    "--note-read-read-bg-dark": highlightColor.darkReadBackground,
    "--note-read-read-color-dark": highlightColor.darkReadColor,
    "--note-read-current-bg-dark": highlightColor.darkCurrentBackground,
    "--note-read-current-color-dark": highlightColor.darkCurrentColor,
    "--note-read-current-ring-dark": highlightColor.darkCurrentRing,
  } as CSSProperties;

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      setIsLoadingStatus(true);

      try {
        const response = await fetch(`/api/lectures/${lectureId}/tts/status`, {
          cache: "no-store",
        });
        const payload = await parseResponse<TtsStatusResponse>(response);

        if (!cancelled) {
          setStatus(
            payload.reason === "notes_not_ready" && chunks.length > 0
              ? {
                  ...payload,
                  available: true,
                  reason: null,
                  chunkCount: chunks.length,
                  totalWords: document.words.length,
                }
              : payload,
          );
          setError(null);
        }
      } catch (statusError) {
        if (!cancelled) {
          const message = statusError instanceof Error ? statusError.message : "";
          setError(/failed to fetch|load failed|network/i.test(message) ? null : "Poslušanje ni na voljo.");
        }
      } finally {
        if (!cancelled) {
          setIsLoadingStatus(false);
        }
      }
    }

    void loadStatus();

    return () => {
      cancelled = true;
    };
  }, [chunks.length, document.words.length, lectureId]);

  useEffect(() => {
    setPlaybackRate(getStoredPlaybackRate());
    setSelectedVoice(getStoredVoice());
    setHighlightColorId(getStoredHighlightColorId());
    setHasHydratedSettings(true);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;

    return () => {
      if (!audio) {
        return;
      }

      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedSettings) {
      return;
    }

    window.localStorage.setItem(NOTE_TTS_RATE_STORAGE_KEY, String(playbackRate));

    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [hasHydratedSettings, playbackRate]);

  useEffect(() => {
    if (!hasHydratedSettings) {
      return;
    }

    window.localStorage.setItem(NOTE_TTS_COLOR_STORAGE_KEY, highlightColorId);
  }, [hasHydratedSettings, highlightColorId]);

  const updateQuota = useCallback((payload: TtsChunkResponse) => {
    setStatus((current) =>
      current
        ? {
            ...current,
            limitSeconds: payload.limitSeconds,
            secondsUsed: payload.secondsUsed,
            remainingSeconds: payload.remainingSeconds,
          }
        : current,
    );
  }, []);

  const setPlaybackWordState = useCallback(
    (wordState: { completedWordIndex: number; currentWordIndex: number | null }) => {
      playbackWordStateRef.current = wordState;
      setCompletedWordIndex(wordState.completedWordIndex);
      setCurrentWordIndex(wordState.currentWordIndex);
    },
    [],
  );

  const clearTtsGenerationProgressTimers = useCallback(() => {
    if (generationProgressIntervalRef.current) {
      window.clearInterval(generationProgressIntervalRef.current);
      generationProgressIntervalRef.current = null;
    }

    if (generationProgressDismissRef.current) {
      window.clearTimeout(generationProgressDismissRef.current);
      generationProgressDismissRef.current = null;
    }
  }, []);

  const startTtsGenerationProgress = useCallback(
    () => {
      clearTtsGenerationProgressTimers();

      generationProgressStartedAtRef.current = Date.now();

      setTtsGenerationProgress({
        label: TTS_GENERATION_PROGRESS_LABEL,
        percent: 5,
      });

      generationProgressIntervalRef.current = window.setInterval(() => {
        setTtsGenerationProgress((current) => {
          if (!current) {
            return current;
          }

          const nextPercent = Math.max(
            current.percent,
            Math.round(getTtsGenerationProgressPercent(generationProgressStartedAtRef.current)),
          );

          return {
            ...current,
            percent: nextPercent,
          };
        });
      }, 450);
    },
    [clearTtsGenerationProgressTimers],
  );

  const finishTtsGenerationProgress = useCallback(() => {
    clearTtsGenerationProgressTimers();
    setTtsGenerationProgress((current) =>
      current
        ? {
            ...current,
            label: TTS_GENERATION_PROGRESS_LABEL,
            percent: 100,
          }
        : current,
    );
    generationProgressDismissRef.current = window.setTimeout(() => {
      setTtsGenerationProgress(null);
      generationProgressDismissRef.current = null;
    }, 650);
  }, [clearTtsGenerationProgressTimers]);

  const cancelTtsGenerationProgress = useCallback(() => {
    clearTtsGenerationProgressTimers();
    setTtsGenerationProgress(null);
  }, [clearTtsGenerationProgressTimers]);

  const resetPlaybackToStart = useCallback(() => {
    playbackRequestIdRef.current += 1;
    sessionIdRef.current = createReadSessionId();
    prefetchedChunksRef.current.clear();
    pendingChunkRequestsRef.current.clear();
    prefetchQueueRef.current = Promise.resolve();
    cancelTtsGenerationProgress();

    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    lastAutoScrolledWordRef.current = null;
    setActiveChunk(null);
    setActiveChunkIndex(0);
    setIsPlaying(false);
    setIsStartingPlayback(false);
    setPlaybackWordState({
      completedWordIndex: -1,
      currentWordIndex: null,
    });
  }, [cancelTtsGenerationProgress, setPlaybackWordState]);

  useEffect(() => {
    return () => {
      clearTtsGenerationProgressTimers();
    };
  }, [clearTtsGenerationProgressTimers]);

  useEffect(() => {
    if (status && !status.hasUnlimitedUsage && status.remainingSeconds <= 0) {
      setError(getDailyLimitDisplayMessage(status));
    }
  }, [status]);

  useEffect(() => {
    if (!hasHydratedSettings) {
      return;
    }

    window.localStorage.setItem(NOTE_TTS_VOICE_STORAGE_KEY, selectedVoice);
    resetPlaybackToStart();
  }, [hasHydratedSettings, resetPlaybackToStart, selectedVoice]);

  const fetchChunk = useCallback(
    async (chunkIndex: number, options?: { silent?: boolean }) => {
      const cacheKey = getChunkCacheKey(selectedVoice, chunkIndex);
      const cachedChunk = prefetchedChunksRef.current.get(cacheKey);

      if (cachedChunk) {
        return cachedChunk;
      }

      const pendingRequest = pendingChunkRequestsRef.current.get(cacheKey);

      if (pendingRequest) {
        return pendingRequest;
      }

      const request = (async () => {
        try {
          const response = await fetch(`/api/lectures/${lectureId}/tts/chunks`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
              chunkIndex,
              voice: selectedVoice,
            }),
          });
          const payload = await parseResponse<TtsChunkResponse>(response);
          updateQuota(payload);
          prefetchedChunksRef.current.set(cacheKey, payload);

          return payload;
        } catch (chunkError) {
          const message =
            chunkError instanceof Error ? chunkError.message : "Poslušanje ni na voljo.";
          const isDailyLimit =
            message === "Limit dosežen." || message === TTS_DAILY_LIMIT_MESSAGE;
          const displayMessage = isDailyLimit
            ? getDailyLimitDisplayMessage(status)
            : message;

          if (!options?.silent) {
            setError(displayMessage);
          }

          if (isDailyLimit) {
            setStatus((current) =>
              current
                ? {
                    ...current,
                    remainingSeconds: 0,
                  }
                : current,
            );

            if (!options?.silent) {
              resetPlaybackToStart();
            }
          }

          return null;
        } finally {
          pendingChunkRequestsRef.current.delete(cacheKey);
        }
      })();

      pendingChunkRequestsRef.current.set(cacheKey, request);

      return request;
    },
    [lectureId, resetPlaybackToStart, selectedVoice, status, updateQuota],
  );

  const loadChunk = useCallback(
    async (chunkIndex: number) => {
      const cacheKey = getChunkCacheKey(selectedVoice, chunkIndex);
      const hasReadyChunk = prefetchedChunksRef.current.has(cacheKey);

      if (!hasReadyChunk) {
        setIsFetchingChunk(true);
        startTtsGenerationProgress();
      }

      setError(null);
      let payload: TtsChunkResponse | null = null;

      try {
        payload = await fetchChunk(chunkIndex);

        if (payload) {
          setActiveChunk(payload);
          setActiveChunkIndex(payload.chunkIndex);
        }

        return payload;
      } finally {
        if (!hasReadyChunk) {
          if (!payload) {
            cancelTtsGenerationProgress();
          }
        }

        setIsFetchingChunk(false);
      }
    },
    [
      cancelTtsGenerationProgress,
      fetchChunk,
      selectedVoice,
      startTtsGenerationProgress,
    ],
  );

  const prefetchChunk = useCallback(
    (chunkIndex: number) => {
      const cacheKey = getChunkCacheKey(selectedVoice, chunkIndex);

      if (
        prefetchedChunksRef.current.has(cacheKey) ||
        pendingChunkRequestsRef.current.has(cacheKey)
      ) {
        return;
      }

      prefetchQueueRef.current = prefetchQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            prefetchedChunksRef.current.has(cacheKey) ||
            pendingChunkRequestsRef.current.has(cacheKey)
          ) {
            return;
          }

          await fetchChunk(chunkIndex, { silent: true });
        });
    },
    [fetchChunk, selectedVoice],
  );

  const prefetchUpcomingChunks = useCallback(
    (chunkIndex: number) => {
      if (!status?.available || status.remainingSeconds <= 0) {
        return;
      }

      const bufferSize = playbackRate >= 1.5 ? 2 : 1;

      for (let offset = 1; offset <= bufferSize; offset += 1) {
        const nextChunkIndex = chunkIndex + offset;

        if (nextChunkIndex >= chunks.length) {
          break;
        }

        prefetchChunk(nextChunkIndex);
      }
    },
    [chunks.length, playbackRate, prefetchChunk, status?.available, status?.remainingSeconds],
  );

  useEffect(() => {
    const markUserInteraction = () => {
      lastUserInteractionRef.current = Date.now();
    };
    const markUserScroll = () => {
      if (Date.now() < ignoreScrollUntilRef.current) {
        return;
      }

      markUserInteraction();
    };

    window.addEventListener("scroll", markUserScroll, { passive: true });
    window.addEventListener("wheel", markUserInteraction, { passive: true });
    window.addEventListener("touchstart", markUserInteraction, { passive: true });
    window.addEventListener("pointerdown", markUserInteraction, { passive: true });
    window.addEventListener("keydown", markUserInteraction);

    return () => {
      window.removeEventListener("scroll", markUserScroll);
      window.removeEventListener("wheel", markUserInteraction);
      window.removeEventListener("touchstart", markUserInteraction);
      window.removeEventListener("pointerdown", markUserInteraction);
      window.removeEventListener("keydown", markUserInteraction);
    };
  }, []);

  const updatePlaybackPosition = useCallback(() => {
    const audio = audioRef.current;

    if (!audio || !activeChunk) {
      return;
    }

    const wordState = getPlaybackWordState(
      activeChunk,
      Math.max(0, audio.currentTime * 1000),
    );
    const previous = playbackWordStateRef.current;

    if (
      previous.completedWordIndex === wordState.completedWordIndex &&
      previous.currentWordIndex === wordState.currentWordIndex
    ) {
      return;
    }

    setPlaybackWordState(wordState);
  }, [activeChunk, setPlaybackWordState]);

  const resetPlaybackWordState = useCallback(
    (completedWordIndex: number) => {
      setPlaybackWordState({
        completedWordIndex,
        currentWordIndex: null,
      });
    },
    [setPlaybackWordState],
  );

  const playChunk = useCallback(
    async (chunkIndex: number) => {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      const requestId = playbackRequestIdRef.current + 1;
      playbackRequestIdRef.current = requestId;
      setIsStartingPlayback(true);

      const payload = await loadChunk(chunkIndex);

      if (!payload) {
        if (playbackRequestIdRef.current === requestId) {
          setIsPlaying(false);
          setIsStartingPlayback(false);
        }
        return;
      }

      if (playbackRequestIdRef.current !== requestId) {
        return;
      }

      audio.src = payload.audioUrl;
      audio.currentTime = 0;
      audio.playbackRate = playbackRate;
      setPlaybackWordState({
        completedWordIndex: payload.wordStartIndex - 1,
        currentWordIndex: payload.alignment[0]?.wordIndex ?? payload.wordStartIndex,
      });
      lastAutoScrolledWordRef.current = null;
      finishTtsGenerationProgress();

      try {
        await audio.play();
        if (playbackRequestIdRef.current !== requestId) {
          audio.pause();
          return;
        }
      } catch {
        if (playbackRequestIdRef.current === requestId) {
          setError("Za začetek poslušanja pritisni še enkrat.");
          setIsPlaying(false);
          setIsStartingPlayback(false);
        }
      }
    },
    [finishTtsGenerationProgress, loadChunk, playbackRate, setPlaybackWordState],
  );

  const handlePlayPause = useCallback(async () => {
    const audio = audioRef.current;

    if (!audio || chunks.length === 0) {
      return;
    }

    if (isStartingPlayback) {
      return;
    }

    if (isPlaying) {
      playbackRequestIdRef.current += 1;
      audio.pause();
      setIsPlaying(false);
      return;
    }

    if (isFetchingChunk) {
      return;
    }

    if (activeChunk && audio.src && audio.paused) {
      const requestId = playbackRequestIdRef.current + 1;
      playbackRequestIdRef.current = requestId;
      setIsStartingPlayback(true);
      setError(null);

      try {
        await audio.play();
      } catch {
        if (playbackRequestIdRef.current === requestId) {
          setError("Za začetek poslušanja pritisni še enkrat.");
          setIsStartingPlayback(false);
        }
      }
      return;
    }

    let playbackStatus = status;

    if (!playbackStatus || isLoadingStatus) {
      setIsFetchingChunk(true);
      setError(null);

      try {
        const response = await fetch(`/api/lectures/${lectureId}/tts/status`, {
          cache: "no-store",
        });
        const payload = await parseResponse<TtsStatusResponse>(response);
        playbackStatus =
          payload.reason === "notes_not_ready" && chunks.length > 0
            ? {
                ...payload,
                available: true,
                reason: null,
                chunkCount: chunks.length,
                totalWords: document.words.length,
              }
            : payload;
        setStatus(playbackStatus);
      } catch (statusError) {
        setError(statusError instanceof Error ? statusError.message : "Poslušanje ni na voljo.");
        return;
      } finally {
        setIsFetchingChunk(false);
      }
    }

    if (!playbackStatus.available) {
      setError("Poslušanje ni na voljo.");
      return;
    }

    if (!playbackStatus.hasUnlimitedUsage && playbackStatus.remainingSeconds <= 0) {
      setError(getDailyLimitDisplayMessage(playbackStatus));
      return;
    }

    await playChunk(activeChunkIndex);
  }, [
    activeChunk,
    activeChunkIndex,
    chunks.length,
    document.words.length,
    isFetchingChunk,
    isLoadingStatus,
    isPlaying,
    isStartingPlayback,
    lectureId,
    playChunk,
    status,
  ]);

  useEffect(() => {
    if (!isPlaying || !activeChunk) {
      return;
    }

    let animationFrame = 0;
    let lastTickMs = 0;
    const tick = (timestamp: number) => {
      if (timestamp - lastTickMs >= 90) {
        updatePlaybackPosition();
        lastTickMs = timestamp;
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeChunk, isPlaying, updatePlaybackPosition]);

  useEffect(() => {
    if (!isPlaying || !activeChunk) {
      return;
    }

    prefetchUpcomingChunks(activeChunk.chunkIndex);
  }, [activeChunk, isPlaying, prefetchUpcomingChunks]);

  useEffect(() => {
    if (currentWordIndex === null || !isPlaying) {
      return;
    }

    if (lastAutoScrolledWordRef.current === currentWordIndex) {
      return;
    }

    if (Date.now() - lastUserInteractionRef.current < AUTO_SCROLL_IDLE_MS) {
      return;
    }

    const wordElement = contentRef.current?.querySelector<HTMLElement>(
      `[data-word-index="${currentWordIndex}"]`,
    );

    if (!wordElement) {
      return;
    }

    lastAutoScrolledWordRef.current = currentWordIndex;

    const rect = wordElement.getBoundingClientRect();
    const topLimit = window.innerHeight * 0.22;
    const bottomLimit = window.innerHeight * 0.72;

    if (rect.top < topLimit || rect.bottom > bottomLimit) {
      ignoreScrollUntilRef.current = Date.now() + 900;
      wordElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    }
  }, [currentWordIndex, isPlaying]);

  const handleEnded = useCallback(() => {
    if (!activeChunk) {
      setIsPlaying(false);
      return;
    }

    resetPlaybackWordState(activeChunk.wordEndIndex - 1);

    const nextChunkIndex = activeChunk.chunkIndex + 1;

    if (nextChunkIndex < activeChunk.chunkCount) {
      if ((status?.remainingSeconds ?? 0) > 0) {
        void playChunk(nextChunkIndex);
        return;
      }

      setError(getDailyLimitDisplayMessage(status));
      setStatus((current) =>
        current
          ? {
              ...current,
              remainingSeconds: 0,
            }
          : current,
      );
      resetPlaybackToStart();
      return;
    }

    setActiveChunk(null);
    setActiveChunkIndex(0);
    resetPlaybackWordState(document.words.length - 1);
    setIsPlaying(false);
  }, [
    activeChunk,
    document.words.length,
    playChunk,
    resetPlaybackWordState,
    resetPlaybackToStart,
    status,
  ]);

  const disabled =
    isFetchingChunk ||
    isStartingPlayback ||
    Boolean(status && (!status.available || (!status.hasUnlimitedUsage && status.remainingSeconds <= 0))) ||
    chunks.length === 0;
  const isPreparingPlayback = isFetchingChunk || isStartingPlayback;
  const playButtonLabel =
    isPreparingPlayback
      ? "Pripravljam..."
      : isPlaying
        ? "Premor"
        : activeChunk
          ? "Nadaljuj"
          : "Poslušaj";
  const renderPlaybackIcon = (className: string) =>
    isPreparingPlayback ? (
      <Loader2 className={`${className} animate-spin`} />
    ) : isPlaying ? (
      <Pause className={className} />
    ) : (
      <Play className={className} />
    );

  return (
    <>
      <div className="note-read-toolbar">
        {annotationToolbar ?? (
          <button
            type="button"
            className="note-read-button"
            onClick={() => {
              void handlePlayPause();
            }}
            disabled={disabled}
            aria-label={playButtonLabel}
          >
            {renderPlaybackIcon("h-4 w-4")}
            <span>{playButtonLabel}</span>
          </button>
        )}
        <QuotaUsageMenu
          status={status}
          playbackRate={playbackRate}
          selectedVoice={selectedVoice}
          highlightColorId={highlightColorId}
          onPlaybackRateChange={setPlaybackRate}
          onVoiceChange={setSelectedVoice}
          onHighlightColorChange={setHighlightColorId}
        />
        {toolbarAccessory}
        {error ? <span className="note-read-error">{error}</span> : null}
      </div>
      {ttsGenerationProgress ? (
        <div
          className="note-read-generation-progress"
          role="status"
          aria-live="polite"
          aria-label={`${ttsGenerationProgress.label} ${ttsGenerationProgress.percent}%`}
        >
          <div className="note-read-generation-progress-copy">
            <span>{ttsGenerationProgress.label}</span>
          </div>
          <div className="note-read-generation-progress-track">
            <span
              className="note-read-generation-progress-fill"
              style={{ width: `${ttsGenerationProgress.percent}%` }}
            />
            <strong>{ttsGenerationProgress.percent}%</strong>
          </div>
        </div>
      ) : null}
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={updatePlaybackPosition}
        onEnded={handleEnded}
        onPlaying={() => {
          setIsPlaying(true);
          setIsStartingPlayback(false);
        }}
        onPause={() => {
          setIsPlaying(false);
          setIsStartingPlayback(false);
        }}
        className="note-read-audio"
      />
      <ViewportPortal>
        {annotationActive && annotationToolbar ? (
          <div className="mobile-note-annotation-pill">{annotationToolbar}</div>
        ) : (
          <button
            type="button"
            className="mobile-note-read-pill"
            onClick={() => {
              window.dispatchEvent(new Event("memoai:mobile-dock-close"));
              void handlePlayPause();
            }}
            disabled={disabled}
            aria-label={playButtonLabel}
          >
            {renderPlaybackIcon("mobile-note-read-pill-icon h-5 w-5")}
            <span className="mobile-note-read-pill-label">{playButtonLabel}</span>
          </button>
        )}
      </ViewportPortal>
      <div ref={contentRef} className="note-read-content" style={readAlongStyle}>
        <ReadAlongMarkdown
          document={document}
          completedWordIndex={completedWordIndex}
          currentWordIndex={currentWordIndex}
          annotations={annotations}
          mediaBlocks={renderedMediaBlocks}
          selectedBlockId={selectedBlockId}
          selectedMediaBlockId={selectedMediaBlockId}
          deletingMediaIds={deletingMediaIds}
          onBlockSelect={onBlockSelect}
          onMediaBlockSelect={onMediaBlockSelect}
          onMoveMediaBlock={handleMoveMediaBlock}
          onLayoutMediaBlock={onLayoutMediaBlock}
          onDeleteMedia={onDeleteMedia}
        />
      </div>
    </>
  );
}
