"use client";

import Image from "next/image";
import type { ComponentType, ReactNode } from "react";
import { Fragment, useEffect, useRef, useState } from "react";

import { ChatMarkdown } from "@/components/chat-markdown";
import { useT, useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { TypingDots } from "@/components/typing-dots";
import type { MessageKey } from "@/lib/i18n/messages/keys";

import { LandingAppScope } from "./app/landing-app-scope";
import { landingNoteMeta, landingNoteTitleMeta } from "./app/landing-note-meta";
import { LandingFlashcardsScreen } from "./app/landing-flashcards-screen";
import { LandingMindmapScreen } from "./app/landing-mindmap-screen";
import { LandingPalaceScreen } from "./app/landing-palace-screen";
import { LandingPodcastScreen } from "./app/landing-podcast-screen";
import { LandingQuizScreen } from "./app/landing-quiz-screen";
import { LandingSpeedReadScreen } from "./app/landing-speed-read-screen";
import { LandingTestScreen } from "./app/landing-test-screen";
import { LandingSampleNote, SAMPLE_NOTE_BLOCKS, sampleNoteWordCount } from "./landing-sample-note";
import { LandingScaledFrame } from "./landing-scaled-frame";
import { LandingTutorDemo } from "./landing-tutor-demo";
import type { SourceDetail, SourceKind } from "./memo-app-preview-data";

/*
 * What the product does, one row per feature, each beside the app doing it.
 *
 * The captions are product copy. Every illustration is the app's own markup —
 * the New note screen, the rendered note, the read-aloud dock, the library chat
 * and, for the study features, the shared screens in `./app/` — drawn at phone
 * width inside a phone-sized screen and scaled to fit, never a drawing of it.
 * What they *contain* is the landing's sample lecture on business information
 * systems, which stands in for the learner's own material.
 *
 * The order is the app's: capture, the note and the two things its screen does
 * besides being read (listen, and the tutor), the study pills in the order the
 * note's pill row lists them, and last the chat, which reaches across every note.
 */
const FEATURES = [
  { id: "capture", titleKey: "showcase.captureTitle", descKey: "showcase.captureDesc" },
  { id: "notes", titleKey: "showcase.notesTitle", descKey: "showcase.notesDesc" },
  { id: "listen", titleKey: "showcase.listenTitle", descKey: "showcase.listenDesc" },
  { id: "tutor", titleKey: "showcase.tutorTitle", descKey: "showcase.tutorDesc" },
  { id: "flashcards", titleKey: "showcase.cardsTitle", descKey: "showcase.cardsDesc" },
  { id: "podcast", titleKey: "showcase.podcastTitle", descKey: "showcase.podcastDesc" },
  { id: "quiz", titleKey: "showcase.quizTitle", descKey: "showcase.quizDesc" },
  { id: "mindmap", titleKey: "showcase.mindmapTitle", descKey: "showcase.mindmapDesc" },
  { id: "palace", titleKey: "showcase.palaceTitle", descKey: "showcase.palaceDesc" },
  { id: "test", titleKey: "showcase.testsTitle", descKey: "showcase.testsDesc" },
  { id: "speed", titleKey: "showcase.speedTitle", descKey: "showcase.speedDesc" },
  { id: "chat", titleKey: "showcase.chatTitle", descKey: "showcase.chatDesc" },
] as const satisfies ReadonlyArray<{ id: string; titleKey: MessageKey; descKey: MessageKey }>;

type FeatureId = (typeof FEATURES)[number]["id"];

/* Only the panel on screen is mounted, so `active` is always true for it; the
   study screens take it as their autoplay switch. */
type PanelProps = { active: boolean };

const SCREEN_WIDTH = 390;

/* The sample note's source, for its title line: the recording it was made from. */
const SAMPLE_NOTE_META = { source: "audio", detail: { minutes: 48 } } as const;

/* Whether scripted motion may run: never under reduced motion. */
function useMotionAllowed() {
  const [allowed, setAllowed] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setAllowed(!query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return allowed;
}

/* A counter that advances every `ms` while `running`. */
function useTicker(running: boolean, ms: number) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setTick((n) => n + 1), ms);
    return () => window.clearInterval(id);
  }, [running, ms]);

  return tick;
}

