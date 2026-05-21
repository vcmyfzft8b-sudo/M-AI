"use client";

import { Loader2 } from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";

import { NoteSourceModal, type NoteSourceMode } from "@/components/note-source-modal";
import { StatusBadge } from "@/components/status-badge";
import { EmojiIcon } from "@/components/emoji-icon";
import { InstantLink } from "@/components/instant-link";
import { LibraryFolderMenu } from "@/components/library-folder-menu";
import { ViewportPortal } from "@/components/viewport-portal";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import { getEffectiveLectureSourceType } from "@/lib/lecture-source-metadata";
import type { AppLectureListItem, AppLibraryFolder } from "@/lib/types";
import { formatCalendarDate } from "@/lib/utils";

const QUICK_ACTIONS = [
  {
    id: "record" as const,
    label: "Posnemi predavanje",
    detail: "Začni z enim dotikom",
    icon: "🎙️",
    accent: "record",
  },
  {
    id: "upload" as const,
    label: "Naloži zvok",
    detail: "MP3, M4A, WAV ali WEBM",
    icon: "📤",
    accent: "default",
  },
  {
    id: "text" as const,
    label: "Prilepi besedilo ali PDF",
    detail: "Pretvori gradivo v strukturirane zapiske",
    icon: "📄",
    accent: "default",
  },
  {
    id: "link" as const,
    label: "Dodaj povezavo",
    detail: "Spletni članek ali vir",
    icon: "🔗",
    accent: "default",
  },
] as const;

const DASHBOARD_MUTATION_TIMEOUT_MS = 18_000;
const DASHBOARD_NOTE_ACTION_REVEAL_PX = 144;
const RENAME_KEYBOARD_VISIBLE_INSET_PX = 80;

type DashboardNoteDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  offset: number;
  isDragging: boolean;
};

async function fetchDashboardMutation(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
) {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, DASHBOARD_MUTATION_TIMEOUT_MS);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new Error(
        "Lokalni strežnik se ni odzval. Osveži stran ali ponovno zaženi localhost.",
      );
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function sourceLabel(sourceType: string) {
  if (sourceType === "link") {
    return "Povezava";
  }

  if (sourceType === "text") {
    return "Besedilo";
  }

  if (sourceType === "pdf") {
    return "PDF";
  }

  if (sourceType === "presentation") {
    return "Predstavitev";
  }

  return "Zvok";
}

function SourceIcon({ sourceType }: { sourceType: string }) {
  if (sourceType === "link") {
    return <EmojiIcon symbol="🔗" size="1rem" />;
  }

  if (sourceType === "text" || sourceType === "pdf" || sourceType === "presentation") {
    return <EmojiIcon symbol="📄" size="1rem" />;
  }

  return <EmojiIcon symbol="🎙️" size="1rem" />;
}

function shouldPollLectureStatus(status: AppLectureListItem["status"]) {
  return (
    status === "uploading" ||
    status === "queued" ||
    status === "transcribing" ||
    status === "generating_notes"
  );
}

type NoteRowProps = {
  lecture: AppLectureListItem;
  isMenuOpen: boolean;
  isBusy: boolean;
  useSwipeActions: boolean;
  onToggleMenu: (lectureId: string) => void;
  onOpenRename: (lecture: AppLectureListItem) => void;
  onOpenDelete: (lecture: AppLectureListItem) => void;
  attachMenuRef: (node: HTMLDivElement | null) => void;
};

