"use client";

import Image from "next/image";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppLayoutProvider } from "@/components/app-layout-context";
import { useCreatorDemoBasePath } from "@/components/creator-demo/creator-demo-context";
import { useT } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { LectureChatLoading } from "@/components/lecture-loading";
import { Msym } from "@/components/msym";
import { useNavigationFeedback } from "@/components/navigation-loading";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";
import type { MessageKey } from "@/lib/i18n/messages/keys";
import { unmapDemoPathname } from "@/lib/creator-demo/paths";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";

/**
 * The desktop rail. The phone design has no persistent navigation at all —
 * help and settings are reached from the gear on the home screen — so this
 * only renders from 1100px up.
 */
const RAIL_ITEMS: Array<{ href: string; labelKey: MessageKey; icon: string }> = [
  { href: "/app", labelKey: "nav.home", icon: "home" },
  { href: "/app/support", labelKey: "nav.help", icon: "help" },
  { href: "/app/settings", labelKey: "nav.settings", icon: "settings" },
];

export function AppShell({
  children,
  hasPaidAccess,
  initialPathname,
  className = "",
}: {
  children: React.ReactNode;
  hasPaidAccess: boolean;
  initialPathname: string;
  /** Extra class on the shell root, for surface-specific styling. */
  className?: string;
}) {
  const t = useT();
  const demoBasePath = useCreatorDemoBasePath();
  const clientPathname = usePathname();
  const router = useRouter();

  // `usePathname` is null on the very first server-rendered pass in some
  // contexts, so the header-provided path seeds it.
  const pathname = unmapDemoPathname(clientPathname ?? initialPathname, demoBasePath);

  // `/app/onboarding` is not a route of its own: it is what `/creator/onboarding`
  // unmaps to, the demo mount of the survey. Both own the whole viewport.
  const isOnboarding = pathname === "/app/start" || pathname === "/app/onboarding";
  const isNote = pathname.startsWith("/app/lectures/");
  const isHome = pathname === "/app";

  // Where a click is headed while its skeleton is on screen. The overlay paints the
  // destination's skeleton before the route commits, so for that whole window the
  // pathname is still the page being left.
  const navigatingTo = useNavigationFeedback()?.navigatingTo ?? null;
  const isNavigatingToNote = navigatingTo
    ? unmapDemoPathname(navigatingTo, demoBasePath).startsWith("/app/lectures/")
    : false;

  useEffect(() => {
    let cancelled = false;

    const warmRailRoutes = () => {
      if (cancelled || document.visibilityState !== "visible") {
        return;
      }

      for (const item of RAIL_ITEMS) {
        const isCurrentRoute =
          item.href === "/app"
            ? pathname === "/app"
            : pathname === item.href || pathname.startsWith(`${item.href}/`);

        // The current page is already in the router tree. Fetching its full RSC
        // payload again wastes bandwidth — Home can be close to a megabyte for
        // a large library — and gives the user nothing they do not already see.
        if (!isCurrentRoute) {
          safeRouterPrefetch(router, item.href, { full: true });
        }
      }
    };

    warmRailRoutes();
    document.addEventListener("visibilitychange", warmRailRoutes);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", warmRailRoutes);
    };
  }, [pathname, router]);

  const railItems = useMemo(
    () =>
      RAIL_ITEMS.map((item) => ({
        ...item,
        label: t(item.labelKey),
        active:
          item.href === "/app"
            ? pathname === "/app" || isNote
            : pathname === item.href || pathname.startsWith(`${item.href}/`),
      })),
    [isNote, pathname, t],
  );

  // Onboarding and checkout own the whole viewport; the app chrome would only
  // get in the way.
  if (isOnboarding) {
    return (
      <div className={`memo memo-shell ${className}`.trim()}>
        <main>{children}</main>
      </div>
    );
  }

  return (
    <AppLayoutProvider>
      {({ chatOpen, registerChatSlot }) => {
        /*
         * A note's skeleton is on screen when one is being navigated to, or when this
         * is already a note route and no note screen has answered yet (`chatOpen` still
         * null) — a cold load or a reload, where loading.tsx renders before the
         * workspace mounts.
         */
        const isNoteSkeleton = isNavigatingToNote || (isNote && chatOpen === null);

        /*
         * While it is, the shell lays the note screen out rather than the page being
         * left: the grid template, the collapsed rail and the chat column, with the
         * panel's own shape drawn into it. The column is the part that matters — it is
         * a third of the width, it lives in the shell rather than in the skeleton, and
         * without it a note loaded full-width and snapped to two thirds the instant the
         * real screen mounted.
         */
        const showsNoteLayout = isNote || isNoteSkeleton;
        const showsChatColumn = isNoteSkeleton || chatOpen === true;
        const chatIsLoading = isNoteSkeleton && chatOpen !== true;
        const railCollapsed = showsNoteLayout && showsChatColumn;

        return (
          <div className={`memo memo-shell ${className}`.trim()}>
            <header className="memo-header">
              <InstantLink
                href="/app"
                className="memo-header-brand"
                aria-label={t("nav.homeBrand", { brand: SEO_BRAND_NAME })}
              >
                <Image
                  src={BRAND_LOCKUP_SRC}
                  alt={SEO_BRAND_NAME}
                  width={BRAND_LOCKUP_WIDTH}
                  height={BRAND_LOCKUP_HEIGHT}
                  priority
                />
              </InstantLink>

              <div className="memo-header-actions">
                {hasPaidAccess ? null : (
                  <InstantLink
                    href="/app/start"
                    className="memo-subscribe-cta"
                  >
                    <span>{t("shell.unlimitedNotes")}</span>
                    <Msym name="bolt" size="1.35rem" />
                  </InstantLink>
                )}
              </div>
            </header>

            <div
              /* Hides the outgoing home screen's ask-bar. It is fixed, so it
                 escapes the overlay covering the content column and is drawn
                 across the chat column the skeleton has just opened. */
              data-note-skeleton={isNoteSkeleton ? "" : undefined}
              className={[
                "memo-grid",
                isHome && !isNoteSkeleton ? "home" : "",
                showsNoteLayout ? "note" : "",
                showsChatColumn ? "with-chat" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <aside className={`memo-rail ${railCollapsed ? "collapsed" : ""}`.trim()}>
                <nav aria-label={t("nav.main")}>
                  {railItems.map((item) => (
                    <InstantLink
                      key={item.href}
                      href={item.href}
                      className={`memo-rail-item ${item.active ? "active" : ""}`.trim()}
                      aria-current={item.active ? "page" : undefined}
                      aria-label={item.label}
                      title={item.label}
                    >
                      <span className="memo-rail-icon">
                        <Msym name={item.icon} size="1.5rem" />
                      </span>
                      {railCollapsed ? null : <span>{item.label}</span>}
                    </InstantLink>
                  ))}
                </nav>
              </aside>

              {/*
                * `app-shell-content` is what the navigation overlay looks for: it
                * portals the route skeleton in here, so the skeleton gets this
                * column's width and padding and the rail beside it stays put.
                * Without the hook the overlay falls back to a fixed layer over
                * the whole window, which covers the rail while a page loads.
                */}
              <main className="memo-main app-shell-content">{children}</main>

              {/* Third grid column; the note screen portals its chat panel here, and
                  the skeleton stands in its shape until that arrives. */}
              {showsChatColumn ? (
                <div className="memo-chat-slot" ref={registerChatSlot}>
                  {chatIsLoading ? <LectureChatLoading /> : null}
                </div>
              ) : null}
            </div>
          </div>
        );
      }}
    </AppLayoutProvider>
  );
}