/* ── Capture: the New note screen ────────────────────────────── */

/* home-dashboard.tsx's QUICK_ACTIONS, and the note each one makes in this demo. */
const QUICK_ACTIONS = [
  {
    id: "record",
    labelKey: "library.quickAction.record",
    icon: "radio_button_checked",
    accent: "record",
    emoji: "🎙️",
    titleKey: "flowDemo.noteTitle.audio",
    note: { source: "audio", detail: { minutes: 48 } },
  },
  {
    id: "link",
    labelKey: "library.quickAction.link",
    icon: "link",
    accent: "",
    emoji: "🔗",
    titleKey: "flowDemo.noteTitle.doc",
    note: { source: "link" },
  },
  {
    id: "text",
    labelKey: "library.quickAction.document",
    icon: "description",
    accent: "",
    emoji: "📄",
    titleKey: "flowDemo.noteTitle.pdf",
    note: { source: "pdf", detail: { pages: 24 } },
  },
  {
    id: "upload",
    labelKey: "library.quickAction.audio",
    icon: "cloud_upload",
    accent: "",
    emoji: "🎙️",
    titleKey: "flowDemo.past.lecture3",
    note: { source: "audio", detail: { minutes: 52 } },
  },
] as const satisfies ReadonlyArray<{
  id: string;
  labelKey: MessageKey;
  icon: string;
  accent: string;
  emoji: string;
  titleKey: MessageKey;
  note: { source: SourceKind; detail?: SourceDetail };
}>;