const NoteRow = memo(function NoteRow({
  lecture,
  isMenuOpen,
  isBusy,
  useSwipeActions,
  onToggleMenu,
  onOpenRename,
  onOpenDelete,
  attachMenuRef,
}: NoteRowProps) {
  const router = useRouter();
  const sourceType = getEffectiveLectureSourceType(lecture);
  const lectureHref = `/app/lectures/${lecture.id}`;
  const dragRef = useRef<DashboardNoteDragState | null>(null);
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [dragState, setDragState] = useState<DashboardNoteDragState | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const noteOffset = dragState?.offset ?? (isMenuOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0);
  const isSwipeActive = Boolean(dragState || isMenuOpen || noteOffset < 0);

  useEffect(() => {
    router.prefetch(lectureHref);
  }, [lectureHref, router]);

  useEffect(
    () => () => {
      cleanupDragListenersRef.current?.();
    },
    [],
  );

  if (!useSwipeActions) {
    return (
      <div className={`ios-row-note-card ${isMenuOpen ? "menu-open" : ""}`}>
        <InstantLink href={lectureHref} className="ios-row-note-card-link">
          <div className="ios-row-icon" style={{ backgroundColor: "var(--surface-muted)" }}>
            <SourceIcon sourceType={sourceType} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="ios-row-title truncate font-medium">
              {lecture.title ?? "Neimenovan zapisek"}
            </p>
            <p className="ios-row-subtitle mt-1">
              {sourceLabel(sourceType)} • {formatCalendarDate(lecture.created_at)}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {lecture.status !== "ready" && <StatusBadge status={lecture.status} />}
          </div>
        </InstantLink>

        <div
          ref={isMenuOpen ? attachMenuRef : undefined}
          className="dashboard-note-actions"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label={`Odpri dejanja za ${lecture.title ?? "zapisek"}`}
            aria-expanded={isMenuOpen}
            disabled={isBusy}
            onClick={() => onToggleMenu(lecture.id)}
            className={`dashboard-note-menu-button ${isMenuOpen ? "open" : ""}`}
          >
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <EmojiIcon symbol="⋯" size="1rem" />
            )}
          </button>

          {isMenuOpen ? (
            <div className="dashboard-note-menu">
              <button
                type="button"
                onClick={() => onOpenRename(lecture)}
                className="dashboard-note-menu-item"
                aria-label="Preimenuj zapisek"
                title="Preimenuj zapisek"
              >
                <EmojiIcon symbol="✏️" size="0.95rem" />
                <span>Preimenuj</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenDelete(lecture)}
                className="dashboard-note-menu-item danger"
                aria-label="Izbriši zapisek"
                title="Izbriši zapisek"
              >
                <EmojiIcon symbol="🗑️" size="0.95rem" />
                <span>Izbriši</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  function updateDrag(clientX: number, clientY: number, pointerId: number, preventDefault?: () => void) {
    const current = dragRef.current;

    if (!current || current.pointerId !== pointerId) {
      return;
    }

    const deltaX = clientX - current.startX;
    const deltaY = clientY - current.startY;
    const isHorizontalDrag =
      current.isDragging || (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY));

    if (!isHorizontalDrag) {
      return;
    }

    preventDefault?.();
    suppressClickRef.current = true;

    const nextDrag = {
      ...current,
      offset: Math.min(
        0,
        Math.max(-DASHBOARD_NOTE_ACTION_REVEAL_PX, current.startOffset + deltaX),
      ),
      isDragging: true,
    };
    dragRef.current = nextDrag;
    setDragState(nextDrag);
  }

  function finishDrag(pointerId: number) {
    const current = dragRef.current;

    if (!current || current.pointerId !== pointerId) {
      return;
    }

    const shouldOpen = current.offset < -DASHBOARD_NOTE_ACTION_REVEAL_PX / 2;
    if (shouldOpen && !isMenuOpen) {
      onToggleMenu(lecture.id);
    } else if (!shouldOpen && isMenuOpen) {
      onToggleMenu(lecture.id);
    }

    dragRef.current = null;
    setDragState(null);
    cleanupDragListenersRef.current?.();
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    cleanupDragListenersRef.current?.();

    const nextDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset: isMenuOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0,
      offset: isMenuOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0,
      isDragging: false,
    };
    dragRef.current = nextDrag;
    suppressClickRef.current = false;
    if (isMenuOpen) {
      setDragState(nextDrag);
    }

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      updateDrag(moveEvent.clientX, moveEvent.clientY, moveEvent.pointerId, () =>
        moveEvent.preventDefault(),
      );
    };
    const handleWindowPointerEnd = (endEvent: PointerEvent) => {
      finishDrag(endEvent.pointerId);
    };

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    cleanupDragListenersRef.current = () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
      cleanupDragListenersRef.current = null;
    };
  }

  function openLecture() {
    setIsOpening(true);
    router.push(lectureHref);
  }

  function handleSurfaceClick(event: ReactMouseEvent<HTMLElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      return;
    }

    openLecture();
  }

  function handleSurfaceKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    openLecture();
  }

  return (
    <div
      className={`ios-row-note-card dashboard-note-swipe-row ${
        isMenuOpen ? "menu-open" : ""
      } ${isSwipeActive ? "is-swiping" : ""} ${dragState ? "is-dragging" : ""} ${isOpening ? "is-opening" : ""}`}
    >
      <div
        ref={isMenuOpen ? attachMenuRef : undefined}
        className="dashboard-note-actions"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={`Preimenuj ${lecture.title ?? "zapisek"}`}
          disabled={isBusy}
          onClick={() => onOpenRename(lecture)}
          className="dashboard-note-menu-button edit"
        >
          <span className="dashboard-note-action-circle">
            <EmojiIcon symbol="✏️" size="1.1rem" />
          </span>
          <span className="dashboard-note-action-label">Uredi</span>
        </button>
        <button
          type="button"
          aria-label={`Izbriši ${lecture.title ?? "zapisek"}`}
          disabled={isBusy}
          onClick={() => onOpenDelete(lecture)}
          className="dashboard-note-menu-button danger"
        >
          <span className="dashboard-note-action-circle">
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <EmojiIcon symbol="🗑️" size="1.1rem" />
            )}
          </span>
          <span className="dashboard-note-action-label">Izbriši</span>
        </button>
      </div>
      <div
        role="link"
        tabIndex={0}
        className="ios-row-note-card-link dashboard-note-card-surface"
        onPointerDown={handlePointerDown}
        onClick={handleSurfaceClick}
        onKeyDown={handleSurfaceKeyDown}
        style={
          {
            "--dashboard-note-swipe-offset": `${noteOffset}px`,
          } as CSSProperties
        }
      >
        <div className="ios-row-icon" style={{ backgroundColor: "var(--surface-muted)" }}>
          <SourceIcon sourceType={sourceType} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="ios-row-title truncate font-medium">{lecture.title ?? "Neimenovan zapisek"}</p>
          <p className="ios-row-subtitle mt-1">
            {sourceLabel(sourceType)} • {formatCalendarDate(lecture.created_at)}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {lecture.status !== "ready" && <StatusBadge status={lecture.status} />}
        </div>
      </div>
    </div>
  );
}, (previousProps, nextProps) => {
  return (
    previousProps.lecture === nextProps.lecture &&
    previousProps.isMenuOpen === nextProps.isMenuOpen &&
    previousProps.isBusy === nextProps.isBusy &&
    previousProps.useSwipeActions === nextProps.useSwipeActions
  );
});

