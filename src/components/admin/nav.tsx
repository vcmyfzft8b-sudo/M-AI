"use client";

import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  Menu,
  Settings,
  Users,
  Video,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { BrandLogo } from "@/components/brand-logo";

export const ADMIN_LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/creators", label: "Creators", icon: Video, badge: "review" },
  { href: "/admin/sales", label: "Sales", icon: CreditCard },
  { href: "/admin/visitors", label: "Visitors", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

/** "/admin" would otherwise light up on every child route. */
function isActive(href: string, pathname: string) {
  return href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);
}

function NavLinks({
  reviewCount,
  onNavigate,
}: {
  reviewCount: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav">
      {ADMIN_LINKS.map((link) => {
        const Icon = link.icon;

        return (
          <Link
            key={link.href}
            href={link.href}
            className="admin-nav-link"
            data-active={isActive(link.href, pathname)}
            onClick={onNavigate}
          >
            <Icon size={15} strokeWidth={2} aria-hidden="true" />
            <span>{link.label}</span>
            {"badge" in link && link.badge === "review" && reviewCount > 0 && (
              <span
                className="admin-nav-badge"
                title={`${reviewCount} videos need review`}
              >
                {reviewCount > 99 ? "99+" : reviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminNav({ reviewCount }: { reviewCount: number }) {
  return <NavLinks reviewCount={reviewCount} />;
}

function AccountFooter({ email, role }: { email: string; role: string }) {
  return (
    <div className="admin-sidebar-footer">
      <span className="admin-sidebar-email">{email}</span>
      <span>{role}</span>
      <form action="/auth/logout" method="post">
        <button type="submit" className="admin-button" data-variant="ghost" data-size="sm">
          Sign out
        </button>
      </form>
    </div>
  );
}

export { AccountFooter };

/**
 * The mobile header and its drawer.
 *
 * On a narrow screen the sidebar was laid out as a horizontally scrolling strip
 * of links, which hid its footer entirely — and with it the only way to sign
 * out. A drawer keeps the whole menu, the signed-in address and sign-out
 * reachable, rather than dropping them because there is no room.
 */
export function AdminMobileNav({
  reviewCount,
  email,
  role,
}: {
  reviewCount: number;
  email: string;
  role: string;
}) {
  const pathname = usePathname();

  // The drawer remembers which page it was opened on, and is open only while
  // that is still the current page. Navigating therefore closes it on its own —
  // including via browser back — without an effect that sets state on every
  // route change and triggers a cascading render.
  const [openedOn, setOpenedOn] = useState<string | null>(null);
  const open = openedOn === pathname;

  const close = useCallback(() => setOpenedOn(null), []);

  // A drawer over the page must not leave the page scrolling behind it.
  useEffect(() => {
    if (!open) {
      return;
    }

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };

    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const current =
    ADMIN_LINKS.find((link) => isActive(link.href, pathname))?.label ?? "Admin";

  return (
    <>
      <header className="admin-topbar">
        <button
          type="button"
          className="admin-topbar-button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpenedOn(pathname)}
        >
          <Menu size={20} strokeWidth={2} aria-hidden="true" />
        </button>

        <Link href="/admin" className="admin-topbar-brand" aria-label="Memo AI admin">
          <BrandLogo compact />
        </Link>

        <span className="admin-topbar-current">{current}</span>

        {reviewCount > 0 && (
          <span className="admin-nav-badge" title={`${reviewCount} videos need review`}>
            {reviewCount > 99 ? "99+" : reviewCount}
          </span>
        )}
      </header>

      {open && (
        <div className="admin-drawer" role="dialog" aria-modal="true" aria-label="Admin menu">
          {/* A button rather than a div, so tapping outside is reachable by
              keyboard and announced as a control. */}
          <button
            type="button"
            className="admin-drawer-scrim"
            aria-label="Close menu"
            onClick={close}
          />
          <div className="admin-drawer-panel">
            <div className="admin-drawer-head">
              <BrandLogo compact />
              <button
                type="button"
                className="admin-topbar-button"
                aria-label="Close menu"
                onClick={close}
              >
                <X size={20} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <NavLinks reviewCount={reviewCount} onNavigate={close} />

            <AccountFooter email={email} role={role} />
          </div>
        </div>
      )}
    </>
  );
}
