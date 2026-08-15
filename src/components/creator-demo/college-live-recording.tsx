"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

import { BrandLogo } from "@/components/brand-logo";
import { CollegeRainbowWave } from "@/components/creator-demo/college-rainbow-wave";
import { EmojiIcon } from "@/components/emoji-icon";
import { ViewportPortal } from "@/components/viewport-portal";
import {
  LIVE_NOTE_SEGMENTS,
  LIVE_NOTE_STATUS_STEPS,
  LIVE_NOTE_TITLE,
  type LiveNoteSegment,
} from "@/lib/creator-demo/college-live-note";
import { mapAppHref } from "@/lib/creator-demo/paths";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";
import { formatCalendarDate, formatTimestamp } from "@/lib/utils";

/**
 * The `/creator/college` live-recording takeover.
 *
 * Everything on this screen is scripted playback for UGC video: no microphone
 * is opened, nothing is transcribed and no AI runs. The note types itself out
 * of the same demo pack the record flow creates, inside the app's own lecture
 * chrome, so stopping the recording lands on the note the creator just watched
 * being written.
 *
 * Reached only from the college demo tree — the real app never renders it.
 */

/**
 * Pace of the write-up. Tuned to read as someone taking notes while a lecturer
 * talks, not as a machine dumping text: ~20 characters a second, with a beat at
 * the end of every sentence and a longer one between blocks.
 */
const MS_PER_CHAR = 44;
const SENTENCE_PAUSE_MS = 360;
const PARAGRAPH_PAUSE_MS = 700;
const HEADING_PAUSE_MS = 520;
/** Table rows land whole: a half-drawn table row reads as a glitch. */
const TABLE_ROW_MS = 260;
const TYPING_TICK_MS = 50;
const PHOTO_TOAST_MS = 3200;
/**
 * Figures run narrower than in the finished note. The pane is half a screen and
 * the note is the star: a full-width figure pushes the writing off camera.
 */
const FIGURE_MAX_WIDTH_PERCENT = 62;
const STATUS_STEP_MS = 3600;
const DESKTOP_QUERY = "(min-width: 1024px)";

const FINISH_STAGES = [
  "Zaključujem snemanje...",
  "Dokončujem zapiske...",
  "Ustvarjam kartice in kviz...",
] as const;
const FINISH_STAGE_MS = 520;

const NOTE_TABS = [
  { id: "notes", label: "Zapiski", icon: "📝" },
  { id: "study", label: "Učenje", icon: "🧠" },
  { id: "chat", label: "Klepet", icon: "💬" },
  { id: "transcript", label: "Prepis", icon: "📜" },
] as const;

type LiveBlock =
  | { kind: "markdown"; text: string; start: number; end: number }
  | { kind: "figure"; segment: Extract<LiveNoteSegment, { kind: "figure" }>; at: number };

/** A point in the playback: at `at` milliseconds, `chars` have been written. */
type RevealStep = { at: number; chars: number };

/**
 * Flattens the script into block-level units with their character offsets.
 * Blocks matter for two reasons: a finished block never re-parses (see
 * `MarkdownBlock`), and a figure only appears once its anchor block is written.
 */
function buildBlocks() {
  const blocks: LiveBlock[] = [];
  let text = "";
  let cursor = 0;

  for (const segment of LIVE_NOTE_SEGMENTS) {
    if (segment.kind === "figure") {
      blocks.push({ kind: "figure", segment, at: cursor });
      continue;
    }

    text += segment.text;

    for (const part of segment.text.split(/(\n{2,})/)) {
      if (!part) {
        continue;
      }

      if (/^\n{2,}$/.test(part)) {
        cursor += part.length;
        continue;
      }

      blocks.push({ kind: "markdown", text: part, start: cursor, end: cursor + part.length });
      cursor += part.length;
    }
  }

  return { blocks, text, totalChars: cursor };
}

/**
 * Precomputes the whole playback as (time, characters) pairs, so the frame loop
 * only has to look up where it should be. Reading position from wall-clock time
 * keeps the pace exact no matter how long a frame takes to render.
 */
