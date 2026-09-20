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

/**
 * The note tabs and actions that cannot be answered from a cached copy.
 *
 * Each has exactly two strings: a short line naming what needs the connection,
 * used wherever the app has room for one line — the toast, the row that stands
 * in for the recording's player, the caption under the closed chat field — and
 * a body that explains, used only where a whole panel is given over to it.
 */
/**
 * The floor on how long a "checking" state stays up.
 *
 * The check is often instant — with the interface reporting no connection at
 * all there is nothing to probe, so it answers in the same tick — and a
 * spinner that appears and vanishes inside one frame is a tap that looks
 * ignored. Long enough to be seen, short enough that a real check is not held
 * up behind it.
 */
const MIN_FEEDBACK_MS = 550;

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
  const { checking, check } = useOfflineRecheck();

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
        onClick={() => void check()}
      >
        {checking ? (
          <Msym name="progress_activity" className="memo-spin" size="1.05rem" />
        ) : null}
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
 *
 * It says the same short line the panel state leads with, rather than the
 * panel's explanation: one phrase per feature, everywhere it appears, so the
 * app never has two ways of saying the same thing.
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
        <span>{t(FEATURE_TITLES[feature])}</span>
      </div>
    </MemoPortal>
  );
}

/**
 * A hook for the many controls whose whole offline behaviour is "say why, then
 * do nothing". Returns a guard to call first and the toast to render.
 */
/**
 * Rechecks the connection, and keeps the caller's busy state up long enough to
 * be seen. Shared so the tab notice and the full screen behave identically.
 */
export function useOfflineRecheck() {
  const { recheck } = useOffline();
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);

    const [online] = await Promise.all([
      recheck(),
      new Promise((resolve) => window.setTimeout(resolve, MIN_FEEDBACK_MS)),
    ]);

    setChecking(false);
    return online;
  }, [recheck]);

  return { checking, check };
}

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
