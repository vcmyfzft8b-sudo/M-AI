"use client";

import Image from "next/image";
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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { flushSync } from "react-dom";

import { useAppHref, useIsCreatorDemo } from "@/components/creator-demo/creator-demo-context";
import { DiscountOffer } from "@/components/discount-offer";
import { LibraryChat } from "@/components/library-chat";
import { NoteSourceModal, type NoteSourceMode } from "@/components/note-source-modal";
import { Emoji, Msym } from "@/components/msym";
import { InstantLink } from "@/components/instant-link";
import { LibraryFolderMenu } from "@/components/library-folder-menu";
import {
  shouldHandleLinkNavigation,
  useInstantNavigation,
} from "@/components/navigation-loading";
import { MemoPortal } from "@/components/memo-portal";
import { useCollapsingHeader } from "@/components/use-collapsing-header";
import { sheetClass, useSheet } from "@/components/use-sheet";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";
import { POLL_INTERVAL_MS } from "@/lib/constants";
import { canRetryLectureFailure } from "@/lib/lecture-failure-codes";
import {
  getEffectiveLectureSourceType,
  getLectureSourceDetail,
  getLectureSourceLabel,
} from "@/lib/lecture-source-metadata";
import { noteEmoji } from "@/lib/note-emoji";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";
import type { AppLectureListItem, AppLibraryFolder } from "@/lib/types";
import { formatCalendarDate } from "@/lib/utils";

/** Desktop home: four capture entry points, in the redesign's order. */
const QUICK_ACTIONS = [
  {
    id: "record" as const,
    label: "Posnemi predavanje",
    icon: "radio_button_checked",
    accent: "record",
    filled: true,
  },
  {
    id: "link" as const,
    label: "Dodaj povezavo",
    icon: "link",
    accent: "",
    filled: true,
  },
  {
    id: "text" as const,
    label: "Naloži PDF ali besedilo",
    icon: "text_fields",
    accent: "",
    filled: true,
  },
  {
    id: "upload" as const,
    label: "Naloži zvok",
    icon: "cloud_upload",
    accent: "",
    filled: true,
  },
] as const;

/** Phone home: the same entry points, as the "Nov zapisek" sheet lists them. */
const CREATE_OPTIONS = [
  { id: "record" as const, emoji: "🎙️", label: "Posnemi zvok" },
  { id: "upload" as const, emoji: "🔊", label: "Naloži zvok" },
  { id: "text" as const, emoji: "📚", label: "PDF, datoteka ali besedilo" },
  { id: "link" as const, emoji: "🔗", label: "Spletna povezava" },
] as const;

const DASHBOARD_MUTATION_TIMEOUT_MS = 18_000;
const DASHBOARD_NOTE_ACTION_REVEAL_PX = 144;

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

