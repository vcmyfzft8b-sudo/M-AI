"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { Emoji, Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { useDictation } from "@/components/use-dictation";
import { sheetClass, useSheet } from "@/components/use-sheet";
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

const SUGGESTIONS = ["Kaj naj ponovim?", "Poišči povezave", "Naredi načrt učenja"];

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
  const router = useRouter();
  const logRef = useRef<HTMLDivElement | null>(null);
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("recent");
  const [scopeFolderId, setScopeFolderId] = useState<string | null>(null);
  const [useTranscripts, setUseTranscripts] = useState(true);
  const [isScopeMenuOpen, setIsScopeMenuOpen] = useState(false);
  const [isFolderSubOpen, setIsFolderSubOpen] = useState(false);

  const scopeFolder = folders.find((folder) => folder.id === scopeFolderId) ?? null;
  const scopeLabel =
    scope === "folder"
      ? (scopeFolder?.name ?? "Mapa")
      : scope === "all"
        ? "Vsi zapiski"
        : "Nedavni zapiski";
  const detailLabel = useTranscripts ? "s prepisi" : "brez prepisov";
  const readyCount = lectures.filter((lecture) => lecture.status === "ready").length;

  useEffect(() => {
    const node = logRef.current;

    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages, isTyping, open]);

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

  async function send(preset?: string) {
    const question = (preset ?? draft).trim();

    if (!question || isTyping) {
      return;
    }

    if (!hasPaidAccess) {
      router.push("/app/start");
      return;
    }

    setDraft("");
    setError(null);
    setIsScopeMenuOpen(false);
    onOpenChange(true);
    setMessages((current) => [
      ...current,
      { id: `u${Date.now()}`, role: "user", text: question },
    ]);
    setIsTyping(true);

    try {
      const response = await fetch("/api/library-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          scope,
          folderId: scope === "folder" ? scopeFolderId : null,
          useTranscripts,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;

      if (!response.ok || !payload?.answer) {
        throw new Error(payload?.error ?? "Odgovora ni bilo mogoče pripraviti.");
      }

      setMessages((current) => [
        ...current,
        { id: `a${Date.now()}`, role: "assistant", text: payload.answer as string },
      ]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Odgovora ni bilo mogoče pripraviti.");
    } finally {
      setIsTyping(false);
    }
  }

  function renderScopeMenu(align: "left" | "right") {
    return (
      <div className={`memo-scope-menu ${align === "left" ? "left" : ""}`.trim()}>
        <p className="memo-scope-caption">Zapiski za iskanje</p>

        {(
          [
            {
              id: "recent" as const,
              emoji: "🕐",
              label: "Nedavni zapiski",
              detail: `Najnovejših ${Math.min(25, Math.max(readyCount, 1))} zapiskov`,
            },
            {
              id: "all" as const,
              emoji: "📒",
              label: "Vsi zapiski",
              detail: "Povzetki vseh zapiskov",
            },
            {
              id: "folder" as const,
              emoji: "📁",
              label: "Mapa",
              detail: scopeFolder?.name ?? "Izberi mapo",
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
                    <p className="memo-scope-sub-empty">Ni map.</p>
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
          Raven podrobnosti
        </p>

        <div className="memo-scope-toggle-row">
          <span className="memo-scope-option-tile">
            <Emoji symbol="📃" size="1.15rem" />
          </span>
          <span className="memo-scope-option-copy">
            <span style={{ display: "flex", alignItems: "center", gap: "0.35rem" }}>
              <span>Uporabi prepise</span>
              <span className="memo-pill-count">25 max</span>
            </span>
            <span>Vključi celotne prepise</span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={useTranscripts}
            aria-label="Uporabi prepise"
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
              Živjo, jaz sem Memo. Vprašaj me karkoli o svojih zapiskih. Ta pogovor se ne
              shrani v tvoj račun.
            </p>
          </div>
        ) : (
          <p className="memo-m-chat-intro">
            Živjo, jaz sem Memo. Kaj te zanima o tvojih zapiskih? Ta klepet se ne shrani v
            tvoj račun.
          </p>
        )}

        {messages.map((message) =>
          message.role === "assistant" ? (
            <div key={message.id} className="memo-homechat-answer">
              <span className="memo-avatar">
                <Image src="/memo-mascot.png" alt="" width={320} height={288} />
              </span>
              <div>{message.text}</div>
            </div>
          ) : (
            <div key={message.id} className="memo-homechat-question">
              <div>{message.text}</div>
            </div>
          ),
        )}

        {isTyping ? <div className="memo-typing">Memo piše…</div> : null}
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

  return (
    <>
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
              placeholder="Vprašaj karkoli o svojih zapiskih"
              aria-label="Vprašaj karkoli o svojih zapiskih"
            />
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
            <button
              type="button"
              aria-label={
                showMic
                  ? dictation.listening
                    ? "Ustavi narekovanje"
                    : "Narekuj vprašanje"
                  : "Pošlji"
              }
              className={`memo-send ${showMic ? "mic" : ""} ${
                dictation.listening ? "listening" : ""
              } ${sendReady ? "ready" : ""}`.trim()}
              onClick={() => (showMic ? dictation.toggle() : void send())}
            >
              <Msym
                name={showMic ? (dictation.listening ? "stop" : "mic") : "arrow_upward"}
                size="1.4rem"
              />
            </button>
          </div>
        </div>
      )}

      {open ? (
        <MemoPortal>
          {/* Desktop: a large panel over a blurred page. */}
          <div className="memo-only-desktop">
            <button
              type="button"
              aria-label="Zapri klepet"
              className="memo-homechat-scrim"
              onClick={() => onOpenChange(false)}
            />
            {/* The wrapper repeats the home grid so the panel can centre over the
                notes column rather than hugging the window's right edge. */}
            <div className="memo-homechat-wrap">
            <div className="memo-homechat-panel" role="dialog" aria-modal="true">
              <div className="memo-homechat-head">
                <span>Klepet z zapiski</span>
                <button
                  type="button"
                  aria-label="Nov pogovor"
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
                  aria-label="Zapri klepet"
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
                  {SUGGESTIONS.map((label) => (
                    <button
                      key={label}
                      type="button"
                      className="memo-chip round"
                      onClick={() => void send(label)}
                    >
                      {label}
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
                    placeholder="Vprašaj dodatno vprašanje"
                    aria-label="Vprašaj dodatno vprašanje"
                  />
                  <div className="memo-homechat-composer-row">
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
                    <button
                      type="button"
                      aria-label={showMic ? "Narekuj vprašanje" : "Pošlji"}
                      className={`memo-send ${showMic ? "mic" : ""} ${
                        dictation.listening ? "listening" : ""
                      } ${sendReady ? "ready" : ""}`.trim()}
                      onClick={() => (showMic ? dictation.toggle() : void send())}
                    >
                      <Msym
                        name={showMic ? (dictation.listening ? "stop" : "mic") : "arrow_upward"}
                        size="1.4rem"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          {/* Phone: the same conversation as a full-height sheet. */}
          <div className="memo-only-mobile">
            <button
              type="button"
              aria-label="Zapri klepet"
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
                  aria-label="Nov klepet"
                  className="memo-m-chat-head-btn left"
                  onClick={() => {
                    setMessages([]);
                    setError(null);
                  }}
                >
                  <Msym name="edit_square" size="1.45rem" fill={false} weight={500} />
                </button>
                <span className="memo-m-chat-heading">
                  <button type="button" onClick={() => setIsScopeMenuOpen((c) => !c)}>
                    Klepet z:
                  </button>
                  <span className="memo-m-chat-scope">
                    <Emoji symbol="📌" size="0.85rem" />
                    <span>{scopeLabel}</span>
                  </span>
                </span>
                <button
                  type="button"
                  aria-label="Zapri"
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
                {isScopeMenuOpen ? (
                  <div ref={scopeRef} className="memo-m-source-menu">
                    <div className="memo-m-source-row">
                      <span>Uporabi prepise (max 25)</span>
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
                        { id: "recent" as const, label: "Nedavni zapiski" },
                        { id: "all" as const, label: "Vsi zapiski" },
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
                  <button
                    type="button"
                    className="memo-m-chat-scope-chip"
                    onClick={() => setIsScopeMenuOpen((current) => !current)}
                  >
                    <span style={{ fontWeight: 700, letterSpacing: "-0.025em" }}>
                      Klepet z:
                    </span>
                    <span style={{ color: "var(--muted)" }}>{scopeLabel}</span>
                    <Msym name="expand_more" size="1.15rem" fill={false} weight={500} />
                  </button>
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
                      placeholder="Vprašaj karkoli o svojih zapiskih"
                      enterKeyHint="send"
                      autoCapitalize="sentences"
                      autoComplete="off"
                      aria-label="Vprašaj karkoli o svojih zapiskih"
                    />
                    <button
                      type="button"
                      aria-label={showMic ? "Narekuj vprašanje" : "Pošlji"}
                      className={`memo-chat-send ${showMic ? "mic" : ""} ${
                        dictation.listening ? "listening" : ""
                      } ${sendReady ? "ready" : ""}`.trim()}
                      onClick={() => (showMic ? dictation.toggle() : void send())}
                    >
                      <Msym
                        name={showMic ? (dictation.listening ? "stop" : "mic") : "arrow_upward"}
                        size="1.5rem"
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
