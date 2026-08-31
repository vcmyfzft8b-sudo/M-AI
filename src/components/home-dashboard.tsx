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
import {
  detectInstallPlatform,
  INSTALL_GUIDE_SEEN_KEY,
  shouldOfferInstallGuide,
} from "@/lib/install-guide";
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
import { rememberHomePromo } from "@/lib/home-promo-hint";
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
    label: "Naloži dokument",
    icon: "description",
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
  { id: "text" as const, emoji: "📚", label: "PDF, dokument ali fotografija" },
  { id: "link" as const, emoji: "🔗", label: "Spletna povezava" },
] as const;

const DASHBOARD_MUTATION_TIMEOUT_MS = 18_000;
const DASHBOARD_NOTE_ACTION_REVEAL_PX = 144;
/** How far a finger travels before the gesture counts as a swipe and not a tap. */
const DASHBOARD_NOTE_DRAG_SLOP_PX = 5;
/**
 * How far it travels before that gesture's *direction* is read. Reading it at
 * the tap slop above meant deciding on 5px, where the direction is mostly the
 * jerk the hand starts with — so a quick, arcing flick was handed to the
 * scroller and the row never moved, while the same swipe done slowly worked.
 * Roughly where the browser makes up its own mind about a pan.
 */
const DASHBOARD_NOTE_DRAG_DIRECTION_PX = 10;
/**
 * How much more vertical than horizontal a gesture must be before it belongs
 * to the list rather than to the row. Merely "more y than x" is not an answer
 * at this distance. Over-claiming is the safe side: `touch-action: pan-y`
 * leaves the browser its veto, and a pan it takes arrives here as a
 * pointercancel that settles the row back.
 */
const DASHBOARD_NOTE_DRAG_AXIS_BIAS = 1.5;
/** Past either end the row still follows the finger, at a fraction of the distance. */
const DASHBOARD_NOTE_DRAG_RUBBER_BAND = 0.3;
/** px/ms. A flick this quick decides the row on its own, however far it travelled. */
const DASHBOARD_NOTE_FLICK_VELOCITY = 0.4;
/** Long enough for the settle transition below to finish before we drop the layer. */
const DASHBOARD_NOTE_SETTLE_MS = 400;

type DashboardNoteDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  offset: number;
  /** "pending" until the slop is crossed and the gesture turns out to be horizontal. */
  axis: "pending" | "x";
  lastX: number;
  lastTime: number;
  velocity: number;
  hasVelocity: boolean;
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

  const label = getLectureSourceLabel(sourceType, lecture.processing_metadata);

  return detail ? `${label}, ${detail}` : label;
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
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // The swipe never touches React state: it writes the transform straight to the
  // node, so a finger on one row cannot re-render the list underneath it.
  const dragRef = useRef<DashboardNoteDragState | null>(null);
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);
  const releaseSurfaceRef = useRef<(() => void) | null>(null);
  const cancelPrefetchRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
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
      releaseSurfaceRef.current?.();
      cancelPrefetchRef.current?.();
    },
    [],
  );

  // The open/closed position is owned imperatively too, so that a list refresh
  // mid-gesture (the status poll swaps every lecture object) cannot snap the row
  // back under the finger.
  useEffect(() => {
    const node = surfaceRef.current;

    if (!useSwipeActions || !node || dragRef.current) {
      return;
    }

    node.style.transform = isMenuOpen
      ? `translateX(${-DASHBOARD_NOTE_ACTION_REVEAL_PX}px)`
      : "";
  }, [isMenuOpen, useSwipeActions]);

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

  function paintOffset(offset: number) {
    const node = surfaceRef.current;

    if (node) {
      node.style.transform = `translateX(${offset}px)`;
    }
  }

  /** Past either end the row keeps following the finger, but grudgingly. */
  function rubberBand(offset: number) {
    if (offset > 0) {
      return offset * DASHBOARD_NOTE_DRAG_RUBBER_BAND;
    }

    if (offset < -DASHBOARD_NOTE_ACTION_REVEAL_PX) {
      return (
        -DASHBOARD_NOTE_ACTION_REVEAL_PX +
        (offset + DASHBOARD_NOTE_ACTION_REVEAL_PX) * DASHBOARD_NOTE_DRAG_RUBBER_BAND
      );
    }

    return offset;
  }

  function cancelPrefetch() {
    cancelPrefetchRef.current?.();
    cancelPrefetchRef.current = null;
  }

  // Warming the note route is a whole render pass on the main thread. On
  // touch-down that lands in the frames the swipe needs, which is what made the
  // first centimetre of the drag stick, so it waits for an idle one instead: a
  // tap leaves the thread free and it still fires within a few ms.
  function schedulePrefetch() {
    if (cancelPrefetchRef.current) {
      return;
    }

    const warm = () => {
      cancelPrefetchRef.current = null;
      safeRouterPrefetch(router, href);
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 600 });
      cancelPrefetchRef.current = () => window.cancelIdleCallback(handle);
      return;
    }

    const handle = window.setTimeout(warm, 0);
    cancelPrefetchRef.current = () => window.clearTimeout(handle);
  }

  /** Hand the row back to the CSS transition, and let its layer go once it lands. */
  function settleTo(offset: number) {
    const node = surfaceRef.current;

    if (!node) {
      return;
    }

    releaseSurfaceRef.current?.();
    node.classList.remove("dragging");
    node.style.transform = offset === 0 ? "" : `translateX(${offset}px)`;

    const release = () => {
      node.removeEventListener("transitionend", handleTransitionEnd);
      window.clearTimeout(timer);
      releaseSurfaceRef.current = null;

      if (!dragRef.current) {
        node.style.willChange = "";
      }
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === "transform") {
        release();
      }
    };
    const timer = window.setTimeout(release, DASHBOARD_NOTE_SETTLE_MS);

    node.addEventListener("transitionend", handleTransitionEnd);
    releaseSurfaceRef.current = release;
  }

  /**
   * One pointer sample. Coalesced samples are replayed through this in order,
   * so a swipe that outran the frame rate is measured on what the finger
   * actually did rather than on the one position that survived to a frame.
   *
   * Returns false once the gesture has been given up as a scroll.
   */
  function trackSample(
    current: DashboardNoteDragState,
    clientX: number,
    clientY: number,
    time: number,
  ) {
    if (current.axis === "pending") {
      const deltaX = clientX - current.startX;
      const deltaY = clientY - current.startY;

      // Too early to read a direction out of it.
      if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DASHBOARD_NOTE_DRAG_DIRECTION_PX) {
        return true;
      }

      // The browser owns vertical pans here (touch-action: pan-y), so a gesture
      // that clearly leans vertical is the list scrolling: let go of it rather
      // than spend the rest of the swipe fighting the scroller.
      if (Math.abs(deltaY) > Math.abs(deltaX) * DASHBOARD_NOTE_DRAG_AXIS_BIAS) {
        dragRef.current = null;
        cleanupDragListenersRef.current?.();
        surfaceRef.current?.classList.remove("dragging");
        return false;
      }

      current.axis = "x";
      // Give the row everything the finger has already covered bar the slop it
      // took to tell a swipe from a tap. Re-anchoring on this sample instead
      // threw the whole first move away — nothing at all on a slow drag, half
      // the gesture at flick speed, which is why the row only kept up when it
      // was dragged slowly.
      current.startX += deltaX < 0 ? -DASHBOARD_NOTE_DRAG_SLOP_PX : DASHBOARD_NOTE_DRAG_SLOP_PX;
      suppressClickRef.current = true;
      cancelPrefetch();
      surfaceRef.current?.classList.add("dragging");
      // `lastX`/`lastTime` are deliberately left where the finger went down, so
      // the velocity below is measured across the burst that opened the swipe.
      // Resetting them here dropped the fastest part of every flick.
    }

    const elapsed = time - current.lastTime;

    if (elapsed > 0) {
      const instant = (clientX - current.lastX) / elapsed;
      // Smoothed from the second sample on, so one stuttering frame at lift-off
      // cannot decide the row. The first is taken whole: a short flick is only a
      // couple of events long, and easing into it from zero would read every
      // one of them as a third of the speed the finger actually had.
      current.velocity = current.hasVelocity
        ? current.velocity * 0.7 + instant * 0.3
        : instant;
      current.hasVelocity = true;
      current.lastX = clientX;
      current.lastTime = time;
    }

    current.offset = rubberBand(current.startOffset + (clientX - current.startX));
    return true;
  }

  function updateDrag(event: PointerEvent) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    if (current.axis === "x") {
      event.preventDefault();
    }

    // A swipe faster than the display hands its dropped samples over here.
    const coalesced = event.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length > 0 ? coalesced : [event];

    for (const sample of samples) {
      if (!trackSample(current, sample.clientX, sample.clientY, sample.timeStamp)) {
        return;
      }
    }

    if (current.axis === "x") {
      paintOffset(current.offset);
    }
  }

  function finishDrag(event: PointerEvent) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    cleanupDragListenersRef.current?.();

    if (current.axis !== "x") {
      // A tap: nothing moved, so there is nothing to settle.
      if (surfaceRef.current) {
        surfaceRef.current.style.willChange = "";
      }
      return;
    }

    // The finger can still travel between the last move and the lift, which on
    // a flick is a real part of the distance. Its speed is not folded in: a
    // lift usually reports no displacement at all, and reading that as a stop
    // would cancel the flick that just happened.
    current.offset = rubberBand(current.startOffset + (event.clientX - current.startX));

    // A flick decides the row whatever distance it covered; a slow drag lands
    // wherever it was let go of.
    const shouldOpen =
      current.velocity < -DASHBOARD_NOTE_FLICK_VELOCITY ||
      (current.velocity <= DASHBOARD_NOTE_FLICK_VELOCITY &&
        current.offset < -DASHBOARD_NOTE_ACTION_REVEAL_PX / 2);

    settleTo(shouldOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0);

    if (shouldOpen !== isMenuOpen) {
      onToggleMenu(lecture.id);
    }
  }

  function cancelDrag(event: PointerEvent) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    dragRef.current = null;
    cleanupDragListenersRef.current?.();
    settleTo(isMenuOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    cleanupDragListenersRef.current?.();

    if (!isMenuOpen) {
      schedulePrefetch();
    }

    const startOffset = isMenuOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0;

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset,
      offset: startOffset,
      axis: "pending",
      lastX: event.clientX,
      lastTime: event.timeStamp,
      velocity: 0,
      hasVelocity: false,
    };
    suppressClickRef.current = false;

    // Promote the row while the finger is still settling, so the first frame of
    // the swipe is a composite rather than a fresh layer.
    if (surfaceRef.current) {
      surfaceRef.current.style.willChange = "transform";
    }

    const handleWindowPointerMove = (moveEvent: PointerEvent) => updateDrag(moveEvent);
    const handleWindowPointerUp = (upEvent: PointerEvent) => finishDrag(upEvent);
    const handleWindowPointerCancel = (cancelEvent: PointerEvent) => cancelDrag(cancelEvent);

    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp);
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    cleanupDragListenersRef.current = () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
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
        ref={surfaceRef}
        role="link"
        tabIndex={0}
        className="memo-swipe-surface"
        onPointerDown={handlePointerDown}
        onDragStart={(event) => event.preventDefault()}
        onClick={handleSurfaceClick}
        onKeyDown={handleSurfaceKeyDown}
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
          /*
           * No `stopPropagation` here on purpose: the chevron is the part of
           * the row that says the actions are there, so it is the part a finger
           * reaches for to pull them out. Letting the pointerdown reach the
           * surface makes the chevron a drag handle as well as a toggle.
           */
          onClick={(event) => {
            event.stopPropagation();

            // The drag already decided where the row sits. Toggling on the
            // click that ends it would immediately undo it.
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }

            onToggleMenu(lecture.id);
          }}
        >
          <Msym name="chevron_right" size="1.25rem" fill={false} weight={500} />
        </button>
      </div>

      <div
        ref={isMenuOpen ? attachMenuRef : undefined}
        className={`memo-swipe-actions ${isMenuOpen ? "on" : ""}`.trim()}
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
  canSpinWheel: initialCanSpinWheel = null,
  showDevDashboard,
}: {
  lectures: AppLectureListItem[];
  folders: AppLibraryFolder[];
  userId: string;
  canCreateNotes: boolean;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  /** Whether the wheel has a spin left, as the server saw it while rendering. */
  canSpinWheel?: boolean | null;
  showDevDashboard: boolean;
}) {
  const router = useRouter();
  const {
    navigateWithFeedback: navigateDashboardWithFeedback,
    overlay: dashboardNavigationOverlay,
  } = useInstantNavigation();
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
  /*
   * Seeded from the URL rather than opened in an effect: an effect runs after
   * the first paint, so returning from Stripe showed the home screen for a
   * frame before the offer appeared. It was never dismissed — it should be
   * there the moment the page draws.
   */
  const [isOfferOpen, setIsOfferOpen] = useState(
    () => searchParams.get("offer") === "1",
  );
  /*
   * True when the offer is being restored after a trip to Stripe rather than
   * opened by the wheel. It was never really dismissed, so it should already
   * be there when the page draws — sliding it up again would say it had gone
   * away and come back.
   */
  const [isOfferRestored, setIsOfferRestored] = useState(
    () => searchParams.get("offer") === "1",
  );
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
  const [canSpinWheel, setCanSpinWheel] = useState<boolean | null>(initialCanSpinWheel);
  /*
   * Whether to badge the settings gear. Read after mount rather than during
   * render: it comes from `localStorage` and from `display-mode`, neither of
   * which the server can know, and a badge that renders on the server would
   * flash on for everyone who has already dismissed it.
   */
  const [showInstallHint, setShowInstallHint] = useState(false);

  useEffect(() => {
    // Phones only — matching the settings row the badge is pointing at.
    const sync = () =>
      setShowInstallHint(detectInstallPlatform() !== "other" && shouldOfferInstallGuide());

    sync();
    window.addEventListener(INSTALL_GUIDE_SEEN_KEY, sync);

    return () => window.removeEventListener(INSTALL_GUIDE_SEEN_KEY, sync);
  }, []);
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
      navigateDashboardWithFeedback(startHref);
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
      getLectureSourceLabel(getEffectiveLectureSourceType(lecture), lecture.processing_metadata)
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

  /*
   * Stripe sends a cancelled discount checkout back with `offer=1`. Reopening
   * the sheet puts the buyer where they left off — the prize is still theirs
   * until it is spent or its ten minutes run out, and the server is the one
   * that decides which.
   */
  useEffect(() => {
    if (searchParams.get("offer") !== "1") {
      return;
    }

    setIsOfferOpen(true);
    setIsOfferRestored(true);
    router.replace(homeHref, { scroll: false });
  }, [homeHref, router, searchParams]);

  useEffect(() => {
    if (hasPaidAccess) {
      return;
    }

    // A refresh, not the first answer: the server already supplied that. This
    // catches a spin taken on another device, or the day turning over.
    let cancelled = false;

    void fetch("/api/discount-wheel")
      .then((response) => (response.ok ? response.json() : null))
      .then((state: { canSpin?: boolean; spunToday?: boolean } | null) => {
        if (!cancelled) {
          // `spunToday` rather than `canSpin`: the latter is relaxed in
          // development so the wheel can be replayed, and the card should be
          // the one production would show either way.
          setCanSpinWheel(Boolean(state?.canSpin) && !state?.spunToday);
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
  /*
   * Which card the slot holds when the home screen is arrived at, which is
   * always the library view — so this is deliberately not `showDiscountPromo`:
   * a folder or a search hides the card without changing what the next visit
   * should draw.
   */
  const promoHint = hasPaidAccess
    ? "none"
    : canSpinWheel === null
      ? "none"
      : wheelAvailable
        ? "wheel"
        : "upgrade";

  /*
   * Remembered for the route's skeleton, which paints before this screen has
   * any data and would otherwise leave the card's place empty for as long as
   * the home screen takes to load. Not from the demo: it is a public page and
   * the card it shows is not the visitor's own.
   */
  useEffect(() => {
    if (isCreatorDemo) {
      return;
    }

    rememberHomePromo(promoHint);
  }, [isCreatorDemo, promoHint]);

  return (
    <>
      {dashboardNavigationOverlay}
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
          {/* The dot is the only hint that there is something new in there;
              it clears the first time the guide is opened. */}
          <InstantLink
            href="/app/settings"
            className={`memo-m-round ${showInstallHint ? "has-dot" : ""}`.trim()}
            aria-label={showInstallHint ? "Nastavitve (1 novost)" : "Nastavitve"}
          >
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
              onClick={() => navigateDashboardWithFeedback("/dev/account-state")}
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
              Posnemi ali naloži zvok, dokument ali povezavo
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
                onClick={() => navigateDashboardWithFeedback(startHref)}
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
                navigateDashboardWithFeedback(startHref);
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
          onOfferOpenChange={(open) => {
            setIsOfferOpen(open);

            if (!open) {
              setIsOfferRestored(false);
            }
          }}
          offerRestored={isOfferRestored}
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
