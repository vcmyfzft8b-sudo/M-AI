"use client";

import { Loader2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useIsCreatorDemo } from "@/components/creator-demo/creator-demo-context";
import { EmojiIcon } from "@/components/emoji-icon";
import { useTranslations } from "@/components/i18n-provider";
import { Emoji, Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { useOfflineGuard } from "@/components/offline/offline-notice";
import { sheetClass, useSheet } from "@/components/use-sheet";
import type { AppLectureListItem, AppLibraryFolder } from "@/lib/types";
import { formatCalendarDate, formatClockTime } from "@/lib/utils";

type LibraryFolder = AppLibraryFolder;
type StoredLibraryFolder = Pick<AppLibraryFolder, "id" | "name" | "lectureIds">;

const LEGACY_FOLDERS_STORAGE_KEY = "nota-library-folders";
const FOLDERS_STORAGE_KEY_PREFIX = "nota-library-folders";
const SELECTED_FOLDER_STORAGE_KEY_PREFIX = "nota-selected-library-folder";

function getFoldersStorageKey(userId: string) {
  return `${FOLDERS_STORAGE_KEY_PREFIX}:${userId}`;
}

function getSelectedFolderStorageKey(userId: string) {
  return `${SELECTED_FOLDER_STORAGE_KEY_PREFIX}:${userId}`;
}

function parseStoredFolders(rawValue: string | null) {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((folder): folder is StoredLibraryFolder => {
      if (!folder || typeof folder !== "object") {
        return false;
      }

      const value = folder as Partial<StoredLibraryFolder>;
      return (
        typeof value.id === "string" &&
        typeof value.name === "string" &&
        Array.isArray(value.lectureIds) &&
        value.lectureIds.every((lectureId) => typeof lectureId === "string")
      );
    });
  } catch {
    return [];
  }
}

function readStoredFolders(userId: string) {
  if (typeof window === "undefined") {
    return [];
  }

  const userScopedKey = getFoldersStorageKey(userId);
  const userScopedFolders = parseStoredFolders(window.localStorage.getItem(userScopedKey));

  if (userScopedFolders.length > 0) {
    return userScopedFolders;
  }

  const legacyFolders = parseStoredFolders(window.localStorage.getItem(LEGACY_FOLDERS_STORAGE_KEY));

  if (legacyFolders.length > 0) {
    window.localStorage.setItem(userScopedKey, JSON.stringify(legacyFolders));
  }

  return legacyFolders;
}

function clearStoredFolders(userId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(getFoldersStorageKey(userId));
  window.localStorage.removeItem(LEGACY_FOLDERS_STORAGE_KEY);
}

function readStoredSelectedFolderId(userId: string) {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(getSelectedFolderStorageKey(userId));
  return typeof value === "string" && value.length > 0 ? value : null;
}

function writeStoredSelectedFolderId(userId: string, folderId: string | null) {
  if (typeof window === "undefined") {
    return;
  }

  const storageKey = getSelectedFolderStorageKey(userId);

  if (folderId) {
    window.localStorage.setItem(storageKey, folderId);
    return;
  }

  window.localStorage.removeItem(storageKey);
}

function toggleLectureId(currentIds: string[], lectureId: string) {
  return currentIds.includes(lectureId)
    ? currentIds.filter((id) => id !== lectureId)
    : [...currentIds, lectureId];
}



/** How long the design's sheet exit runs before the sheet may unmount. */

