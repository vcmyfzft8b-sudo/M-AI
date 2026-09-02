"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import {
  memo,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
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
import { useT, useTranslations } from "@/components/i18n-provider";
import {
  detectInstallPlatform,
  INSTALL_GUIDE_SEEN_EVENT,
  shouldOfferInstallGuide,
} from "@/lib/install-guide";
import { LibraryChat } from "@/components/library-chat";
import type { NoteSourceMode } from "@/components/note-source-modal";
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
import { canRetryLectureFailure, lectureFailureMessage } from "@/lib/lecture-failure-codes";
import { clearOfferResume, isOfferResumePending, markOfferResume } from "@/lib/offer-resume";
import {
  getEffectiveLectureSourceType,
  getLectureSourceDetail,
  getLectureSourceLabel,
} from "@/lib/lecture-source-metadata";
import { noteEmoji } from "@/lib/note-emoji";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";
import {
  actionsProgress,
  commitDebt,
  createVelocityTracker,
  decayCommitDebt,
  resolveAxis,
  rubberBand,
  shouldOpen,
  springFrames,
  SWIPE_ACTIONS_SCALE_FROM,
  SWIPE_REVEAL_PX,
  SWIPE_TAP_SLOP_PX,
  type SwipeAxis,
  type SwipeTracker,
} from "@/lib/swipe-gesture";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";
import type { AppLectureListItem, AppLibraryFolder } from "@/lib/types";
import { formatCalendarDate } from "@/lib/utils";

const loadNoteSourceModal = () => import("@/components/note-source-modal");
const loadDiscountOffer = () => import("@/components/discount-offer");
const loadLectureWorkspace = () => import("@/components/lecture-workspace");

function DeferredSurfaceLoading() {
  return (
    <div
      className="navigation-progress memo-portal"
      data-navigation-overlay=""
      role="status"
    >
      <span className="navigation-progress-bar" />
    </div>
  );
}

const DeferredNoteSourceModal = dynamic(
  () => loadNoteSourceModal().then((module) => module.NoteSourceModal),
  { loading: DeferredSurfaceLoading },
);

const DeferredDiscountOffer = dynamic(
  () => loadDiscountOffer().then((module) => module.DiscountOffer),
  { loading: DeferredSurfaceLoading },
);

function connectionAllowsIdleWarmup() {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;

  return !connection?.saveData && !connection?.effectiveType?.includes("2g");
}

/** Desktop home: four capture entry points, in the redesign's order. */
const QUICK_ACTIONS = [
  {
    id: "record" as const,
    labelKey: "library.quickAction.record" satisfies MessageKey,
    icon: "radio_button_checked",
    accent: "record",
    filled: true,
  },
  {
    id: "link" as const,
    labelKey: "library.quickAction.link" satisfies MessageKey,
    icon: "link",
    accent: "",
    filled: true,
  },
  {
    id: "text" as const,
    labelKey: "library.quickAction.document" satisfies MessageKey,
    icon: "description",
    accent: "",
    filled: true,
  },
  {
    id: "upload" as const,
    labelKey: "library.quickAction.audio" satisfies MessageKey,
    icon: "cloud_upload",
    accent: "",
    filled: true,
  },
] as const;

/** Phone home: the same entry points, as the "new note" sheet lists them. */
const CREATE_OPTIONS = [
  { id: "record" as const, emoji: "🎙️", labelKey: "library.create.record" satisfies MessageKey },
  { id: "upload" as const, emoji: "🔊", labelKey: "library.quickAction.audio" satisfies MessageKey },
  { id: "text" as const, emoji: "📚", labelKey: "library.create.text" satisfies MessageKey },
  { id: "link" as const, emoji: "🔗", labelKey: "library.create.link" satisfies MessageKey },
] as const;

const DASHBOARD_MUTATION_TIMEOUT_MS = 18_000;

/**
 * How much faster than the row the actions fade in. Ahead of the travel, so
 * they are solid by the time the row has uncovered three quarters of them and
 * never read as half-painted at the point the finger is looking at them.
 */
const DASHBOARD_NOTE_ACTIONS_FADE = 1.35;

type DashboardNoteDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: number;
  /** Where the row is drawn, the commit debt already taken off it. */
  offset: number;
  /** "pending" until the gesture has travelled far enough to have a direction. */
  axis: SwipeAxis;
  lastTime: number;
  lastX: number;
  /** The recognition step the row is still easing into. See `commitDebt`. */
  debt: number;
};

