"use client";

/**
 * Keeps the offline copy in step with what the server just rendered.
 *
 * Mounted by the real `/app` pages, never by the offline shell — the shell
 * renders *from* this copy, and writing it back would only re-date it and push
 * a note that was genuinely opened more recently out of the cache.
 *
 * Writing on render rather than on an interval is deliberate: what is cached is
 * exactly what the reader has actually seen, so the offline library can never
 * show a note that was never opened, nor a title that was renamed since.
 */
import { useEffect } from "react";

import { useOffline } from "@/components/offline/offline-provider";
import { saveOfflineHome, saveOfflineLecture } from "@/lib/offline/snapshot";
import type { AppLectureListItem, AppLibraryFolder, LectureDetail } from "@/lib/types";

export function OfflineHomeCapture({
  userId,
  lectures,
  folders,
  hasPaidAccess,
  trialLectureId,
}: {
  userId: string;
  lectures: AppLectureListItem[];
  folders: AppLibraryFolder[];
  hasPaidAccess: boolean;
  trialLectureId: string | null;
}) {
  const { isShell } = useOffline();

  useEffect(() => {
    if (isShell) {
      return;
    }

    void saveOfflineHome({ userId, lectures, folders, hasPaidAccess, trialLectureId });
  }, [folders, hasPaidAccess, isShell, lectures, trialLectureId, userId]);

  return null;
}

export function OfflineLectureCapture({
  userId,
  detail,
  hasPaidAccess,
  trialLectureId,
}: {
  userId: string;
  detail: LectureDetail;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
}) {
  const { isShell } = useOffline();

  useEffect(() => {
    if (isShell) {
      return;
    }

    /*
     * Only a finished note. One still being transcribed or written would be
     * cached as a progress screen that can never progress, and the reader would
     * be looking at a spinner with no connection behind it.
     */
    if (detail.lecture.status !== "ready") {
      return;
    }

    void saveOfflineLecture({ userId, detail, hasPaidAccess, trialLectureId });
  }, [detail, hasPaidAccess, isShell, trialLectureId, userId]);

  return null;
}