/** "Zvok, 1 h 12 min" where the design has a detail to print, "Zvok" where not. */
function sourceMeta(lecture: AppLectureListItem, sourceType: string) {
  const detail = getLectureSourceDetail(lecture);

  return detail
    ? `${getLectureSourceLabel(sourceType)}, ${detail}`
    : getLectureSourceLabel(sourceType);
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
  href: string;
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
  href,
  onToggleMenu,
  onOpenRename,
  onOpenDelete,
  attachMenuRef,
}: NoteRowProps) {
  const router = useRouter();
  const {
    navigateWithFeedback,
    overlay: navigationOverlay,
    isNavigating: isOpening,
  } = useInstantNavigation();
  const sourceType = getEffectiveLectureSourceType(lecture);
  const dragRef = useRef<DashboardNoteDragState | null>(null);
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  const [dragState, setDragState] = useState<DashboardNoteDragState | null>(null);
  const noteOffset = dragState?.offset ?? (isMenuOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0);
  const title = lecture.title?.trim() || "Neimenovan zapisek";
  const emoji = noteEmoji(lecture);
  const isProcessing = shouldPollLectureStatus(lecture.status);
  const isFailed = lecture.status === "failed";
  const meta = isProcessing
    ? "Ustvarjanje zapiskov…"
    : isFailed
      ? "Obdelava ni uspela"
      : `${formatCalendarDate(lecture.created_at)} • ${sourceMeta(lecture, sourceType)}`;

  useEffect(
    () => () => {
      cleanupDragListenersRef.current?.();
    },
    [],
  );

  function openLecture() {
    if (isOpening) {
      return;
    }

    navigateWithFeedback(href);
  }

  // Desktop: a plain row that opens the note. Actions live on the note screen.
  if (!useSwipeActions) {
    return (
      <>
        {navigationOverlay}
        <InstantLink
          href={href}
          className="memo-note-row"
          aria-busy={isOpening}
          onClick={(event) => {
            if (!shouldHandleLinkNavigation(event)) {
              return;
            }

            event.preventDefault();
            openLecture();
          }}
        >
          <span className="memo-note-emoji">
            <Emoji symbol={emoji} size="1.3rem" />
          </span>

          <span className="memo-note-copy">
            <span className="memo-note-title">{title}</span>
            <span className="memo-note-meta">{meta}</span>
          </span>

          {isProcessing ? <span className="memo-note-badge">Ustvarjanje</span> : null}
          {isFailed ? <span className="memo-note-badge failed">Napaka</span> : null}

          <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
        </InstantLink>
      </>
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
    if (shouldOpen !== isMenuOpen) {
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

    // Warm the note route on touch-down so the skeleton has real content to
    // swap in by the time the tap completes.
    if (!isMenuOpen) {
      safeRouterPrefetch(router, href);
    }

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

  function handleSurfaceClick(event: ReactMouseEvent<HTMLElement>) {
    if (suppressClickRef.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClickRef.current = false;
      return;
    }

    // A tap while the actions are revealed closes them instead of opening.
    if (isMenuOpen) {
      onToggleMenu(lecture.id);
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

  // Phone: the row slides left to reveal Uredi / Izbriši.
  return (
    <div className={`memo-swipe-row ${isMenuOpen ? "open" : ""}`.trim()}>
      {navigationOverlay}
      <div
        role="link"
        tabIndex={0}
        className={`memo-swipe-surface ${dragState ? "dragging" : ""}`.trim()}
        onPointerDown={handlePointerDown}
        onDragStart={(event) => event.preventDefault()}
        onClick={handleSurfaceClick}
        onKeyDown={handleSurfaceKeyDown}
        style={{ transform: `translateX(${noteOffset}px)` }}
      >
        <span className="memo-note-emoji">
          <Emoji symbol={emoji} size="1.35rem" />
        </span>

        <span className="memo-note-copy">
          <span className="memo-note-title">{title}</span>
          <span className="memo-note-meta">{meta}</span>
        </span>

        <button
          type="button"
          aria-label={`Dejanja za ${title}`}
          aria-expanded={isMenuOpen}
          className={`memo-note-chevron ${isMenuOpen ? "open" : ""}`.trim()}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            suppressClickRef.current = false;
            onToggleMenu(lecture.id);
          }}
        >
          <Msym name="chevron_right" size="1.25rem" fill={false} weight={500} />
        </button>
      </div>

      <div
        ref={isMenuOpen ? attachMenuRef : undefined}
        className={`memo-swipe-actions ${isMenuOpen || noteOffset < 0 ? "on" : ""}`.trim()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label={`Preimenuj ${title}`}
          disabled={isBusy}
          onClick={() => onOpenRename(lecture)}
          className="memo-swipe-action"
        >
          <span className="memo-swipe-action-circle">
            <Emoji symbol="✏️" size="1.1rem" />
          </span>
          <span>Uredi</span>
        </button>
        <button
          type="button"
          aria-label={`Izbriši ${title}`}
          disabled={isBusy}
          onClick={() => onOpenDelete(lecture)}
          className="memo-swipe-action danger"
        >
          <span className="memo-swipe-action-circle">
            {isBusy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Emoji symbol="🗑️" size="1.1rem" />
            )}
          </span>
          <span>Izbriši</span>
        </button>
      </div>
    </div>
  );
}, (previousProps, nextProps) => {
  return (
    previousProps.lecture === nextProps.lecture &&
    previousProps.href === nextProps.href &&
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
  trialLectureId,
  showDevDashboard,
}: {
  lectures: AppLectureListItem[];
  folders: AppLibraryFolder[];
  userId: string;
  canCreateNotes: boolean;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  showDevDashboard: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const homeHref = useAppHref("/app");
  // The upgrade screen exists on the demo too; `/app/start` would walk out of it.
  const startHref = useAppHref("/app/start");
  const isCreatorDemo = useIsCreatorDemo();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isLibraryChatOpen, setIsLibraryChatOpen] = useState(false);
  const [isWheelOpen, setIsWheelOpen] = useState(false);
  const [isOfferOpen, setIsOfferOpen] = useState(false);
  const [hasClaimedDiscount, setHasClaimedDiscount] = useState(false);
  /*
   * Whether the wheel has a spin left, as the server sees it. Null until the
   * answer arrives, which is why neither card is drawn before then — guessing
   * and correcting would flash one card into the other on every load.
   *
   * Asking the server matters: the spin is once a day and survives reloads and
   * devices, so a purely local flag showed the gift again to somebody who had
   * already used theirs.
   */
  const [canSpinWheel, setCanSpinWheel] = useState<boolean | null>(null);
  const [manualModal, setManualModal] = useState<NoteSourceMode | null>(null);
  const [isMobileCreateMenuOpen, setIsMobileCreateMenuOpen] = useState(false);
  const [libraryLectures, setLibraryLectures] = useState(lectures);
  const [useDashboardSwipeActions, setUseDashboardSwipeActions] = useState(false);
  const [busyLectureId, setBusyLectureId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderLectureIds, setSelectedFolderLectureIds] = useState<string[] | null>(null);
  const [openMenuLectureId, setOpenMenuLectureId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AppLectureListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<AppLectureListItem | null>(null);
  const [dashboardActionError, setDashboardActionError] = useState<string | null>(null);
  const [showLocalDevDashboard, setShowLocalDevDashboard] = useState(showDevDashboard);
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
    if (typeof window === "undefined") {
      return;
    }

    setShowLocalDevDashboard(
      !isCreatorDemo &&
        (window.location.hostname === "localhost" ||
          window.location.hostname === "127.0.0.1" ||
          window.location.hostname === "::1"),
    );
  }, [isCreatorDemo]);

  useEffect(() => {
    // The redesign switches to the phone layout at 1100px, and the swipe rows
    // are part of that layout.
    const mediaQuery = window.matchMedia("(max-width: 1099px)");
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
        Boolean(target.closest(".memo-swipe-row.open"));

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
      router.replace(homeHref, { scroll: false });
    }
  }

  const closeMobileCreateMenu = useCallback(() => {
    setIsMobileCreateMenuOpen(false);
  }, []);

  const closeDashboardDialog = useCallback(() => {
    setDashboardActionError(null);
    setRenameTarget(null);
    setRenameValue("");
    setDeleteTarget(null);
  }, []);

  /*
   * The design gives every phone sheet the same exit — it drops out of frame
   * under `.closing` rather than vanishing. On desktop these are centred
   * dialogs that the design closes on the spot, so the animated path is taken
   * only where the sheet skin is.
   */
  const createSheet = useSheet(closeMobileCreateMenu);
  const dialogSheet = useSheet(closeDashboardDialog, { locked: Boolean(busyLectureId) });

  const dismissCreateSheet = createSheet.dismiss;
  const dismissDialogSheet = dialogSheet.dismiss;

  // Wrapped rather than passed straight to `onClick`, which would hand the
  // click event to `dismiss` as its "run after closing" callback.
  const animateCloseMobileCreateMenu = useCallback(() => {
    dismissCreateSheet();
  }, [dismissCreateSheet]);

  const animateCloseDashboardDialog = useCallback(() => {
    dismissDialogSheet();
  }, [dismissDialogSheet]);

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
    if (!renameTarget || !useDashboardSwipeActions) {
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

    // The dialog itself rides `--memo-kb`, which `KeyboardInset` publishes.
    // All this has left to do is hold the page behind it still.
    const updateViewportMetrics = () => {
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
  }, [renameTarget, useDashboardSwipeActions]);

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

  function openQuickAction(mode: NoteSourceMode) {
    if (!canCreateNotes) {
      router.push(startHref);
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

    if (useDashboardSwipeActions) {
      animateCloseDashboardDialog();
    } else {
      closeDashboardDialog();
    }
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

    if (useDashboardSwipeActions) {
      animateCloseDashboardDialog();
    } else {
      closeDashboardDialog();
    }
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
      getLectureSourceLabel(getEffectiveLectureSourceType(lecture))
        .toLowerCase()
        .includes(search)
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
  // The wheel is a one-shot offer for people who have not subscribed. Whether
  // it was already spun lives on the server; `hasClaimedDiscount` only hides
  // the card for the rest of this session once it has been. As in the design it
  // sits above the full library only: a search or a folder is a narrowed view,
  // and the offer would be pushing itself in front of the answer.
  // Publishes `--memo-head-p` as the list scrolls; the collapse itself is CSS.
  const { attachScroll, attachScreen } = useCollapsingHeader();

  useEffect(() => {
    if (hasPaidAccess) {
      return;
    }

    let cancelled = false;

    void fetch("/api/discount-wheel")
      .then((response) => (response.ok ? response.json() : null))
      .then((state: { canSpin?: boolean } | null) => {
        if (!cancelled) {
          setCanSpinWheel(state?.canSpin ?? false);
        }
      })
      .catch(() => {
        // No wheel rather than a broken home screen.
        if (!cancelled) {
          setCanSpinWheel(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [hasPaidAccess]);

  const inLibraryView = !selectedFolderId && !deferredQuery.trim();
  /*
   * The wheel is on offer while the server says there is a spin left and this
   * session has not already used it. `hasClaimedDiscount` is what covers the
   * gap between spinning and the server catching up.
   */
  const wheelAvailable = canSpinWheel === true && !hasClaimedDiscount;
  const showDiscountPromo = !hasPaidAccess && wheelAvailable && inLibraryView;
  /*
   * ...and whenever it is not on offer, the slot keeps an ordinary way to buy.
   *
   * Stated as "the wheel is not available" rather than "the server says the
   * spin is spent", because those are not the same thing and the difference
   * left a hole: spinning hides the gift card immediately, while the server
   * only reports the spin gone on the next load — and in development it never
   * reports it at all. The slot showed nothing in between.
   *
   * Still waits for the first answer (`canSpinWheel !== null`), so the two
   * cards do not flash into each other on load.
   */
  const showUpgradePromo =
    !hasPaidAccess && canSpinWheel !== null && !wheelAvailable && inLibraryView;

  return (
    <>
      <div className="memo-home-screen" ref={attachScreen}>
        {/* Phone chrome: the lockup and the gear that opens Nastavitve. */}
        <div className="memo-m-topbar memo-only-mobile flex">
          <Image
            src={BRAND_LOCKUP_SRC}
            alt={SEO_BRAND_NAME}
            width={BRAND_LOCKUP_WIDTH}
            height={BRAND_LOCKUP_HEIGHT}
            priority
          />
          <InstantLink href="/app/settings" className="memo-m-round" aria-label="Nastavitve">
            <Msym name="settings" size="1.6rem" fill={false} weight={500} />
          </InstantLink>
        </div>

        <div className="memo-home-scroll" ref={attachScroll}>
          {showLocalDevDashboard ? (
            <button
              type="button"
              aria-label="Dev dashboard"
              data-testid="dev-dashboard-button"
              className="memo-utility-link memo-only-desktop"
              onClick={() => router.push("/dev/account-state")}
            >
              <span>Dev dashboard</span>
              <Msym name="chevron_right" size="1.1rem" fill={false} weight={400} />
            </button>
          ) : null}

          {/* The upgrade card below the search says this, and says it better:
              two prompts to buy stacked above the library read as nagging. */}

          <div className="memo-only-desktop">
            <h1 className="memo-home-h1">Nov zapisek</h1>
            <p className="memo-home-sub">
              Posnemi ali naloži zvok, prilepi besedilo ali povezavo
            </p>

            <div className="memo-quick-grid">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="memo-quick-card"
                  onClick={() => openQuickAction(action.id)}
                >
                  <span className={`memo-quick-tile ${action.accent}`.trim()}>
                    <Msym name={action.icon} size="1.45rem" fill={action.filled} />
                  </span>
                  <span className="memo-quick-label">{action.label}</span>
                </button>
              ))}
            </div>

            <h2 className="memo-home-h2">Moji zapiski</h2>
          </div>

          {/* The title and the search scroll away with the list; while they
              go, the title fades and the field folds. The folder pill below is
              opaque and sits above them, so they pass under it. */}
          <h1 className="memo-m-title memo-only-mobile">Moji zapiski</h1>

          <div className="memo-m-search memo-only-mobile flex">
            <Msym name="search" size="1.3rem" fill={false} weight={600} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Išči po zapiskih in prepisih"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label="Išči po zapiskih"
            />
          </div>

          {/* Desktop library bar: the folder chip slides out as search opens. */}
          <div className="memo-library-bar memo-only-desktop">
            <div className={`memo-folder-wrap ${isSearchOpen ? "hidden" : ""}`.trim()}>
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
            </div>

            <div
              className={`memo-search ${isSearchOpen ? "open" : ""}`.trim()}
              onClick={() => searchInputRef.current?.focus()}
            >
              <Msym name="search" size="1.3rem" fill={false} weight={600} />
              <input
                ref={searchInputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setIsSearchOpen(true)}
                onBlur={() => setIsSearchOpen(false)}
                placeholder="Išči po zapiskih"
                aria-label="Išči po zapiskih"
              />
            </div>
          </div>

          <div className="memo-m-folderbar memo-only-mobile">
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
          </div>

          <div className="memo-home-body">
            {showDiscountPromo ? (
              <button
                type="button"
                className="memo-promo memo-only-mobile flex"
                onClick={() => setIsWheelOpen(true)}
              >
                <span className="memo-promo-copy">
                  <span>Dobil si popust!</span>
                  <span>Odkleni najboljše funkcije ceneje</span>
                </span>
                <Emoji symbol="🎁" size="2rem" />
              </button>
            ) : showUpgradePromo ? (
              <button
                type="button"
                className="memo-promo upgrade memo-only-mobile flex"
                onClick={() => router.push(startHref)}
              >
                <span className="memo-promo-copy">
                  <span>Odkleni Premium</span>
                  <span>Neomejeni zapiski in učna orodja</span>
                </span>
                <Emoji symbol="⚡" size="2rem" />
              </button>
            ) : null}

            {dashboardActionError && !renameTarget && !deleteTarget ? (
              <p className="memo-inline-error">{dashboardActionError}</p>
            ) : null}

            {failedLectures.length > 0 ? (
              <div className="memo-note-list memo-failed-list">
                {failedLectures.map((lecture) => (
                  <div key={lecture.id} className="memo-failed-row">
                    <span className="memo-note-emoji failed">
                      <Msym name="warning" size="1.25rem" />
                    </span>
                    <span className="memo-note-copy">
                      <span className="memo-note-title">
                        {lecture.title ?? "Neimenovan zapisek"}
                      </span>
                      <span className="memo-note-meta">
                        {lecture.error_message ?? "Obdelava ni uspela."}
                      </span>
                    </span>
                    <span className="memo-failed-actions">
                      {canRetryLectureFailure(lecture) ? (
                        <button
                          type="button"
                          className="memo-button-outline small"
                          onClick={() => void handleRetryLecture(lecture.id)}
                          disabled={busyLectureId === lecture.id}
                        >
                          {busyLectureId === lecture.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : null}
                          Poskusi znova
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="memo-button-outline small danger"
                        onClick={() => openDeleteModal(lecture)}
                        disabled={busyLectureId === lecture.id}
                      >
                        Izbriši
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {regularLectures.length > 0 ? (
              <div className="memo-note-list">
                {regularLectures.map((lecture) => (
                  <NoteRow
                    key={lecture.id}
                    lecture={lecture}
                    // Without a subscription only the trial note opens; the rest
                    // route to checkout.
                    href={
                      hasPaidAccess || trialLectureId === lecture.id
                        ? `/app/lectures/${lecture.id}`
                        : startHref
                    }
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
            ) : null}

            {filteredLectures.length === 0 ? (
              <div className="memo-empty">
                <Emoji symbol="📝" size="2rem" />
                <p>{search ? "Ni ujemajočih zapiskov" : "Še ni zapiskov"}</p>
                <p>
                  {search
                    ? "Poskusi krajši iskalni izraz."
                    : "Posnemi predavanje ali naloži gradivo in Memo pripravi zapiske."}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Phone: chat and the create sheet. */}
        <div className="memo-m-homebar memo-only-mobile flex">
          <button
            type="button"
            aria-label="Klepet z zapiski"
            className="memo-m-chat-fab"
            onClick={() => setIsLibraryChatOpen(true)}
          >
            <Msym name="chat_bubble" size="1.6rem" fill={false} weight={500} />
          </button>
          <button
            type="button"
            className="memo-m-create"
            onClick={() => {
              if (!canCreateNotes) {
                router.push(startHref);
                return;
              }

              setIsMobileCreateMenuOpen(true);
            }}
          >
            <Msym name="edit_square" size="1.4rem" fill={false} weight={500} />
            <span>Nov zapisek</span>
          </button>
        </div>
      </div>

      {/* Desktop: the always-present ask bar, and the full panel it opens. */}
      <LibraryChat
        folders={folders}
        lectures={libraryLectures}
        open={isLibraryChatOpen}
        onOpenChange={setIsLibraryChatOpen}
        hasPaidAccess={hasPaidAccess}
      />

      <NoteSourceModal
        mode={activeModal}
        open={Boolean(activeModal)}
        onClose={closeModal}
        canCreateNotes={canCreateNotes}
      />

      {showDiscountPromo || isWheelOpen || isOfferOpen ? (
        <DiscountOffer
          wheelOpen={isWheelOpen}
          offerOpen={isOfferOpen}
          onWheelOpenChange={setIsWheelOpen}
          onOfferOpenChange={setIsOfferOpen}
          onClaimed={() => setHasClaimedDiscount(true)}
        />
      ) : null}

      {/* Rename and delete are bottom sheets on the phone and centred dialogs
          on desktop; one markup, two skins. */}
      {renameTarget ? (
        <MemoPortal>
          <button
            type="button"
            aria-label="Zapri"
            className={sheetClass("memo-scrim", dialogSheet.closing)}
            onClick={closeRenameModal}
          />
          <div
            className={sheetClass("memo-sheet memo-dialog", dialogSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-note-title"
            onPointerDown={dialogSheet.dragProps.onPointerDown}
            onPointerDownCapture={handleRenameDialogPointerDownCapture}
            data-dragging={dialogSheet.dragProps["data-dragging"]}
            style={dialogSheet.dragProps.style}
          >
            <div className="memo-grab" data-drag-handle />
            <span id="rename-note-title" className="memo-sheet-heading">
              Preimenuj zapisek
            </span>
            <input
              ref={renameInputRef}
              className="memo-sheet-field"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleRenameLecture();
                }
              }}
              placeholder="Naslov zapiska"
              enterKeyHint="done"
              autoCapitalize="sentences"
              autoCorrect="off"
              autoComplete="off"
            />
            {dashboardActionError ? (
              <p className="memo-inline-error">{dashboardActionError}</p>
            ) : null}
            <div className="memo-sheet-actions">
              <button
                type="button"
                className="memo-sheet-coral"
                onClick={() => void handleRenameLecture()}
                disabled={busyLectureId === renameTarget.id}
              >
                {busyLectureId === renameTarget.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Shrani naslov
              </button>
              <button
                type="button"
                className="memo-sheet-ghost"
                onClick={closeRenameModal}
                disabled={busyLectureId === renameTarget.id}
              >
                Prekliči
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      {deleteTarget ? (
        <MemoPortal>
          <button
            type="button"
            aria-label="Zapri"
            className={sheetClass("memo-scrim", dialogSheet.closing)}
            onClick={closeDeleteModal}
          />
          <div
            className={sheetClass("memo-sheet memo-dialog", dialogSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-note-title"
            {...dialogSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <span id="delete-note-title" className="memo-sheet-heading">
              Izbriši zapisek
            </span>
            <p className="memo-sheet-copy">
              Zapisek »{deleteTarget.title?.trim() || "Neimenovan zapisek"}« bo trajno
              izbrisan skupaj s prepisom, karticami in kvizi.
            </p>
            {dashboardActionError ? (
              <p className="memo-inline-error">{dashboardActionError}</p>
            ) : null}
            <div className="memo-sheet-actions">
              <button
                type="button"
                className="memo-sheet-danger"
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
                className="memo-sheet-ghost"
                onClick={closeDeleteModal}
                disabled={busyLectureId === deleteTarget.id}
              >
                Prekliči
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      {/* Phone: "Nov zapisek" opens the capture picker as a bottom sheet. */}
      {isMobileCreateMenuOpen ? (
        <MemoPortal>
          <button
            type="button"
            aria-label="Zapri"
            className={sheetClass("memo-scrim", createSheet.closing)}
            onClick={animateCloseMobileCreateMenu}
          />
          <div
            className={sheetClass("memo-sheet", createSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-create-menu-title"
            {...createSheet.dragProps}
          >
            <div className="memo-grab memo-create-drag-handle" data-drag-handle />
            <div className="memo-sheet-title">
              <span id="mobile-create-menu-title">Nov zapisek</span>
              <button
                type="button"
                className="memo-sheet-close"
                aria-label="Zapri"
                onClick={animateCloseMobileCreateMenu}
              >
                <Msym name="close" size="1.45rem" fill={false} weight={500} />
              </button>
            </div>
            <div className="memo-sheet-list">
              {CREATE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  className="memo-sheet-option"
                  onClick={() => {
                    closeMobileCreateMenu();
                    openQuickAction(option.id);
                  }}
                >
                  <span className="memo-sheet-option-tile">
                    <Emoji symbol={option.emoji} size="1.35rem" />
                  </span>
                  <span className="memo-sheet-option-label">{option.label}</span>
                </button>
              ))}
            </div>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