/**
 * `timeoutMessage` is passed in rather than written here because this runs
 * outside a component and has no access to the translator. The caller is a
 * screen; it has one.
 */
async function fetchDashboardMutation(
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMessage = "",
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
      throw new Error(timeoutMessage);
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/** "Audio, 1 h 12 min" where the design has a detail to print, "Audio" where not. */
function sourceMeta(
  lecture: AppLectureListItem,
  sourceType: string,
  t: Translate<MessageKey>,
) {
  const detail = getLectureSourceDetail(lecture, t);

  const label = getLectureSourceLabel(sourceType, lecture.processing_metadata, t);

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
  const { locale, t } = useTranslations();
  const router = useRouter();
  const {
    navigateWithFeedback,
    overlay: navigationOverlay,
    isNavigating: isOpening,
  } = useInstantNavigation();
  const sourceType = getEffectiveLectureSourceType(lecture);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const actionsTrackRef = useRef<HTMLDivElement | null>(null);
  // The swipe never touches React state: it writes the transform straight to the
  // node, so a finger on one row cannot re-render the list underneath it.
  const dragRef = useRef<DashboardNoteDragState | null>(null);
  const cleanupDragListenersRef = useRef<(() => void) | null>(null);
  const cancelPrefetchRef = useRef<(() => void) | null>(null);
  const suppressClickRef = useRef(false);
  /** One transform write per frame, however many pointer samples arrive in it. */
  const frameRef = useRef(0);
  /** What `paint` last put on the node, so a new gesture knows where it starts. */
  const paintedOffsetRef = useRef(0);
  /** Where the row was last sent, so a re-render cannot re-send it there. */
  const settledTargetRef = useRef<number | null>(null);
  const animationsRef = useRef<Animation[]>([]);
  const velocityRef = useRef<SwipeTracker | null>(null);

  if (velocityRef.current == null) {
    velocityRef.current = createVelocityTracker();
  }
  const title = lecture.title?.trim() || t("note.untitled");
  const emoji = noteEmoji(lecture);
  const isProcessing = shouldPollLectureStatus(lecture.status);
  const isFailed = lecture.status === "failed";
  const meta = isProcessing
    ? t("note.generating")
    : isFailed
      ? t("note.processingFailed")
      : `${formatCalendarDate(lecture.created_at, locale)} • ${sourceMeta(lecture, sourceType, t)}`;

  useEffect(
    () => () => {
      cleanupDragListenersRef.current?.();
      cancelPrefetchRef.current?.();

      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
      }

      for (const animation of animationsRef.current) {
        animation.cancel();
      }
    },
    [],
  );

  /** The buttons grow into the gap the row opens rather than waiting in it. */
  function actionsStyle(offset: number) {
    const progress = actionsProgress(offset);
    const scale = SWIPE_ACTIONS_SCALE_FROM + progress * (1 - SWIPE_ACTIONS_SCALE_FROM);

    return {
      transform: `scale(${scale.toFixed(4)})`,
      opacity: `${Math.min(1, progress * DASHBOARD_NOTE_ACTIONS_FADE)}`,
    };
  }

  /** The one place either node is written to. Compositor-only properties only. */
  function paint(offset: number) {
    paintedOffsetRef.current = offset;

    const node = surfaceRef.current;

    if (node) {
      node.style.transform = `translate3d(${offset}px, 0, 0)`;
    }

    const track = actionsTrackRef.current;

    if (track) {
      const style = actionsStyle(offset);
      track.style.transform = style.transform;
      track.style.opacity = style.opacity;
    }
  }

  /**
   * Where the row is *now* — which mid-settle is not what we last wrote, but
   * what the compositor is drawing. Reading it costs a style flush, so it is
   * only paid when an animation is actually in flight; that is the case where
   * a finger has caught a moving row, and continuing from anywhere else would
   * teleport it.
   */
  function currentOffset() {
    const node = surfaceRef.current;

    if (!node || typeof node.getAnimations !== "function" || node.getAnimations().length === 0) {
      return paintedOffsetRef.current;
    }

    try {
      return new DOMMatrixReadOnly(window.getComputedStyle(node).transform).m41;
    } catch {
      return paintedOffsetRef.current;
    }
  }

  function stopAnimations() {
    for (const animation of animationsRef.current) {
      animation.cancel();
    }

    animationsRef.current = [];
  }

  /** Promote both layers before the first frame that needs them, not during it. */
  function holdLayers() {
    surfaceRef.current?.style.setProperty("will-change", "transform");
    actionsTrackRef.current?.style.setProperty("will-change", "transform, opacity");
  }

  function releaseLayers() {
    surfaceRef.current?.style.removeProperty("will-change");
    actionsTrackRef.current?.style.removeProperty("will-change");
  }

  /**
   * The release, as a spring that starts at the speed the finger had.
   *
   * A fixed-duration CSS transition cannot help but break the gesture at the
   * moment it matters most — let go mid-flick and the row visibly stalls
   * before restarting on somebody else's curve. Handing the velocity to the
   * spring keeps the motion continuous through the lift, and playing the
   * sampled result through the Web Animations API keeps it on the compositor
   * afterwards, where a list re-render cannot stutter it.
   */
  function animateTo(target: number, velocity: number) {
    const node = surfaceRef.current;

    if (!node) {
      return;
    }

    const from = currentOffset();

    stopAnimations();
    settledTargetRef.current = target;
    // The resting styles go on first: the animation runs unfilled, so this is
    // what the row lands on when it finishes, and what it holds if the tab is
    // backgrounded halfway through.
    paint(target);

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const { offsets, durationMs } = reduced
      ? { offsets: [target], durationMs: 0 }
      : springFrames(from, target, velocity);

    if (durationMs <= 0 || typeof node.animate !== "function") {
      releaseLayers();
      return;
    }

    holdLayers();

    const timing: KeyframeAnimationOptions = { duration: durationMs, easing: "linear" };
    const surfaceAnimation = node.animate(
      offsets.map((offset) => ({ transform: `translate3d(${offset}px, 0, 0)` })),
      timing,
    );

    animationsRef.current = [surfaceAnimation];

    const track = actionsTrackRef.current;

    if (track && typeof track.animate === "function") {
      animationsRef.current.push(track.animate(offsets.map(actionsStyle), timing));
    }

    const done = () => {
      // Only the settle that is still the current one may drop the layers: a
      // cancel fires this after the gesture that replaced it has already asked
      // for them back.
      if (dragRef.current || animationsRef.current[0] !== surfaceAnimation) {
        return;
      }

      animationsRef.current = [];
      releaseLayers();
    };

    surfaceAnimation.addEventListener("finish", done);
    surfaceAnimation.addEventListener("cancel", done);
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
      safeRouterPrefetch(router, href, { full: true });
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 600 });
      cancelPrefetchRef.current = () => window.cancelIdleCallback(handle);
      return;
    }

    const handle = window.setTimeout(warm, 0);
    cancelPrefetchRef.current = () => window.clearTimeout(handle);
  }

  /**
   * One transform write per displayed frame, whatever the touch sample rate is.
   *
   * Writing straight from the pointer handler looked the same on a 60Hz screen
   * and did redundant style work on a 120Hz one, where a single frame can carry
   * several samples. The paint is queued instead and runs inside the frame the
   * events were dispatched in, so nothing is delayed by it.
   */
  function schedulePaint() {
    if (frameRef.current) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;

      const current = dragRef.current;

      if (current && current.axis === "x") {
        paint(current.offset);
      }
    });
  }

  function endGesture() {
    dragRef.current = null;
    cleanupDragListenersRef.current?.();
    surfaceRef.current?.classList.remove("dragging");

    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
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
    velocityRef.current?.push(clientX, time);

    if (current.axis === "pending") {
      const axis = resolveAxis(clientX - current.startX, clientY - current.startY);

      // Too early to read a direction out of it.
      if (axis === "pending") {
        return true;
      }

      // The browser owns vertical pans here (touch-action: pan-y), so a gesture
      // that clearly leans vertical is the list scrolling: let go of it rather
      // than spend the rest of the swipe fighting the scroller.
      if (axis === "y") {
        endGesture();
        releaseLayers();
        return false;
      }

      const deltaX = clientX - current.startX;

      current.axis = "x";
      // Give the row everything the finger has already covered bar the slop it
      // took to tell a swipe from a tap. Re-anchoring on this sample instead
      // threw the whole first move away — nothing at all on a slow drag, half
      // the gesture at flick speed, which is why the row only kept up when it
      // was dragged slowly.
      current.startX += deltaX < 0 ? -SWIPE_TAP_SLOP_PX : SWIPE_TAP_SLOP_PX;
      current.debt = commitDebt(deltaX);
      current.lastTime = time;
      current.lastX = clientX;
      suppressClickRef.current = true;
      cancelPrefetch();
      surfaceRef.current?.classList.add("dragging");
    }

    current.debt = decayCommitDebt(
      current.debt,
      time - current.lastTime,
      clientX - current.lastX,
    );
    current.lastTime = time;
    current.lastX = clientX;
    current.offset = rubberBand(current.startOffset + (clientX - current.startX)) - current.debt;
    return true;
  }

  function updateDrag(event: PointerEvent) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
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
      // Claimed on the event that commits the gesture as well as on the ones
      // after it, so the browser never gets to start a scroll we then fight.
      if (event.cancelable) {
        event.preventDefault();
      }

      schedulePaint();
    }
  }

  function finishDrag(event: PointerEvent) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const { axis, debt, startOffset, startX } = current;
    // The lift's own speed is not folded in: it usually reports no displacement
    // at all, and reading that as a stop would cancel the flick that just
    // happened. Its position is, because on a flick the travel between the last
    // move and the lift is a real part of the distance.
    const velocity = axis === "x" ? (velocityRef.current?.read(event.timeStamp) ?? 0) : 0;
    const offset = rubberBand(startOffset + (event.clientX - startX));

    endGesture();

    if (axis !== "x") {
      // A tap: nothing moved, so there is nothing to settle.
      releaseLayers();
      return;
    }

    // The settle starts from where the row is *drawn*, debt included, so the
    // spring picks up exactly the pixel the last frame left — and the decision
    // is taken on where the finger actually got to.
    paintedOffsetRef.current = offset - debt;

    const open = shouldOpen(offset, velocity);

    animateTo(open ? -SWIPE_REVEAL_PX : 0, velocity);

    if (open !== isMenuOpen) {
      onToggleMenu(lecture.id);
    }
  }

  function cancelDrag(event: PointerEvent) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const { axis } = current;

    endGesture();

    if (axis !== "x") {
      releaseLayers();
      return;
    }

    animateTo(isMenuOpen ? -SWIPE_REVEAL_PX : 0, 0);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    // A second finger landing on a row that is already being dragged belongs to
    // whatever the first one is doing. The same finger coming down again does
    // not: that is a gesture whose end never arrived, and refusing it would
    // strand the row for good.
    if (dragRef.current && dragRef.current.pointerId !== event.pointerId) {
      return;
    }

    cleanupDragListenersRef.current?.();

    if (!isMenuOpen) {
      schedulePrefetch();
    }

    // Catch the row wherever it happens to be: grabbing one mid-settle picks it
    // up from there rather than snapping it to the end it was heading for.
    const startOffset = currentOffset();

    stopAnimations();
    paint(startOffset);
    // Promote both layers while the finger is still settling, so the first
    // frame of the swipe is a composite rather than a fresh layer.
    holdLayers();

    velocityRef.current?.reset(event.clientX, event.timeStamp);

    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startOffset,
      offset: startOffset,
      axis: "pending",
      lastTime: event.timeStamp,
      lastX: event.clientX,
      debt: 0,
    };
    suppressClickRef.current = false;

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

  // The open/closed position is owned imperatively too, so that a list refresh
  // mid-gesture (the status poll swaps every lecture object) cannot snap the row
  // back under the finger. `settledTargetRef` is the guard for the other half of
  // that: the re-render the swipe itself causes must not restart the settle it
  // is already playing.
  useEffect(() => {
    const node = surfaceRef.current;

    if (!useSwipeActions || !node || dragRef.current) {
      return;
    }

    const target = isMenuOpen ? -SWIPE_REVEAL_PX : 0;

    if (settledTargetRef.current === target) {
      return;
    }

    animateTo(target, 0);
    // `animateTo` closes over nothing this needs to watch: it reads the row's
    // live position off the node, and re-running whenever the list re-renders
    // would restart the settle a swipe is in the middle of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

          {isProcessing ? <span className="memo-note-badge">{t("status.generatingNotes")}</span> : null}
          {isFailed ? <span className="memo-note-badge failed">{t("status.failed")}</span> : null}

          <Msym name="chevron_right" size="1.55rem" fill={false} weight={400} />
        </InstantLink>
      </>
    );
  }

  // Phone: the row slides left to reveal the edit and delete actions.
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
          aria-label={t("library.row.actions", { title })}
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
        {/*
          * The track is what moves. It carries the buttons out from under the
          * row as the row uncovers them, and the container above it clips what
          * has not come out yet — without that, the tucked-away half of the
          * pair would hang off the right edge of the card.
          */}
        <div ref={actionsTrackRef} className="memo-swipe-actions-track">
          <button
            type="button"
            aria-label={t("library.row.rename", { title })}
            disabled={isBusy}
            onClick={() => onOpenRename(lecture)}
            className="memo-swipe-action"
          >
            <span className="memo-swipe-action-circle">
              <Emoji symbol="✏️" size="1.1rem" />
            </span>
            <span>{t("common.edit")}</span>
          </button>
          <button
            type="button"
            aria-label={t("library.row.delete", { title })}
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
            <span>{t("common.delete")}</span>
          </button>
        </div>
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
  installGuideSeen = false,
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
  /**
   * Whether this account has already opened the home screen guide. Read from
   * the profile so the gear's badge is answered once, for good, rather than
   * once in every browser they sign in from.
   */
  installGuideSeen?: boolean;
  showDevDashboard: boolean;
}) {
  const t = useT();
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
   * Seeded during render rather than opened in an effect: an effect runs after
   * the first paint, so returning from Stripe showed the home screen for a
   * frame before the offer appeared. It was never dismissed — it should be
   * there the moment the page draws.
   *
   * Two sources, because Stripe's cancel URL is only one of the ways back.
   * `offer=1` arrives when the buyer uses Stripe's own back link; the note in
   * `sessionStorage` is there however they return, including the browser's
   * back gesture and a reload of the web view. Reading storage during render
   * is safe here: the sheet lives in a portal that draws nothing until after
   * hydration, so the server and the first client pass agree either way.
   */
  const isOfferResumed =
    searchParams.get("offer") === "1" || isOfferResumePending();
  const [isOfferOpen, setIsOfferOpen] = useState(() => isOfferResumed);
  /*
   * True when the offer is being restored after a trip to Stripe rather than
   * opened by the wheel. It was never really dismissed, so it should already
   * be there when the page draws — sliding it up again would say it had gone
   * away and come back.
   */
  const [isOfferRestored, setIsOfferRestored] = useState(() => isOfferResumed);
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
   * Whether to badge the settings gear. The account's answer comes from the
   * server, but which device is looking does not, so this is settled after
   * mount: the phone check and the local echo are both browser facts.
   */
  const [showInstallHint, setShowInstallHint] = useState(false);

  useEffect(() => {
    // Phones only — matching the settings row the badge is pointing at.
    const sync = () =>
      setShowInstallHint(
        detectInstallPlatform() !== "other" && shouldOfferInstallGuide(installGuideSeen),
      );

    sync();
    window.addEventListener(INSTALL_GUIDE_SEEN_EVENT, sync);

    return () => window.removeEventListener(INSTALL_GUIDE_SEEN_EVENT, sync);
  }, [installGuideSeen]);
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
    if (isCreatorDemo || !connectionAllowsIdleWarmup()) {
      return;
    }

    const warm = () => {
      if (canCreateNotes) {
        void loadNoteSourceModal();
      }

      if (!hasPaidAccess) {
        void loadDiscountOffer();
      }

      if (
        lectures.some(
          (lecture) => hasPaidAccess || lecture.id === trialLectureId,
        )
      ) {
        void loadLectureWorkspace();
      }

      // Keep the most likely note taps genuinely instant. Warming every row
      // would download an entire library, so only the two newest ready notes
      // this account can open are put in Next's in-memory route cache.
      for (const lecture of lectures
        .filter(
          (lecture) =>
            lecture.status === "ready" &&
            (hasPaidAccess || lecture.id === trialLectureId),
        )
        .slice(0, 2)) {
        safeRouterPrefetch(router, `/app/lectures/${lecture.id}`, { full: true });
      }
    };

    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(warm, { timeout: 1_500 });
      return () => window.cancelIdleCallback(handle);
    }

    const handle = window.setTimeout(warm, 500);
    return () => window.clearTimeout(handle);
  }, [canCreateNotes, hasPaidAccess, isCreatorDemo, lectures, router, trialLectureId]);

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
      setRenameValue(lecture.title?.trim() || t("note.untitled"));
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

  async function handleDeleteLecture() {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;

    try {
      setDashboardActionError(null);
      setBusyLectureId(target.id);
      const response = await fetchDashboardMutation(
        `/api/lectures/${target.id}`,
        { method: "DELETE" },
        t("library.error.localServer"),
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t("library.error.deleteFailed"));
      }

      setLibraryLectures((current) => current.filter((lecture) => lecture.id !== target.id));
      setDeleteTarget(null);
      startTransition(() => router.refresh());
    } catch (error) {
      setDashboardActionError(
        error instanceof Error ? error.message : t("library.error.deleteFailed"),
      );
    } finally {
      setBusyLectureId(null);
    }
  }

  async function handleRetryLecture(id: string) {
    try {
      setDashboardActionError(null);
      setBusyLectureId(id);
      const response = await fetchDashboardMutation(
        `/api/lectures/${id}/retry`,
        { method: "POST" },
        t("library.error.localServer"),
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t("library.error.retryFailed"));
      }

      startTransition(() => router.refresh());
    } catch (error) {
      setDashboardActionError(
        error instanceof Error ? error.message : t("library.error.retryFailed"),
      );
    } finally {
      setBusyLectureId(null);
    }
  }

  async function handleRenameLecture() {
    if (!renameTarget) {
      return;
    }

    const currentTitle = renameTarget.title?.trim() || t("note.untitled");
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
      const response = await fetchDashboardMutation(
        `/api/lectures/${target.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: nextTitle }),
        },
        t("library.error.localServer"),
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? t("library.error.renameFailed"));
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
        error instanceof Error ? error.message : t("library.error.renameFailed"),
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
      getLectureSourceLabel(
        getEffectiveLectureSourceType(lecture),
        lecture.processing_metadata,
        t,
      )
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
   * Putting the offer back after a trip to Stripe.
   *
   * The sheet is already open by now — the state above is seeded during render
   * — so what is left is tidying the URL, and marking the offer as still open
   * for the reload after this one. A buyer who goes to Stripe, comes back, and
   * then refreshes has still not closed the offer, and the query string does
   * not survive a refresh.
   *
   * The prize is still theirs either way: it is spent by buying, by closing
   * the sheet, or by its ten minutes running out, and the server is the one
   * that decides which.
   */
  useEffect(() => {
    if (!isOfferResumed) {
      return;
    }

    markOfferResume();
    setIsOfferOpen(true);
    setIsOfferRestored(true);

    if (searchParams.get("offer") === "1") {
      router.replace(homeHref, { scroll: false });
    }
  }, [homeHref, isOfferResumed, router, searchParams]);

  /*
   * A bought subscription ends the offer as surely as closing it does, and the
   * note would otherwise outlive the thing it points at — reopening a dead
   * sheet on the next visit to the home screen.
   */
  useEffect(() => {
    if (hasPaidAccess) {
      clearOfferResume();
    }
  }, [hasPaidAccess]);

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
          // `spunToday` as well as `canSpin`, because either one being false
          // means there is nothing to offer. Both are relaxed in development
          // so the wheel can be spun more than once an afternoon; production
          // decides them the same way it always has.
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
            aria-label={
              showInstallHint ? t("library.settings.withBadge") : t("nav.settings")
            }
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
            <h1 className="memo-home-h1">{t("library.newNote")}</h1>
            <p className="memo-home-sub">{t("library.newNoteSub")}</p>

            <div className="memo-quick-grid">
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  className="memo-quick-card"
                  onPointerEnter={() => void loadNoteSourceModal()}
                  onFocus={() => void loadNoteSourceModal()}
                  onClick={() => openQuickAction(action.id)}
                >
                  <span className={`memo-quick-tile ${action.accent}`.trim()}>
                    <Msym name={action.icon} size="1.45rem" fill={action.filled} />
                  </span>
                  <span className="memo-quick-label">{t(action.labelKey)}</span>
                </button>
              ))}
            </div>

            <h2 className="memo-home-h2">{t("library.myNotes")}</h2>
          </div>

          {/* The title and the search scroll away with the list; while they
              go, the title fades. The folder pill below is opaque and sits
              above them, so they pass under it. */}
          <h1 className="memo-m-title memo-only-mobile">{t("library.myNotes")}</h1>

          <div className="memo-m-search memo-only-mobile flex">
            <Msym name="search" size="1.3rem" fill={false} weight={600} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("library.search.placeholderLong")}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              aria-label={t("library.search.placeholder")}
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
                placeholder={t("library.search.placeholder")}
                aria-label={t("library.search.placeholder")}
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
                onPointerDown={() => void loadDiscountOffer()}
                onClick={() => setIsWheelOpen(true)}
              >
                <span className="memo-promo-copy">
                  <span>{t("library.promo.discountTitle")}</span>
                  <span>{t("library.promo.discountDetail")}</span>
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
                  <span>{t("library.promo.upgradeTitle")}</span>
                  <span>{t("library.promo.upgradeDetail")}</span>
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
                        {lecture.title ?? t("note.untitled")}
                      </span>
                      <span className="memo-note-meta">
                        {/* The code first: the stored message was written in
                            whatever language the pipeline ran in, which is not
                            necessarily this reader's. */}
                        {lectureFailureMessage(lecture.processing_metadata, t) ??
                          lecture.error_message ??
                          t("note.processingFailedSentence")}
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
                          {t("common.retry")}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="memo-button-outline small danger"
                        onClick={() => openDeleteModal(lecture)}
                        disabled={busyLectureId === lecture.id}
                      >
                        {t("common.delete")}
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
                <p>
                  {t(search ? "library.empty.noMatchTitle" : "library.empty.noNotesTitle")}
                </p>
                <p>
                  {t(search ? "library.empty.noMatchBody" : "library.empty.noNotesBody")}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Phone: chat and the create sheet. */}
        <div className="memo-m-homebar memo-only-mobile flex">
          <button
            type="button"
            aria-label={t("library.chatFab")}
            className="memo-m-chat-fab"
            onClick={() => setIsLibraryChatOpen(true)}
          >
            <Msym name="chat_bubble" size="1.6rem" fill={false} weight={500} />
          </button>
          <button
            type="button"
            className="memo-m-create"
            onPointerDown={() => {
              if (canCreateNotes) {
                void loadNoteSourceModal();
              }
            }}
            onClick={() => {
              if (!canCreateNotes) {
                navigateDashboardWithFeedback(startHref);
                return;
              }

              setIsMobileCreateMenuOpen(true);
            }}
          >
            <Msym name="edit_square" size="1.4rem" fill={false} weight={500} />
            <span>{t("library.newNote")}</span>
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

      {activeModal ? (
        <DeferredNoteSourceModal
          mode={activeModal}
          open
          onClose={closeModal}
          canCreateNotes={canCreateNotes}
        />
      ) : null}

      {isWheelOpen || isOfferOpen ? (
        <DeferredDiscountOffer
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
          on desktop; one markup, two skins.

          The rename sheet rides `--memo-kb` and needs nothing else. It used to
          freeze the page behind it as well — `position: fixed` on the body,
          scroll pinned, touch and wheel swallowed — and that lock was the whole
          bug: with the document unable to scroll, WebKit pans the visual
          viewport instead when the field is focused a second time, which
          `KeyboardInset` reads back as no keyboard at all, leaving the sheet
          sitting under the keys. The folder rename sheet never locked anything
          and never had the problem, so this one no longer does either. */}
      {renameTarget ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", dialogSheet.closing)}
            onClick={closeRenameModal}
          />
          <div
            className={sheetClass("memo-sheet memo-dialog", dialogSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-note-title"
            {...dialogSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <span id="rename-note-title" className="memo-sheet-heading">
              {t("library.rename.title")}
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
              placeholder={t("library.rename.placeholder")}
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
                {t("library.rename.save")}
              </button>
              <button
                type="button"
                className="memo-sheet-ghost"
                onClick={closeRenameModal}
                disabled={busyLectureId === renameTarget.id}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      {deleteTarget ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
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
              {t("library.delete.title")}
            </span>
            <p className="memo-sheet-copy">
              {t("library.delete.body", {
                title: deleteTarget.title?.trim() || t("note.untitled"),
              })}
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
                {t("library.delete.title")}
              </button>
              <button
                type="button"
                className="memo-sheet-ghost"
                onClick={closeDeleteModal}
                disabled={busyLectureId === deleteTarget.id}
              >
                {t("common.cancel")}
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
            aria-label={t("common.close")}
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
              <span id="mobile-create-menu-title">{t("library.newNote")}</span>
              <button
                type="button"
                className="memo-sheet-close"
                aria-label={t("common.close")}
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
                  <span className="memo-sheet-option-label">{t(option.labelKey)}</span>
                </button>
              ))}
            </div>
          </div>
        </MemoPortal>
      ) : null}
    </>
  );
}
