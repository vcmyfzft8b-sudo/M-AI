"use client";

import Image from "next/image";
import { useEffect, useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AppLayoutProvider } from "@/components/app-layout-context";
import { useCreatorDemoBasePath } from "@/components/creator-demo/creator-demo-context";
import { useT } from "@/components/i18n-provider";
import { InstantLink } from "@/components/instant-link";
import { Msym } from "@/components/msym";
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
      {({ chatOpen, registerChatSlot }) => (
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
                    {isNote && chatOpen ? null : <span>{item.label}</span>}
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

            {/* Third grid column; the note screen portals its chat panel here. */}
            {chatOpen ? <div className="memo-chat-slot" ref={registerChatSlot} /> : null}
          </div>
        </div>
      )}
    </AppLayoutProvider>
  );
}
