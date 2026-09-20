"use client";

/**
 * The app, drawn from its offline copy.
 *
 * This is the document the service worker hands back for *any* navigation the
 * network could not answer, so the address bar still says `/app/lectures/…`
 * while the bytes came from `/offline`. Which screen to draw is therefore read
 * from `location`, not from a route parameter, and the screens themselves are
 * the real `HomeDashboard` and `LectureWorkspace` — the same components, the
 * same CSS, the same behaviour — mounted against a snapshot instead of against
 * a server response. A reader offline is not meant to notice a different app.
 *
 * Nothing real is rendered until after hydration. The server rendered this at
 * `/offline` with no snapshot and no idea of the destination; a first client
 * pass that drew the note screen would not match that HTML and React would
 * throw the whole document away. One frame of the skeleton is the price.
 */
import { useEffect, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { DashboardLoading } from "@/components/dashboard-loading";
import { HomeDashboard } from "@/components/home-dashboard";
import { useT } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { LectureWorkspaceLoading } from "@/components/lecture-loading";
import { LectureWorkspace } from "@/components/lecture-workspace";
import { Msym } from "@/components/msym";
import { OfflineProvider, useOffline } from "@/components/offline/offline-provider";
import { useIsHydrated } from "@/components/viewport-portal";
import { resolveOfflineRoute, type OfflineRoute } from "@/lib/offline/paths";
import {
  readOfflineHome,
  readOfflineLecture,
  type OfflineHomeSnapshot,
  type OfflineLectureSnapshot,
} from "@/lib/offline/snapshot";

type Resolved =
  | { state: "loading" }
  | { state: "home"; snapshot: OfflineHomeSnapshot }
  | { state: "lecture"; snapshot: OfflineLectureSnapshot }
  /** Nothing cached for this screen, or a screen that has no offline form. */
  | { state: "missing"; route: OfflineRoute };

/**
 * The screen for everything the snapshot cannot answer: settings, help, the
 * upgrade flow, a note never opened on this device, and the first launch of an
 * account that has never been online here.
 */
function OfflineUnavailable({ route }: { route: OfflineRoute }) {
  const t = useT();
  const { recheck } = useOffline();
  const [checking, setChecking] = useState(false);
  const isMissingNote = route.kind === "lecture";
  const offersHome = isMissingNote || (route.kind === "unavailable" && route.backToHome);

  return (
    <main className="home-dashboard pb-8">
      <div className="memo-offline-note" role="status">
        <span className="memo-offline-note-icon" aria-hidden="true">
          <Msym name="wifi_off" size="1.2rem" fill={false} weight={500} />
        </span>
        <p className="memo-offline-note-title">
          {t(isMissingNote ? "offline.note.missingTitle" : "offline.screen.title")}
        </p>
        <p className="memo-offline-note-copy">
          {t(isMissingNote ? "offline.note.missingBody" : "offline.screen.body")}
        </p>
        <button
          type="button"
          className="memo-offline-note-action"
          disabled={checking}
          onClick={() => {
            setChecking(true);
            void recheck().then((online) => {
              if (online) {
                window.location.reload();
                return;
              }

              setChecking(false);
            });
          }}
        >
          {t(checking ? "offline.checking" : "offline.checkAgain")}
        </button>
        {offersHome ? (
          <InstantLink href="/app" className="memo-offline-note-link">
            {t("offline.backToNotes")}
          </InstantLink>
        ) : null}
      </div>
    </main>
  );
}

/**
 * Which screen was asked for. Read during render rather than in an effect: this
 * component is only ever rendered after hydration, so `location` is settled and
 * the loading skeleton can be the *right* skeleton from the first frame.
 */
function useRequestedRoute() {
  const [route] = useState<OfflineRoute>(() => resolveOfflineRoute(window.location.pathname));

  return route;
}

function OfflineScreens() {
  const route = useRequestedRoute();
  const [resolved, setResolved] = useState<Resolved>({ state: "loading" });

  useEffect(() => {
    let active = true;

    const load = async (): Promise<Resolved> => {
      if (route.kind === "unavailable") {
        return { state: "missing", route };
      }

      if (route.kind === "lecture") {
        const snapshot = await readOfflineLecture(route.lectureId);

        return snapshot ? { state: "lecture", snapshot } : { state: "missing", route };
      }

      const snapshot = await readOfflineHome();

      return snapshot ? { state: "home", snapshot } : { state: "missing", route };
    };

    void load().then((next) => {
      if (active) {
        setResolved(next);
      }
    });

    return () => {
      active = false;
    };
  }, [route]);

  if (resolved.state === "loading") {
    return route.kind === "lecture" ? (
      <LectureWorkspaceLoading />
    ) : (
      <DashboardLoading promoPlaceholder={false} />
    );
  }

  if (resolved.state === "home") {
    return (
      <HomeDashboard
        lectures={resolved.snapshot.lectures}
        folders={resolved.snapshot.folders}
        userId={resolved.snapshot.userId}
        /*
         * Never, whatever the account may be entitled to: the upload, the
         * recording and the link import all end at an API call that cannot be
         * made. The capture controls say why instead of failing.
         */
        canCreateNotes={false}
        hasPaidAccess={resolved.snapshot.hasPaidAccess}
        trialLectureId={resolved.snapshot.trialLectureId}
        canSpinWheel={null}
        installGuideSeen
        showDevDashboard={false}
      />
    );
  }

  if (resolved.state === "lecture") {
    return (
      <LectureWorkspace
        key={resolved.snapshot.detail.lecture.id}
        initialDetail={resolved.snapshot.detail}
        hasPaidAccess={resolved.snapshot.hasPaidAccess}
        trialLectureId={resolved.snapshot.trialLectureId}
        initialTrialChatMessagesRemaining={0}
      />
    );
  }

  return <OfflineUnavailable route={resolved.route} />;
}

export function OfflineApp() {
  /*
   * Nothing real until after hydration. The server rendered this document at
   * `/offline`, with no destination and no store to read; a first client pass
   * that drew the note screen would not match that HTML and React would throw
   * the whole document away and start again.
   */
  const hydrated = useIsHydrated();
  const [paidHint, setPaidHint] = useState(true);

  useEffect(() => {
    void readOfflineHome().then((snapshot) => {
      if (snapshot) {
        setPaidHint(snapshot.hasPaidAccess);
      }
    });
  }, []);

  /*
   * The shell itself waits too, not just its contents. `AppShell` lays the page
   * out from the pathname, and the pathname this document was *rendered* at is
   * `/offline` while the one it is *served* at is the note or the library that
   * was asked for. Rendering the shell before hydration would hand React two
   * different layouts for the same markup and make it throw the document away.
   */
  if (!hydrated) {
    return (
      <div className="memo memo-shell">
        <DashboardLoading promoPlaceholder={false} />
      </div>
    );
  }

  return (
    <OfflineProvider isShell>
      {/*
        * `hasPaidAccess` decides one thing in the shell: whether the header
        * carries the upgrade pill. It is optimistic until the snapshot answers,
        * because offering somebody a subscription they already have is the
        * worse of the two wrong guesses — and neither can be bought offline.
        */}
      <AppShell hasPaidAccess={paidHint} initialPathname={window.location.pathname}>
        <OfflineScreens />
      </AppShell>
    </OfflineProvider>
  );
}