export function HomeDashboard({
  lectures,
  folders,
  userId,
  canCreateNotes,
  hasPaidAccess,
  hasTrialLectureAvailable,
  trialLectureId,
  trialChatMessagesRemaining,
}: {
  lectures: AppLectureListItem[];
  folders: AppLibraryFolder[];
  userId: string;
  canCreateNotes: boolean;
  hasPaidAccess: boolean;
  hasTrialLectureAvailable: boolean;
  trialLectureId: string | null;
  trialChatMessagesRemaining: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mobileCreateMenuDragStartYRef = useRef<number | null>(null);
  const mobileCreateMenuDragOffsetRef = useRef(0);
  const mobileCreateMenuSuppressClickRef = useRef(false);
  const mobileCreateMenuCloseTimerRef = useRef<number | null>(null);
  const dashboardDialogDragStartYRef = useRef<number | null>(null);
  const dashboardDialogDragOffsetRef = useRef(0);
  const dashboardDialogSuppressClickRef = useRef(false);
  const dashboardDialogCloseTimerRef = useRef<number | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const renameViewportMetricsKeyRef = useRef("");
  const [query, setQuery] = useState("");
  const [manualModal, setManualModal] = useState<NoteSourceMode | null>(null);
  const [isMobileCreateMenuOpen, setIsMobileCreateMenuOpen] = useState(false);
  const [mobileCreateMenuDragOffset, setMobileCreateMenuDragOffset] = useState(0);
  const [dashboardDialogDragOffset, setDashboardDialogDragOffset] = useState(0);
  const [renameDialogStyle, setRenameDialogStyle] = useState<CSSProperties | undefined>();
  const [libraryLectures, setLibraryLectures] = useState(lectures);
  const [useDashboardSwipeActions, setUseDashboardSwipeActions] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia("(max-width: 767px)").matches,
  );
  const [busyLectureId, setBusyLectureId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderLectureIds, setSelectedFolderLectureIds] = useState<string[] | null>(null);
  const [openMenuLectureId, setOpenMenuLectureId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AppLectureListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameKeyboardVisible, setRenameKeyboardVisible] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AppLectureListItem | null>(null);
  const [dashboardActionError, setDashboardActionError] = useState<string | null>(null);
  const deferredQuery = useDeferredValue(query);
  const selectedFolderLectureIdSet = useMemo(
    () => (selectedFolderLectureIds ? new Set(selectedFolderLectureIds) : null),
    [selectedFolderLectureIds],
  );

  const searchModal = (() => {
    const mode = searchParams.get("mode");
    return mode === "record" || mode === "link" || mode === "text" || mode === "upload"
      ? mode
      : null;
  })();

  const activeModal = manualModal ?? searchModal;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const syncSwipeMode = () => setUseDashboardSwipeActions(mediaQuery.matches);

    syncSwipeMode();
    mediaQuery.addEventListener("change", syncSwipeMode);
    return () => mediaQuery.removeEventListener("change", syncSwipeMode);
  }, []);

  useEffect(() => {
    setLibraryLectures(lectures);
  }, [lectures]);

  useEffect(() => {
    if (!libraryLectures.some((lecture) => shouldPollLectureStatus(lecture.status))) {
      return;
    }

    let cancelled = false;

    const refresh = () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }

      startTransition(() => router.refresh());
    };

    const intervalId = window.setInterval(refresh, POLL_INTERVAL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [libraryLectures, router]);

  useEffect(() => {
    if (!openMenuLectureId) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      const isInsideOpenSwipeRow =
        target instanceof Element &&
        Boolean(target.closest(".dashboard-note-swipe-row.menu-open"));

      if (isInsideOpenSwipeRow) {
        return;
      }

      if (!menuRef.current?.contains(target as Node)) {
        setOpenMenuLectureId(null);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [openMenuLectureId]);

  function closeModal() {
    setManualModal(null);
    if (searchModal) {
      router.replace("/app", { scroll: false });
    }
  }

  const closeMobileCreateMenu = useCallback(() => {
    if (mobileCreateMenuCloseTimerRef.current !== null) {
      window.clearTimeout(mobileCreateMenuCloseTimerRef.current);
      mobileCreateMenuCloseTimerRef.current = null;
    }
    mobileCreateMenuDragStartYRef.current = null;
    mobileCreateMenuDragOffsetRef.current = 0;
    setMobileCreateMenuDragOffset(0);
    setIsMobileCreateMenuOpen(false);
  }, []);

  const animateCloseMobileCreateMenu = useCallback(() => {
    if (mobileCreateMenuCloseTimerRef.current !== null) {
      return;
    }

    mobileCreateMenuDragStartYRef.current = null;
    mobileCreateMenuDragOffsetRef.current = window.innerHeight;
    setMobileCreateMenuDragOffset(window.innerHeight);
    mobileCreateMenuCloseTimerRef.current = window.setTimeout(() => {
      mobileCreateMenuCloseTimerRef.current = null;
      closeMobileCreateMenu();
    }, 180);
  }, [closeMobileCreateMenu]);

  const closeDashboardDialog = useCallback(() => {
    if (dashboardDialogCloseTimerRef.current !== null) {
      window.clearTimeout(dashboardDialogCloseTimerRef.current);
      dashboardDialogCloseTimerRef.current = null;
    }

    dashboardDialogDragStartYRef.current = null;
    dashboardDialogDragOffsetRef.current = 0;
    dashboardDialogSuppressClickRef.current = false;
    setDashboardDialogDragOffset(0);
    setDashboardActionError(null);
    setRenameTarget(null);
    setRenameValue("");
    setRenameKeyboardVisible(false);
    setRenameDialogStyle(undefined);
    setDeleteTarget(null);
  }, []);

  const animateCloseDashboardDialog = useCallback(() => {
    if (busyLectureId || dashboardDialogCloseTimerRef.current !== null) {
      return;
    }

    dashboardDialogDragStartYRef.current = null;
    dashboardDialogDragOffsetRef.current = window.innerHeight;
    setDashboardDialogDragOffset(window.innerHeight);
    dashboardDialogCloseTimerRef.current = window.setTimeout(() => {
      dashboardDialogCloseTimerRef.current = null;
      closeDashboardDialog();
    }, 180);
  }, [busyLectureId, closeDashboardDialog]);

  useEffect(() => {
    if (!renameTarget && !deleteTarget) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        animateCloseDashboardDialog();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [animateCloseDashboardDialog, deleteTarget, renameTarget]);

  useLayoutEffect(() => {
    if (!renameTarget) {
      return;
    }

    const scrollY = window.scrollY;
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousRootOverscrollBehavior = root.style.overscrollBehavior;
    const previousRootScrollBehavior = root.style.scrollBehavior;
    const previousRootTouchAction = root.style.touchAction;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const previousBodyHeight = document.body.style.height;
    const previousBodyOverscrollBehavior = document.body.style.overscrollBehavior;
    const previousBodyTouchAction = document.body.style.touchAction;
    const renameInput = renameInputRef.current;

    root.style.overflow = "hidden";
    root.style.overscrollBehavior = "none";
    root.style.scrollBehavior = "auto";
    root.style.touchAction = "none";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    document.body.style.height = "100%";
    document.body.style.overscrollBehavior = "none";
    document.body.style.touchAction = "none";

    const restoreScrollPosition = () => {
      window.scrollTo({ left: 0, top: scrollY, behavior: "auto" });
    };

    const scheduleScrollRestore = () => {
      window.requestAnimationFrame(restoreScrollPosition);
      window.setTimeout(restoreScrollPosition, 0);
    };

    const updateViewportMetrics = () => {
      const viewport = window.visualViewport;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const viewportOffsetTop = viewport?.offsetTop ?? 0;
      const keyboardInset = Math.max(
        0,
        window.innerHeight - viewportHeight - viewportOffsetTop,
      );
      setRenameKeyboardVisible(keyboardInset > RENAME_KEYBOARD_VISIBLE_INSET_PX);

      const roundedKeyboardInset = Math.round(keyboardInset);
      const roundedViewportHeight = Math.round(viewportHeight);
      const roundedViewportOffsetTop = Math.round(viewportOffsetTop);
      const viewportMetricsKey = [
        roundedKeyboardInset,
        roundedViewportHeight,
        roundedViewportOffsetTop,
      ].join(":");

      if (renameViewportMetricsKeyRef.current !== viewportMetricsKey) {
        renameViewportMetricsKeyRef.current = viewportMetricsKey;
        setRenameDialogStyle({
          "--dashboard-note-dialog-keyboard-inset": `${roundedKeyboardInset}px`,
          "--dashboard-note-dialog-visual-height": `${roundedViewportHeight}px`,
          "--dashboard-note-dialog-visual-offset-top": `${roundedViewportOffsetTop}px`,
        } as CSSProperties);
      }
      scheduleScrollRestore();
    };

    const focusRenameInput = () => {
      if (renameInput && document.activeElement !== renameInput) {
        renameInput.focus({ preventScroll: true });
      }

      scheduleScrollRestore();
    };

    function preventPageScroll(event: TouchEvent | WheelEvent) {
      event.preventDefault();
      scheduleScrollRestore();
    }

    function handleScroll() {
      scheduleScrollRestore();
    }

    function handleFocusIn() {
      updateViewportMetrics();
      scheduleScrollRestore();
    }

    document.addEventListener("touchmove", preventPageScroll, {
      capture: true,
      passive: false,
    });
    document.addEventListener("wheel", preventPageScroll, {
      capture: true,
      passive: false,
    });
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", updateViewportMetrics, { passive: true });
    window.visualViewport?.addEventListener("scroll", updateViewportMetrics, { passive: true });
    window.visualViewport?.addEventListener("resize", updateViewportMetrics, { passive: true });
    renameInput?.addEventListener("focus", handleFocusIn);
    const viewportPollId = window.setInterval(updateViewportMetrics, 120);
    updateViewportMetrics();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(focusRenameInput);
    });
    scheduleScrollRestore();

    return () => {
      document.removeEventListener("touchmove", preventPageScroll, true);
      document.removeEventListener("wheel", preventPageScroll, true);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", updateViewportMetrics);
      window.visualViewport?.removeEventListener("scroll", updateViewportMetrics);
      window.visualViewport?.removeEventListener("resize", updateViewportMetrics);
      renameInput?.removeEventListener("focus", handleFocusIn);
      window.clearInterval(viewportPollId);
      renameViewportMetricsKeyRef.current = "";
      setRenameDialogStyle(undefined);
      root.style.overflow = previousRootOverflow;
      root.style.overscrollBehavior = previousRootOverscrollBehavior;
      root.style.scrollBehavior = previousRootScrollBehavior;
      root.style.touchAction = previousRootTouchAction;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      document.body.style.height = previousBodyHeight;
      document.body.style.overscrollBehavior = previousBodyOverscrollBehavior;
      document.body.style.touchAction = previousBodyTouchAction;
      window.scrollTo(0, scrollY);
    };
  }, [renameTarget]);

  useEffect(
    () => () => {
      if (dashboardDialogCloseTimerRef.current !== null) {
        window.clearTimeout(dashboardDialogCloseTimerRef.current);
        dashboardDialogCloseTimerRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (!isMobileCreateMenuOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        animateCloseMobileCreateMenu();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [animateCloseMobileCreateMenu, isMobileCreateMenuOpen]);

  function handleMobileCreateMenuPointerDown(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    const target = event.target;
    const interactiveTarget =
      target instanceof Element
        ? target.closest("button, a, input, textarea, select, .app-close-button")
        : null;
    const dragHandleTarget =
      target instanceof Element ? target.closest(".mobile-create-menu-drag-handle") : null;

    mobileCreateMenuSuppressClickRef.current = false;
    mobileCreateMenuDragStartYRef.current = null;

    if (interactiveTarget && !dragHandleTarget) {
      return;
    }

    mobileCreateMenuDragStartYRef.current = event.clientY;
    if (!interactiveTarget || dragHandleTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateMobileCreateMenuDragOffset(clientY: number) {
    if (mobileCreateMenuDragStartYRef.current === null) {
      return;
    }

    const nextOffset = Math.max(0, clientY - mobileCreateMenuDragStartYRef.current);
    mobileCreateMenuDragOffsetRef.current = nextOffset;
    if (nextOffset > 8) {
      mobileCreateMenuSuppressClickRef.current = true;
    }
    setMobileCreateMenuDragOffset(nextOffset);
  }

  function handleMobileCreateMenuClickCapture(
    event: ReactMouseEvent<HTMLElement>,
  ) {
    if (!mobileCreateMenuSuppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    mobileCreateMenuSuppressClickRef.current = false;
  }

  useEffect(() => {
    if (!isMobileCreateMenuOpen) {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      updateMobileCreateMenuDragOffset(event.clientY);
    }

    function handleWindowPointerEnd() {
      if (mobileCreateMenuDragOffsetRef.current > 80) {
        animateCloseMobileCreateMenu();
        return;
      }

      mobileCreateMenuDragStartYRef.current = null;
      mobileCreateMenuDragOffsetRef.current = 0;
      setMobileCreateMenuDragOffset(0);
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [animateCloseMobileCreateMenu, isMobileCreateMenuOpen]);

  function openQuickAction(mode: NoteSourceMode) {
    if (!canCreateNotes) {
      router.push("/app/start");
      return;
    }

    setManualModal(mode);
  }

  function openRenameModal(lecture: AppLectureListItem) {
    flushSync(() => {
      setOpenMenuLectureId(null);
      setDashboardActionError(null);
      setRenameTarget(lecture);
      setRenameValue(lecture.title?.trim() || "Neimenovan zapisek");
    });
    renameInputRef.current?.focus({ preventScroll: true });
  }

  function closeRenameModal() {
    if (busyLectureId === renameTarget?.id) {
      return;
    }

    animateCloseDashboardDialog();
  }

  function openDeleteModal(lecture: AppLectureListItem) {
    setOpenMenuLectureId(null);
    setDashboardActionError(null);
    setDeleteTarget(lecture);
  }

  function closeDeleteModal() {
    if (busyLectureId === deleteTarget?.id) {
      return;
    }

    animateCloseDashboardDialog();
  }

  function handleDashboardDialogDragHandlePointerDown(
    event: ReactPointerEvent<HTMLElement>,
  ) {
    if (busyLectureId || (event.pointerType === "mouse" && event.button !== 0)) {
      return;
    }

    const target = event.target;
    const interactiveTarget =
      target instanceof Element
        ? target.closest("button, a, input, textarea, select, .app-close-button")
        : null;
    const dragHandleTarget =
      target instanceof Element ? target.closest(".mobile-create-menu-drag-handle") : null;

    dashboardDialogSuppressClickRef.current = false;
    dashboardDialogDragStartYRef.current = null;

    if (interactiveTarget && !dragHandleTarget) {
      return;
    }

    dashboardDialogDragStartYRef.current = event.clientY;
    if (!interactiveTarget || dragHandleTarget) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }

  function updateDashboardDialogDragOffset(clientY: number) {
    if (dashboardDialogDragStartYRef.current === null) {
      return;
    }

    const nextOffset = Math.max(0, clientY - dashboardDialogDragStartYRef.current);
    dashboardDialogDragOffsetRef.current = nextOffset;
    if (nextOffset > 8) {
      dashboardDialogSuppressClickRef.current = true;
    }
    setDashboardDialogDragOffset(nextOffset);
  }

  function handleDashboardDialogClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!dashboardDialogSuppressClickRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    dashboardDialogSuppressClickRef.current = false;
  }

  function handleRenameDialogPointerDownCapture(event: ReactPointerEvent<HTMLElement>) {
    const target = event.target;

    if (!(target instanceof Element)) {
      return;
    }

    const inputTarget = target.closest(".dashboard-note-dialog-field");
    if (inputTarget && target !== renameInputRef.current) {
      renameInputRef.current?.focus({ preventScroll: true });
      return;
    }

    if (target.closest("button, a, input, textarea, select, .mobile-sheet-drag-handle")) {
      return;
    }

    renameInputRef.current?.blur();
  }

  useEffect(() => {
    if (!renameTarget && !deleteTarget) {
      return;
    }

    function handleWindowPointerMove(event: PointerEvent) {
      updateDashboardDialogDragOffset(event.clientY);
    }

    function handleWindowPointerEnd() {
      if (dashboardDialogDragOffsetRef.current > 80 && !busyLectureId) {
        animateCloseDashboardDialog();
        return;
      }

      dashboardDialogDragStartYRef.current = null;
      dashboardDialogDragOffsetRef.current = 0;
      setDashboardDialogDragOffset(0);
    }

    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", handleWindowPointerEnd);
    window.addEventListener("pointercancel", handleWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerEnd);
      window.removeEventListener("pointercancel", handleWindowPointerEnd);
    };
  }, [animateCloseDashboardDialog, busyLectureId, deleteTarget, renameTarget]);

  async function handleDeleteLecture() {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;

    try {
      setDashboardActionError(null);
      setBusyLectureId(target.id);
      const response = await fetchDashboardMutation(`/api/lectures/${target.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Zapiska ni bilo mogoče izbrisati.");
      }

      setLibraryLectures((current) => current.filter((lecture) => lecture.id !== target.id));
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } catch (error) {
      setDashboardActionError(
        error instanceof Error ? error.message : "Zapiska ni bilo mogoče izbrisati.",
      );
    } finally {
      setBusyLectureId(null);
    }
  }

  async function handleRetryLecture(id: string) {
    try {
      setDashboardActionError(null);
      setBusyLectureId(id);
      const response = await fetchDashboardMutation(`/api/lectures/${id}/retry`, {
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Ponovni poskus ni uspel.");
      }

      startTransition(() => router.refresh());
    } catch (error) {
      setDashboardActionError(
        error instanceof Error ? error.message : "Ponovni poskus ni uspel.",
      );
    } finally {
      setBusyLectureId(null);
    }
  }

  async function handleRenameLecture() {
    if (!renameTarget) {
      return;
    }

    const currentTitle = renameTarget.title?.trim() || "Neimenovan zapisek";
    const nextTitle = renameValue.trim();

    if (!nextTitle || nextTitle === currentTitle) {
      closeRenameModal();
      return;
    }

    const target = renameTarget;
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    try {
      setDashboardActionError(null);
      setBusyLectureId(target.id);
      const response = await fetchDashboardMutation(`/api/lectures/${target.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title: nextTitle }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Naslova ni bilo mogoče shraniti.");
      }

      setLibraryLectures((current) =>
        current.map((item) =>
          item.id === target.id
            ? {
                ...item,
                title: nextTitle,
              }
            : item,
        ),
      );
      setRenameTarget(null);
      setRenameValue("");
      startTransition(() => router.refresh());
    } catch (error) {
      setDashboardActionError(
        error instanceof Error ? error.message : "Naslova ni bilo mogoče shraniti.",
      );
    } finally {
      setBusyLectureId(null);
    }
  }

  const visibleLectures = selectedFolderLectureIdSet
    ? libraryLectures.filter((lecture) => selectedFolderLectureIdSet.has(lecture.id))
    : libraryLectures;
  const search = deferredQuery.trim().toLowerCase();
  const filteredLectures = visibleLectures.filter((lecture) => {
    if (!search) {
      return true;
    }

    return (
      lecture.title?.toLowerCase().includes(search) ||
      lecture.error_message?.toLowerCase().includes(search) ||
      sourceLabel(getEffectiveLectureSourceType(lecture)).toLowerCase().includes(search)
    );
  });

  const failedLectures = filteredLectures.filter((lecture) => lecture.status === "failed");
  const regularLectures = filteredLectures.filter((lecture) => lecture.status !== "failed");
  const attachMenuRef = (node: HTMLDivElement | null) => {
    menuRef.current = node;
  };
  const toggleLectureMenu = (lectureId: string) => {
    setOpenMenuLectureId((current) => (current === lectureId ? null : lectureId));
  };

  return (
    <>
      <div className="home-dashboard pb-8">
        {!hasPaidAccess ? (
          <section className="dashboard-section">
            <div style={{ padding: "0.1rem 0" }}>
              <p className="ios-row-subtitle">
                {hasTrialLectureAvailable
                  ? "Na voljo imaš en brezplačen preizkus. Vključuje zapiske, flashcardse, kviz, test in chat."
                  : trialLectureId
                    ? `Tvoj poskusni zapisek ostane v knjižnici. Preostalih brezplačnih sporočil v klepetu: ${trialChatMessagesRemaining}.`
                    : "Nadgradi za ustvarjanje novega gradiva."}
              </p>
              {!canCreateNotes ? (
                <button
                  type="button"
                  className="app-home-highlight-link"
                  onClick={() => router.push("/app/start")}
                >
                  <span>Nadgradi za nov zapisek</span>
                  <EmojiIcon symbol="›" size="1.1rem" />
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="dashboard-section dashboard-create-section">
          <div className="dashboard-section-heading">
            <h2 className="dashboard-section-title">Nov zapisek</h2>
          </div>

          <div className="note-action-grid">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.id}
                type="button"
                onClick={() => openQuickAction(action.id)}
                className="note-action-card"
              >
                <span
                  className={`note-action-card-icon ${
                    action.accent === "record" ? "record" : ""
                  }`}
                >
                  <EmojiIcon symbol={action.icon} size="1.2rem" />
                </span>
                <span className="note-action-card-copy">
                  <span className="note-action-card-label">{action.label}</span>
                  <span className="note-action-card-detail">{action.detail}</span>
                </span>
                <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
              </button>
            ))}
          </div>
        </section>

        <section className="dashboard-section dashboard-library-section mt-4">
          <div className="dashboard-section-heading mb-4">
            <h2 className="dashboard-section-title">Moji zapiski</h2>
          </div>

          <div className="dashboard-toolbar library-toolbar">
            <LibraryFolderMenu
              lectures={libraryLectures}
              userId={userId}
              initialFolders={folders}
              selectedFolderId={selectedFolderId}
              onSelectFolder={(folderId, lectureIds) => {
                setSelectedFolderId(folderId);
                setSelectedFolderLectureIds(lectureIds);
              }}
            />

            <div className="ios-search notes-search">
              <EmojiIcon symbol="🔎" size="0.95rem" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Išči po naslovu"
              />
            </div>
          </div>

          {failedLectures.length > 0 ? (
            <div className="dashboard-subsection">
              <div className="dashboard-subsection-heading">
                <h3 className="dashboard-subsection-title">Potrebno pozornosti</h3>
              </div>

              {failedLectures.map((lecture) => (
                <div key={lecture.id} className="dashboard-alert-card">
                  <div className="ios-row-icon" style={{ backgroundColor: "var(--red-soft)", color: "var(--red)", width: "2rem", height: "2rem" }}>
                    <EmojiIcon symbol="⚠️" size="1rem" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="ios-row-title text-[var(--red)] font-medium">
                      {lecture.error_message ? "Napaka pri obdelavi zapiska" : "Napaka pri ustvarjanju zapiska"}
                    </p>
                    <p className="ios-row-subtitle mt-1" style={{ fontSize: "0.8rem", color: "var(--label)" }}>
                      {lecture.error_message ?? "Poskusi znova ali odstrani zapisek iz knjižnice."}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={busyLectureId === lecture.id}
                      onClick={() => openDeleteModal(lecture)}
                      className="ios-text-button"
                      style={{ color: "var(--red)", backgroundColor: "var(--red-soft)", padding: "0.3rem 1rem", borderRadius: "10px", fontSize: "0.85rem", fontWeight: 600 }}
                    >
                      {busyLectureId === lecture.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Izbriši
                    </button>
                    {lecture.status === "failed" ? (
                      <button
                        type="button"
                        disabled={busyLectureId === lecture.id}
                        onClick={() => void handleRetryLecture(lecture.id)}
                        className="ios-text-button"
                        style={{ color: "var(--label)", backgroundColor: "var(--surface-muted)", padding: "0.3rem 1rem", borderRadius: "10px", fontSize: "0.85rem", fontWeight: 600 }}
                      >
                        {busyLectureId === lecture.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : null}
                        Poskusi znova
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {regularLectures.length > 0 ? (
            <div className="dashboard-note-list">
              {regularLectures.map((lecture) => (
                <NoteRow
                  key={lecture.id}
                  lecture={lecture}
                  isMenuOpen={openMenuLectureId === lecture.id}
                  isBusy={busyLectureId === lecture.id}
                  useSwipeActions={useDashboardSwipeActions}
                  onToggleMenu={toggleLectureMenu}
                  onOpenRename={openRenameModal}
                  onOpenDelete={openDeleteModal}
                  attachMenuRef={attachMenuRef}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state app-empty-state">
              <div className="app-empty-state-icon">
                <EmojiIcon symbol="📝" size="1.25rem" />
              </div>
              <p className="ios-row-title">
                {search
                  ? "Ni ujemajočih zapiskov"
                  : selectedFolderId
                    ? "Ta mapa je prazna"
                    : "Tvoja knjižnica je prazna"}
              </p>
              <p className="ios-row-subtitle mt-2">
                {search
                  ? "Poskusi krajši iskalni izraz ali počisti iskanje."
                  : selectedFolderId
                    ? "Dodaj predavanja v to mapo ali se vrni na vse zapiske."
                    : "Začni s posnetkom, zvočno datoteko, PDF-jem, PPTX-om, besedilom ali povezavo."}
              </p>
              {!search && !selectedFolderId ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!canCreateNotes) {
                      router.push("/app/start");
                      return;
                    }

                    setManualModal("record");
                  }}
                  className="app-home-highlight-link"
                >
                  <span>Ustvari svoj prvi zapisek</span>
                  <EmojiIcon symbol="›" size="1.1rem" />
                </button>
              ) : null}
            </div>
          )}
        </section>

      </div>

      <ViewportPortal>
        <button
          type="button"
          className="mobile-new-note-pill"
          onClick={() => {
            window.dispatchEvent(new Event("memoai:mobile-dock-close"));
            setIsMobileCreateMenuOpen(true);
          }}
          aria-haspopup="dialog"
          aria-expanded={isMobileCreateMenuOpen}
        >
          <EmojiIcon symbol="➕" size="1rem" className="mobile-new-note-pill-icon" />
          <span className="mobile-new-note-pill-label">Nov zapisek</span>
        </button>
      </ViewportPortal>

      {isMobileCreateMenuOpen ? (
        <ViewportPortal>
          <>
            <button
              type="button"
              className="mobile-create-menu-backdrop"
              onClick={animateCloseMobileCreateMenu}
              aria-label="Zapri meni za nov zapisek"
            />
            <section
              className="mobile-create-menu"
              role="dialog"
              aria-modal="true"
              aria-labelledby="mobile-create-menu-title"
              onPointerDown={handleMobileCreateMenuPointerDown}
              onClickCapture={handleMobileCreateMenuClickCapture}
              style={
                mobileCreateMenuDragOffset > 0
                  ? { transform: `translateY(${mobileCreateMenuDragOffset}px)` }
                  : undefined
              }
            >
              <button
                type="button"
                className="mobile-sheet-drag-handle mobile-create-menu-drag-handle"
                aria-label="Povleci navzdol za zapiranje"
              />
              <div className="mobile-create-menu-header">
                <h2 id="mobile-create-menu-title" className="dashboard-section-title">
                  Nov zapisek
                </h2>
                <button
                  type="button"
                  className="app-close-button"
                  onClick={animateCloseMobileCreateMenu}
                  aria-label="Zapri meni za nov zapisek"
                >
                  <EmojiIcon symbol="✖️" size="1rem" />
                </button>
              </div>

              <div className="note-action-grid mobile-create-action-grid">
                {QUICK_ACTIONS.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => openQuickAction(action.id)}
                    className="note-action-card"
                  >
                    <span
                      className={`note-action-card-icon ${
                        action.accent === "record" ? "record" : ""
                      }`}
                    >
                      <EmojiIcon symbol={action.icon} size="1.2rem" />
                    </span>
                    <span className="note-action-card-copy">
                      <span className="note-action-card-label">{action.label}</span>
                      <span className="note-action-card-detail">{action.detail}</span>
                    </span>
                    <EmojiIcon className="note-action-card-chevron" symbol="›" size="1.1rem" />
                  </button>
                ))}
              </div>
            </section>
          </>
        </ViewportPortal>
      ) : null}

      <NoteSourceModal
        mode={activeModal}
        open={Boolean(activeModal)}
        onClose={closeModal}
        canCreateNotes={canCreateNotes}
      />

      {renameTarget ? (
        <ViewportPortal>
          <>
            <button
              type="button"
              className="mobile-create-menu-backdrop dashboard-note-dialog-backdrop"
              onClick={closeRenameModal}
              aria-label="Zapri okno za preimenovanje zapiska"
            />
            <section
              className={`mobile-create-menu dashboard-note-dialog dashboard-note-dialog-rename mobile-draggable-sheet keyboard-open ${
                renameKeyboardVisible ? "keyboard-visible" : "keyboard-hidden"
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="rename-note-title"
              onPointerDownCapture={handleRenameDialogPointerDownCapture}
              onPointerDown={handleDashboardDialogDragHandlePointerDown}
              onClickCapture={handleDashboardDialogClickCapture}
              style={{
                ...renameDialogStyle,
                ...(dashboardDialogDragOffset > 0
                  ? { transform: `translateY(${dashboardDialogDragOffset}px)` }
                  : null),
              }}
            >
              <button
                type="button"
                className="mobile-sheet-drag-handle mobile-create-menu-drag-handle dashboard-note-dialog-drag-handle"
                aria-label="Povleci navzdol za zapiranje"
                disabled={busyLectureId === renameTarget.id}
              />
              <div className="mobile-create-menu-header dashboard-note-dialog-header">
                <h2 id="rename-note-title" className="dashboard-section-title">
                  Preimenuj zapisek
                </h2>
                <button
                  type="button"
                  className="app-close-button"
                  onClick={closeRenameModal}
                  aria-label="Zapri okno za preimenovanje zapiska"
                  disabled={busyLectureId === renameTarget.id}
                >
                  <EmojiIcon symbol="✖️" size="1rem" />
                </button>
              </div>

              <form
                className="dashboard-note-dialog-body"
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleRenameLecture();
                }}
              >
                <p className="ios-subtitle dashboard-note-dialog-copy">
                  Daj temu zapisku bolj jasen naslov, ne da zapustiš stran.
                </p>
                {dashboardActionError ? (
                  <p className="ios-info ios-danger dashboard-note-dialog-copy">
                    {dashboardActionError}
                  </p>
                ) : null}

                <label className="dashboard-note-dialog-field">
                  <span>Naslov</span>
                  <input
                    ref={renameInputRef}
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onPointerDown={(event) => {
                      if (document.activeElement === event.currentTarget && !renameKeyboardVisible) {
                        event.currentTarget.blur();
                      }

                      event.currentTarget.focus({ preventScroll: true });
                    }}
                    onClick={(event) => {
                      event.currentTarget.focus({ preventScroll: true });
                    }}
                    className="ios-input"
                    placeholder="Neimenovan zapisek"
                  />
                </label>

                <div className="dashboard-note-dialog-actions">
                  <button
                    type="submit"
                    className="ios-primary-button"
                    disabled={
                      busyLectureId === renameTarget.id ||
                      !renameValue.trim() ||
                      renameValue.trim() === (renameTarget.title?.trim() || "Neimenovan zapisek")
                    }
                  >
                    {busyLectureId === renameTarget.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Shrani naslov
                  </button>
                  <button
                    type="button"
                    className="ios-secondary-button"
                    onClick={closeRenameModal}
                    disabled={busyLectureId === renameTarget.id}
                  >
                    Prekliči
                  </button>
                </div>
              </form>
            </section>
          </>
        </ViewportPortal>
      ) : null}

      {deleteTarget ? (
        <ViewportPortal>
          <>
            <button
              type="button"
              className="mobile-create-menu-backdrop dashboard-note-dialog-backdrop"
              onClick={closeDeleteModal}
              aria-label="Zapri okno za brisanje zapiska"
            />
            <section
              className="mobile-create-menu dashboard-note-dialog mobile-draggable-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-note-title"
              onPointerDown={handleDashboardDialogDragHandlePointerDown}
              onClickCapture={handleDashboardDialogClickCapture}
              style={
                dashboardDialogDragOffset > 0
                  ? { transform: `translateY(${dashboardDialogDragOffset}px)` }
                  : undefined
              }
            >
              <button
                type="button"
                className="mobile-sheet-drag-handle mobile-create-menu-drag-handle dashboard-note-dialog-drag-handle"
                aria-label="Povleci navzdol za zapiranje"
                disabled={busyLectureId === deleteTarget.id}
              />
              <div className="mobile-create-menu-header dashboard-note-dialog-header">
                <h2 id="delete-note-title" className="dashboard-section-title">
                  Izbriši zapisek
                </h2>
                <button
                  type="button"
                  className="app-close-button"
                  onClick={closeDeleteModal}
                  aria-label="Zapri okno za brisanje zapiska"
                  disabled={busyLectureId === deleteTarget.id}
                >
                  <EmojiIcon symbol="✖️" size="1rem" />
                </button>
              </div>

              <div className="dashboard-note-dialog-body">
                <p className="ios-subtitle dashboard-note-dialog-copy">
                  Izbriši{" "}
                  <span className="dashboard-note-dialog-highlight">
                    {deleteTarget.title?.trim() || "Neimenovan zapisek"}
                  </span>
                  ? Tega ni mogoče razveljaviti.
                </p>
                {dashboardActionError ? (
                  <p className="ios-info ios-danger dashboard-note-dialog-copy">
                    {dashboardActionError}
                  </p>
                ) : null}

                <div className="dashboard-note-dialog-actions">
                  <button
                    type="button"
                    className="dashboard-note-dialog-danger"
                    onClick={() => void handleDeleteLecture()}
                    disabled={busyLectureId === deleteTarget.id}
                  >
                    {busyLectureId === deleteTarget.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    Izbriši zapisek
                  </button>
                  <button
                    type="button"
                    className="ios-secondary-button"
                    onClick={closeDeleteModal}
                    disabled={busyLectureId === deleteTarget.id}
                  >
                    Prekliči
                  </button>
                </div>
              </div>
            </section>
          </>
        </ViewportPortal>
      ) : null}
    </>
  );
}
