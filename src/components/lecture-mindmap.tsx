"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

import { StudyGenerationNotice } from "@/components/generation-notice";
import { useT } from "@/components/i18n-provider";
import { MemoPortal } from "@/components/memo-portal";
import { Emoji, Msym } from "@/components/msym";
import {
  MindmapCanvas,
  type MindmapCanvasHandle,
  type MindmapView,
} from "@/components/mindmap-canvas";
import { parseApiResponse, redirectToBillingIfNeeded } from "@/lib/billing-client";
import type { StudyAssetStatus } from "@/lib/database.types";
import {
  flattenMindmap,
  focusMindmapOn,
  mindmapPathTo,
  mindmapTrail,
  parseMindmapDoc,
  type MindmapDoc,
  type MindmapNode,
} from "@/lib/mindmap-doc";
import {
  mindmapBranchColor,
  suggestMindmapFold,
  MINDMAP_REFERENCE_FRAMES,
} from "@/lib/mindmap-layout";

/**
 * The Mindmap tab: the note read as a shape instead of as a page.
 *
 * It fetches on its own rather than riding the note's detail payload, which already fans out to a
 * dozen queries on every open of a note that most readers never map. The tab pays for its own
 * request, when it is opened.
 */

type MindmapResponse = {
  status: StudyAssetStatus | null;
  doc: unknown;
  errorMessage: string | null;
  generatedAt: string | null;
  stale: boolean;
};

type MindmapState = {
  status: StudyAssetStatus | null;
  doc: MindmapDoc | null;
  errorMessage: string | null;
  stale: boolean;
  /**
   * When the *map* was last finished — not when its row was last touched.
   *
   * It keys the canvas, so a redrawn map arrives framed instead of in the old view. Taking it
   * from every response would remount the canvas on every poll of a running generation, since
   * the row's `generated_at` moves on each status write: a reader who pressed "draw again" and
   * panned while waiting would be snapped back to fit every two and a half seconds.
   */
  readyAt: string | null;
};

const POLL_INTERVAL_MS = 2500;
/** Retina, and no more: a map is wide, and 3x turns a big one into a 30 MB download. */
const EXPORT_SCALE = 2;

function isRunning(status: StudyAssetStatus | null) {
  return status === "queued" || status === "generating";
}

