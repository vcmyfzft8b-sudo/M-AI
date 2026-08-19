"use client";

import {
  BarChart3,
  CreditCard,
  LayoutDashboard,
  Settings,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/creators", label: "Creators", icon: Video, badge: "review" },
  { href: "/admin/sales", label: "Sales", icon: CreditCard },
  { href: "/admin/visitors", label: "Visitors", icon: BarChart3 },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

export function AdminNav({ reviewCount }: { reviewCount: number }) {
  const pathname = usePathname();

  return (
    <nav className="admin-nav">
      {LINKS.map((link) => {
        const Icon = link.icon;
        // "/admin" would otherwise light up on every child route.
        const active =
          link.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(link.href);

        return (
          <Link
            key={link.href}
            href={link.href}
            className="admin-nav-link"
            data-active={active}
          >
            <Icon size={15} strokeWidth={2} aria-hidden="true" />
            <span>{link.label}</span>
            {"badge" in link && link.badge === "review" && reviewCount > 0 && (
              <span className="admin-nav-badge" title={`${reviewCount} videos need review`}>
                {reviewCount > 99 ? "99+" : reviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
