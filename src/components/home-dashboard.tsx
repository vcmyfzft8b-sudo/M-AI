"use client";

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
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { NoteSourceModal, type NoteSourceMode } from "@/components/note-source-modal";
import { StatusBadge } from "@/components/status-badge";
import { EmojiIcon } from "@/components/emoji-icon";
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
  onToggleMenu: (lectureId: string) => void;
  onOpenRename: (lecture: AppLectureListItem) => void;
  onOpenDelete: (lecture: AppLectureListItem) => void;
  attachMenuRef: (node: HTMLDivElement | null) => void;
};

const NoteRow = memo(function NoteRow({
  lecture,
  isMenuOpen,
  isBusy,
  onToggleMenu,
  onOpenRename,
  onOpenDelete,
  attachMenuRef,
}: NoteRowProps) {
  const router = useRouter();
  const sourceType = getEffectiveLectureSourceType(lecture);
  const lectureHref = `/app/lectures/${lecture.id}`;
  const dragRef = useRef<DashboardNoteDragState | null>(null);
  const suppressClickRef = useRef(false);
  const [dragState, setDragState] = useState<DashboardNoteDragState | null>(null);
  const [isOpening, setIsOpening] = useState(false);
  const noteOffset = dragState?.offset ?? (isMenuOpen ? -DASHBOARD_NOTE_ACTION_REVEAL_PX : 0);
  const isSwipeActive = Boolean(dragState || isMenuOpen || noteOffset < 0);

  useEffect(() => {
    router.prefetch(lectureHref);
  }, [lectureHref, router]);

  function handlePointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
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
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    const isHorizontalDrag =
      current.isDragging || (Math.abs(deltaX) > 8 && Math.abs(deltaX) > Math.abs(deltaY));

    if (!isHorizontalDrag) {
      return;
    }

    event.preventDefault();
    suppressClickRef.current = true;
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }

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

  function handlePointerEnd(event: ReactPointerEvent<HTMLElement>) {
    const current = dragRef.current;

    if (!current || current.pointerId !== event.pointerId) {
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
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
      <div ref={isMenuOpen ? attachMenuRef : undefined} className="dashboard-note-actions">
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
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
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
    previousProps.isBusy === nextProps.isBusy
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
  const [query, setQuery] = useState("");
  const [manualModal, setManualModal] = useState<NoteSourceMode | null>(null);
  const [isMobileCreateMenuOpen, setIsMobileCreateMenuOpen] = useState(false);
  const [mobileCreateMenuDragOffset, setMobileCreateMenuDragOffset] = useState(0);
  const [dashboardDialogDragOffset, setDashboardDialogDragOffset] = useState(0);
  const [libraryLectures, setLibraryLectures] = useState(lectures);
  const [busyLectureId, setBusyLectureId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFolderLectureIds, setSelectedFolderLectureIds] = useState<string[] | null>(null);
  const [openMenuLectureId, setOpenMenuLectureId] = useState<string | null>(null);
  const [renameTarget, setRenameTarget] = useState<AppLectureListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameInputFocused, setRenameInputFocused] = useState(false);
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
      if (!menuRef.current?.contains(event.target as Node)) {
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
    setOpenMenuLectureId(null);
    setDashboardActionError(null);
    setRenameTarget(lecture);
    setRenameValue(lecture.title?.trim() || "Neimenovan zapisek");
    setRenameInputFocused(false);
  }

  function closeRenameModal() {
    if (busyLectureId === renameTarget?.id) {
      return;
    }

    setRenameInputFocused(false);
    animateCloseDashboardDialog();
  }

  function openDeleteModal(lecture: AppLectureListItem) {
    setOpenMenuLectureId(null);
    setDashboardActionError(null);
    setRenameInputFocused(false);
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
              className={`mobile-create-menu dashboard-note-dialog dashboard-note-dialog-rename mobile-draggable-sheet ${
                renameInputFocused ? "keyboard-open" : ""
              }`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="rename-note-title"
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
                    autoFocus
                    value={renameValue}
                    onChange={(event) => setRenameValue(event.target.value)}
                    onFocus={() => setRenameInputFocused(true)}
                    onBlur={() => setRenameInputFocused(false)}
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