function normaliseForSearch(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function fileNameFor(title: string) {
  const stem =
    title
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .toLowerCase() || "mindmap";

  return `${stem}-mindmap.png`;
}

export function LectureMindmap({
  lectureId,
  lectureTitle,
  lectureReady,
}: {
  lectureId: string;
  lectureTitle: string;
  lectureReady: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const canvasRef = useRef<MindmapCanvasHandle | null>(null);

  const [state, setState] = useState<MindmapState | null>(null);
  /*
   * Mirrors `state` for `load`, which needs the previous value but must not be rebuilt on every
   * poll — a new `load` identity restarts the polling effect. Written beside every `setState`
   * below rather than during render, so the two never disagree.
   */
  const stateRef = useRef<MindmapState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  /*
   * `null` until the reader folds something themselves, at which point their arrangement replaces
   * the opening one for good. Derived rather than seeded into state so a redrawn map opens on its
   * own best view instead of inheriting the folds of the map it replaced.
   */
  const [userCollapsedIds, setUserCollapsedIds] = useState<ReadonlySet<string> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [matchCursor, setMatchCursor] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  /*
   * Which node the map is currently re-rooted on. Folding takes things away; this takes the
   * reader in — it is what makes a four-hundred-node map of a long note navigable rather than
   * merely foldable, and it is the only control here that changes what the centre means.
   */
  const [focusId, setFocusId] = useState<string | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);

  const wholeDoc = state?.doc ?? null;
  const status = state?.status ?? null;

  /* Everything below — layout, search, keyboard, export — works on whatever is on screen. */
  const doc = useMemo(
    () => (wholeDoc && focusId ? focusMindmapOn(wholeDoc, focusId) ?? wholeDoc : wholeDoc),
    [wholeDoc, focusId],
  );
  const trail = useMemo(
    () => (wholeDoc && focusId ? mindmapTrail(wholeDoc, focusId) : []),
    [wholeDoc, focusId],
  );

  /* What the map opens folded to, so that what it opens on is readable rather than merely whole. */
  const suggestedFold = useMemo(() => {
    if (!doc) {
      return new Set<string>();
    }

    /*
     * Read once, when there is a map to fold: the canvas has not measured itself yet, and the
     * question — laptop column or phone stage — is answered well enough by the same breakpoint
     * the stylesheet uses. Safe on the server because `doc` is null until the fetch lands.
     */
    const isPhone =
      typeof window !== "undefined" && window.matchMedia("(max-width: 1099px)").matches;

    return suggestMindmapFold(doc, {
      frame: MINDMAP_REFERENCE_FRAMES[isPhone ? "phone" : "desktop"],
    });
  }, [doc]);
  const collapsedIds = userCollapsedIds ?? suggestedFold;

  const load = useCallback(async () => {
    const response = await fetch(`/api/lectures/${lectureId}/mindmap`, { cache: "no-store" });
    const payload = await parseApiResponse<MindmapResponse>(response, t);
    const previous = stateRef.current;
    const next: MindmapState = {
      status: payload.status,
      doc: parseMindmapDoc(payload.doc),
      errorMessage: payload.errorMessage,
      stale: Boolean(payload.stale),
      readyAt: payload.status === "ready" ? payload.generatedAt : (previous?.readyAt ?? null),
    };

    stateRef.current = next;
    setState(next);

    return next;
  }, [lectureId, t]);

  const start = useCallback(
    async (options?: { regenerate?: boolean }) => {
      setActionError(null);
      setIsStarting(true);

      try {
        const path = options?.regenerate
          ? `/api/lectures/${lectureId}/mindmap/regenerate`
          : `/api/lectures/${lectureId}/mindmap`;
        const response = await fetch(path, { method: "POST" });
        await parseApiResponse<{ ok: true }>(response, t);
        setFocusId(null);
        setState((previous) => {
          const next: MindmapState = {
            status: "queued",
            doc: previous?.doc ?? null,
            errorMessage: null,
            stale: previous?.stale ?? false,
            readyAt: previous?.readyAt ?? null,
          };

          stateRef.current = next;

          return next;
        });
      } catch (error) {
        if (redirectToBillingIfNeeded({ error, router })) {
          return;
        }

        setActionError(error instanceof Error ? error.message : t("mindmap.failedBody"));
      } finally {
        setIsStarting(false);
      }
    },
    [lectureId, router, t],
  );

  /*
   * First open: read what is there, and set it going when there is nothing.
   *
   * Guarded by a ref rather than by the dependency list. `load` and `start` are rebuilt whenever
   * the translator identity changes, and without the guard a locale switch would re-run this and
   * queue a second generation of a map that is already being drawn.
   */
  const hasBootstrappedRef = useRef(false);
  useEffect(() => {
    if (hasBootstrappedRef.current) {
      return;
    }

    hasBootstrappedRef.current = true;
    let cancelled = false;

    void load()
      .then((next) => {
        if (!cancelled && lectureReady && !next.doc && next.status === null) {
          void start();
        }
      })
      .catch((error: unknown) => {
        if (cancelled || redirectToBillingIfNeeded({ error, router })) {
          return;
        }

        setLoadError(error instanceof Error ? error.message : t("mindmap.failedBody"));
      });

    return () => {
      cancelled = true;
    };
  }, [load, start, lectureReady, router, t]);

  /* While it is being drawn, ask again. Stops the moment it lands or fails. */
  useEffect(() => {
    if (!isRunning(status)) {
      return;
    }

    const timer = window.setInterval(() => {
      void load().catch(() => {
        /* A dropped poll is not a failure; the next one answers. */
      });
    }, POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [status, load]);

  const allNodes = useMemo(() => (doc ? flattenMindmap(doc) : []), [doc]);

  const nodesById = useMemo(() => {
    const map = new Map<string, MindmapNode>();

    for (const node of allNodes) {
      map.set(node.id, node);
    }

    return map;
  }, [allNodes]);

  const matches = useMemo(() => {
    const query = normaliseForSearch(search.trim());

    if (query.length < 2 || !doc) {
      return [] as MindmapNode[];
    }

    return allNodes.filter((node) =>
      normaliseForSearch(`${node.label} ${node.detail ?? ""}`).includes(query),
    );
  }, [search, allNodes, doc]);

  const matchedIds = useMemo(
    () => (matches.length > 0 ? new Set(matches.map((node) => node.id)) : null),
    [matches],
  );

  /*
   * A match hidden inside a folded branch is not a match the reader can see, so finding one
   * opens whatever is covering it. Done as an effect rather than inside the search handler
   * because the ancestors to open depend on the map, not on the keystroke.
   */
  useEffect(() => {
    if (matches.length === 0 || !doc) {
      return;
    }

    setUserCollapsedIds((previous) => {
      const base = previous ?? suggestedFold;

      if (base.size === 0) {
        return previous;
      }

      const next = new Set(base);
      let changed = false;

      for (const match of matches) {
        for (const ancestorId of mindmapPathTo(doc, match.id).slice(0, -1)) {
          if (next.delete(ancestorId)) {
            changed = true;
          }
        }
      }

      return changed ? next : previous;
    });
  }, [matches, doc, suggestedFold]);

  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;
  /*
   * Read off the map being drawn rather than off the id, so a focused map recolours with the
   * canvas instead of keeping the colours of the branches it came out of.
   */
  const selectedBranchIndex = useMemo(() => {
    if (!doc || !selectedId) {
      return 0;
    }

    const branchId = mindmapPathTo(doc, selectedId)[0];

    return Math.max(0, doc.branches.findIndex((branch) => branch.id === branchId));
  }, [doc, selectedId]);

  const toggleCollapse = useCallback(
    (nodeId: string) => {
      setUserCollapsedIds((previous) => {
        const next = new Set(previous ?? suggestedFold);

        if (!next.delete(nodeId)) {
          next.add(nodeId);
        }

        return next;
      });
    },
    [suggestedFold],
  );

  const handleViewChange = useCallback((view: MindmapView) => {
    setZoomPercent((previous) => {
      const next = Math.round(view.k * 100);
      return next === previous ? previous : next;
    });
  }, []);

  const jumpToMatch = useCallback(
    (index: number) => {
      if (matches.length === 0) {
        return;
      }

      const wrapped = ((index % matches.length) + matches.length) % matches.length;
      const target = matches[wrapped];
      setMatchCursor(wrapped);
      setSelectedId(target.id);
      canvasRef.current?.centreOn(target.id, { zoom: 1 });
    },
    [matches],
  );

  async function handleExport() {
    if (!doc) {
      return;
    }

    setActionError(null);
    setIsExporting(true);

    try {
      const blob = await canvasRef.current?.toPngBlob(EXPORT_SCALE);

      if (!blob) {
        setActionError(t("mindmap.exportFailed"));
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileNameFor(doc.title || lectureTitle);
      document.body.appendChild(link);
      link.click();
      link.remove();
      /* Freed on the next turn: revoking synchronously cancels the download in Safari. */
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setActionError(t("mindmap.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  }

  /**
   * Arrows walk the tree, Enter folds, Escape lets go — the keyboard equivalent of the pointer
   * affordances, and the only way to drive the map without one.
   */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!doc) {
      return;
    }

    if (event.key === "Escape") {
      if (selectedId) {
        setSelectedId(null);
      } else if (focusId) {
        setFocusId(null);
      }

      return;
    }

    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter", " "].includes(event.key)) {
      return;
    }

    event.preventDefault();

    if (!selectedId) {
      const first = doc.branches[0];

      if (first) {
        setSelectedId(first.id);
        canvasRef.current?.centreOn(first.id);
      }

      return;
    }

    const path = mindmapPathTo(doc, selectedId);
    const parentId = path.length > 1 ? path[path.length - 2] : null;
    const siblings = parentId ? nodesById.get(parentId)?.children ?? [] : doc.branches;
    const index = siblings.findIndex((node) => node.id === selectedId);
    const node = nodesById.get(selectedId);

    if (event.key === "Enter" || event.key === " ") {
      if (node && node.children.length > 0) {
        toggleCollapse(selectedId);
      }

      return;
    }

    let nextId: string | null = null;

    if (event.key === "ArrowDown") {
      nextId = siblings[index + 1]?.id ?? null;
    } else if (event.key === "ArrowUp") {
      nextId = siblings[index - 1]?.id ?? null;
    } else if (event.key === "ArrowRight") {
      nextId = node && !collapsedIds.has(node.id) ? node.children[0]?.id ?? null : null;
    } else if (event.key === "ArrowLeft") {
      nextId = parentId;
    }

    if (nextId) {
      setSelectedId(nextId);
      canvasRef.current?.centreOn(nextId);
    }
  }

  const canvas = doc ? (
    <MindmapCanvas
      key={state?.readyAt ?? "mindmap"}
      doc={doc}
      title={doc.title || lectureTitle}
      collapsedIds={collapsedIds}
      selectedId={selectedId}
      matchedIds={matchedIds}
      onSelect={setSelectedId}
      onToggleCollapse={toggleCollapse}
      handleRef={canvasRef}
      onViewChange={handleViewChange}
      ariaLabel={t("mindmap.canvasLabel")}
    />
  ) : null;

  const toolbar = doc ? (
    <div className="memo-mm-toolbar">
      <div className="memo-mm-tools">
        <div className={`memo-mm-search ${isSearchOpen ? "open" : ""}`.trim()}>
          <button
            type="button"
            className="memo-mm-tool"
            aria-label={t("mindmap.search")}
            aria-expanded={isSearchOpen}
            onClick={() => {
              setIsSearchOpen((open) => !open);

              if (isSearchOpen) {
                setSearch("");
              }
            }}
          >
            <Msym name="search" size="1.15rem" fill={false} weight={500} />
          </button>
          {isSearchOpen ? (
            <>
              {/* Opened by a deliberate press on the search button; focusing it is the point. */}
              <input
                autoFocus
                type="search"
                className="memo-mm-search-input"
                value={search}
                placeholder={t("mindmap.search")}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setMatchCursor(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    /* First Enter frames the first match; every Enter after it steps on. */
                    jumpToMatch(selectedId ? matchCursor + 1 : matchCursor);
                  }

                  if (event.key === "Escape") {
                    setSearch("");
                    setIsSearchOpen(false);
                  }
                }}
              />
              {search.trim().length >= 2 ? (
                <span className="memo-mm-search-count">
                  {matches.length > 0
                    ? t("mindmap.matches", { count: matches.length })
                    : t("mindmap.noMatches")}
                </span>
              ) : null}
            </>
          ) : null}
        </div>

        <button
          type="button"
          className="memo-mm-tool"
          onClick={() => setIsFullscreen((open) => !open)}
          aria-label={t(isFullscreen ? "mindmap.exitFullscreen" : "mindmap.fullscreen")}
          title={t(isFullscreen ? "mindmap.exitFullscreen" : "mindmap.fullscreen")}
        >
          <Msym
            name={isFullscreen ? "close_fullscreen" : "open_in_full"}
            size="1.1rem"
            fill={false}
            weight={500}
          />
        </button>

      </div>

      <div className="memo-mm-zoom memo-only-desktop">
        <button
          type="button"
          className="memo-mm-tool"
          onClick={() => canvasRef.current?.zoomBy(1 / 1.25)}
          aria-label={t("mindmap.zoomOut")}
        >
          <Msym name="remove" size="1.2rem" fill={false} weight={500} />
        </button>
        <button
          type="button"
          className="memo-mm-zoom-level"
          onClick={() => canvasRef.current?.fit()}
          title={t("mindmap.fit")}
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          className="memo-mm-tool"
          onClick={() => canvasRef.current?.zoomBy(1.25)}
          aria-label={t("mindmap.zoomIn")}
        >
          <Msym name="add" size="1.2rem" fill={false} weight={500} />
        </button>
      </div>

      <button
        type="button"
        className="memo-mm-save"
        onClick={() => void handleExport()}
        disabled={isExporting}
      >
        {isExporting ? (
          <Msym name="progress_activity" className="memo-spin" size="1.15rem" />
        ) : (
          <Msym name="download" size="1.15rem" fill={false} weight={500} />
        )}
        <span>{t("mindmap.saveImage")}</span>
      </button>
    </div>
  ) : null;

  const detailCard = selected ? (
    <div className="memo-mm-detail" role="status">
      <span
        className="memo-mm-detail-rail"
        style={{ background: mindmapBranchColor(selectedBranchIndex) }}
      />
      <div className="memo-mm-detail-body">
        <p className="memo-mm-detail-label">{selected.label}</p>
        {selected.detail ? <p className="memo-mm-detail-copy">{selected.detail}</p> : null}
        {selected.children.length > 0 ? (
          <div className="memo-mm-detail-actions">
          <button
            type="button"
            className="memo-mm-detail-action"
            onClick={() => {
              setFocusId(selected.id);
              setSelectedId(null);
              setSearch("");
            }}
          >
            <Msym name="center_focus_strong" size="1.05rem" fill={false} weight={500} />
            <span>{t("mindmap.focusNode")}</span>
          </button>
          <button
            type="button"
            className="memo-mm-detail-action"
            onClick={() => toggleCollapse(selected.id)}
          >
            <Msym
              name={collapsedIds.has(selected.id) ? "unfold_more" : "unfold_less"}
              size="1.05rem"
              fill={false}
              weight={500}
            />
            <span>
              {t(collapsedIds.has(selected.id) ? "mindmap.unfoldNode" : "mindmap.foldNode", {
                count: selected.children.length,
              })}
            </span>
          </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="memo-mm-detail-close"
        aria-label={t("common.close")}
        onClick={() => setSelectedId(null)}
      >
        <Msym name="close" size="1.1rem" fill={false} weight={500} />
      </button>
    </div>
  ) : null;

  const stage = (
    <div
      className={`memo-mm-stage ${isFullscreen ? "fullscreen" : ""}`.trim()}
      tabIndex={0}
      role="application"
      aria-label={t("mindmap.canvasLabel")}
      onKeyDown={handleKeyDown}
    >
      {canvas}
      {trail.length > 0 ? (
        <nav className="memo-mm-trail" aria-label={t("mindmap.trail")}>
          <button type="button" onClick={() => setFocusId(null)}>
            {t("mindmap.wholeMap")}
          </button>
          {trail.map((step, index) => (
            <span key={step.id} className="memo-mm-trail-step">
              <Msym name="chevron_right" size="1rem" fill={false} weight={500} />
              {index === trail.length - 1 ? (
                <span className="memo-mm-trail-current">{step.label}</span>
              ) : (
                <button type="button" onClick={() => setFocusId(step.id)}>
                  {step.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}
      {toolbar}
      {detailCard}
      {/*
        * A failed redraw of a map that already exists is the one failure with nowhere else to
        * appear: the map on screen is the old one and looks perfectly well, so without this the
        * reader presses redraw, watches the spinner stop, and is shown the same map with no
        * explanation. The staleness notice steps aside for it — one badge in that corner.
        */}
      {status === "failed" && doc ? (
        <div className="memo-mm-stale">
          <span>{state?.errorMessage || t("mindmap.failedBody")}</span>
          <button type="button" onClick={() => void start({ regenerate: true })}>
            {t("common.retry")}
          </button>
        </div>
      ) : state?.stale && !isRunning(status) ? (
        <div className="memo-mm-stale">
          <span>{t("mindmap.stale")}</span>
          <button type="button" onClick={() => void start({ regenerate: true })}>
            {t("mindmap.redraw")}
          </button>
        </div>
      ) : null}
      {isRunning(status) && doc ? (
        <div className="memo-mm-redrawing" role="status">
          <Msym name="progress_activity" className="memo-spin" size="1.05rem" />
          <span>{t("mindmap.redrawing")}</span>
        </div>
      ) : null}
    </div>
  );

  if (loadError) {
    return <p className="danger-panel lecture-inline-note">{loadError}</p>;
  }

  if (doc) {
    return (
      <>
        {actionError ? <p className="danger-panel lecture-inline-note">{actionError}</p> : null}
        {isFullscreen ? (
          <>
            <div className="memo-mm-placeholder" aria-hidden="true" />
            <MemoPortal>
              <div className="memo-mm-overlay">{stage}</div>
            </MemoPortal>
          </>
        ) : (
          stage
        )}
      </>
    );
  }

  /*
   * Being drawn, and being about to be drawn, are the same wait to a reader — the request is
   * already in flight while the status is still `null`. Both show the app's own generation
   * screen rather than a spinner of this tab's invention: the ghost of a map, over the stage
   * caption that says which minute of the wait this is.
   */
  if (isRunning(status) || isStarting || state === null) {
    return (
      <StudyGenerationNotice
        preview="mindmap"
        stageCopy={t(state === null ? "mindmap.loading" : "mindmap.generating")}
        bodyCopy={state === null ? "" : t("mindmap.generatingBody")}
      />
    );
  }

  /* Everything below is the map's absence, in its several flavours. */
  return (
    <div className="memo-study-empty">
      <div className="memo-study-empty-orb">
        <Emoji symbol="🧠" size="4.4rem" />
      </div>
      <p className="memo-study-empty-title">
        {!lectureReady
          ? t("mindmap.locked")
          : status === "failed"
            ? t("mindmap.failed")
            : t("mindmap.emptyTitle")}
      </p>
      <p className="memo-study-empty-copy">
        {!lectureReady
          ? t("mindmap.lockedBody")
          : status === "failed"
            ? state?.errorMessage || t("mindmap.failedBody")
            : t("mindmap.emptyBody")}
      </p>
      {actionError ? <p className="danger-panel lecture-inline-note">{actionError}</p> : null}
      {lectureReady ? (
        <button
          type="button"
          className="memo-study-empty-cta"
          onClick={() => void start({ regenerate: status === "failed" })}
        >
          <Msym name="account_tree" size="1.2rem" fill={false} weight={500} />
          {t(status === "failed" ? "common.retry" : "mindmap.create")}
        </button>
      ) : null}
    </div>
  );
}
