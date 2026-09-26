"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";

import { useT } from "@/components/i18n-provider";
import { LandingAppScope, type LandingAppTheme } from "@/components/landing/app/landing-app-scope";
import {
  useLandingAutoplay,
  useLandingAutoplayStep,
  type LandingAutoplayStep,
} from "@/components/landing/app/landing-study-content";
import {
  MindmapCanvas,
  type MindmapCanvasHandle,
} from "@/components/mindmap-canvas";
import { Msym } from "@/components/msym";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
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

/*
 * The mindmap tab, as the app draws it (`lecture-mindmap.tsx`).
 *
 * The map itself is the app's own `MindmapCanvas` — its layout, its links, its pan and pinch,
 * tap-to-open and badge-to-fold — handed a static document instead of a fetched one. Around it
 * is the tab's JSX, transcribed: the stage, the search, the detail card with "zoom into this
 * branch" and "hide subtopics", the breadcrumb out of a focused branch, and "Save as image",
 * which is the canvas's own PNG export and never leaves the browser.
 *
 * Left out, because they cannot run on a public page: the fetch and the generation poll and the
 * offline copy. Full screen, a portal over the window in the app, covers the landing's phone.
 *
 * The map is the landing's sample lecture (the flow demo's note), in the reader's language.
 */

const EXPORT_SCALE = 2;

/*
 * The canvas measures its labels on a real 2D context, which the server does not have: its
 * layout there is an approximation, and hydrating one over the other leaves every link and
 * node where the server guessed. The app never meets this — its map arrives by fetch, after
 * mount — so here the canvas is simply drawn on the client only.
 */
const subscribeToNothing = () => () => {};

type DraftNode = { labelKey?: MessageKey; label?: string; detailKey?: MessageKey; children?: DraftNode[] };

/** The sample note, drawn as the generator would draw it: topics, then the ideas under them. */
const SAMPLE_MAP: DraftNode[] = [
  {
    labelKey: "flowDemo.note.typesHeading",
    children: [
      { labelKey: "flowDemo.note.bullet1Term", detailKey: "landingMindmap.transactionalDetail" },
      { labelKey: "flowDemo.note.bullet2Term", detailKey: "landingMindmap.supportDetail" },
      { labelKey: "flowDemo.note.bullet3Term", detailKey: "landingMindmap.erpDetail" },
    ],
  },
  {
    labelKey: "landingMindmap.connects",
    detailKey: "landingMindmap.connectsDetail",
    children: [
      { labelKey: "landingMindmap.finance" },
      { labelKey: "landingMindmap.purchasing" },
      { labelKey: "landingMindmap.production" },
      { labelKey: "landingMindmap.sales" },
      { labelKey: "landingMindmap.hr" },
    ],
  },
  {
    labelKey: "landingMindmap.data",
    children: [
      { labelKey: "landingMindmap.goodData", detailKey: "flowDemo.note.keyBody" },
      { labelKey: "landingMindmap.oneSource", detailKey: "landingMindmap.oneSourceDetail" },
    ],
  },
  {
    labelKey: "landingMindmap.rollout",
    children: [
      { labelKey: "landingMindmap.redesign", detailKey: "landingMindmap.redesignDetail" },
      { labelKey: "landingMindmap.training" },
    ],
  },
  {
    labelKey: "landingMindmap.exam",
    children: [
      { labelKey: "landingMindmap.compare", detailKey: "landingMindmap.compareDetail" },
      { labelKey: "landingMindmap.speed", detailKey: "landingMindmap.speedDetail" },
    ],
  },
];

/**
 * The sample as a stored map, through the same parser a fetched one goes through — which is
 * what gives it the app's positional node ids and its label caps.
 */