function CapturePanel({ active }: PanelProps) {
  const { t, locale } = useTranslations();
  const motion = useMotionAllowed();
  /* Three beats per source: it is picked, it lands as a note being written, the note is ready. */
  const tick = useTicker(active && motion, 1300);
  const cycle = Math.floor(tick / 3);
  const phase = motion ? tick % 3 : 2;
  const action = QUICK_ACTIONS[cycle % QUICK_ACTIONS.length];
  /* While the next source is being picked, the list still shows the last one's note. */
  const rowCycle = phase === 0 ? cycle - 1 : cycle;
  const row = rowCycle >= 0 ? QUICK_ACTIONS[rowCycle % QUICK_ACTIONS.length] : null;

  return (
    <div className="landing-v2-flow-pad landing-v2-fx-capture">
      <h1 className="memo-home-h1">{t("library.newNote")}</h1>
      <p className="memo-home-sub">{t("library.newNoteSub")}</p>
      <div className="memo-quick-grid">
        {QUICK_ACTIONS.map((quick) => (
          <div
            key={quick.id}
            className={`memo-quick-card ${motion && phase === 0 && quick.id === action.id ? "landing-v2-fx-picked" : ""}`.trim()}
          >
            <span className={`memo-quick-tile ${quick.accent}`.trim()}>
              <Msym name={quick.icon} size="1.45rem" />
            </span>
            <span className="memo-quick-label">{t(quick.labelKey)}</span>
          </div>
        ))}
      </div>
      <div className="memo-note-list">
        {row ? (
          <div key={rowCycle} className="memo-note-row landing-v2-flow-new-row">
            <span className="memo-note-emoji">
              <Emoji symbol={row.emoji} size="1.3rem" />
            </span>
            <span className="memo-note-copy">
              <span className="memo-note-title">{t(row.titleKey)}</span>
              <span className="memo-note-meta">
                {landingNoteMeta(t, locale, { ...row.note, writing: phase === 1 })}
              </span>
            </span>
            <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Notes: the note tab ─────────────────────────────────────── */

function NotesPanel({ active }: PanelProps) {
  const { t, locale } = useTranslations();
  const motion = useMotionAllowed();
  /* Written out once when the row is chosen, then left to be read. */
  const tick = useTicker(active && motion, 320);
  const written = motion ? Math.min(SAMPLE_NOTE_BLOCKS, tick + 1) : SAMPLE_NOTE_BLOCKS;

  return (
    <div className="landing-v2-flow-pad">
      <LandingSampleNote
        t={t}
        emoji="🎙️"
        title={t("flowDemo.noteTitle.audio")}
        meta={landingNoteTitleMeta(t, locale, SAMPLE_NOTE_META)}
        written={written}
      />
    </div>
  );
}

/* ── Listen: read-aloud over the note ────────────────────────── */

/* Roughly the voice's pace at 1×: about three words a second. */
const READ_WORD_MS = 320;

function formatClock(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function ListenPanel({ active }: PanelProps) {
  const { t, locale } = useTranslations();
  const motion = useMotionAllowed();
  const [playing, setPlaying] = useState(true);
  const total = sampleNoteWordCount(t);
  const tick = useTicker(active && motion && playing, READ_WORD_MS);
  /* A beat of silence at the end, and it starts again. */
  const word = motion ? tick % (total + 6) : 12;
  const readWord = word < total ? word : null;
  const scrollRef = useRef<HTMLDivElement>(null);

  /* The note follows the voice, as the app keeps the spoken word in view — by
     moving this box, never the page. */
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    if (readWord === null) {
      box.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const el = box.querySelector<HTMLElement>(`[data-word-index="${readWord}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    if (top > box.clientHeight * 0.55) {
      box.scrollTo({ top: box.scrollTop + top - box.clientHeight * 0.3, behavior: "smooth" });
    }
  }, [readWord]);

  const progress = Math.min(100, Math.round(((readWord ?? total) / total) * 100));

  return (
    <div className="landing-v2-fx-column">
      <div ref={scrollRef} className="landing-v2-fx-scroll landing-v2-flow-pad">
        <LandingSampleNote
          t={t}
          emoji="🎙️"
          title={t("flowDemo.noteTitle.audio")}
          meta={landingNoteTitleMeta(t, locale, SAMPLE_NOTE_META)}
          readWord={readWord}
        />
      </div>
      <div className="landing-v2-fx-dock">
        <div className="memo-dock-pill reading">
          <div className="memo-dock-layer memo-dock-player on">
            <button
              type="button"
              className="memo-dock-play"
              onClick={() => setPlaying((current) => !current)}
              aria-label={t(playing ? "readAloud.pause" : "readAloud.resume")}
            >
              <Msym name={playing ? "pause" : "play_arrow"} size="1.35rem" />
            </button>
            <span className="memo-dock-track">
              <span style={{ width: `${progress}%` }} />
            </span>
            <span className="memo-dock-time">{formatClock(((readWord ?? total) * READ_WORD_MS) / 1000)}</span>
            <span className="note-read-usage-menu" aria-hidden="true">
              <span className="note-read-usage-trigger">
                <Msym name="tune" size="1.25rem" fill={false} weight={500} />
              </span>
            </span>
            <span className="memo-dock-close" aria-hidden="true">
              <Msym name="close" size="1.45rem" fill={false} weight={500} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Chat: the library chat ──────────────────────────────────── */

const CHAT_SUGGESTIONS: MessageKey[] = [
  "libraryChat.suggestion.review",
  "libraryChat.suggestion.links",
  "libraryChat.suggestion.plan",
];

type ChatBeat = { draft: number; sent: boolean; answer: number };

function ChatPanel({ active }: PanelProps) {
  const t = useT();
  const motion = useMotionAllowed();
  const question = t("showcase.chat.question");
  const answerWords = t("showcase.chat.answer").split(" ");
  /*
   * One script: the question is typed into the composer, sent, the dots stand in
   * while Memo reads the notes, and the answer streams in word by word. It holds,
   * and plays again. Reduced motion gets the finished exchange.
   */
  const [beat, setBeat] = useState<ChatBeat>({ draft: 0, sent: false, answer: 0 });

  useEffect(() => {
    if (!active || !motion) return;
    let next: ChatBeat | null = null;
    let delay = 0;

    if (!beat.sent && beat.draft < question.length) {
      next = { ...beat, draft: beat.draft + 1 };
      delay = beat.draft === 0 ? 900 : 38;
    } else if (!beat.sent) {
      next = { draft: 0, sent: true, answer: 0 };
      delay = 450;
    } else if (beat.answer < answerWords.length) {
      next = { ...beat, answer: beat.answer + 1 };
      delay = beat.answer === 0 ? 1300 : 55;
    } else {
      next = { draft: 0, sent: false, answer: 0 };
      delay = 5200;
    }

    const id = window.setTimeout(() => setBeat(next), delay);
    return () => window.clearTimeout(id);
  }, [active, motion, beat, question.length, answerWords.length]);

  const shown: ChatBeat = motion ? beat : { draft: 0, sent: true, answer: answerWords.length };
  const logRef = useRef<HTMLDivElement>(null);

  /* The log keeps the newest line in view while the answer streams, as the app's does. */
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [shown.answer, shown.sent]);
  const draft = question.slice(0, shown.draft);
  const streaming = shown.sent && shown.answer < answerWords.length;

  return (
    <div className="memo-homechat-panel landing-v2-fx-chat">
      <div className="memo-homechat-head">
        <span>{t("libraryChat.title")}</span>
        <span className="memo-homechat-head-btn" aria-hidden="true">
          <Msym name="refresh" size="1.3rem" fill={false} weight={500} />
        </span>
      </div>
      <div ref={logRef} className="memo-homechat-log">
        {shown.sent ? (
          <>
            <div className="memo-homechat-question">
              <div>{question}</div>
            </div>
            {shown.answer === 0 ? (
              <TypingDots withAvatar />
            ) : (
              <div className="memo-homechat-answer">
                <span className="memo-avatar">
                  <Image src="/memo-mascot.png" alt="" width={320} height={288} />
                </span>
                <div>
                  <ChatMarkdown content={answerWords.slice(0, shown.answer).join(" ")} streaming={streaming} />
                </div>
              </div>
            )}
          </>
        ) : null}
      </div>
      <div className="memo-homechat-foot">
        <div className="memo-chip-row memo-chiprow">
          {CHAT_SUGGESTIONS.map((key) => (
            <span key={key} className="memo-chip round">
              {t(key)}
            </span>
          ))}
        </div>
        <div className="memo-homechat-composer">
          <input
            value={draft}
            readOnly
            tabIndex={-1}
            placeholder={t("libraryChat.askAboutNotes")}
            aria-label={t("libraryChat.askAboutNotes")}
          />
          <div className="memo-homechat-composer-row">
            <span className="memo-homechat-scope">
              <span>{t("libraryChat.scope.recent")}</span>
              <span className="memo-scope-detail">{t("libraryChat.withTranscripts")}</span>
              <Msym name="expand_more" size="1.2rem" />
            </span>
            <span className={`memo-send ${draft ? "ready" : "mic"}`} aria-hidden="true">
              <Msym name={draft ? "arrow_upward" : "mic"} size="1.4rem" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── The study screens ───────────────────────────────────────── */

function TutorPanel() {
  /* It does not start by itself: it has a voice, and a voice may only be started
     by the visitor, so it waits on its own button. */
  return <LandingTutorDemo />;
}

const PANELS: Record<FeatureId, ComponentType<PanelProps>> = {
  capture: CapturePanel,
  notes: NotesPanel,
  listen: ListenPanel,
  tutor: TutorPanel,
  flashcards: ({ active }) => <LandingFlashcardsScreen autoplay={active} />,
  podcast: ({ active }) => <LandingPodcastScreen autoplay={active} />,
  quiz: ({ active }) => <LandingQuizScreen autoplay={active} />,
  mindmap: ({ active }) => <LandingMindmapScreen autoplay={active} />,
  palace: ({ active }) => <LandingPalaceScreen autoplay={active} />,
  test: ({ active }) => <LandingTestScreen autoplay={active} />,
  speed: ({ active }) => <LandingSpeedReadScreen autoplay={active} />,
  chat: ChatPanel,
};

/* Screens that are a full note tab get the note's side inset; the chat panel and
   the tab bodies that carry their own chrome do not. */
const PADDED: ReadonlySet<FeatureId> = new Set([
  "tutor",
  "flashcards",
  "podcast",
  "quiz",
  "mindmap",
  "palace",
  "test",
  "speed",
]);

/* One phone-sized screen holding the app. */
function FeatureScreen({ id }: { id: FeatureId }) {
  const Panel = PANELS[id];
  let body: ReactNode = <Panel active />;

  if (PADDED.has(id)) {
    body = <div className="landing-v2-fx-scroll landing-v2-fx-tab">{body}</div>;
  }

  return (
    <div className="landing-v2-fx-phone">
      <LandingAppScope className="landing-v2-fx-screen">
        <LandingScaledFrame fill width={SCREEN_WIDTH}>
          {body}
        </LandingScaledFrame>
      </LandingAppScope>
    </div>
  );
}

/* Must track landing.css: the side stage takes over at min-width 900px. */
const SIDE_STAGE_QUERY = "(min-width: 900px)";

export function LandingFeatureShowcase() {
  const t = useT();
  const [active, setActive] = useState(0);
  const activeId = FEATURES[active].id;
  /*
   * Which of the two places shows the screen. Only one is mounted: the screens
   * run their own walkthroughs, and a copy under `display: none` would play one
   * nobody can see. Unknown until mounted, so the server renders neither.
   */
  const [wide, setWide] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia(SIDE_STAGE_QUERY);
    const sync = () => setWide(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <div className="landing-v2-fx-layout">
      <div style={{ display: "grid", alignContent: "start", gap: "2px" }}>
        {FEATURES.map((feature, i) => {
          const on = active === i;
          return (
            <Fragment key={feature.id}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-expanded={on}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "0.85rem",
                  width: "100%",
                  padding: "0.95rem 0.5rem",
                  border: "none",
                  borderBottom: "1px solid var(--l-line-faint)",
                  background: "transparent",
                  fontFamily: "inherit",
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: "3px",
                    height: "1.9rem",
                    marginTop: "0.15rem",
                    borderRadius: "999px",
                    background: on ? "var(--l-label)" : "transparent",
                    transition: "background 260ms ease",
                  }}
                />
                <span style={{ display: "grid", gap: "3px", textAlign: "left" }}>
                  <span
                    style={{
                      color: on ? "var(--l-label)" : "var(--l-second)",
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      lineHeight: 1.25,
                      transition: "color 260ms ease",
                    }}
                  >
                    {t(feature.titleKey)}
                  </span>
                  {/* The title's colour already marks the active row; dimming
                      this line as well pushed it under 3:1 against the page. */}
                  <span style={{ color: "var(--l-second)", fontSize: "0.9rem", lineHeight: 1.45 }}>
                    {t(feature.descKey)}
                  </span>
                </span>
              </button>

              {/* Stacked layouts show the demo right under its feature; the
                  side stage takes over from the two-column breakpoint up. Only
                  the chosen feature's screen is mounted in either place. */}
              <div className="landing-v2-fx-inline" data-open={on ? "true" : "false"} aria-hidden={!on}>
                <div className="landing-v2-fx-inline-panel">
                  {on && wide === false ? <FeatureScreen id={feature.id} /> : null}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="landing-v2-fx-stage">
        {wide ? (
          <div key={activeId} className="landing-v2-fx-stage-item">
            <FeatureScreen id={activeId} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
