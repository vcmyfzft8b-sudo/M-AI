"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";

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
  mindmapBranchIndexOf,
  mindmapPathTo,
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
  /** Doubles as the canvas key, so a redrawn map arrives framed rather than in the old view. */
  generatedAt: string | null;
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
  const [zoomPercent, setZoomPercent] = useState(100);

  const doc = state?.doc ?? null;
  const status = state?.status ?? null;

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
    const next: MindmapState = {
      status: payload.status,
      doc: parseMindmapDoc(payload.doc),
      errorMessage: payload.errorMessage,
      stale: Boolean(payload.stale),
      generatedAt: payload.generatedAt,
    };

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
        setState((previous) => ({
          status: "queued",
          doc: previous?.doc ?? null,
          errorMessage: null,
          stale: previous?.stale ?? false,
          generatedAt: previous?.generatedAt ?? null,
        }));
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

  const collapseToTopics = useCallback(() => {
    if (!doc) {
      return;
    }

    /*
     * "Collapse" folds every branch to its own name rather than folding everything everywhere:
     * a map folded to nothing is a title, and the reader wanted the overview, not the void.
     */
    setUserCollapsedIds(new Set(doc.branches.map((branch) => branch.id)));
    setSelectedId(null);
  }, [doc]);

  const expandAll = useCallback(() => {
    setUserCollapsedIds(new Set<string>());
  }, []);

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
      setSelectedId(null);
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
      key={state?.generatedAt ?? "mindmap"}
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
          onClick={collapsedIds.size > 0 ? expandAll : collapseToTopics}
          aria-label={t(collapsedIds.size > 0 ? "mindmap.expandAll" : "mindmap.collapseAll")}
          title={t(collapsedIds.size > 0 ? "mindmap.expandAll" : "mindmap.collapseAll")}
        >
          <Msym
            name={collapsedIds.size > 0 ? "unfold_more" : "unfold_less"}
            size="1.15rem"
            fill={false}
            weight={500}
          />
        </button>

        {/* The phone has no room for a zoom cluster, and no need of one: it pinches. What it
            cannot do by hand is frame the map again afterwards, so that one control stays. */}
        <button
          type="button"
          className="memo-mm-tool memo-only-mobile"
          onClick={() => canvasRef.current?.fit()}
          aria-label={t("mindmap.fit")}
          title={t("mindmap.fit")}
        >
          <Msym name="fit_screen" size="1.15rem" fill={false} weight={500} />
        </button>

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

        <button
          type="button"
          className="memo-mm-tool"
          onClick={() => void start({ regenerate: true })}
          disabled={isStarting || isRunning(status)}
          aria-label={t("mindmap.redraw")}
          title={t("mindmap.redraw")}
        >
          <Msym
            name="refresh"
            size="1.15rem"
            fill={false}
            weight={500}
            className={isStarting ? "memo-spin" : undefined}
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
        style={{ background: mindmapBranchColor(mindmapBranchIndexOf(selected.id)) }}
      />
      <div className="memo-mm-detail-body">
        <p className="memo-mm-detail-label">{selected.label}</p>
        {selected.detail ? <p className="memo-mm-detail-copy">{selected.detail}</p> : null}
        {selected.children.length > 0 ? (
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

  /* Everything below is the map's absence, in its several flavours. */
  return (
    <div className="memo-study-empty">
      <div className="memo-study-empty-orb">
        <Emoji symbol={isRunning(status) || state === null ? "🌱" : "🧠"} size="4.4rem" />
      </div>
      <p className="memo-study-empty-title">
        {state === null
          ? t("mindmap.loading")
          : !lectureReady
            ? t("mindmap.locked")
            : isRunning(status)
              ? t("mindmap.generating")
              : status === "failed"
                ? t("mindmap.failed")
                : t("mindmap.emptyTitle")}
      </p>
      <p className="memo-study-empty-copy">
        {state === null
          ? ""
          : !lectureReady
            ? t("mindmap.lockedBody")
            : isRunning(status)
              ? t("mindmap.generatingBody")
              : status === "failed"
                ? state?.errorMessage || t("mindmap.failedBody")
                : t("mindmap.emptyBody")}
      </p>
      {actionError ? <p className="danger-panel lecture-inline-note">{actionError}</p> : null}
      {lectureReady && !isRunning(status) ? (
        <button
          type="button"
          className="memo-study-empty-cta"
          onClick={() => void start({ regenerate: status === "failed" })}
          disabled={isStarting}
        >
          {isStarting ? (
            <Msym name="progress_activity" className="memo-spin" size="1.2rem" />
          ) : (
            <Msym name="account_tree" size="1.2rem" fill={false} weight={500} />
          )}
          {t(status === "failed" ? "common.retry" : "mindmap.create")}
        </button>
      ) : null}
    </div>
  );
}
