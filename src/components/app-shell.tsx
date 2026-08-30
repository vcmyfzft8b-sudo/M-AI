"use client";

import Image from "next/image";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppLayoutProvider } from "@/components/app-layout-context";
import { useCreatorDemoBasePath } from "@/components/creator-demo/creator-demo-context";
import { InstantLink } from "@/components/instant-link";
import { Msym } from "@/components/msym";
import {
  shouldHandleLinkNavigation,
  useInstantNavigation,
} from "@/components/navigation-loading";
import {
  BRAND_LOCKUP_HEIGHT,
  BRAND_LOCKUP_SRC,
  BRAND_LOCKUP_WIDTH,
  SEO_BRAND_NAME,
} from "@/lib/brand";
import { unmapDemoPathname } from "@/lib/creator-demo/paths";
import { safeRouterPrefetch } from "@/lib/safe-router-prefetch";

/**
 * The desktop rail. The phone design has no persistent navigation at all —
 * Pomoč and Nastavitve are reached from the gear on the home screen — so this
 * only renders from 1100px up.
 */
const RAIL_ITEMS = [
  { href: "/app", label: "Domov", icon: "home" },
  { href: "/app/support", label: "Pomoč", icon: "help" },
  { href: "/app/settings", label: "Nastavitve", icon: "settings" },
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
  const demoBasePath = useCreatorDemoBasePath();
  const clientPathname = usePathname();
  const router = useRouter();
  const { navigateWithFeedback, overlay: navigationOverlay } = useInstantNavigation();

  // `usePathname` is null on the very first server-rendered pass in some
  // contexts, so the header-provided path seeds it.
  const pathname = unmapDemoPathname(clientPathname ?? initialPathname, demoBasePath);

  const isOnboarding = pathname === "/app/start";
  const isNote = pathname.startsWith("/app/lectures/");
  const isHome = pathname === "/app";

  useEffect(() => {
    for (const item of RAIL_ITEMS) {
      safeRouterPrefetch(router, item.href);
    }
  }, [router]);

  const railItems = useMemo(
    () =>
      RAIL_ITEMS.map((item) => ({
        ...item,
        active:
          item.href === "/app"
            ? pathname === "/app" || isNote
            : pathname === item.href || pathname.startsWith(`${item.href}/`),
      })),
    [isNote, pathname],
  );

  function handleNavLinkClick(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!shouldHandleLinkNavigation(event)) {
      return;
    }

    event.preventDefault();
    navigateWithFeedback(href);
  }

  // Onboarding and checkout own the whole viewport; the app chrome would only
  // get in the way.
  if (isOnboarding) {
    return (
      <div className={`memo memo-shell ${className}`.trim()}>
        {navigationOverlay}
        <main>{children}</main>
      </div>
    );
  }

  return (
    <AppLayoutProvider>
      {({ chatOpen, registerChatSlot }) => (
        <div className={`memo memo-shell ${className}`.trim()}>
          {navigationOverlay}

          <header className="memo-header">
            <InstantLink
              href="/app"
              className="memo-header-brand"
              aria-label={`Domov ${SEO_BRAND_NAME}`}
              onClick={(event) => handleNavLinkClick(event, "/app")}
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
                  onClick={(event) => handleNavLinkClick(event, "/app/start")}
                >
                  <span>Neomejeni zapiski</span>
                  <Msym name="bolt" size="1.35rem" />
                </InstantLink>
              )}
            </div>
          </header>

          <div
            className={[
              "memo-grid",
              isHome ? "home" : "",
              isNote ? "note" : "",
              chatOpen ? "with-chat" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <aside className={`memo-rail ${isNote && chatOpen ? "collapsed" : ""}`.trim()}>
              <nav aria-label="Glavna navigacija">
                {railItems.map((item) => (
                  <InstantLink
                    key={item.href}
                    href={item.href}
                    className={`memo-rail-item ${item.active ? "active" : ""}`.trim()}
                    aria-current={item.active ? "page" : undefined}
                    aria-label={item.label}
                    title={item.label}
                    onClick={(event) => handleNavLinkClick(event, item.href)}
                  >
                    <span className="memo-rail-icon">
                      <Msym name={item.icon} size="1.5rem" />
                    </span>
                    {isNote && chatOpen ? null : <span>{item.label}</span>}
                  </InstantLink>
                ))}
              </nav>
            </aside>

            <main className="memo-main">{children}</main>

            {/* Third grid column; the note screen portals its chat panel here. */}
            {chatOpen ? <div className="memo-chat-slot" ref={registerChatSlot} /> : null}
          </div>
        </div>
      )}
    </AppLayoutProvider>
  );
}