export function LibraryFolderMenu({
  lectures,
  userId,
  initialFolders,
  selectedFolderId,
  onSelectFolder,
}: {
  lectures: AppLectureListItem[];
  userId: string;
  initialFolders: AppLibraryFolder[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null, lectureIds: string[] | null) => void;
}) {
  const { locale, t } = useTranslations();
  const isCreatorDemo = useIsCreatorDemo();
  /*
   * Folders live on the account, so every one of these writes is a request.
   * Each handler below returns silently when the server refuses, which offline
   * would mean a button that quietly does nothing — the guard says why instead.
   */
  const { blockedOffline, offlineToast } = useOfflineGuard();
  const shellRef = useRef<HTMLDivElement | null>(null);

  /**
   * "31. 8. 2026 ob 14:05", with the word between the two parts coming from the
   * catalogue rather than from `Intl`, which has no opinion about it.
   */
  const formatCreatedAt = useCallback(
    (isoString: string) =>
      t("date.dateAtTime", {
        date: formatCalendarDate(isoString, locale),
        time: formatClockTime(isoString, locale),
      }),
    [locale, t],
  );
  const hasRestoredSelectionRef = useRef(false);
  const hasMigratedLocalFoldersRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [folders, setFolders] = useState<LibraryFolder[]>(initialFolders);
  const [folderName, setFolderName] = useState("");
  const [draftLectureIds, setDraftLectureIds] = useState<string[]>([]);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  /** The folder whose ••• action sheet is open, as the phone design draws it. */
  const [folderActionTarget, setFolderActionTarget] = useState<LibraryFolder | null>(null);
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<LibraryFolder | null>(null);
  /** True while a sheet plays the design's exit, just before it unmounts. */
  const closeFolderActions = useCallback(() => setFolderActionTarget(null), []);
  const folderActionSheet = useSheet(closeFolderActions);
  const [editingName, setEditingName] = useState("");
  const [editingLectureIds, setEditingLectureIds] = useState<string[]>([]);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isSavingFolder, setIsSavingFolder] = useState(false);
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null);
  const folderDeleteSheet = useSheet(
    useCallback(() => setFolderDeleteTarget(null), []),
    { locked: Boolean(deletingFolderId) },
  );
  const lectureIdSet = useMemo(
    () => new Set(lectures.map((lecture) => lecture.id)),
    [lectures],
  );
  const liveFolders = useMemo(
    () =>
      folders.map((folder) => ({
        ...folder,
        lectureIds: folder.lectureIds.filter((lectureId) => lectureIdSet.has(lectureId)),
      })),
    [folders, lectureIdSet],
  );

  const selectedFolder = liveFolders.find((folder) => folder.id === selectedFolderId) ?? null;
  const isEditModalOpen = editingFolderId !== null;
  const isFolderEditBusy = isSavingFolder || deletingFolderId !== null;

  useEffect(() => {
    setFolders(initialFolders);
  }, [initialFolders]);

  const resetEditModal = useCallback(() => {
    setEditingFolderId(null);
    setEditingName("");
    setEditingLectureIds([]);
    setIsSavingFolder(false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    if (isFolderEditBusy) {
      return;
    }

    resetEditModal();
  }, [isFolderEditBusy, resetEditModal]);

  const closeCreateModal = useCallback(() => {
    if (isCreatingFolder) {
      return;
    }

    setIsCreateModalOpen(false);
  }, [isCreatingFolder]);

  const closeFolderSheet = useCallback(() => {
    setIsOpen(false);
  }, []);

  /*
   * The picker, the "new folder" modal and the folder editor are one sheet each
   * on the phone, and all three leave the way the design leaves a sheet: the
   * drag carries straight into the exit rather than springing back first.
   */
  const folderSheet = useSheet(closeFolderSheet);
  const createModalSheet = useSheet(closeCreateModal, { locked: isCreatingFolder });
  const editModalSheet = useSheet(resetEditModal, { locked: isFolderEditBusy });

  const dismissFolderSheet = folderSheet.dismiss;
  const dismissCreateModal = createModalSheet.dismiss;
  const dismissEditModal = editModalSheet.dismiss;

  // Wrapped rather than passed straight to `onClick`, which would hand the
  // click event to `dismiss` as its "run after closing" callback.
  const animateCloseFolderSheet = useCallback(() => {
    dismissFolderSheet();
  }, [dismissFolderSheet]);

  const animateCloseCreateModal = useCallback(() => {
    dismissCreateModal();
  }, [dismissCreateModal]);

  const animateCancelEdit = useCallback(() => {
    dismissEditModal();
  }, [dismissEditModal]);

  useEffect(() => {
    if (hasRestoredSelectionRef.current) {
      return;
    }

    hasRestoredSelectionRef.current = true;

    const storedFolderId = readStoredSelectedFolderId(userId);

    if (!storedFolderId) {
      onSelectFolder(null, null);
      return;
    }

    const storedFolder = liveFolders.find((folder) => folder.id === storedFolderId);

    if (!storedFolder) {
      const storedLocalFolders = readStoredFolders(userId);

      if (storedLocalFolders.some((folder) => folder.id === storedFolderId)) {
        return;
      }

      writeStoredSelectedFolderId(userId, null);
      onSelectFolder(null, null);
      return;
    }

    onSelectFolder(storedFolder.id, storedFolder.lectureIds);
  }, [liveFolders, onSelectFolder, userId]);

  useEffect(() => {
    if (!hasRestoredSelectionRef.current) {
      return;
    }

    writeStoredSelectedFolderId(userId, selectedFolderId);
  }, [selectedFolderId, userId]);

  useEffect(() => {
    if (!isOpen && !isCreateModalOpen && !isEditModalOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (isCreateModalOpen || isEditModalOpen) {
        return;
      }

      const target = event.target;

      /*
       * Every phone sheet — and the scrim behind it — lives in a portal and
       * closes itself through `dismiss`, so the exit gets to play. Closing
       * here as well would unmount the sheet on the same mousedown, before
       * the scrim's own click ever ran, and the folders sheet would vanish
       * without the drop the rest of them do.
       */
      if (target instanceof Element && target.closest(".memo-portal")) {
        return;
      }

      if (!shellRef.current?.contains(target as Node)) {
        animateCloseFolderSheet();
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        animateCloseFolderSheet();
        animateCloseCreateModal();
        animateCancelEdit();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [
    animateCancelEdit,
    animateCloseCreateModal,
    animateCloseFolderSheet,
    isCreateModalOpen,
    isEditModalOpen,
    isOpen,
  ]);

  useEffect(() => {
    if (!selectedFolderId) {
      return;
    }

    const nextSelectedFolder = liveFolders.find((folder) => folder.id === selectedFolderId);

    if (!nextSelectedFolder) {
      writeStoredSelectedFolderId(userId, null);
      onSelectFolder(null, null);
    }
  }, [liveFolders, onSelectFolder, selectedFolderId, userId]);

  useEffect(() => {
    // The creator demo runs under a synthetic user id. Migrating there would
    // pull the visitor's own un-migrated legacy folders into the demo library
    // and then delete them locally, so it must never run.
    if (isCreatorDemo || hasMigratedLocalFoldersRef.current) {
      return;
    }

    hasMigratedLocalFoldersRef.current = true;

    const storedFolders = readStoredFolders(userId);

    if (storedFolders.length === 0) {
      clearStoredFolders(userId);
      return;
    }

    const storedFolderId = readStoredSelectedFolderId(userId);
    const storedSelectedFolder = storedFolders.find((folder) => folder.id === storedFolderId) ?? null;
    const foldersToImport = storedFolders
      .map((folder) => ({
        name: folder.name,
        lectureIds: folder.lectureIds.filter((lectureId) => lectureIdSet.has(lectureId)),
      }))
      .filter((folder) => folder.name.trim().length > 0);

    if (foldersToImport.length === 0) {
      clearStoredFolders(userId);
      return;
    }

    void fetch("/api/library-folders", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ folders: foldersToImport }),
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Folder migration failed.");
        }

        return (await response.json()) as { folders: AppLibraryFolder[] };
      })
      .then((payload) => {
        setFolders(payload.folders);
        clearStoredFolders(userId);

        if (!storedSelectedFolder) {
          if (storedFolderId) {
            writeStoredSelectedFolderId(userId, null);
          }
          return;
        }

        const migratedSelectedFolder =
          payload.folders.find((folder) => folder.name === storedSelectedFolder.name) ?? null;

        if (migratedSelectedFolder) {
          const nextLectureIds = migratedSelectedFolder.lectureIds.filter((lectureId) =>
            lectureIdSet.has(lectureId),
          );
          onSelectFolder(migratedSelectedFolder.id, nextLectureIds);
          return;
        }

        writeStoredSelectedFolderId(userId, null);
      })
      .catch(() => {
        hasMigratedLocalFoldersRef.current = false;
      });
  }, [isCreatorDemo, lectureIdSet, onSelectFolder, userId]);

  function handleToggleMenu() {
    setIsOpen((currentValue) => !currentValue);
  }


  /*
   * Picking a folder leaves the sheet the same way the X and the scrim do:
   * the list behind it changes at once, and the sheet drops out of frame over
   * it rather than blinking away.
   */
  function handleSelectAllNotes() {
    onSelectFolder(null, null);
    animateCloseFolderSheet();
  }

  function handleSelectFolder(folder: LibraryFolder) {
    onSelectFolder(folder.id, folder.lectureIds);
    animateCloseFolderSheet();
  }

  async function handleCreateFolder() {
    const trimmedName = folderName.trim();

    if (!trimmedName || isCreatingFolder || blockedOffline("edit")) {
      return;
    }

    setIsCreatingFolder(true);

    try {
      const response = await fetch("/api/library-folders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          lectureIds: draftLectureIds.filter((lectureId) => lectureIdSet.has(lectureId)),
        }),
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { folder: AppLibraryFolder };
      const nextFolder = payload.folder;
      const nextFolders = [...folders, nextFolder];

      setFolders(nextFolders);
      onSelectFolder(nextFolder.id, nextFolder.lectureIds);
      setFolderName("");
      setDraftLectureIds([]);
      setIsCreateModalOpen(false);
      setIsOpen(false);
    } finally {
      setIsCreatingFolder(false);
    }
  }

  function startEditingFolder(folder: LibraryFolder) {
    if (isFolderEditBusy) {
      return;
    }

    // The picker gives way to the editor rather than sitting behind it — two
    // stacked sheets read as one broken one.
    setIsOpen(false);

    setEditingFolderId(folder.id);
    setEditingName(folder.name);
    setEditingLectureIds(folder.lectureIds);
  }

  async function handleSaveFolder() {
    if (!editingFolderId || isFolderEditBusy || blockedOffline("edit")) {
      return;
    }

    const trimmedName = editingName.trim();

    if (!trimmedName) {
      return;
    }

    setIsSavingFolder(true);

    try {
      const response = await fetch(`/api/library-folders/${editingFolderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          lectureIds: editingLectureIds.filter((lectureId) => lectureIdSet.has(lectureId)),
        }),
      });

      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as { folder: AppLibraryFolder };
      const nextFolders = folders.map((folder) =>
        folder.id === editingFolderId ? payload.folder : folder,
      );

      setFolders(nextFolders);

      if (selectedFolderId === editingFolderId) {
        const nextSelectedFolder = nextFolders.find((folder) => folder.id === editingFolderId);
        onSelectFolder(nextSelectedFolder?.id ?? null, nextSelectedFolder?.lectureIds ?? null);
      }

      resetEditModal();
      setIsOpen(false);
    } finally {
      setIsSavingFolder(false);
    }
  }

  async function handleDeleteFolder(folderId: string) {
    if (isFolderEditBusy || blockedOffline("edit")) {
      return;
    }

    setDeletingFolderId(folderId);

    try {
      const response = await fetch(`/api/library-folders/${folderId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        return;
      }

      const nextFolders = folders.filter((folder) => folder.id !== folderId);
      setFolders(nextFolders);
      // The confirm sheet is what asked; it leaves once the folder is gone.
      setFolderDeleteTarget(null);

      if (selectedFolderId === folderId) {
        onSelectFolder(null, null);
      }

      if (editingFolderId === folderId) {
        setEditingFolderId(null);
        setEditingName("");
        setEditingLectureIds([]);
        setIsOpen(false);
      }
    } finally {
      setDeletingFolderId(null);
    }
  }

  function handleOpenEditModal() {
    if (liveFolders.length === 0) {
      return;
    }

    startEditingFolder(selectedFolder ?? liveFolders[0]);
  }

  /**
   * The folder list, as the redesign draws it: flat rows on the menu's own
   * surface, a filled check on the selected one, then a rule and the two
   * management actions. The counts production showed under each name are gone —
   * the design puts the name on a single line.
   */
  function renderFolderMenuOptions() {
    const options = [
      { id: null as string | null, name: t("folders.allNotes"), onSelect: handleSelectAllNotes },
      ...liveFolders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        onSelect: () => handleSelectFolder(folder),
      })),
    ];

    return (
      <>
        {options.map((option) => (
          <button
            key={option.id ?? "all"}
            type="button"
            className="memo-menu-item"
            onClick={option.onSelect}
          >
            <Emoji symbol="📁" size="1.05rem" />
            <span className="memo-menu-item-label">{option.name}</span>
            {selectedFolderId === option.id ? (
              <span className="memo-menu-check">
                <Msym name="check" size="0.9rem" />
              </span>
            ) : null}
          </button>
        ))}

        <div className="memo-menu-sep" />

        <button
          type="button"
          className="memo-menu-item"
          onClick={() => {
            setFolderName("");
            setDraftLectureIds([]);
            setIsCreateModalOpen(true);
          }}
        >
          <Msym name="add" size="1.2rem" fill={false} weight={500} />
          <span className="memo-menu-item-label">{t("folders.new")}</span>
        </button>

        <button type="button" className="memo-menu-item" onClick={handleOpenEditModal}>
          <Msym name="edit" size="1.15rem" weight={500} />
          <span className="memo-menu-item-label">{t("folders.edit")}</span>
        </button>
      </>
    );
  }

  return (
    <div className="library-folder-shell" ref={shellRef}>
      {/* Desktop chip: 📁 · name · caret, as the redesign draws it. */}
      <button
        type="button"
        className="memo-folder-chip memo-only-desktop"
        onClick={handleToggleMenu}
        aria-expanded={isOpen}
      >
        <Emoji symbol="📁" size="1.2rem" />
        <span className="memo-folder-chip-label">
          {selectedFolder?.name ?? t("folders.allNotes")}
        </span>
        <Msym name="arrow_drop_down" size="1.2rem" />
      </button>

      {/* Phone chip: shorter, with the expand caret the sheet opens from. */}
      <button
        type="button"
        className="memo-m-folder-chip memo-only-mobile"
        onClick={handleToggleMenu}
        aria-expanded={isOpen}
      >
        <Emoji symbol="📁" size="1.1rem" />
        <span>{selectedFolder?.name ?? t("folders.allNotes")}</span>
        <Msym name="expand_more" size="1.2rem" fill={false} weight={500} />
      </button>

      {isOpen ? (
        <>
          <div className="memo-menu memo-only-desktop">{renderFolderMenuOptions()}</div>
          <MemoPortal>
            <div
              className={sheetClass("library-folder-mobile-sheet-backdrop", folderSheet.closing)}
              role="presentation"
              onClick={animateCloseFolderSheet}
            />
            <section
              className={sheetClass("library-folder-mobile-sheet", folderSheet.closing)}
              role="dialog"
              aria-modal="true"
              aria-labelledby="folders-sheet-title"
              {...folderSheet.dragProps}
            >
              <button
                type="button"
                className="mobile-sheet-drag-handle library-folder-mobile-sheet-handle"
                aria-label={t("folders.dragToCloseList")}
                data-drag-handle
              />
              <div className="library-folder-mobile-sheet-header">
                <h2 id="folders-sheet-title" className="library-folder-mobile-sheet-title">
                  {t("folders.title")}
                </h2>
                <button
                  type="button"
                  className="app-close-button library-folder-mobile-sheet-close"
                  onClick={animateCloseFolderSheet}
                  aria-label={t("folders.closeList")}
                >
                  <Msym name="close" size="1.45rem" fill={false} weight={500} />
                </button>
              </div>
              {/* The phone design groups the folders into one card with hairline
                  dividers and puts the per-folder menu at the end of each row,
                  rather than the desktop dropdown's flat list. */}
              <div className="library-folder-mobile-sheet-body">
                <div className="memo-folder-card">
                  <div className="memo-folder-row">
                    <button
                      type="button"
                      className="memo-folder-row-main"
                      onClick={handleSelectAllNotes}
                    >
                      <Emoji symbol="📁" size="1.2rem" />
                      <span className="memo-folder-row-label">{t("folders.allNotes")}</span>
                      {selectedFolderId === null ? (
                        <Msym name="check" size="1.35rem" fill={false} weight={500} />
                      ) : null}
                    </button>
                  </div>

                  {liveFolders.map((folder) => (
                    <div key={folder.id} className="memo-folder-row">
                      <button
                        type="button"
                        className="memo-folder-row-main"
                        onClick={() => handleSelectFolder(folder)}
                      >
                        <Emoji symbol="📁" size="1.2rem" />
                        <span className="memo-folder-row-label">{folder.name}</span>
                        {selectedFolderId === folder.id ? (
                          <Msym name="check" size="1.35rem" fill={false} weight={500} />
                        ) : null}
                      </button>
                      <button
                        type="button"
                        className="memo-folder-row-menu"
                        onClick={() => {
                          setIsOpen(false);
                          setFolderActionTarget(folder);
                        }}
                        aria-label={t("folders.options", { name: folder.name })}
                      >
                        <Msym name="more_horiz" size="1.5rem" fill={false} weight={500} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="memo-folder-sheet-cta">
                  <button
                    type="button"
                    className="memo-new-folder-cta"
                    onClick={() => {
                      setIsOpen(false);
                      setFolderName("");
                      setDraftLectureIds([]);
                      setIsCreateModalOpen(true);
                    }}
                  >
                    {t("folders.new")}
                  </button>
                </div>
              </div>
            </section>
          </MemoPortal>
        </>
      ) : null}

      {isCreateModalOpen ? (
        <MemoPortal>
          <div
            className={sheetClass("library-folder-modal-overlay", createModalSheet.closing)}
            role="presentation"
            onClick={animateCloseCreateModal}
          >
            <div
              className={sheetClass(
                "library-folder-modal mobile-draggable-sheet",
                createModalSheet.closing,
              )}
              role="dialog"
              aria-modal="true"
              aria-labelledby="new-folder-title"
              onClick={(event) => event.stopPropagation()}
              {...createModalSheet.dragProps}
            >
              <button
                type="button"
                className="mobile-sheet-drag-handle library-folder-modal-drag-handle"
                aria-label={t("folders.dragToClose")}
                data-drag-handle
              />
              <button
                type="button"
                className="app-close-button library-folder-modal-close memo-only-desktop"
                onClick={animateCloseCreateModal}
                aria-label={t("folders.closeNew")}
              >
                <EmojiIcon symbol="✖️" size="1rem" />
              </button>

              <div className="library-folder-modal-header">
                <h3 id="new-folder-title" className="library-folder-modal-title">
                  {t("folders.new")}
                </h3>
                {/* The phone confirms from the header; desktop keeps its
                    footer button. */}
                <button
                  type="button"
                  className="memo-folder-done memo-only-mobile flex"
                  onClick={handleCreateFolder}
                  disabled={isCreatingFolder || folderName.trim().length === 0}
                  aria-busy={isCreatingFolder}
                >
                  {t("common.done")}
                </button>
              </div>

              <div className="library-folder-modal-icon-row">
                <div className="library-folder-modal-icon">
                  <Emoji symbol="📁" size="2.6rem" />
                </div>
              </div>

              <div className="library-folder-modal-body">
                <label className="library-folder-modal-field">
                  <span className="memo-only-desktop">{t("folders.name")}</span>
                  <input
                    value={folderName}
                    onChange={(event) => setFolderName(event.target.value)}
                    placeholder={t("folders.nameExamples")}
                    className="ios-input"
                    aria-label={t("folders.nameLabel")}
                    maxLength={32}
                    disabled={isCreatingFolder}
                  />
                </label>

                {/* The phone creates the folder empty and says so; notes are
                    moved in from the folder's own editor afterwards. */}
                <div className="library-folder-modal-field memo-only-desktop">
                  <span>{t("folders.addLectures")}</span>
                  <div className="library-folder-lecture-picker modal">
                    {lectures.length > 0 ? (
                      lectures.map((lecture) => (
                        <label key={lecture.id} className="library-folder-lecture-option">
                          <input
                            type="checkbox"
                            checked={draftLectureIds.includes(lecture.id)}
                            disabled={isCreatingFolder}
                            onChange={() =>
                              setDraftLectureIds((currentIds) =>
                                toggleLectureId(currentIds, lecture.id),
                              )
                            }
                          />
                          <span>
                            <span className="library-folder-lecture-title">
                              {lecture.title ?? t("note.untitled")}
                            </span>
                            <span className="library-folder-lecture-meta">
                              {formatCreatedAt(lecture.created_at)}
                            </span>
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="library-folder-empty">
                        {t("folders.emptyLectures")}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <p className="memo-folder-hint memo-only-mobile">
                {t("folders.hintMobile")}
              </p>

              <button
                type="button"
                className="library-folder-primary-button modal memo-only-desktop"
                onClick={handleCreateFolder}
                disabled={isCreatingFolder || folderName.trim().length === 0}
                aria-busy={isCreatingFolder}
              >
                {isCreatingFolder ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {isCreatingFolder ? t("folders.creating") : t("folders.create")}
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      {folderActionTarget ? (
        <MemoPortal>
          <div
            className={sheetClass(
              "library-folder-mobile-sheet-backdrop",
              folderActionSheet.closing,
            )}
            role="presentation"
            onClick={() => folderActionSheet.dismiss()}
          />
          <section
            className={sheetClass("memo-action-sheet", folderActionSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-label={t("folders.options", { name: folderActionTarget.name })}
            {...folderActionSheet.dragProps}
          >
            <span className="mobile-sheet-drag-handle" data-drag-handle="true" />
            <p className="memo-action-sheet-target">{folderActionTarget.name}</p>

            <div className="memo-action-sheet-list">
              <button
                type="button"
                className="memo-action-sheet-item"
                onClick={() => {
                  const folder = folderActionTarget;
                  setFolderActionTarget(null);
                  startEditingFolder(folder);
                }}
              >
                <Msym name="drive_file_rename_outline" size="1.4rem" fill={false} weight={500} />
                {t("folders.rename")}
              </button>

              <button
                type="button"
                className="memo-action-sheet-item danger"
                disabled={deletingFolderId === folderActionTarget.id}
                onClick={() => {
                  const folder = folderActionTarget;
                  setFolderActionTarget(null);
                  setFolderDeleteTarget(folder);
                }}
              >
                <Msym name="folder_delete" size="1.4rem" fill={false} weight={500} />
                {t("folders.delete")}
              </button>

              <button
                type="button"
                className="memo-action-sheet-cancel"
                onClick={() => {
                  setFolderActionTarget(null);
                  setIsOpen(true);
                }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </section>
        </MemoPortal>
      ) : null}

      {folderDeleteTarget ? (
        <MemoPortal>
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim", folderDeleteSheet.closing)}
            onClick={() => folderDeleteSheet.dismiss()}
          />
          <div
            className={sheetClass("memo-sheet memo-folder-delete-sheet", folderDeleteSheet.closing)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-delete-title"
            {...folderDeleteSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <span id="folder-delete-title" className="memo-folder-delete-title">
              {t("folders.delete")}
            </span>
            <p className="memo-folder-delete-copy">
              {t("folders.deleteBody", { name: folderDeleteTarget.name })}
            </p>
            <div className="memo-folder-delete-actions">
              <button
                type="button"
                className="memo-folder-delete-go"
                disabled={Boolean(deletingFolderId)}
                onClick={() => {
                  const folderId = folderDeleteTarget.id;
                  void handleDeleteFolder(folderId);
                }}
              >
                {deletingFolderId ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {t("folders.delete")}
              </button>
              <button
                type="button"
                className="memo-folder-delete-cancel"
                disabled={Boolean(deletingFolderId)}
                onClick={() => folderDeleteSheet.dismiss(() => setIsOpen(true))}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      {isEditModalOpen ? (
        <MemoPortal>
          {/*
            * The phone renames on its own sheet — title, a done button, one field —
            * as the artboard draws it. The editor below, with its folder
            * picker and its three stacked buttons, is desktop's.
            */}
          <button
            type="button"
            aria-label={t("common.close")}
            className={sheetClass("memo-scrim memo-only-mobile", editModalSheet.closing)}
            onClick={animateCancelEdit}
          />
          <div
            className={sheetClass(
              "memo-sheet memo-folder-name-sheet memo-only-mobile",
              editModalSheet.closing,
            )}
            role="dialog"
            aria-modal="true"
            aria-label={t("folders.rename")}
            {...editModalSheet.dragProps}
          >
            <div className="memo-grab" data-drag-handle />
            <div className="memo-folder-name-head">
              <span className="memo-folder-name-title">{t("common.rename")}</span>
              <button
                type="button"
                className="memo-folder-done"
                onClick={() => void handleSaveFolder()}
                disabled={isFolderEditBusy || editingName.trim().length === 0}
                aria-busy={isSavingFolder}
              >
                {t("common.done")}
              </button>
            </div>
            <input
              className="memo-folder-name-field"
              value={editingName}
              onChange={(event) => setEditingName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") {
                  return;
                }

                event.preventDefault();
                event.currentTarget.blur();
                void handleSaveFolder();
              }}
              placeholder={t("folders.nameLabel")}
              enterKeyHint="done"
              autoCapitalize="sentences"
              autoCorrect="off"
              autoComplete="off"
              maxLength={32}
              aria-label={t("folders.nameLabel")}
              disabled={isFolderEditBusy}
            />
          </div>

          <div
            className={sheetClass(
              "library-folder-modal-overlay memo-only-desktop",
              editModalSheet.closing,
            )}
            role="presentation"
            onClick={animateCancelEdit}
          >
            <div
              className={sheetClass(
                "library-folder-modal mobile-draggable-sheet",
                editModalSheet.closing,
              )}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-folder-title"
              onClick={(event) => event.stopPropagation()}
              {...editModalSheet.dragProps}
            >
            <button
              type="button"
              className="mobile-sheet-drag-handle library-folder-modal-drag-handle"
              aria-label={t("folders.dragToClose")}
              data-drag-handle
            />
            <button
              type="button"
              className="app-close-button library-folder-modal-close"
              onClick={animateCancelEdit}
              aria-label={t("folders.closeEditor")}
            >
              <EmojiIcon symbol="✖️" size="1rem" />
            </button>

            <div className="library-folder-modal-header">
              <h3 id="edit-folder-title" className="library-folder-modal-title">
                {t("folders.editOne")}
              </h3>
            </div>

            <div className="library-folder-modal-icon-row">
              <div className="library-folder-modal-icon">
                <Emoji symbol="📁" size="2.6rem" />
              </div>
            </div>

            <div className="library-folder-modal-body">
              {liveFolders.length > 1 ? (
                <div className="library-folder-modal-field">
                  <span>{t("folders.choose")}</span>
                  <div className="library-folder-modal-folder-list">
                    {liveFolders.map((folder) => (
                      <button
                        type="button"
                        key={folder.id}
                        className={`library-folder-modal-folder-option ${editingFolderId === folder.id ? "active" : ""}`}
                        onClick={() => startEditingFolder(folder)}
                        disabled={isFolderEditBusy}
                      >
                        <span>
                          <span className="library-folder-saved-title">{folder.name}</span>
                          <span className="library-folder-saved-meta">
                            {t("folders.lectureCount", { count: folder.lectureIds.length })}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <label className="library-folder-modal-field">
                <span>{t("folders.name")}</span>
                <input
                  value={editingName}
                  onChange={(event) => setEditingName(event.target.value)}
                  className="ios-input"
                  disabled={isFolderEditBusy}
                />
              </label>

              <div className="library-folder-modal-field">
                <span>{t("folders.addLectures")}</span>
                <div className="library-folder-lecture-picker modal">
                  {lectures.length > 0 ? (
                    lectures.map((lecture) => (
                      <label key={lecture.id} className="library-folder-lecture-option">
                        <input
                          type="checkbox"
                          checked={editingLectureIds.includes(lecture.id)}
                          disabled={isFolderEditBusy}
                          onChange={() =>
                            setEditingLectureIds((currentIds) =>
                              toggleLectureId(currentIds, lecture.id),
                            )
                          }
                        />
                        <span>
                          <span className="library-folder-lecture-title">
                            {lecture.title ?? t("note.untitled")}
                          </span>
                          <span className="library-folder-lecture-meta">
                            {formatCreatedAt(lecture.created_at)}
                          </span>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="library-folder-empty">
                      {t("folders.emptyLectures")}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="library-folder-modal-actions">
              <button
                type="button"
                className="library-folder-primary-button modal"
                onClick={handleSaveFolder}
                disabled={isFolderEditBusy || editingName.trim().length === 0}
                aria-busy={isSavingFolder}
              >
                {isSavingFolder ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                {isSavingFolder ? t("folders.saving") : t("folders.saveChanges")}
              </button>
              <button
                type="button"
                className="library-folder-secondary-button"
                onClick={handleCancelEdit}
                disabled={isFolderEditBusy}
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                className="library-folder-danger-button"
                onClick={() => {
                  if (editingFolderId) {
                    void handleDeleteFolder(editingFolderId);
                  }
                }}
                disabled={isFolderEditBusy}
                aria-busy={deletingFolderId === editingFolderId}
              >
                {deletingFolderId === editingFolderId ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Msym name="delete" size="1.15rem" fill={false} weight={500} />
                )}
                {deletingFolderId === editingFolderId ? t("folders.deleting") : t("folders.delete")}
              </button>
            </div>
            </div>
          </div>
        </MemoPortal>
      ) : null}

      {offlineToast}
    </div>
  );
}
