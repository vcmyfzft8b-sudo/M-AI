"use client";

import { ArrowDown, ArrowUp, Loader2, MoreHorizontal, X } from "lucide-react";
import Image from "next/image";
import katex from "katex";
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { createPortal } from "react-dom";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { useAnnotateWidth } from "@/components/use-annotate-width";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import { sheetClass, useSheet } from "@/components/use-sheet";
import {
  DEFAULT_NOTE_TTS_HIGHLIGHT_COLOR_ID,
  DEFAULT_NOTE_TTS_PLAYBACK_RATE,
  DEFAULT_NOTE_TTS_VOICE,
  NOTE_TTS_HIGHLIGHT_COLORS,
  NOTE_TTS_PLAYBACK_RATES,
  NOTE_TTS_VOICE_STORAGE_KEY,
  NOTE_TTS_VOICES,
  normalizeNoteTtsVoice,
  type NoteTtsHighlightColorId,
  type NoteTtsPlaybackRate,
  type NoteTtsVoice,
} from "@/lib/note-tts-settings";
import {
  applyTtsCreationQuotaExhausted,
  canCreateTtsChunk,
  getTtsChunkRetryDelayMs,
  isTtsChunkPendingPayload,
  shouldRetryTtsChunkRequest,
} from "@/lib/note-tts-retry";
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
const NOTE_TTS_RATE_STORAGE_KEY = "memo-note-tts-rate";
const NOTE_TTS_COLOR_STORAGE_KEY = "memo-note-tts-color";
const TTS_DAILY_LIMIT_KEY = "readAloud.dailyLimitShort" satisfies MessageKey;
const TTS_FREE_DAILY_LIMIT_KEY = "readAloud.dailyLimitFree" satisfies MessageKey;
const TTS_PAID_DAILY_LIMIT_KEY = "readAloud.dailyLimitPaid" satisfies MessageKey;
const TTS_GENERATION_PROGRESS_KEY = "stage.lecture.preparingAudio" satisfies MessageKey;

function getTtsGenerationProgressPercent(startedAt: number, workloadChunks = 1) {
  const workload = Math.max(1, workloadChunks);
  const elapsedSeconds = Math.max(0, (Date.now() - startedAt) / 1000) / workload;

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

  return normalizeNoteTtsVoice(window.localStorage.getItem(NOTE_TTS_VOICE_STORAGE_KEY));
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

/**
 * A free account is being told it could buy its way past the daily limit; a
 * paid one is simply out until midnight. Two sentences, picked by tier.
 */
function getDailyLimitDisplayKey(
  status: TtsStatusResponse | null,
  fallbackTier?: TtsStatusResponse["tier"],
): MessageKey {
  return (status?.tier ?? fallbackTier) === "free"
    ? TTS_FREE_DAILY_LIMIT_KEY
    : TTS_PAID_DAILY_LIMIT_KEY;
}

class TtsRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string | undefined,
    public readonly status: number,
    public readonly tier?: TtsStatusResponse["tier"],
    public readonly quota?: Pick<
      TtsChunkResponse,
      "limitSeconds" | "remainingSeconds" | "secondsUsed" | "hasUnlimitedUsage"
    >,
  ) {
    super(message);
    this.name = "TtsRequestError";
  }
}

// The retry policy itself lives in @/lib/note-tts-retry so it can be tested without a DOM.
function toTtsChunkFailure(error: unknown) {
  return error instanceof TtsRequestError ? { code: error.code, status: error.status } : null;
}

