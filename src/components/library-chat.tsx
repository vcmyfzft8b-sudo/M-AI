"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { useInstantNavigation } from "@/components/navigation-loading";
import { ChatMarkdown } from "@/components/chat-markdown";
import { TypingDots } from "@/components/typing-dots";
import { useDictation } from "@/components/use-dictation";
import { sheetClass, useSheet } from "@/components/use-sheet";
import { requestChatAnswer } from "@/lib/chat-stream-client";
import { getRequestErrorMessage } from "@/lib/request-error-message";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { AppLectureListItem, AppLibraryFolder } from "@/lib/types";

/**
 * "Klepet z zapiski" — the ask bar pinned to the desktop home screen and the
 * chat sheet behind the phone's chat button.
 *
 * The conversation is deliberately not persisted: the design tells the learner
 * it is not saved to their account, and `/api/library-chat` writes nothing. It
 * therefore lives in component state and resets when the panel is dismissed
 * with the refresh control.
 */

type Scope = "recent" | "all" | "folder";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const SUGGESTIONS: MessageKey[] = [
  "libraryChat.suggestion.review",
  "libraryChat.suggestion.links",
  "libraryChat.suggestion.plan",
];

export function LibraryChat({
  folders,
  lectures,
  open,
  onOpenChange,
  hasPaidAccess,
}: {
  folders: AppLibraryFolder[];
  lectures: AppLectureListItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasPaidAccess: boolean;
}) {
  const t = useT();
  const { navigateWithFeedback, overlay: navigationOverlay } = useInstantNavigation();
  const logRef = useRef<HTMLDivElement | null>(null);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  /* The answer as it is being written, before it becomes a finished message. */
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("recent");
  const [scopeFolderId, setScopeFolderId] = useState<string | null>(null);
  const [useTranscripts, setUseTranscripts] = useState(true);
  const [isScopeMenuOpen, setIsScopeMenuOpen] = useState(false);
  const [isFolderSubOpen, setIsFolderSubOpen] = useState(false);

  const scopeFolder = folders.find((folder) => folder.id === scopeFolderId) ?? null;
  const scopeLabel =
    scope === "folder"
      ? (scopeFolder?.name ?? t("libraryChat.scope.folder"))
      : t(scope === "all" ? "libraryChat.scope.all" : "libraryChat.scope.recent");
  const detailLabel = t(
    useTranscripts ? "libraryChat.withTranscripts" : "libraryChat.withoutTranscripts",
  );
  const readyCount = lectures.filter((lecture) => lecture.status === "ready").length;
  /*
   * With nothing in the library there is nothing to scope to, so the picker
   * goes: every option it offers — recent notes, all notes, a folder — reads
   * the same empty shelf. The chat itself stays, because Memo can still answer.
   */
  const hasNotes = readyCount > 0;

  useEffect(() => {
    const node = logRef.current;

    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, isTyping, streamingAnswer, open]);

  /*
   * And again whenever the keyboard resizes the log under it. The effect above
   * only runs when the conversation changes, and the keyboard changes nothing
   * about the conversation — it just takes half the log away, leaving the last
   * message stranded behind the composer.
   */
  useEffect(() => {
    const viewport = window.visualViewport;

    if (!viewport || !open) {
      return;
    }

    const stick = () => {
      const node = logRef.current;

      if (node) {
        node.scrollTop = node.scrollHeight;
      }
    };

    viewport.addEventListener("resize", stick);
    return () => viewport.removeEventListener("resize", stick);
  }, [open]);

  useEffect(() => {
    if (!isScopeMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        scopeRef.current &&
        !scopeRef.current.contains(event.target)
      ) {
        setIsScopeMenuOpen(false);
        setIsFolderSubOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [isScopeMenuOpen]);

  const close = useCallback(() => {
    onOpenChange(false);
    setIsScopeMenuOpen(false);
  }, [onOpenChange]);

  /*
   * The phone sheet is a scrolling conversation, so — as in the design — only
   * the grabber starts a drag; a finger on the log pans it.
   */
  const chatSheet = useSheet(close, { scrollable: true });
  const dismissChatSheet = chatSheet.dismiss;

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        dismissChatSheet();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [dismissChatSheet, open]);

  async function send(preset?: string, sourceLanguageAction = false) {
    const question = (preset ?? draft).trim();

    if (!question || isTyping) {
      return;
    }

    if (!hasPaidAccess) {
      navigateWithFeedback("/app/start");
      return;
    }

    /*
     * Nothing about this conversation is stored, so the transcript that goes
     * back with the question is the only memory the tutor has of it. Sent
     * before the new question is added, since that travels separately.
     */
    const history = messages.map((message) => ({
      role: message.role,
      content: message.text,
    }));

    const askedId = `u${Date.now()}`;

    setDraft("");
    setError(null);
    setIsScopeMenuOpen(false);
    onOpenChange(true);
    setMessages((current) => [...current, { id: askedId, role: "user", text: question }]);
    setIsTyping(true);
    setStreamingAnswer("");

    try {
      const { response, payload } = await requestChatAnswer<{ answer?: string; error?: string }>({
        url: "/api/library-chat",
        body: {
          question,
          sourceLanguageAction,
          scope,
          folderId: scope === "folder" ? scopeFolderId : null,
          useTranscripts,
          history,
        },
        onDelta: (text) => setStreamingAnswer((current) => current + text),
        // A second attempt starts from a blank bubble: half of one answer
        // followed by all of another would read as gibberish.
        onAttemptStart: () => setStreamingAnswer(""),
        t,
      });

      if (!response.ok || !payload?.answer) {
        throw new Error(payload?.error ?? t("libraryChat.error.answerFailed"));
      }

      setMessages((current) => [
        ...current,
        { id: `a${Date.now()}`, role: "assistant", text: payload.answer as string },
      ]);
    } catch (caught) {
      setError(getRequestErrorMessage(caught, t("libraryChat.error.answerFailed"), t));
      /*
       * Nothing the learner typed is lost to a failure: the question goes back
       * into the composer so asking again is one tap, and the unanswered bubble
       * leaves the log — this chat is never saved, so that bubble is also the
       * history the next turn would be sent, and a dangling question in it makes
       * the tutor answer the wrong thing.
       */
      setDraft((current) => (current.trim() ? current : question));
      setMessages((current) => current.filter((message) => message.id !== askedId));
    } finally {
      setIsTyping(false);
      setStreamingAnswer("");
    }
  }

  function renderScopeMenu(align: "left" | "right") {
    return (
      <div className={`memo-scope-menu ${align === "left" ? "left" : ""}`.trim()}>
        <p className="memo-scope-caption">{t("libraryChat.scopeCaption")}</p>

        {(
          [
            {
              id: "recent" as const,
              emoji: "🕐",
              label: t("libraryChat.scope.recent"),
              detail: t("libraryChat.scope.recentDetail", {
                count: Math.min(25, Math.max(readyCount, 1)),
              }),
            },
            {
              id: "all" as const,
              emoji: "📒",
              label: t("libraryChat.scope.all"),
              detail: t("libraryChat.scope.allDetail"),
            },
            {
              id: "folder" as const,
              emoji: "📁",
              label: t("libraryChat.scope.folder"),
              detail: scopeFolder?.name ?? t("folders.choose"),
            },
          ] as const
        ).map((option) => {
          const selected = scope === option.id && !(option.id === "folder" && isFolderSubOpen);

          return (
            <div key={option.id} style={{ position: "relative" }}>
              <button
                type="button"
                className={`memo-scope-option ${
                  option.id === "folder" && isFolderSubOpen ? "expanded" : ""
                }`.trim()}
                onClick={() => {
                  if (option.id === "folder") {
                    setIsFolderSubOpen((current) => !current);
                    return;
                  }

                  setScope(option.id);
                  setIsScopeMenuOpen(false);
                  setIsFolderSubOpen(false);
                }}
              >
                <span className="memo-scope-option-tile">
                  <Emoji symbol={option.emoji} size="1.15rem" />
                </span>
                <span className="memo-scope-option-copy">
                  <span>{option.label}</span>
                  <span>{option.detail}</span>
                </span>
                {selected ? <Msym name="check" size="1.2rem" fill={false} weight={500} /> : null}
                {option.id === "folder" ? (
                  <Msym name="chevron_right" size="1.2rem" fill={false} weight={400} />
                ) : null}
              </button>

              {option.id === "folder" && isFolderSubOpen ? (
                <div className="memo-scope-sub">
                  {folders.length === 0 ? (
                    <p className="memo-scope-sub-empty">{t("libraryChat.noFolders")}</p>
                  ) : (
                    folders.map((folder) => (
                      <button
                        key={folder.id}
                        type="button"
                        className={`memo-scope-sub-item ${
                          scope === "folder" && scopeFolderId === folder.id ? "selected" : ""
                        }`.trim()}
                        onClick={() => {
                          setScope("folder");
                          setScopeFolderId(folder.id);
                          setIsFolderSubOpen(false);
                          setIsScopeMenuOpen(false);
                        }}
                      >
                        <Emoji symbol="📁" size="1.15rem" />
                        <span>{folder.name}</span>
                        {scope === "folder" && scopeFolderId === folder.id ? (
                          <Msym name="check" size="1.15rem" fill={false} weight={500} />
                        ) : null}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="memo-menu-sep" style={{ margin: "0.5rem 1.5rem 0" }} />
        <p className="memo-scope-caption" style={{ margin: "0.8rem 1.5rem 0.1rem" }}>
          {t("libraryChat.detailLevel")}
        </p>

        <div className="memo-scope-toggle-row">
          <span className="memo-scope-option-tile">
            <Emoji symbol="📃" size="1.15rem" />
          </span>
          <span className="memo-scope-option-copy">
            <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span>{t("libraryChat.useTranscripts")}</span>
              <span className="memo-pill-count">
                {t("libraryChat.transcriptLimit", { count: 25 })}
              </span>
            </span>
            <span>{t("libraryChat.useTranscriptsDetail")}</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={useTranscripts}
            aria-label={t("libraryChat.useTranscripts")}
            className={`memo-switch ${useTranscripts ? "on" : ""}`.trim()}
            onClick={() => setUseTranscripts((current) => !current)}
          >
            <span />
          </button>
        </div>
      </div>
    );
  }

  function renderLog(variant: "desktop" | "mobile") {
    return (
      <>
        {variant === "desktop" ? (
          <div className="memo-chat-intro">
            <span className="memo-avatar">
              <Image src="/memo-mascot.png" alt="" width={320} height={288} />
            </span>
            <p>
              {t(hasNotes ? "libraryChat.introWithNotes" : "libraryChat.introNoNotes")}
            </p>
          </div>
        ) : (
          <p className="memo-m-chat-intro">
            {t(
              hasNotes ? "libraryChat.introMobileWithNotes" : "libraryChat.introMobileNoNotes",
            )}
          </p>
        )}

        {messages.map((message) =>
          message.role === "assistant" ? (
            <div key={message.id} className="memo-homechat-answer">
              <span className="memo-avatar">
                <Image src="/memo-mascot.png" alt="" width={320} height={288} />
              </span>
              {/* Markdown on the tutor's side only; the learner's question is
                  shown exactly as they typed it. */}
              <div>
                <ChatMarkdown content={message.text} />
              </div>
            </div>
          ) : (
            <div key={message.id} className="memo-homechat-question">
              <div>{message.text}</div>
            </div>
          ),
        )}

        {/* While it streams it renders where the finished message will sit, so
            the text does not jump when the two swap. The dots show only until
            the first token lands. */}
        {streamingAnswer ? (
          <div className="memo-homechat-answer">
            <span className="memo-avatar">
              <Image src="/memo-mascot.png" alt="" width={320} height={288} />
            </span>
            <div>
              <ChatMarkdown content={streamingAnswer} streaming />
            </div>
          </div>
        ) : isTyping ? (
          <TypingDots withAvatar />
        ) : null}
        {error ? <div className="memo-inline-error">{error}</div> : null}
      </>
    );
  }

  const sendReady = draft.trim().length > 0;
  /*
   * The same control as the note chat's: a microphone until there is something
   * to send, then Send. Desktop has no reason to differ — the arrow appearing
   * only when it does something is the point, not the input method.
   */
  const dictation = useDictation({
    onText: useCallback((text: string) => {
      setDraft((current) => (current.trim() ? `${current.trim()} ${text}` : text));
    }, []),
  });
  const showMic = dictation.supported && !sendReady;
  /*
   * Dictation has two things worth saying — that it is still transcribing, and
   * why it gave up — and three composers to say them under, so the line is
   * built once and dropped beneath each of them.
   */
  const dictationNotice = dictation.error ? (
    <p className="memo-chat-status danger">{dictation.error}</p>
  ) : dictation.transcribing ? (
    <p className="memo-chat-status">{t("chat.status.transcribing")}</p>
  ) : null;

  return (
    <>
      {navigationOverlay}
      {/* Desktop: the always-visible ask bar over the notes column. */}
      {open ? null : (
        <div className="memo-homebar-wrap memo-only-desktop">
          <div className="memo-homebar">
            <span className="memo-homebar-icon">
              <Msym name="forum" size="1.35rem" />
            </span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder={t(hasNotes ? "libraryChat.askAboutNotes" : "libraryChat.askAnything")}
              aria-label={t(hasNotes ? "libraryChat.askAboutNotes" : "libraryChat.askAnything")}
            />
            {hasNotes ? (
              <div ref={scopeRef} style={{ position: "relative", flex: "0 0 auto" }}>
                {isScopeMenuOpen ? renderScopeMenu("right") : null}
                <button
                  type="button"
                  className={`memo-scope-button ${isScopeMenuOpen ? "open" : ""}`.trim()}
                  onClick={() => {
                    setIsScopeMenuOpen((current) => !current);
                    setIsFolderSubOpen(false);
                  }}
                >
                  <span>{scopeLabel}</span>
                  <span className="memo-scope-detail">{detailLabel}</span>
                  <Msym name="arrow_drop_down" size="1.2rem" />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              disabled={dictation.transcribing}
              aria-label={
                showMic
                  ? dictation.transcribing
                    ? t("chat.dictate.transcribing")
                    : dictation.listening
                      ? t("chat.dictate.stop")
                      : t("chat.dictate.start")
                  : t("libraryChat.send")
              }
              className={`memo-send ${showMic ? "mic" : ""} ${
                dictation.listening ? "listening" : ""
              } ${dictation.transcribing ? "transcribing" : ""} ${
                sendReady ? "ready" : ""
              }`.trim()}
              onClick={() => (showMic ? dictation.toggle() : void send())}
            >
              {dictation.transcribing ? (
                <Msym name="progress_activity" className="memo-spin" size="1.4rem" />
              ) : (
                <Msym
                  name={showMic ? (dictation.listening ? "stop" : "mic") : "arrow_upward"}
                  size="1.4rem"
                />
              )}
            </button>
          </div>
          {dictationNotice}
        </div>
      )}

      {open ? (
        <MemoPortal>
          {/* Desktop: a large panel over a blurred page. */}
          <div className="memo-only-desktop">
            <button
              type="button"
              aria-label={t("chat.close")}
              className="memo-homechat-scrim"
              onClick={() => onOpenChange(false)}
            />
            {/* The wrapper repeats the home grid so the panel can centre over the
                notes column rather than hugging the window's right edge. */}
            <div className="memo-homechat-wrap">
            <div className="memo-homechat-panel" role="dialog" aria-modal="true">
              <div className="memo-homechat-head">
                <span>{t("libraryChat.title")}</span>
                <button
                  type="button"
                  aria-label={t("libraryChat.newConversation")}
                  className="memo-homechat-head-btn"
                  onClick={() => {
                    setMessages([]);
                    setError(null);
                  }}
                >
                  <Msym name="refresh" size="1.3rem" fill={false} weight={500} />
                </button>
                <button
                  type="button"
                  aria-label={t("chat.close")}
                  className="memo-homechat-head-btn"
                  onClick={() => onOpenChange(false)}
                >
                  <Msym name="close" size="1.45rem" fill={false} weight={500} />
                </button>
              </div>

              <div ref={logRef} className="memo-homechat-log memo-scroll">
                {renderLog("desktop")}
              </div>

              <div className="memo-homechat-foot">
                <div className="memo-chip-row memo-chiprow">
                  {SUGGESTIONS.map((suggestionKey) => (
                    <button
                      key={suggestionKey}
                      type="button"
                      className="memo-chip round"
                      /* Sent as it reads: the assistant answers in the
                         language it is asked in. */
                      onClick={() => void send(t(suggestionKey), true)}
                    >
                      {t(suggestionKey)}
                    </button>
                  ))}
                </div>

                <div className="memo-homechat-composer">
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void send();
                      }
                    }}
                    placeholder={t("libraryChat.askFollowUp")}
                    aria-label={t("libraryChat.askFollowUp")}
                  />
                  <div className="memo-homechat-composer-row">
                    {hasNotes ? (
                      <div ref={scopeRef} style={{ position: "relative", flex: "0 0 auto" }}>
                        {isScopeMenuOpen ? renderScopeMenu("left") : null}
                        <button
                          type="button"
                          className="memo-homechat-scope"
                          onClick={() => {
                            setIsScopeMenuOpen((current) => !current);
                            setIsFolderSubOpen(false);
                          }}
                        >
                          <span>{scopeLabel}</span>
                          <span className="memo-scope-detail">{detailLabel}</span>
                          <Msym name="expand_more" size="1.2rem" />
                        </button>
                      </div>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      disabled={dictation.transcribing}
                      aria-label={
                        showMic
                          ? dictation.transcribing
                            ? t("chat.dictate.transcribing")
                            : dictation.listening
                              ? t("chat.dictate.stop")
                              : t("chat.dictate.start")
                          : t("libraryChat.send")
                      }
                      className={`memo-send ${showMic ? "mic" : ""} ${
                        dictation.listening ? "listening" : ""
                      } ${dictation.transcribing ? "transcribing" : ""} ${
                        sendReady ? "ready" : ""
                      }`.trim()}
                      onClick={() => (showMic ? dictation.toggle() : void send())}
                    >
                      {dictation.transcribing ? (
                        <Msym name="progress_activity" className="memo-spin" size="1.4rem" />
                      ) : (
                        <Msym
                          name={showMic ? (dictation.listening ? "stop" : "mic") : "arrow_upward"}
                          size="1.4rem"
                        />
                      )}
                    </button>
                  </div>
                  {dictationNotice}
                </div>
              </div>
            </div>
            </div>
          </div>

          {/* Phone: the same conversation as a full-height sheet. */}
          <div className="memo-only-mobile">
            <button
              type="button"
              aria-label={t("chat.close")}
              className={sheetClass("memo-scrim", chatSheet.closing)}
              onClick={() => chatSheet.dismiss()}
            />
            <div
              className={sheetClass("memo-sheet-full surface", chatSheet.closing)}
              role="dialog"
              aria-modal="true"
              {...chatSheet.dragProps}
            >
              <div className="memo-grab-wide" data-drag-handle>
                <span />
              </div>
              <div className="memo-m-chat-head" data-drag-zone>
                <button
                  type="button"
                  aria-label={t("libraryChat.newChat")}
                  className="memo-m-chat-head-btn left"
                  onClick={() => {
                    setMessages([]);
                    setError(null);
                  }}
                >
                  <Msym name="edit_square" size="1.45rem" fill={false} weight={500} />
                </button>
                <span className="memo-m-chat-heading">
                  {hasNotes ? (
                    <>
                      <button type="button" onClick={() => setIsScopeMenuOpen((c) => !c)}>
                        {t("libraryChat.chattingWith")}
                      </button>
                      <span className="memo-m-chat-scope">
                        <Emoji symbol="📌" size="0.85rem" />
                        <span>{scopeLabel}</span>
                      </span>
                    </>
                  ) : (
                    <span className="memo-m-chat-title">{t("libraryChat.titleMobile")}</span>
                  )}
                </span>
                <button
                  type="button"
                  aria-label={t("common.close")}
                  className="memo-m-chat-head-btn right"
                  onClick={() => chatSheet.dismiss()}
                >
                  <Msym name="close" size="1.45rem" fill={false} weight={500} />
                </button>
              </div>

              <div ref={logRef} className="memo-m-chat-log">
                {renderLog("mobile")}
              </div>

              <div className="memo-m-chat-foot">
                {isScopeMenuOpen && hasNotes ? (
                  <div ref={scopeRef} className="memo-m-source-menu">
                    <div className="memo-m-source-row">
                      <span>{t("libraryChat.useTranscriptsMax")}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={useTranscripts}
                        className={`memo-switch ${useTranscripts ? "on" : ""}`.trim()}
                        onClick={() => setUseTranscripts((current) => !current)}
                      >
                        <span />
                      </button>
                    </div>
                    <div className="memo-menu-sep" style={{ margin: "0 1.25rem" }} />
                    {(
                      [
                        { id: "recent" as const, label: t("libraryChat.scope.recent") },
                        { id: "all" as const, label: t("libraryChat.scope.all") },
                        ...folders.map((folder) => ({
                          id: `folder:${folder.id}`,
                          label: folder.name,
                        })),
                      ] as Array<{ id: string; label: string }>
                    ).map((option) => {
                      const isFolder = option.id.startsWith("folder:");
                      const folderId = isFolder ? option.id.slice(7) : null;
                      const selected = isFolder
                        ? scope === "folder" && scopeFolderId === folderId
                        : scope === option.id;

                      return (
                        <button
                          key={option.id}
                          type="button"
                          className="memo-m-source-option"
                          onClick={() => {
                            if (isFolder) {
                              setScope("folder");
                              setScopeFolderId(folderId);
                            } else {
                              setScope(option.id as Scope);
                            }

                            setIsScopeMenuOpen(false);
                          }}
                        >
                          <span>{option.label}</span>
                          {selected ? (
                            <Msym name="check" size="1.4rem" fill={false} weight={500} />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                <div className="memo-m-chat-composer">
                  {hasNotes ? (
                    <button
                      type="button"
                      className="memo-m-chat-scope-chip"
                      onClick={() => setIsScopeMenuOpen((current) => !current)}
                    >
                      <span style={{ fontWeight: 700, letterSpacing: "-0.025em" }}>
                        {t("libraryChat.chattingWith")}
                      </span>
                      <span style={{ color: "var(--muted)" }}>{scopeLabel}</span>
                      <Msym name="expand_more" size="1.15rem" fill={false} weight={500} />
                    </button>
                  ) : null}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                    <input
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void send();
                        }
                      }}
                      placeholder={t(hasNotes ? "libraryChat.askAboutNotes" : "libraryChat.askAnything")}
                      enterKeyHint="send"
                      autoCapitalize="sentences"
                      autoComplete="off"
                      aria-label={t(hasNotes ? "libraryChat.askAboutNotes" : "libraryChat.askAnything")}
                    />
                    <button
                      type="button"
                      disabled={dictation.transcribing}
                      aria-label={
                        showMic
                          ? dictation.transcribing
                            ? t("chat.dictate.transcribing")
                            : dictation.listening
                              ? t("chat.dictate.stop")
                              : t("chat.dictate.start")
                          : t("libraryChat.send")
                      }
                      className={`memo-chat-send ${showMic ? "mic" : ""} ${
                        dictation.listening ? "listening" : ""
                      } ${dictation.transcribing ? "transcribing" : ""} ${
                        sendReady ? "ready" : ""
                      }`.trim()}
                      onClick={() => (showMic ? dictation.toggle() : void send())}
                    >
                      {dictation.transcribing ? (
                        <Msym name="progress_activity" className="memo-spin" size="1.5rem" />
                      ) : (
                        <Msym
                          name={showMic ? (dictation.listening ? "stop" : "mic") : "arrow_upward"}
                          size="1.5rem"
                        />
                      )}
                    </button>
                  </div>
                  {dictationNotice}
                </div>
              </div>
            </div>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