function buildSchedule(blocks: LiveBlock[]): RevealStep[] {
  const steps: RevealStep[] = [{ at: 0, chars: 0 }];
  let clock = 0;

  for (const block of blocks) {
    if (block.kind === "figure") {
      continue;
    }

    const isHeading = block.text.trimStart().startsWith("#");

    for (const line of splitLines(block.text)) {
      if (line.text.trimStart().startsWith("|")) {
        clock += TABLE_ROW_MS;
        steps.push({ at: clock, chars: block.start + line.end });
        continue;
      }

      // Word by word: the note fills the way someone writes it down, not
      // character by character like a terminal.
      for (const word of splitWords(line.text)) {
        clock += Math.max(90, word.text.length * MS_PER_CHAR);

        if (/[.!?:]["»]?\s*$/.test(word.text)) {
          clock += SENTENCE_PAUSE_MS;
        }

        steps.push({ at: clock, chars: block.start + line.start + word.end });
      }

      clock += isHeading ? HEADING_PAUSE_MS : 120;
    }

    clock += isHeading ? 0 : PARAGRAPH_PAUSE_MS;
  }

  return steps;
}

function splitLines(text: string) {
  const lines: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;

  for (const line of text.split("\n")) {
    lines.push({ text: line, start, end: start + line.length + 1 });
    start += line.length + 1;
  }

  return lines;
}

function splitWords(text: string) {
  const words: Array<{ text: string; end: number }> = [];
  const matches = text.match(/\S+\s*/g) ?? [];
  let end = text.length - text.trimStart().length;

  for (const match of matches) {
    end += match.length;
    words.push({ text: match, end });
  }

  return words;
}

const SCRIPT = buildBlocks();
const SCHEDULE = buildSchedule(SCRIPT.blocks);
const SCRIPT_DURATION_MS = SCHEDULE[SCHEDULE.length - 1]?.at ?? 0;

/**
 * The app renders notes through its read-along view, not raw markdown, so the
 * live note mirrors that markup: top-level headings get the blue highlight
 * chip, and bold runs render as plain leading labels the way the real note does.
 */
const NOTE_MARKDOWN_COMPONENTS = {
  h1: ({ children }: { children?: ReactNode }) => (
    <h2>
      <span className="lecture-heading-highlight">{children}</span>
    </h2>
  ),
  h2: ({ children }: { children?: ReactNode }) => (
    <h2>
      <span className="lecture-heading-highlight">{children}</span>
    </h2>
  ),
  h3: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
  h4: ({ children }: { children?: ReactNode }) => <h3>{children}</h3>,
  strong: ({ children }: { children?: ReactNode }) => (
    <span className="note-read-leading-label">{children}</span>
  ),
  em: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
};

/**
 * One block of the note. Memoised on its text, so a finished block stops
 * re-parsing and only the block under the cursor costs anything.
 */
const MarkdownBlock = memo(function MarkdownBlock({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={NOTE_MARKDOWN_COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  );
});

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setIsDesktop(query.matches);

    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isDesktop;
}

export function CollegeLiveRecording({
  basePath,
  onClose,
}: {
  basePath: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const isDesktop = useIsDesktop();
  const noteScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingLectureRef = useRef<{ id: string; commit: () => string } | null>(null);
  const followScrollRef = useRef(true);

  const [typedChars, setTypedChars] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [statusStep, setStatusStep] = useState(0);
  const [photoToast, setPhotoToast] = useState<string | null>(null);
  const [finishStage, setFinishStage] = useState<string | null>(null);
  const [createdAt] = useState(() => new Date().toISOString());

  const isComplete = typedChars >= SCRIPT.totalChars;

  // Stage the note up front and warm its route, so stopping the recording is a
  // single cut into the finished note with no loading screen in between.
  useEffect(() => {
    let cancelled = false;

    void import("@/lib/creator-demo/store").then(({ prepareDemoLecture }) => {
      if (cancelled) {
        return;
      }

      const pending = prepareDemoLecture("record");
      pendingLectureRef.current = pending;
      safeRouterPrefetch(router, mapAppHref(`/app/lectures/${pending.id}`, basePath));
    });

    return () => {
      cancelled = true;
    };
  }, [basePath, router]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setElapsedSeconds((value) => value + 1);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setStatusStep((value) => (value + 1) % LIVE_NOTE_STATUS_STEPS.length);
    }, STATUS_STEP_MS);

    return () => window.clearInterval(intervalId);
  }, []);

  // The write-up only runs where the note is on screen: on phones the takeover
  // is the wave alone, and re-parsing markdown there would be pure waste.
  useEffect(() => {
    if (!isDesktop || finishStage) {
      return;
    }

    const startedAt = performance.now();
    let stepIndex = 0;

    // An interval rather than a frame loop: reveals are word-sized, so 20 checks
    // a second is plenty, and it keeps running when the browser throttles
    // animation frames. Position comes from the clock either way, so a skipped
    // check catches up instead of falling behind.
    const intervalId = window.setInterval(() => {
      const elapsed = performance.now() - startedAt;

      while (stepIndex + 1 < SCHEDULE.length && SCHEDULE[stepIndex + 1].at <= elapsed) {
        stepIndex += 1;
      }

      setTypedChars(SCHEDULE[stepIndex].chars);

      if (elapsed >= SCRIPT_DURATION_MS) {
        window.clearInterval(intervalId);
      }
    }, TYPING_TICK_MS);

    return () => window.clearInterval(intervalId);
  }, [finishStage, isDesktop]);

  const visibleBlocks = useMemo(() => {
    const rendered: Array<{ key: string; node: LiveBlock; text?: string }> = [];

    for (const [index, block] of SCRIPT.blocks.entries()) {
      if (block.kind === "figure") {
        if (typedChars >= block.at) {
          rendered.push({ key: `figure-${index}`, node: block });
        }
        continue;
      }

      if (typedChars <= block.start) {
        continue;
      }

      const visible = Math.min(block.text.length, typedChars - block.start);

      rendered.push({
        key: `block-${index}`,
        node: block,
        text: block.text.slice(0, visible),
      });
    }

    return rendered;
  }, [typedChars]);

  const visibleFigureCount = visibleBlocks.filter((entry) => entry.node.kind === "figure").length;

  useEffect(() => {
    if (visibleFigureCount === 0) {
      return;
    }

    setPhotoToast("Slika dodana v zapiske");
    const timeoutId = window.setTimeout(() => setPhotoToast(null), PHOTO_TOAST_MS);

    return () => window.clearTimeout(timeoutId);
  }, [visibleFigureCount]);

  const scrollNoteToBottom = useCallback(() => {
    const element = noteScrollRef.current;

    if (!element || !followScrollRef.current) {
      return;
    }

    element.scrollTop = element.scrollHeight - element.clientHeight;
  }, []);

  useLayoutEffect(scrollNoteToBottom, [scrollNoteToBottom, typedChars, visibleFigureCount]);

  // Text growing is not the only thing that moves the bottom: a figure that
  // finishes decoding, a paragraph that rewraps, the pane itself resizing. Watch
  // the content box so the view follows the writing in every case.
  useEffect(() => {
    const element = noteScrollRef.current;
    const content = element?.firstElementChild;

    if (!element || !content) {
      return;
    }

    const observer = new ResizeObserver(scrollNoteToBottom);

    observer.observe(content);
    observer.observe(element);
    return () => observer.disconnect();
  }, [scrollNoteToBottom]);

  const handleNoteScroll = useCallback(() => {
    const element = noteScrollRef.current;

    if (!element) {
      return;
    }

    // Scrolling up hands control to the creator; returning to the bottom takes
    // the follow back.
    followScrollRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < 90;
  }, []);

  const finishRecording = useCallback(async () => {
    if (finishStage) {
      return;
    }

    for (const stage of FINISH_STAGES) {
      setFinishStage(stage);
      await new Promise((resolve) => window.setTimeout(resolve, FINISH_STAGE_MS));
    }

    // The staging effect normally wins the race; this covers a stop pressed
    // before its dynamic import resolved.
    if (!pendingLectureRef.current) {
      const { prepareDemoLecture } = await import("@/lib/creator-demo/store");
      pendingLectureRef.current = prepareDemoLecture("record");
    }

    const pending = pendingLectureRef.current;
    const href = mapAppHref(`/app/lectures/${pending.id}`, basePath);

    pending.commit();

    // Opened from a `?mode=` link, the note replaces that entry so going back
    // lands on the library instead of restarting the recording.
    if (new URLSearchParams(window.location.search).has("mode")) {
      router.replace(href);
      return;
    }

    router.push(href);
  }, [basePath, finishStage, router]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !finishStage) {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [finishStage, onClose]);

  const statusLabel = isComplete ? "Zapiski so pripravljeni" : LIVE_NOTE_STATUS_STEPS[statusStep];

  return (
    <ViewportPortal>
      <div className="college-live" role="dialog" aria-modal="true" aria-label="Snemanje predavanja">
        <header className="college-live-header">
          <span className="college-live-brand">
            <BrandLogo subtitle="" />
          </span>

          <div className="college-live-header-meta">
            <span className="college-live-rec">
              <span className="college-live-rec-dot" aria-hidden="true" />
              Snemam
            </span>
            <span className="college-live-timer">{formatTimestamp(elapsedSeconds * 1000)}</span>
          </div>

          <button
            type="button"
            className="college-live-close"
            onClick={onClose}
            disabled={Boolean(finishStage)}
            aria-label="Zapri"
          >
            <EmojiIcon symbol="✖️" size="1rem" />
          </button>
        </header>

        <div className="college-live-body">
          {isDesktop ? (
            <section className="college-live-note-pane" aria-label="Zapiski nastajajo v živo">
              {/* The app's own lecture chrome, so the pane reads as the note
                  screen the creator already knows. It sits outside the scroller
                  so the title and tabs stay on camera while the note fills. */}
              <div className="lecture-workspace lecture-workspace-full college-live-note-chrome">
                <div className="workspace-panel-stack lecture-main-column">
                  <div className="lecture-header">
                    <div className="lecture-header-row">
                      <div className="ios-title-block lecture-title-block">
                        <h1 className="ios-large-title">{LIVE_NOTE_TITLE}</h1>
                        <div className="lecture-meta-row">
                          <span className="lecture-meta-copy">{formatCalendarDate(createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    <p className="ios-info lecture-inline-note">
                      {isComplete
                        ? "Zapiski so pripravljeni. Ustavi snemanje in jih odpri."
                        : "Snemanje poteka. Zapiski nastajajo sproti."}
                    </p>
                  </div>

                  <div className="ios-segmented lecture-segmented">
                    {NOTE_TABS.map((tab) => (
                      <span
                        key={tab.id}
                        className={`ios-segment lecture-tab-button ${tab.id === "notes" ? "active" : ""}`}
                        title={tab.label}
                      >
                        <span className="lecture-tab-button-content">
                          <EmojiIcon symbol={tab.icon} size="1rem" />
                          <span className="lecture-tab-button-label">{tab.label}</span>
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div
                className="college-live-note-scroll"
                ref={noteScrollRef}
                onScroll={handleNoteScroll}
              >
                <div className="lecture-workspace lecture-workspace-full">
                  <div className="workspace-panel-stack lecture-main-column">
                    <div className="workspace-panel-stack lecture-panel-stack">
                      <div className="ios-card lecture-notes-card">
                        <div className="markdown lecture-markdown">
                          <div className="markdown text-sm text-stone-700 sm:text-[15px]">
                            {visibleBlocks.map((entry) =>
                              entry.node.kind === "figure" ? (
                                <figure
                                  key={entry.key}
                                  className="note-inline-media college-live-figure"
                                  style={{
                                    ["--note-inline-media-width" as string]: `${Math.min(
                                      entry.node.segment.widthPercent,
                                      FIGURE_MAX_WIDTH_PERCENT,
                                    )}%`,
                                  }}
                                >
                                  <Image
                                    src={entry.node.segment.src}
                                    alt={entry.node.segment.alt}
                                    width={1200}
                                    height={800}
                                    draggable={false}
                                    unoptimized
                                    onLoad={scrollNoteToBottom}
                                  />
                                  <figcaption>
                                    <span className="college-live-figure-caption">
                                      {entry.node.segment.fileName}
                                    </span>
                                  </figcaption>
                                </figure>
                              ) : (
                                <MarkdownBlock key={entry.key} text={entry.text ?? ""} />
                              ),
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {photoToast ? (
                <div className="college-live-photo-toast" role="status">
                  <EmojiIcon symbol="🖼️" size="1rem" />
                  {photoToast}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="college-live-stage" aria-label="Poslušanje predavanja">
            <div className="college-live-aurora" aria-hidden="true" />
            <div className="college-live-halo" aria-hidden="true" />
            <CollegeRainbowWave className="college-live-canvas" />

            <div className="college-live-stage-copy">
              <p className="college-live-stage-status" aria-live="polite">
                {statusLabel}
              </p>
              <p className="college-live-stage-hint">
                {isDesktop
                  ? "Memo AI posluša predavanje in sproti piše zapiske."
                  : "Memo AI posluša predavanje in iz njega pripravi zapiske."}
              </p>
            </div>

            <div className="college-live-equalizer" aria-hidden="true">
              {Array.from({ length: 9 }).map((_, index) => (
                <span key={index} style={{ animationDelay: `${index * 90}ms` }} />
              ))}
            </div>
          </section>
        </div>

        <footer className="college-live-footer">
          {finishStage ? (
            <p className="college-live-finishing" aria-live="polite">
              <span className="college-live-finishing-spinner" aria-hidden="true" />
              {finishStage}
            </p>
          ) : (
            <>
              <button
                type="button"
                className="college-live-stop"
                onClick={() => void finishRecording()}
              >
                <span className="college-live-stop-icon" aria-hidden="true" />
                Ustavi snemanje in odpri zapiske
              </button>
              <p className="college-live-footer-hint">
                Predstavitveni način – mikrofon ni vklopljen.
              </p>
            </>
          )}
        </footer>
      </div>
    </ViewportPortal>
  );
}