function waitMs(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  const t = useT();
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
    if (menuRef.current) {
      menuRef.current.open = false;
    }
  }, []);

  // The listening settings are an ordinary phone sheet: they drag from anywhere
  // that is not a control, and they leave through the shared exit.
  const settingsSheet = useSheet(closeMenu);
  const dismissSettingsSheet = settingsSheet.dismiss;

  const animateCloseMenu = useCallback(() => {
    dismissSettingsSheet();
  }, [dismissSettingsSheet]);

  if (!status) {
    return null;
  }

  const remainingPercent = getQuotaRemainingPercent(status);
  const usedPercent = 100 - remainingPercent;
  const isLimitReached = !status.hasUnlimitedUsage && status.remainingSeconds <= 0;
  const remainingLabel = status.hasUnlimitedUsage ? "∞" : `${remainingPercent}%`;

  const menuContent = (
    <>
      {/* `data-drag-handle` is what lets a drag start here: useSheet ignores
          pointers that land on a button unless the button is the grabber. */}
      <button
        type="button"
        data-drag-handle="true"
        className="mobile-sheet-drag-handle note-read-usage-drag-handle"
        aria-label={t("folders.dragToClose")}
      />
      <div
        className="note-read-usage-bar"
        role="progressbar"
        aria-label={
          isLimitReached
            ? t("readAloud.limitReached")
            : status.hasUnlimitedUsage
              ? t("readAloud.noDailyLimitLong")
              : t("readAloud.quotaLabel", { remaining: remainingPercent, used: usedPercent })
        }
        aria-valuetext={
          status.hasUnlimitedUsage
            ? t("readAloud.noDailyLimitLong")
            : t("readAloud.quotaValueText", { remaining: remainingPercent, used: usedPercent })
        }
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remainingPercent}
      >
        <span className="note-read-usage-fill" style={{ width: `${remainingPercent}%` }} />
        <span className="note-read-usage-bar-label">{remainingLabel}</span>
      </div>
      <div className="note-read-usage-reset">
        {t(status.hasUnlimitedUsage ? "readAloud.noDailyLimit" : "readAloud.resetsAt")}
      </div>
      <div className="note-read-settings-divider" />
      <div className="note-read-setting-group">
        <span className="note-read-setting-label">{t("readAloud.speed")}</span>
        <div className="note-read-rate-options" role="group" aria-label={t("readAloud.speedGroup")}>
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
        <span className="note-read-setting-label">{t("readAloud.voice")}</span>
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
        <span className="note-read-setting-label">{t("readAloud.color")}</span>
        <div className="note-read-color-options" role="group" aria-label={t("note.annotate.colorGroup")}>
          {NOTE_TTS_HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color.id}
              type="button"
              className={`note-read-color-option ${
                highlightColorId === color.id ? "active" : ""
              }`}
              onClick={() => onHighlightColorChange(color.id)}
              aria-label={t(color.labelKey)}
              title={t(color.labelKey)}
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
        onToggle={(event) => setIsMenuOpen(event.currentTarget.open)}
      >
        <summary
          className="note-read-usage-trigger"
          aria-label={
            isLimitReached
              ? t("readAloud.limitReached")
              : status.hasUnlimitedUsage
                ? t("readAloud.noDailyLimitLong")
              : t("readAloud.quotaShort", { remaining: remainingPercent })
          }
          title={t("readAloud.settings")}
        >
          <Msym name="tune" size="1.25rem" fill={false} weight={500} />
        </summary>
        <div className="note-read-usage-popover note-read-usage-inline-popover">
          {menuContent}
        </div>
      </details>
      {isMenuOpen ? (
        <MemoPortal>
          <button
            type="button"
            className={sheetClass("note-read-usage-mobile-backdrop", settingsSheet.closing)}
            onClick={animateCloseMenu}
            aria-label={t("readAloud.closeSettings")}
          />
          <div
            className={sheetClass(
              "note-read-usage-popover note-read-usage-mobile-sheet",
              settingsSheet.closing,
            )}
            role="dialog"
            aria-modal="true"
            aria-label={t("readAloud.settings")}
            {...settingsSheet.dragProps}
          >
            {menuContent}
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}

/**
 * `t` is passed in because this runs outside the component. The `error` a
 * response carries is already in the reader's language — the API translates it
 * — so it is used as-is; only the messages decided here need resolving.
 */
async function parseResponse<T>(response: Response, t: Translate<MessageKey>): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & {
    code?: string;
    error?: string;
    hasUnlimitedUsage?: boolean;
    limitSeconds?: number;
    remainingSeconds?: number;
    secondsUsed?: number;
    tier?: TtsStatusResponse["tier"];
  };

  // "Still generating, ask again" now arrives on a 202 so it stops counting against the production
  // error rate. It carries no audio, so it has to leave through the same throw as before — the
  // retry policy keys off the code, not the status.
  if (response.ok && isTtsChunkPendingPayload(payload)) {
    throw new TtsRequestError(
      payload.error || t("readAloud.stillPreparing"),
      payload.code,
      response.status,
    );
  }

  if (!response.ok) {
    let message = payload.error || t("api.audioPrepareFailed");

    if (payload.code === "tts_daily_limit_reached") {
      message = t(TTS_DAILY_LIMIT_KEY);
    } else if (message.includes("HTTP 429")) {
      message = t("readAloud.stillPreparing");
    } else if (response.status === 429 && !payload.error) {
      message = t("readAloud.tooManyRequests");
    }

    const quota =
      typeof payload.limitSeconds === "number" &&
      typeof payload.remainingSeconds === "number" &&
      typeof payload.secondsUsed === "number"
        ? {
            limitSeconds: payload.limitSeconds,
            remainingSeconds: payload.remainingSeconds,
            secondsUsed: payload.secondsUsed,
            hasUnlimitedUsage: payload.hasUnlimitedUsage,
          }
        : undefined;

    throw new TtsRequestError(message, payload.code, response.status, payload.tier, quota);
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

/**
 * Markdown escapes survive the note tokenizer as literal text ("\$30" for a $30 price), because
 * unescaping earlier would let the bare dollars pair up as fake math delimiters. Display is the
 * one safe place to drop the backslash — word indices never change, only the glyphs shown.
 */
function displayText(value: string) {
  return value.replace(/\\(\$)/g, "$1");
}

function MathToken({ value, display }: { value: string; display: boolean }) {
  let html = "";

  try {
    html = katex.renderToString(value, {
      displayMode: display,
      throwOnError: false,
      strict: false,
    });
  } catch {
    html = "";
  }

  const className = display ? "note-read-math display" : "note-read-math inline";

  if (!html) {
    return <span className={className}>{value}</span>;
  }

  const MathTag = display ? "span" : "span";

  return (
    <MathTag
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
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
        const colorId = annotation.highlightColorId;

        while (cursor < params.tokens.length) {
          const candidate = params.tokens[cursor];
          const following = params.tokens[cursor + 1];
          const followingAnnotation = following?.type === "word"
            ? params.wordAnnotations.get(following.wordIndex)
            : undefined;

          if (
            candidate?.type === "text" &&
            following?.type === "word" &&
            followingAnnotation?.highlight &&
            followingAnnotation.highlightColorId === colorId
          ) {
            runTokens.push(candidate, following);
            cursor += 2;
            continue;
          }

          break;
        }

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
            {runTokens.map((runToken, runIndex) => {
              if (runToken.type === "text") {
                return (
                  <span key={`highlight-text-${index + runIndex}`}>{displayText(runToken.text)}</span>
                );
              }

              if (runToken.type === "word") {
                return (
                <WordToken
                  key={`highlight-word-${runToken.wordIndex}`}
                  token={runToken}
                  completedWordIndex={params.completedWordIndex}
                  currentWordIndex={params.currentWordIndex}
                  annotation={params.wordAnnotations.get(runToken.wordIndex)}
                  renderHighlight={false}
                />
                );
              }

              return null;
            })}
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
      rendered.push(<span key={`text-${index}`}>{displayText(token.text)}</span>);
      index += 1;
      continue;
    }

    if (token.type === "math") {
      rendered.push(
        <MathToken
          key={`math-${index}`}
          value={token.text}
          display={token.display}
        />,
      );
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
  const t = useT();
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const [liveLayout, setLiveLayout] = useState<NoteMediaBlockLayoutUpdate | null>(null);
  const [isResizing, setIsResizing] = useState(false);
  const mediaRef = useRef<HTMLElement | null>(null);
  const liveLayoutRef = useRef<NoteMediaBlockLayoutUpdate | null>(null);
  const resizeSessionRef = useRef<NoteMediaResizeSession | null>(null);
  const xDragSessionRef = useRef<NoteMediaXDragSession | null>(null);
  const suppressClickRef = useRef(false);
  const isSavingPreview = block.media?.signedUrl.startsWith("blob:") ?? false;
  const handleDisabled = deleting || isSavingPreview;
  const actionsDisabled = handleDisabled || isResizing;
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
      mediaRef.current?.removeAttribute("data-note-media-resizing");
      liveLayoutRef.current = null;
      setLiveLayout(null);
      onLayoutChange?.(block.id, {
        widthPercent: Math.round(update.widthPercent ?? widthPercent),
        xPercent: Math.round(update.xPercent ?? xPercent),
      });
    },
    [block.id, onLayoutChange, widthPercent, xPercent],
  );
  const stopResizeSession = () => {
    mediaRef.current?.removeAttribute("data-note-media-resizing");
    setIsResizing(false);
  };
  const updateLiveLayout = (update: NoteMediaBlockLayoutUpdate) => {
    liveLayoutRef.current = update;
    setLiveLayout(update);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (handleDisabled) {
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
    setIsActionMenuOpen(false);
    mediaElement.dataset.noteMediaResizing = "true";
    setIsResizing(true);

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
      stopResizeSession();
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
    stopResizeSession();
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
        disabled={handleDisabled}
        onClick={(event) => {
          event.stopPropagation();
          setIsActionMenuOpen(false);
          if (actionsDisabled) {
            return;
          }
          onMove?.(block.id, "up");
        }}
        aria-label={t("noteMedia.moveUp")}
        title={t("noteMedia.moveUp")}
      >
        <ArrowUp aria-hidden="true" />
        {compact ? <span>{t("noteMedia.up")}</span> : null}
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
        aria-label={t("noteMedia.moveDown")}
        title={t("noteMedia.moveDown")}
      >
        <ArrowDown aria-hidden="true" />
        {compact ? <span>{t("noteMedia.down")}</span> : null}
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
        aria-label={t(deleting ? "noteMedia.deleting" : "noteMedia.delete")}
        aria-busy={deleting}
      >
        {deleting ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
        <span>{t(deleting ? "noteMedia.deletingShort" : "common.delete")}</span>
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
        alt={block.media.original_file_name ?? t("noteMedia.addedPhoto")}
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
            disabled={actionsDisabled}
            onClick={(event) => {
              event.stopPropagation();
              if (actionsDisabled) {
                return;
              }
              setIsActionMenuOpen((current) => !current);
            }}
            aria-label={t("noteMedia.options")}
            title={t("noteMedia.options")}
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
        disabled={handleDisabled}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
        aria-label={t("noteMedia.resize")}
        title={t("noteMedia.resize")}
      />
      {isPreviewOpen ? (
        <MemoPortal>
          <div
            className="note-media-preview"
            role="dialog"
            aria-modal="true"
            aria-label={t("noteMedia.preview")}
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
              aria-label={t("noteMedia.closePreview")}
            >
              <X aria-hidden="true" />
            </button>
            <Image
              src={block.media.signedUrl}
              alt={block.media.original_file_name ?? t("noteMedia.addedPhoto")}
              width={1600}
              height={1200}
              draggable={false}
              unoptimized
              onClick={(event) => event.stopPropagation()}
            />
          </div>
        </MemoPortal>
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
  autoPrepareFirstChunk = false,
  annotationToolbar,
  toolbarAccessory,
  annotationActive = false,
  dockContainer = null,
  annotationPaletteOpen = false,
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
  autoPrepareFirstChunk?: boolean;
  annotationToolbar?: ReactNode;
  toolbarAccessory?: ReactNode;
  annotationActive?: boolean;
  /**
   * Where the dock renders. The redesign pins it to the bottom of the note
   * screen beside the chat affordance, which lives outside this component, so
   * the note screen hands down the element to portal into. Null renders it in
   * place, which is what the creator demo and any other host gets.
   */
  dockContainer?: HTMLElement | null;
  /** True while the colour swatches are showing, so the pill widens for them. */
  annotationPaletteOpen?: boolean;
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
  const t = useT();
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
  const pendingArrowMoveCloneRef = useRef<HTMLElement | null>(null);
  /** Pre-move positions of every other block, so the displaced text slides instead of snapping. */
  const pendingArrowMoveSiblingRectsRef = useRef<Map<string, DOMRect> | null>(null);
  const prefetchedChunksRef = useRef(new Map<string, TtsChunkResponse>());
  const pendingChunkRequestsRef = useRef(new Map<string, Promise<TtsChunkResponse>>());
  const prefetchQueueRef = useRef<Promise<void>>(Promise.resolve());
  // The voice the chunk route last refused on a spent daily allowance, so the look-ahead buffer
  // stops asking for chunks it already knows will be refused. Cleared as soon as a request comes
  // back with allowance left.
  const creationLimitReachedVoiceRef = useRef<NoteTtsVoice | null>(null);
  const playbackRequestIdRef = useRef(0);
  /**
   * Seconds of audio finished before the chunk that is playing now. The note is
   * read as a sequence of chunks, so the audio element's own currentTime resets
   * at every boundary; adding it to this gives a clock for the whole reading,
   * which is what the dock shows.
   */
  const playedBeforeChunkRef = useRef(0);
  const preparedInitialChunkKeyRef = useRef<string | null>(null);
  const generationProgressIntervalRef = useRef<number | null>(null);
  const generationProgressDismissRef = useRef<number | null>(null);
  const generationProgressStartedAtRef = useRef(0);
  const generationProgressWorkloadRef = useRef(1);
  const playbackWordStateRef = useRef<{
    completedWordIndex: number;
    currentWordIndex: number | null;
  }>({
    completedWordIndex: -1,
    currentWordIndex: null,
  });
  const sessionIdRef = useRef<string>(createReadSessionId());
  const statusRef = useRef<TtsStatusResponse | null>(null);
  const [status, setStatus] = useState<TtsStatusResponse | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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

      pendingArrowMoveCloneRef.current?.remove();
      pendingArrowMoveFromRectRef.current = mediaElement?.getBoundingClientRect() ?? null;

      // FLIP snapshot of everything else in the note: the reorder reflows the blocks between the
      // photo's old and new position, and without a before-rect they snap. Keyed with a prefix so
      // a text block id can never collide with a media block id.
      const siblingRects = new Map<string, DOMRect>();

      for (const element of contentRef.current?.querySelectorAll<HTMLElement>(
        "[data-note-block-id], [data-note-media-block-id]",
      ) ?? []) {
        const textId = element.getAttribute("data-note-block-id");
        const mediaId = element.getAttribute("data-note-media-block-id");

        if (mediaId === blockId) {
          continue;
        }

        siblingRects.set(textId ? `b:${textId}` : `m:${mediaId}`, element.getBoundingClientRect());
      }

      pendingArrowMoveSiblingRectsRef.current = siblingRects;

      if (mediaElement && pendingArrowMoveFromRectRef.current) {
        const sourceImage = mediaElement.querySelector("img");
        const cloneHost =
          mediaElement.closest<HTMLElement>(".app-shell-pull-content") ?? window.document.body;
        const clone = window.document.createElement("figure");
        const cloneImage = window.document.createElement("img");
        const rect = pendingArrowMoveFromRectRef.current;
        const hostRect = cloneHost.getBoundingClientRect();
        const sourceImageUrl = sourceImage?.currentSrc || sourceImage?.src || "";

        clone.className = mediaElement.className;
        clone.classList.add("note-inline-media-moving-clone");
        clone.removeAttribute("data-note-media-block-id");
        clone.style.position = "absolute";
        clone.style.left = `${rect.left - hostRect.left + cloneHost.scrollLeft}px`;
        clone.style.top = `${rect.top - hostRect.top + cloneHost.scrollTop}px`;
        clone.style.width = `${rect.width}px`;
        clone.style.height = `${rect.height}px`;
        clone.style.margin = "0";
        clone.style.pointerEvents = "none";
        clone.style.zIndex = "30";
        clone.style.transformOrigin = "top left";
        clone.style.willChange = "transform";

        if (sourceImageUrl) {
          cloneImage.src = sourceImageUrl;
          cloneImage.alt = sourceImage?.alt ?? "";
          cloneImage.draggable = false;
          cloneImage.decoding = "sync";
          cloneImage.style.display = "block";
          cloneImage.style.width = "100%";
          cloneImage.style.height = "100%";
          cloneImage.style.objectFit = "contain";
          // Transparent like the real photo: the flying copy must look exactly like what it
          // replaces, not like the framed box the design retired.
          cloneImage.style.background = "transparent";
          clone.appendChild(cloneImage);
        }

        // Native scroll anchoring reacts to the reflow the move causes and shifts the page under
        // the flying clone, which both drifts the landing spot and jolts the screen. Held off for
        // the duration of the move; the layout effect's cleanup restores it.
        cloneHost.style.overflowAnchor = "none";
        cloneHost.appendChild(clone);
        pendingArrowMoveCloneRef.current = clone;
      } else {
        pendingArrowMoveCloneRef.current = null;
      }

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

    // The click handler turned scroll anchoring off on the clone's host; every path out of this
    // effect that does not end in clearAnimatedElementStyles has to turn it back on itself.
    const restoreOverflowAnchor = () => {
      const host =
        contentRef.current?.closest<HTMLElement>(".app-shell-pull-content") ??
        window.document.body;

      host.style.overflowAnchor = "";
    };

    if (!renderedMediaBlocks.some((block) => block.id === pendingBlockId)) {
      pendingArrowMovedMediaBlockIdRef.current = null;
      pendingArrowMoveCloneRef.current?.remove();
      pendingArrowMoveCloneRef.current = null;
      restoreOverflowAnchor();
      return;
    }

    let cleanupTimeout = 0;
    let animatedElement: HTMLElement | null = null;
    let animatedClone: HTMLElement | null = null;
    let moveAnimation: Animation | null = null;
    const siblingAnimations: Animation[] = [];

    let pinReleased = false;

    /**
     * Releases the size pin without letting the page move: the scroll position is captured,
     * the pin cleared with a forced layout, and the scroll written back before paint — so even
     * if the unpin does change the box (an image that has not re-decoded yet), the viewport
     * holds. Scroll anchoring stays off until a frame after the release for the same reason:
     * re-enabling it in the same tick as a reflow was exactly the end-of-move page shift.
     */
    const releaseSizePin = (element: HTMLElement) => {
      if (pinReleased) {
        return;
      }

      pinReleased = true;

      const host = element.closest<HTMLElement>(".app-shell-pull-content");
      const scroller = host && host.scrollHeight > host.clientHeight + 1 ? host : null;
      const savedTop = scroller ? scroller.scrollTop : window.scrollY;

      // One frozen operation: reveal the real element, drop the pin, remove the covering clone,
      // flush layout, and write the captured scroll back before paint. Whatever any of those
      // mutations did to scroll height or anchoring, the viewport cannot move.
      element.style.visibility = "";
      element.style.width = "";
      element.style.height = "";
      animatedClone?.remove();
      if (pendingArrowMoveCloneRef.current === animatedClone) {
        pendingArrowMoveCloneRef.current = null;
      }
      void element.offsetHeight;

      if (scroller) {
        scroller.scrollTop = savedTop;
      } else if (Math.abs(window.scrollY - savedTop) > 0.5) {
        window.scrollTo({ top: savedTop });
      }

      window.requestAnimationFrame(() => {
        (host ?? window.document.body).style.overflowAnchor = "";
      });
    };

    const clearAnimatedElementStyles = () => {
      if (animatedElement) {
        animatedElement.style.backfaceVisibility = "";
        animatedElement.style.transformOrigin = "";
        animatedElement.style.willChange = "";
        animatedElement.style.zIndex = "";

        // The pin — and the clone still covering the landing spot — wait for the remounted
        // image to finish decoding: released earlier, the box falls back to its attribute ratio
        // and the note below shifts after visibly settling.
        const element = animatedElement;
        const image = element.querySelector("img");

        if (image && !image.complete) {
          const release = () => releaseSizePin(element);

          image.addEventListener("load", release, { once: true });
          image.addEventListener("error", release, { once: true });
          window.setTimeout(release, 1_200);
        } else {
          releaseSizePin(element);
        }

        return;
      }

      animatedClone?.remove();
      if (pendingArrowMoveCloneRef.current === animatedClone) {
        pendingArrowMoveCloneRef.current = null;
      }
    };

    const mediaElement = contentRef.current?.querySelector<HTMLElement>(
      `[data-note-media-block-id="${pendingBlockId}"]`,
    );

    if (!mediaElement) {
      pendingArrowMoveCloneRef.current?.remove();
      pendingArrowMoveCloneRef.current = null;
      restoreOverflowAnchor();
      return;
    }

    const fromRect = pendingArrowMoveFromRectRef.current;
    const clone = pendingArrowMoveCloneRef.current;
    const siblingRects = pendingArrowMoveSiblingRectsRef.current;

    // The move re-parents the media in React, so the <img> remounts and sizes itself from its
    // attribute ratio until the bitmap re-decodes — a late height correction that nudged the
    // text below after everything had visibly settled. The element's true size is already known
    // (it was on screen a frame ago), so pin the box to it for the flight; by release time the
    // cached image has decoded at exactly this size and the unpin changes nothing.
    if (fromRect) {
      mediaElement.style.width = `${fromRect.width}px`;
      mediaElement.style.height = `${fromRect.height}px`;
    }

    const toRect = mediaElement.getBoundingClientRect();
    pendingArrowMovedMediaBlockIdRef.current = null;
    pendingArrowMoveFromRectRef.current = null;
    pendingArrowMoveSiblingRectsRef.current = null;
    ignoreScrollUntilRef.current = Date.now() + 900;

    if (fromRect) {
      const deltaX = fromRect.left - toRect.left;
      const deltaY = fromRect.top - toRect.top;
      const moveDistance = Math.hypot(deltaX, deltaY);
      const moveDurationMs = Math.min(760, Math.max(460, moveDistance * 1.08));

      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        animatedElement = mediaElement;
        animatedClone = clone;
        mediaElement.style.backfaceVisibility = "hidden";
        mediaElement.style.transformOrigin = "center center";
        mediaElement.style.visibility = clone ? "hidden" : "";

        const animationTarget = clone ?? mediaElement;
        if (!clone) {
          mediaElement.style.willChange = "transform";
          mediaElement.style.zIndex = "3";
        }

        moveAnimation = animationTarget.animate(
          clone
            ? [
                {
                  transform: "translate3d(0, 0, 0)",
                  offset: 0,
                },
                {
                  transform: `translate3d(${-deltaX}px, ${-deltaY}px, 0)`,
                  offset: 1,
                },
              ]
            : [
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
            duration: moveDurationMs,
            easing: "cubic-bezier(0.2, 0, 0, 1)",
            composite: "replace",
            // Without fill, a finished Web Animation reverts to its start for the frame between
            // "finish" and the clone's removal — a visible flash of the photo back at its old
            // position, which read as the move "glitching".
            fill: "forwards",
          },
        );
        moveAnimation.addEventListener("finish", clearAnimatedElementStyles, { once: true });

        // The same slide, applied to every block the reorder displaced: each starts at its
        // pre-move position and settles into its new one on the same clock as the photo, so the
        // whole note moves as one motion instead of the text snapping under a flying image.
        if (siblingRects) {
          for (const element of contentRef.current?.querySelectorAll<HTMLElement>(
            "[data-note-block-id], [data-note-media-block-id]",
          ) ?? []) {
            const textId = element.getAttribute("data-note-block-id");
            const mediaId = element.getAttribute("data-note-media-block-id");

            if (mediaId === pendingBlockId) {
              continue;
            }

            const before = siblingRects.get(textId ? `b:${textId}` : `m:${mediaId}`);

            if (!before) {
              continue;
            }

            const after = element.getBoundingClientRect();
            const siblingDeltaX = before.left - after.left;
            const siblingDeltaY = before.top - after.top;

            if (Math.abs(siblingDeltaX) < 0.5 && Math.abs(siblingDeltaY) < 0.5) {
              continue;
            }

            siblingAnimations.push(
              element.animate(
                [
                  { transform: `translate3d(${siblingDeltaX}px, ${siblingDeltaY}px, 0)` },
                  { transform: "translate3d(0, 0, 0)" },
                ],
                {
                  duration: moveDurationMs,
                  easing: "cubic-bezier(0.2, 0, 0, 1)",
                  composite: "replace",
                },
              ),
            );
          }
        }

        cleanupTimeout = window.setTimeout(() => {
          clearAnimatedElementStyles();
        }, moveDurationMs + 80);
      } else {
        clone?.remove();
        if (pendingArrowMoveCloneRef.current === clone) {
          pendingArrowMoveCloneRef.current = null;
        }
        releaseSizePin(mediaElement);
      }
    }

    return () => {
      window.clearTimeout(cleanupTimeout);
      moveAnimation?.cancel();

      for (const animation of siblingAnimations) {
        animation.cancel();
      }

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
        const payload = await parseResponse<TtsStatusResponse>(response, t);

        if (!cancelled) {
          const nextStatus =
            payload.reason === "notes_not_ready" && chunks.length > 0
              ? {
                  ...payload,
                  available: true,
                  reason: null,
                  chunkCount: chunks.length,
                  totalWords: document.words.length,
                }
              : payload;

          if (nextStatus.hasUnlimitedUsage || nextStatus.remainingSeconds > 0) {
            creationLimitReachedVoiceRef.current = null;
          }

          statusRef.current = nextStatus;
          setStatus(nextStatus);
          setError(null);
        }
      } catch (statusError) {
        if (!cancelled) {
          const message = statusError instanceof Error ? statusError.message : "";
          setError(/failed to fetch|load failed|network/i.test(message) ? null : t("readAloud.unavailable"));
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
  }, [chunks.length, document.words.length, lectureId, t]);

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
    // A request that got through with allowance left means the refusal we remembered no longer
    // holds — the day rolled over, or the chunk was served from cache. Let the buffer fill again.
    if (payload.hasUnlimitedUsage || payload.remainingSeconds > 0) {
      creationLimitReachedVoiceRef.current = null;
    }

    setStatus((current) => {
      // Keep the same object when the numbers have not moved: the prefetch effect is rebuilt on
      // every change of this object's identity, so a gratuitously new one costs a round of
      // re-renders and re-queued prefetches per chunk.
      if (
        !current ||
        (current.limitSeconds === payload.limitSeconds &&
          current.secondsUsed === payload.secondsUsed &&
          current.remainingSeconds === payload.remainingSeconds)
      ) {
        statusRef.current = current;
        return current;
      }

      const nextStatus = {
        ...current,
        limitSeconds: payload.limitSeconds,
        secondsUsed: payload.secondsUsed,
        remainingSeconds: payload.remainingSeconds,
      };

      statusRef.current = nextStatus;
      return nextStatus;
    });
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
    (workloadChunks = 1) => {
      clearTtsGenerationProgressTimers();

      generationProgressStartedAtRef.current = Date.now();
      generationProgressWorkloadRef.current = Math.max(1, workloadChunks);

      setTtsGenerationProgress({
        label: t(TTS_GENERATION_PROGRESS_KEY),
        percent: 5,
      });

      generationProgressIntervalRef.current = window.setInterval(() => {
        setTtsGenerationProgress((current) => {
          if (!current) {
            return current;
          }

          const nextPercent = Math.max(
            current.percent,
            Math.round(
              getTtsGenerationProgressPercent(
                generationProgressStartedAtRef.current,
                generationProgressWorkloadRef.current,
              ),
            ),
          );

          return {
            ...current,
            percent: nextPercent,
          };
        });
      }, 450);
    },
    [clearTtsGenerationProgressTimers, t],
  );

  const finishTtsGenerationProgress = useCallback(() => {
    clearTtsGenerationProgressTimers();
    setTtsGenerationProgress((current) =>
      current
        ? {
            ...current,
            label: t(TTS_GENERATION_PROGRESS_KEY),
            percent: 100,
          }
        : current,
    );
    generationProgressDismissRef.current = window.setTimeout(() => {
      setTtsGenerationProgress(null);
      generationProgressDismissRef.current = null;
    }, 650);
  }, [clearTtsGenerationProgressTimers, t]);

  const cancelTtsGenerationProgress = useCallback(() => {
    clearTtsGenerationProgressTimers();
    setTtsGenerationProgress(null);
  }, [clearTtsGenerationProgressTimers]);

  const resetPlaybackToStart = useCallback((options?: { preservePreparedChunks?: boolean }) => {
    playbackRequestIdRef.current += 1;
    sessionIdRef.current = createReadSessionId();

    if (!options?.preservePreparedChunks) {
      prefetchedChunksRef.current.clear();
      pendingChunkRequestsRef.current.clear();
      prefetchQueueRef.current = Promise.resolve();
    }

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
    if (!hasHydratedSettings) {
      return;
    }

    window.localStorage.setItem(NOTE_TTS_VOICE_STORAGE_KEY, selectedVoice);
    resetPlaybackToStart();
  }, [hasHydratedSettings, resetPlaybackToStart, selectedVoice]);

  const isCreationQuotaUnavailableForChunk = useCallback(
    (chunkIndex: number, currentStatus: TtsStatusResponse | null) => {
      return !canCreateTtsChunk({
        quota: currentStatus,
        estimatedSeconds: chunks[chunkIndex]?.estimatedSeconds ?? 1,
      });
    },
    [chunks],
  );

  const fetchChunk = useCallback(
    async (
      chunkIndex: number,
      options?: { silent?: boolean; resetToStartOnCreationLimit?: boolean },
    ) => {
      const cacheKey = getChunkCacheKey(selectedVoice, chunkIndex);
      const cachedChunk = prefetchedChunksRef.current.get(cacheKey);

      if (cachedChunk) {
        return cachedChunk;
      }

      let request = pendingChunkRequestsRef.current.get(cacheKey);

      if (!request) {
        request = (async () => {
          const startedAt = Date.now();
          // Playback resets bump this, which is our signal that nobody is waiting on this chunk
          // any more — stop re-asking rather than retrying into an abandoned session.
          const playbackRequestId = playbackRequestIdRef.current;

          for (let attempt = 0; ; attempt += 1) {
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
                  // Tells the route this bundle understands a 202 "still generating" answer, so it
                  // does not have to report one as a 503 server error. See TTS_CHUNK_PENDING_STATUS.
                  acceptsPendingStatus: true,
                }),
              });
              const payload = await parseResponse<TtsChunkResponse>(response, t);
              updateQuota(payload);
              prefetchedChunksRef.current.set(cacheKey, payload);

              return payload;
            } catch (error) {
              const shouldRetry = shouldRetryTtsChunkRequest({
                failure: toTtsChunkFailure(error),
                elapsedMs: Date.now() - startedAt,
                cancelled: playbackRequestIdRef.current !== playbackRequestId,
              });

              if (!shouldRetry) {
                throw error;
              }

              await waitMs(getTtsChunkRetryDelayMs(attempt));
            }
          }
        })();

        pendingChunkRequestsRef.current.set(cacheKey, request);
        request.then(
          () => {
            if (pendingChunkRequestsRef.current.get(cacheKey) === request) {
              pendingChunkRequestsRef.current.delete(cacheKey);
            }
          },
          () => {
            if (pendingChunkRequestsRef.current.get(cacheKey) === request) {
              pendingChunkRequestsRef.current.delete(cacheKey);
            }
          },
        );
      }

      try {
        return await request;
      } catch (chunkError) {
        const message =
          chunkError instanceof Error ? chunkError.message : t("readAloud.unavailable");
        const requestError = chunkError instanceof TtsRequestError ? chunkError : null;
        const errorCode = requestError?.code;
        const currentStatus: TtsStatusResponse | null = requestError?.quota
          ? {
              ...(statusRef.current ?? {
                available: true,
                reason: null,
                tier: requestError.tier ?? "paid",
                chunkCount: chunks.length,
                totalWords: document.words.length,
                limitSeconds: requestError.quota.limitSeconds,
                remainingSeconds: requestError.quota.remainingSeconds,
                secondsUsed: requestError.quota.secondsUsed,
              }),
              limitSeconds: requestError.quota.limitSeconds,
              remainingSeconds: requestError.quota.remainingSeconds,
              secondsUsed: requestError.quota.secondsUsed,
              hasUnlimitedUsage: requestError.quota.hasUnlimitedUsage,
            }
          : statusRef.current;
        /*
         * The code, and only the code. This used to also compare the message
         * against two Slovenian sentences; those strings now arrive in
         * whichever of five languages the reader is using, so matching on them
         * would silently stop recognising the limit. Every path that reports it
         * sets `tts_daily_limit_reached` — the route and `note-tts.ts` both do.
         */
        const isDailyLimit = errorCode === "tts_daily_limit_reached";
        const canTreatPendingAsCreationLimit =
          errorCode === "tts_generation_pending" ||
          errorCode === "tts_provider_rate_limited" ||
          requestError?.status === 429;
        const shouldShowCreationLimit =
          isDailyLimit ||
          (
            canTreatPendingAsCreationLimit &&
            isCreationQuotaUnavailableForChunk(chunkIndex, currentStatus)
          );
        const displayMessage = shouldShowCreationLimit
          ? t(getDailyLimitDisplayKey(currentStatus, requestError?.tier))
          : message;

        if (!options?.silent) {
          setError(displayMessage);
        }

        if (shouldShowCreationLimit) {
          creationLimitReachedVoiceRef.current = selectedVoice;

          setStatus((current) => {
            const nextStatus = applyTtsCreationQuotaExhausted(current ?? currentStatus);

            statusRef.current = nextStatus;
            return nextStatus;
          });

          if (!options?.silent && (options?.resetToStartOnCreationLimit ?? true)) {
            resetPlaybackToStart({ preservePreparedChunks: true });
          }
        }

        return null;
      }
    },
    // `status` is deliberately absent: this reads the live value through `statusRef`, and taking
    // the state object as a dependency made every quota update rebuild the prefetch effect.
    [
      chunks.length,
      document.words.length,
      isCreationQuotaUnavailableForChunk,
      lectureId,
      resetPlaybackToStart,
      selectedVoice,
      t,
      updateQuota,
    ],
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

  const loadPlaybackStartBuffer = useCallback(
    async (chunkIndex: number) => {
      const targetChunkIndexes = [chunkIndex];
      const nextChunkIndex = chunkIndex + 1;

      if (nextChunkIndex < chunks.length) {
        targetChunkIndexes.push(nextChunkIndex);
      }

      const hasMissingChunk = targetChunkIndexes.some(
        (targetChunkIndex) =>
          !prefetchedChunksRef.current.has(getChunkCacheKey(selectedVoice, targetChunkIndex)),
      );

      if (hasMissingChunk) {
        setIsFetchingChunk(true);
        startTtsGenerationProgress(targetChunkIndexes.length);
      }

      setError(null);
      let payload: TtsChunkResponse | null = null;

      try {
        payload = await fetchChunk(chunkIndex);

        if (!payload) {
          return null;
        }

        setActiveChunk(payload);
        setActiveChunkIndex(payload.chunkIndex);

        if (nextChunkIndex < chunks.length) {
          await fetchChunk(nextChunkIndex, {
            silent: true,
            resetToStartOnCreationLimit: false,
          });
        }

        return payload;
      } finally {
        if (hasMissingChunk) {
          if (!payload) {
            cancelTtsGenerationProgress();
          }

          setIsFetchingChunk(false);
        }
      }
    },
    [
      cancelTtsGenerationProgress,
      chunks.length,
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
      if (!status?.available) {
        return;
      }

      const bufferSize = playbackRate >= 1.5 ? 3 : 2;

      for (let offset = 1; offset <= bufferSize; offset += 1) {
        const nextChunkIndex = chunkIndex + offset;

        if (nextChunkIndex >= chunks.length) {
          break;
        }

        // Once the route has told us the allowance is spent, every chunk that still has to be
        // generated will answer the same way, so filling the buffer just runs the route once per
        // chunk for the rest of the note. Stop asking. This waits for an actual rejection rather
        // than pre-judging from the remaining seconds, because a chunk generated on an earlier day
        // is served from cache and costs no allowance — those keep prefetching normally, and only
        // the first one that genuinely needs generating pays a wasted request.
        if (
          creationLimitReachedVoiceRef.current === selectedVoice &&
          !prefetchedChunksRef.current.has(getChunkCacheKey(selectedVoice, nextChunkIndex))
        ) {
          break;
        }

        prefetchChunk(nextChunkIndex);
      }
    },
    // Only primitives off `status`, never the object: the effect that calls this is rebuilt on
    // every dependency change, so depending on the object's identity is what let a rejected
    // prefetch re-trigger itself.
    [chunks.length, playbackRate, prefetchChunk, selectedVoice, status?.available],
  );

  useEffect(() => {
    if (
      !autoPrepareFirstChunk ||
      !hasHydratedSettings ||
      !status?.available ||
      chunks.length === 0
    ) {
      return;
    }

    const warmupChunks = chunks.slice(0, 2);
    const warmupKey = `${lectureId}:${selectedVoice}:${warmupChunks
      .map((chunk) => `${chunk.chunkIndex}:${chunk.text}`)
      .join("|")}`;

    if (preparedInitialChunkKeyRef.current === warmupKey) {
      return;
    }

    preparedInitialChunkKeyRef.current = warmupKey;

    let cancelled = false;

    void Promise.all(
      warmupChunks.map((chunk) => fetchChunk(chunk.chunkIndex, { silent: true })),
    ).then((payloads) => {
      const payload = payloads.find((item) => item?.chunkIndex === 0);

      if (cancelled || !payload) {
        return;
      }

      const audio = audioRef.current;

      if (!audio || audio.src === payload.audioUrl) {
        return;
      }

      audio.src = payload.audioUrl;
      audio.preload = "auto";
      audio.load();
    });

    return () => {
      cancelled = true;
    };
  }, [
    autoPrepareFirstChunk,
    chunks,
    fetchChunk,
    hasHydratedSettings,
    lectureId,
    selectedVoice,
    status?.available,
  ]);

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

    setElapsedSeconds(playedBeforeChunkRef.current + audio.currentTime);

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
    async (chunkIndex: number, options?: { warmupNextChunk?: boolean }) => {
      const audio = audioRef.current;

      if (!audio) {
        return;
      }

      const requestId = playbackRequestIdRef.current + 1;
      playbackRequestIdRef.current = requestId;
      setIsStartingPlayback(true);

      const payload = options?.warmupNextChunk
        ? await loadPlaybackStartBuffer(chunkIndex)
        : await loadChunk(chunkIndex);

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

      if (audio.src !== payload.audioUrl) {
        audio.src = payload.audioUrl;
      }
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
          setError(t("readAloud.pressAgain"));
          setIsPlaying(false);
          setIsStartingPlayback(false);
        }
      }
    },
    [
      finishTtsGenerationProgress,
      loadChunk,
      loadPlaybackStartBuffer,
      playbackRate,
      setPlaybackWordState,
      t,
    ],
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
          setError(t("readAloud.pressAgain"));
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
        const payload = await parseResponse<TtsStatusResponse>(response, t);
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
        statusRef.current = playbackStatus;
        setStatus(playbackStatus);
      } catch (statusError) {
        setError(statusError instanceof Error ? statusError.message : t("readAloud.unavailable"));
        return;
      } finally {
        setIsFetchingChunk(false);
      }
    }

    if (!playbackStatus.available) {
      setError(t("readAloud.unavailable"));
      return;
    }

    await playChunk(activeChunkIndex, { warmupNextChunk: true });
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
    t,
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
      // Bank this chunk's length before the element rewinds for the next one.
      const finished = audioRef.current?.duration;
      if (Number.isFinite(finished)) {
        playedBeforeChunkRef.current += finished as number;
      }

      void playChunk(nextChunkIndex);
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
  ]);

  /** Closes the reading player and puts the dock back to its headphones state. */
  const stopReading = useCallback(() => {
    const audio = audioRef.current;

    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }

    playbackRequestIdRef.current += 1;
    playedBeforeChunkRef.current = 0;
    setElapsedSeconds(0);
    setIsPlaying(false);
    setIsStartingPlayback(false);
    setActiveChunk(null);
    setActiveChunkIndex(0);
    resetPlaybackWordState(-1);
  }, [resetPlaybackWordState]);

  const disabled =
    isFetchingChunk ||
    isStartingPlayback ||
    Boolean(status && !status.available) ||
    chunks.length === 0;
  const isPreparingPlayback = isFetchingChunk || isStartingPlayback;
  const playButtonLabel = t(
    isPreparingPlayback
      ? "readAloud.preparing"
      : isPlaying
        ? "readAloud.pause"
        : activeChunk
          ? "readAloud.resume"
          : "readAloud.listen",
  );

  /**
   * The dock, exactly as the redesign draws it: one pill that morphs between
   * three states rather than swapping elements, so its width animates.
   *
   *   idle       — a headphones button; tapping it starts the reading
   *   reading    — play/pause, progress, elapsed, speed, close
   *   annotating — the highlight tools, whenever note text is selected
   *
   * Only the active layer is rendered on desktop so the pill sizes to its
   * content; on the phone all three stack and cross-fade (see redesign.css).
   */
  const formatClock = (seconds: number) => {
    const total = Math.max(0, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  };

  const isAnnotating = annotationActive && Boolean(annotationToolbar);
  const isReading = !isAnnotating && (isPlaying || Boolean(activeChunk));
  const isIdle = !isAnnotating && !isReading;
  const { pillRef, layerRef } = useAnnotateWidth(isAnnotating, annotationPaletteOpen);
  const totalWords = document.words.length;
  const readProgressPercent =
    totalWords > 0
      ? Math.min(100, Math.round(((completedWordIndex + 2) / totalWords) * 100))
      : 0;

  const renderNoteDock = () => (
    <div
      ref={pillRef}
      className={[
        "memo-dock-pill",
        isReading ? "reading" : "",
        isAnnotating ? "annotating" : "",
        isAnnotating && annotationPaletteOpen ? "palette" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={`memo-dock-layer memo-dock-idle-layer ${isIdle ? "on" : ""}`.trim()}>
        <button
          type="button"
          className="memo-dock-idle"
          onClick={() => void handlePlayPause()}
          disabled={disabled}
          aria-label={playButtonLabel}
        >
          {isPreparingPlayback ? (
            <Msym name="progress_activity" size="1.55rem" className="memo-spin" />
          ) : (
            <Msym name="headphones" size="1.55rem" fill={false} weight={500} />
          )}
        </button>
      </div>

      <div className={`memo-dock-layer memo-dock-player ${isReading ? "on" : ""}`.trim()}>
        <button
          type="button"
          className="memo-dock-play"
          onClick={() => void handlePlayPause()}
          disabled={disabled}
          aria-label={playButtonLabel}
        >
          {isPreparingPlayback ? (
            <Msym name="progress_activity" size="1.35rem" className="memo-spin" />
          ) : (
            <Msym name={isPlaying ? "pause" : "play_arrow"} size="1.35rem" />
          )}
        </button>
        <span className="memo-dock-track">
          <span style={{ width: `${readProgressPercent}%` }} />
        </span>
        <span className="memo-dock-time">{formatClock(elapsedSeconds)}</span>
        <QuotaUsageMenu
          status={status}
          playbackRate={playbackRate}
          selectedVoice={selectedVoice}
          highlightColorId={highlightColorId}
          onPlaybackRateChange={setPlaybackRate}
          onVoiceChange={setSelectedVoice}
          onHighlightColorChange={setHighlightColorId}
        />
        <button
          type="button"
          className="memo-dock-close"
          onClick={stopReading}
          aria-label={t("readAloud.close")}
        >
          <Msym name="close" size="1.45rem" fill={false} weight={500} />
        </button>
      </div>

      <div
        ref={layerRef}
        className={`memo-dock-layer memo-dock-annotate ${isAnnotating ? "on" : ""}`.trim()}
      >
        {annotationToolbar}
      </div>
    </div>
  );

  return (
    <>
      {toolbarAccessory || error ? (
        <div className="memo-note-toolbar">
          {toolbarAccessory}
          {error ? <span className="memo-note-toolbar-error">{error}</span> : null}
        </div>
      ) : null}
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
      {/* The note screen owns where the dock sits, on both breakpoints. */}
      {dockContainer ? createPortal(renderNoteDock(), dockContainer) : null}
      <div
        ref={contentRef}
        className="note-read-content"
        style={readAlongStyle}
        data-sentry-block
      >
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
      {dockContainer ? null : <div className="memo-dock">{renderNoteDock()}</div>}
    </>
  );
}
