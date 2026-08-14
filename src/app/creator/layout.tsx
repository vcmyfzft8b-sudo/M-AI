import type { Metadata } from "next";
import { headers } from "next/headers";

import { AppShell } from "@/components/app-shell";
import { CreatorDemoProvider } from "@/components/creator-demo/creator-demo-provider";
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
 */
export default async function CreatorDemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = (await headers()).get("x-pathname") ?? "/creator";

  return (
    <CreatorDemoProvider seed={getCreatorDemoSeed()}>
      <AppShell hasPaidAccess initialPathname={pathname}>
        {children}
      </AppShell>
    </CreatorDemoProvider>
  );
}