export function landingMindmapDoc(t: Translate<MessageKey>, language: string): MindmapDoc | null {
  const toRaw = (node: DraftNode): Record<string, unknown> => ({
    label: node.label ?? (node.labelKey ? t(node.labelKey) : ""),
    detail: node.detailKey ? t(node.detailKey) : null,
    children: (node.children ?? []).map(toRaw),
  });

  return parseMindmapDoc({
    version: 1,
    title: t("flowDemo.note.leadA"),
    language,
    branches: SAMPLE_MAP.map(toRaw),
  });
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

export function LandingMindmapScreen({
  theme,
  autoplay = false,
  className,
  doc: docOverride,
}: {
  theme?: LandingAppTheme;
  autoplay?: boolean;
  className?: string;
  /** A map to draw instead of the landing's sample. */
  doc?: MindmapDoc;
}) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<MindmapCanvasHandle | null>(null);
  const isClient = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const sampleDoc = useMemo(() => landingMindmapDoc(t, ""), [t]);
  const wholeDoc = docOverride ?? sampleDoc;

  const [userCollapsedIds, setUserCollapsedIds] = useState<ReadonlySet<string> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [matchCursor, setMatchCursor] = useState(0);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const doc = useMemo(
    () => (wholeDoc && focusId ? focusMindmapOn(wholeDoc, focusId) ?? wholeDoc : wholeDoc),
    [wholeDoc, focusId],
  );
  const trail = useMemo(
    () => (wholeDoc && focusId ? mindmapTrail(wholeDoc, focusId) : []),
    [wholeDoc, focusId],
  );

  /* Always the phone's reference frame: this screen is drawn at the phone's size everywhere. */
  const suggestedFold = useMemo(
    () => (doc ? suggestMindmapFold(doc, { frame: MINDMAP_REFERENCE_FRAMES.phone }) : new Set<string>()),
    [doc],
  );
  const collapsedIds = userCollapsedIds ?? suggestedFold;

  const allNodes = useMemo(() => (doc ? flattenMindmap(doc) : []), [doc]);
  const nodesById = useMemo(() => new Map(allNodes.map((node) => [node.id, node])), [allNodes]);

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
   * A match inside a folded branch opens what covers it — the app does this in an effect; here it
   * is worked out as part of the fold, which comes to the same set without a second render.
   */
  const visibleCollapsedIds = useMemo(() => {
    if (!doc || matches.length === 0 || collapsedIds.size === 0) {
      return collapsedIds;
    }

    const next = new Set(collapsedIds);

    for (const match of matches) {
      for (const ancestorId of mindmapPathTo(doc, match.id).slice(0, -1)) {
        next.delete(ancestorId);
      }
    }

    return next;
  }, [collapsedIds, doc, matches]);

  const selected = selectedId ? nodesById.get(selectedId) ?? null : null;
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
        const next = new Set(previous ?? visibleCollapsedIds);

        if (!next.delete(nodeId)) {
          next.add(nodeId);
        }

        return next;
      });
    },
    [visibleCollapsedIds],
  );

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
      link.download = fileNameFor(doc.title);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setActionError(t("mindmap.exportFailed"));
    } finally {
      setIsExporting(false);
    }
  }

  /** The app's keyboard: arrows walk the tree, Enter folds, Escape lets go. */
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!doc || event.target !== event.currentTarget) {
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
      nextId = node && !visibleCollapsedIds.has(node.id) ? node.children[0]?.id ?? null : null;
    } else if (event.key === "ArrowLeft") {
      nextId = parentId;
    }

    if (nextId) {
      setSelectedId(nextId);
      canvasRef.current?.centreOn(nextId);
    }
  }

  /*
   * The walkthrough, as a reader's taps: open a folded topic, read one of its ideas, open another,
   * and fold the map back to where it started. A tap on a folded node opens and selects it, the
   * way the canvas's own click does.
   */
  const { running } = useLandingAutoplay(autoplay, rootRef);
  const [demoStep, setDemoStep] = useState(0);
  const tap = (nodeId: string) => {
    if (visibleCollapsedIds.has(nodeId)) {
      toggleCollapse(nodeId);
    }

    setSelectedId(nodeId);
  };
  const script: Array<{ delay: number; run: () => void }> = [
    { delay: 1_600, run: () => tap("n2") },
    { delay: 2_600, run: () => tap("n2.3") },
    { delay: 2_400, run: () => tap("n1") },
    { delay: 2_600, run: () => tap("n1.1") },
    { delay: 2_600, run: () => setSelectedId(null) },
    {
      delay: 2_200,
      run: () => {
        setUserCollapsedIds(null);
        setSelectedId(null);
      },
    },
  ];
  const current = script[demoStep % script.length];
  const step: LandingAutoplayStep = doc
    ? {
        key: `mindmap-${demoStep}`,
        delay: current.delay,
        run: () => {
          current.run();
          setDemoStep((value) => value + 1);
        },
      }
    : null;

  useLandingAutoplayStep(running, step);

  const rootClassName = ["landing-study-screen landing-feature-screen", className]
    .filter(Boolean)
    .join(" ");

  if (!doc) {
    return <LandingAppScope theme={theme} className={rootClassName}>{null}</LandingAppScope>;
  }

  const stage = (
    <div
      className="memo-mm-stage"
      tabIndex={0}
      role="application"
      aria-label={t("mindmap.canvasLabel")}
      onKeyDown={handleKeyDown}
    >
      {isClient ? (
        <MindmapCanvas
          doc={doc}
          title={doc.title}
          collapsedIds={visibleCollapsedIds}
          selectedId={selectedId}
          matchedIds={matchedIds}
          onSelect={setSelectedId}
          onToggleCollapse={toggleCollapse}
          handleRef={canvasRef}
          ariaLabel={t("mindmap.canvasLabel")}
        />
      ) : null}

      {trail.length > 0 ? (
        <nav className="memo-mm-trail" aria-label={t("mindmap.trail")}>
          <button type="button" onClick={() => setFocusId(null)}>
            {t("mindmap.wholeMap")}
          </button>
          {trail.map((entry, index) => (
            <span key={entry.id} className="memo-mm-trail-step">
              <Msym name="chevron_right" size="1rem" fill={false} weight={500} />
              {index === trail.length - 1 ? (
                <span className="memo-mm-trail-current">{entry.label}</span>
              ) : (
                <button type="button" onClick={() => setFocusId(entry.id)}>
                  {entry.label}
                </button>
              )}
            </span>
          ))}
        </nav>
      ) : null}

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

      {selected ? (
        <div className="memo-mm-detail" role="status">
          <div className="memo-mm-detail-head">
            <span
              className="memo-mm-detail-dot"
              style={{ background: mindmapBranchColor(selectedBranchIndex) }}
            />
            <p className="memo-mm-detail-label">{selected.label}</p>
            <button
              type="button"
              className="memo-mm-detail-close"
              aria-label={t("common.close")}
              onClick={() => setSelectedId(null)}
            >
              <Msym name="close" size="1rem" fill={false} weight={500} />
            </button>
          </div>
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
                <Msym name="center_focus_strong" size="0.95rem" fill={false} weight={500} />
                <span>{t("mindmap.focusNode")}</span>
              </button>
              <button
                type="button"
                className="memo-mm-detail-action"
                onClick={() => toggleCollapse(selected.id)}
              >
                <Msym
                  name={visibleCollapsedIds.has(selected.id) ? "unfold_more" : "unfold_less"}
                  size="0.95rem"
                  fill={false}
                  weight={500}
                />
                <span>
                  {t(visibleCollapsedIds.has(selected.id) ? "mindmap.unfoldNode" : "mindmap.foldNode", {
                    count: selected.children.length,
                  })}
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );

  return (
    <LandingAppScope theme={theme} className={rootClassName}>
      <div ref={rootRef} className="landing-study-frame" data-note-tab="mindmap">
        {actionError ? <p className="danger-panel lecture-inline-note">{actionError}</p> : null}
        {/*
          * Full screen is a portal in the app, over the whole window; here the whole window is the
          * phone the landing draws, so the overlay covers the screen instead (see landing.css).
          */}
        {isFullscreen ? (
          <>
            <div className="memo-mm-placeholder" aria-hidden="true" />
            <div className="memo-mm-overlay">{stage}</div>
          </>
        ) : (
          stage
        )}
      </div>
    </LandingAppScope>
  );
}
