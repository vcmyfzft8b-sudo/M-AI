import type { ReactNode } from "react";

import { AutoRefresh } from "@/components/admin/auto-refresh";
import { AdminNav } from "@/components/admin/nav";
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
      <aside className="admin-sidebar">
        <a className="admin-brand" href="/admin" aria-label="Memo AI admin">
          <BrandLogo compact />
          <span className="admin-brand-label">admin</span>
        </a>

        <AdminNav reviewCount={reviewCount} />

        <div className="admin-sidebar-footer">
          <span className="admin-sidebar-email">{context.user.email}</span>
          <span>{context.isOwner ? "Owner" : "Admin"}</span>
          <form action="/auth/logout" method="post">
            <button
              type="submit"
              className="admin-button"
              data-variant="ghost"
              data-size="sm"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="admin-main">
        <AutoRefresh />
        {children}
      </main>
    </div>
  );
}
