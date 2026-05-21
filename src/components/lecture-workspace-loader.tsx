"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { LectureWorkspace } from "@/components/lecture-workspace";
import {
  readCachedLectureNoteDetail,
  writeCachedLectureNoteDetail,
} from "@/lib/lecture-note-cache";
import type { LectureDetail } from "@/lib/types";

type LectureWorkspaceLoaderProps = {
  lectureId: string;
  hasPaidAccess: boolean;
  trialLectureId: string | null;
  initialTrialChatMessagesRemaining: number;
};

export function LectureWorkspaceLoader({
  lectureId,
  hasPaidAccess,
  trialLectureId,
  initialTrialChatMessagesRemaining,
}: LectureWorkspaceLoaderProps) {
  const [detail, setDetail] = useState<LectureDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latestCachedRevisionRef = useRef<string | null>(null);
  const hasReceivedNetworkDetailRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void readCachedLectureNoteDetail(lectureId).then((cachedDetail) => {
      if (!cancelled && cachedDetail) {
        setDetail(cachedDetail);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [lectureId]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadNoteDetail() {
      try {
        const response = await fetch(`/api/lectures/${lectureId}?scope=notes`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as LectureDetail | { error?: unknown } | null;

        if (!response.ok) {
          const apiError = (payload as { error?: unknown } | null)?.error;
          setError(
            typeof apiError === "string"
              ? apiError
              : "Zapiska ni bilo mogoče naložiti.",
          );
          return;
        }

        const nextDetail = payload as LectureDetail;
        hasReceivedNetworkDetailRef.current = true;
        setDetail(nextDetail);
        setError(null);
        await writeCachedLectureNoteDetail(nextDetail);
      } catch {
        if (controller.signal.aborted) {
          return;
        }

        setError("Povezava je bila prekinjena. Poskusi znova.");
      }
    }

    void loadNoteDetail();

    return () => {
      controller.abort();
    };
  }, [lectureId]);

  const handleDetailChange = useCallback((nextDetail: LectureDetail) => {
    if (!hasReceivedNetworkDetailRef.current) {
      return;
    }

    const cacheRevision = [
      nextDetail.lecture.id,
      nextDetail.lecture.updated_at,
      nextDetail.editableNoteRevision,
      nextDetail.editableNoteDoc?.updatedAt ?? "",
      nextDetail.noteMedia
        .map((media) => `${media.id}:${media.created_at}:${media.signedUrl}`)
        .join("|"),
    ].join(":");

    if (latestCachedRevisionRef.current === cacheRevision) {
      return;
    }

    latestCachedRevisionRef.current = cacheRevision;
    void writeCachedLectureNoteDetail(nextDetail);
  }, []);

  if (detail) {
    return (
      <LectureWorkspace
        initialDetail={detail}
        initialDetailScope="notes"
        hasPaidAccess={hasPaidAccess}
        trialLectureId={trialLectureId}
        initialTrialChatMessagesRemaining={initialTrialChatMessagesRemaining}
        onDetailChange={handleDetailChange}
      />
    );
  }

  return (
    <main className="app-shell">
      <section className="ios-card lecture-notes-card">
        <p className="ios-row-title">{error ?? "Nalagam zapisek..."}</p>
      </section>
    </main>
  );
}
