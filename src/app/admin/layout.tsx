import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./admin.css";

export const metadata: Metadata = {
  title: "Admin",
  // The dashboard exposes revenue and the user list; it must never be indexed
  // or previewed by a crawler, even though it is also protected by the
  // allowlist check in the dashboard layout.
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return <div className="admin-root">{children}</div>;
}
