import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { CreatorDemoProvider } from "@/components/creator-demo/creator-demo-provider";
import { resolveCreatorDemoBasePath } from "@/lib/creator-demo/paths";
import { getCreatorDemoSeed } from "@/lib/creator-demo/server-seed";

export const metadata: Metadata = {
  title: "Demo",
  robots: {
    index: false,
    follow: false,
  },
};

/**
 * `/creator` runs the real app UI against an offline demo library: no account,
 * no upload, no AI. It exists so creators can record UGC videos of the product.
 *
 * `/creator/college` is a second mount of the same demo, nested inside this
 * layout on purpose so both trees share one shell. The pathname decides which
 * base path the tree links against — see `resolveCreatorDemoBasePath`.
 */
export default async function CreatorDemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname") ?? "/creator";
  const basePath = resolveCreatorDemoBasePath(pathname);

  return (
    <CreatorDemoProvider seed={getCreatorDemoSeed()} basePath={basePath}>
      <AppShell hasPaidAccess initialPathname={pathname} className="creator-demo-shell">
        {children}
      </AppShell>
    </CreatorDemoProvider>
  );
}
