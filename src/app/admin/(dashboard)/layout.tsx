import type { ReactNode } from "react";

import { AutoRefresh } from "@/components/admin/auto-refresh";
import {
  AccountFooter,
  AdminMobileNav,
  AdminNav,
} from "@/components/admin/nav";
import { NavigationProgress } from "@/components/admin/pending-link";
import { BrandLogo } from "@/components/brand-logo";
import { requireAdmin, touchAdminLastSeen } from "@/lib/admin/auth";
import { countVideosNeedingReview } from "@/lib/admin/ugc";

// Every panel reads live data, so nothing here may be cached or prerendered.
export const dynamic = "force-dynamic";

export default async function AdminDashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await requireAdmin();

  // Best effort: a failed bookkeeping write must not block the dashboard.
  const reviewCount = await countVideosNeedingReview().catch(() => 0);
  void touchAdminLastSeen(context.admin.id).catch(() => undefined);

  return (
    <div className="admin-shell">
      {/* One bar for the whole dashboard, so it survives the controls that
          unmount as they navigate — the mobile drawer closes on tap. */}
      <NavigationProgress />

      <aside className="admin-sidebar">
        <a className="admin-brand" href="/admin" aria-label="Memo AI admin">
          <BrandLogo compact />
          <span className="admin-brand-label">admin</span>
        </a>

        <AdminNav reviewCount={reviewCount} />

        <AccountFooter
          email={context.user.email ?? ""}
          role={context.isOwner ? "Owner" : "Admin"}
        />
      </aside>

      <AdminMobileNav
        reviewCount={reviewCount}
        email={context.user.email ?? ""}
        role={context.isOwner ? "Owner" : "Admin"}
      />

      <main className="admin-main">
        <AutoRefresh />
        {children}
      </main>
    </div>
  );
}
