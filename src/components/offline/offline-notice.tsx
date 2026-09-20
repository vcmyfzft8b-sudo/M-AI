"use client";

/**
 * What the app says when something needs a connection it does not have.
 *
 * Every one of these is built out of the app's own shapes — `memo-study-empty`
 * is the same orb/title/copy/pill the mind map and the practice test use for
 * their own absences, and `memo-toast` is the app's toast — so an offline
 * screen reads as part of the product rather than as a browser error. The whole
 * point is that the reader never sees "Load failed", and never taps something
 * that quietly does nothing.
 */
import { useCallback, useEffect, useState } from "react";

import { useT } from "@/components/i18n-provider";
import { Msym } from "@/components/msym";
import { MemoPortal } from "@/components/memo-portal";
import { useOffline } from "@/components/offline/offline-provider";
import type { MessageKey } from "@/lib/i18n/messages/keys";

/** The note tabs and actions that cannot be answered from a cached copy. */
export type OfflineFeature =
  | "chat"
  | "tutor"
  | "podcast"
  | "readAloud"
  | "generate"
  | "create"
  | "edit"
  | "audio";

const FEATURE_TITLES: Record<OfflineFeature, MessageKey> = {
  chat: "offline.feature.chat.title",
  tutor: "offline.feature.tutor.title",
  podcast: "offline.feature.podcast.title",
  readAloud: "offline.feature.readAloud.title",
  generate: "offline.feature.generate.title",
  create: "offline.feature.create.title",
  edit: "offline.feature.edit.title",
  audio: "offline.feature.audio.title",
};

const FEATURE_BODIES: Record<OfflineFeature, MessageKey> = {
  chat: "offline.feature.chat.body",
  tutor: "offline.feature.tutor.body",
  podcast: "offline.feature.podcast.body",
  readAloud: "offline.feature.readAloud.body",
  generate: "offline.feature.generate.body",
  create: "offline.feature.create.body",
  edit: "offline.feature.edit.body",
  audio: "offline.feature.audio.body",
};

/**
 * What a tab says when what it holds is made on request rather than stored —
 * the walkthrough, the episode, a map that has never been drawn.
 *
 * Deliberately not the app's big empty state. Those announce an absence worth
 * acting on ("make the cards", "draw the map"); this announces a condition the
 * reader already knows they are in, on a screen they reached by accident, and
 * the right size for that is small. A muted glyph, a line, and a quiet way to
 * look again — nothing that competes with the note they came to read.
 */
export function OfflineFeatureNotice({ feature }: { feature: OfflineFeature }) {
  const t = useT();
  const { recheck } = useOffline();
  const [checking, setChecking] = useState(false);

  return (
    <div className="memo-offline-note" role="status">
      <span className="memo-offline-note-icon" aria-hidden="true">
        <Msym name="wifi_off" size="1.2rem" fill={false} weight={500} />
      </span>
      <p className="memo-offline-note-title">{t(FEATURE_TITLES[feature])}</p>
      <p className="memo-offline-note-copy">{t(FEATURE_BODIES[feature])}</p>
      <button
        type="button"
        className="memo-offline-note-action"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          void recheck().finally(() => setChecking(false));
        }}
      >
        {t(checking ? "offline.checking" : "offline.checkAgain")}
      </button>
    </div>
  );
}

/**
 * The nudge for a control that is on screen but cannot act — the create button,
 * a rename, a delete. Shown for a few seconds and then gone: the reader knows
 * why nothing happened, and is not left with a dialog to close.
 *
 * The app's toast shape in a quieter skin. A solid black capsule is what this
 * product uses to confirm something done; being told why a button did nothing
 * is not that, and it should not arrive with the same weight.
 */
export function OfflineToast({ feature, onDone }: { feature: OfflineFeature; onDone: () => void }) {
  const t = useT();

  useEffect(() => {
    const timer = window.setTimeout(onDone, 3200);

    return () => window.clearTimeout(timer);
  }, [onDone]);

  return (
    <MemoPortal>
      <div className="memo-toast subtle" role="status">
        <Msym name="wifi_off" size="1.1rem" fill={false} weight={500} />
        <span>{t(FEATURE_BODIES[feature])}</span>
      </div>
    </MemoPortal>
  );
}

/**
 * A hook for the many controls whose whole offline behaviour is "say why, then
 * do nothing". Returns a guard to call first and the toast to render.
 */
export function useOfflineGuard() {
  const isOffline = useOffline().isOffline;
  const [blocked, setBlocked] = useState<OfflineFeature | null>(null);

  /** True when the caller should stop. Shows the toast as a side effect. */
  const blockedOffline = useCallback(
    (feature: OfflineFeature) => {
      if (!isOffline) {
        return false;
      }

      setBlocked(feature);
      return true;
    },
    [isOffline],
  );

  const clear = useCallback(() => setBlocked(null), []);

  return {
    isOffline,
    blockedOffline,
    offlineToast: blocked ? <OfflineToast feature={blocked} onDone={clear} /> : null,
  };
}
