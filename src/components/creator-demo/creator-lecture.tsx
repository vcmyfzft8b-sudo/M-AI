"use client";

import { useEffect, useState } from "react";

import { useCreatorDemoDetail } from "@/components/creator-demo/creator-demo-provider";
import { useT } from "@/components/i18n-provider";
import { EmojiIcon } from "@/components/emoji-icon";
import { InstantLink } from "@/components/instant-link";
import { LectureWorkspaceLoading } from "@/components/lecture-loading";
import { LectureWorkspace } from "@/components/lecture-workspace";
import type { LectureDetail } from "@/lib/types";

/** How long to keep showing the skeleton before calling the note missing. */
const RESOLVE_TIMEOUT_MS = 2500;

export function CreatorLecture({
  lectureId,
  initialDetail,
}: {
  lectureId: string;
  initialDetail: LectureDetail | null;
}) {
  const t = useT();
  const detail = useCreatorDemoDetail(lectureId, initialDetail);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (detail) {
      return;
    }

    const timeoutId = window.setTimeout(() => setTimedOut(true), RESOLVE_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutId);
  }, [detail]);

  if (!detail) {
    if (!timedOut) {
      return <LectureWorkspaceLoading />;
    }

    return (
      <main className="home-dashboard pb-8">
        <section className="dashboard-section">
          <div className="empty-state app-empty-state">
            <div className="app-empty-state-icon">
              <EmojiIcon symbol="📝" size="1.25rem" />
            </div>
            <p className="ios-row-title">{t("creatorDemo.missingTitle")}</p>
            <p className="ios-row-subtitle mt-2">
              {t("creatorDemo.missingBody")}
            </p>
            <InstantLink href="/app" className="app-home-highlight-link">
              <span>{t("creatorDemo.backToNotes")}</span>
              <EmojiIcon symbol="›" size="1.1rem" />
            </InstantLink>
          </div>
        </section>
      </main>
    );
  }

  return (
    <LectureWorkspace
      key={lectureId}
      initialDetail={detail}
      hasPaidAccess
      trialLectureId={null}
      initialTrialChatMessagesRemaining={5}
    />
  );
}
