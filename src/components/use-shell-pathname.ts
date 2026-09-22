"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useIsHydrated } from "@/components/viewport-portal";

/** Keep the shell and its streamed page consistent while the router boots. */
export function useShellPathname(initialPathname: string) {
  const clientPathname = usePathname();
  const router = useRouter();
  const hydrated = useIsHydrated();
  const [initialRoute] = useState(() => ({
    pathname: clientPathname,
    // A client-only mount (including the offline shell) has no server tree
    // to reconcile. A reused layout's initialPathname can also be stale.
    needsRefresh: !hydrated && clientPathname !== null && clientPathname !== initialPathname,
  }));
  const checkedInitialRoute = useRef(false);

  useEffect(() => {
    if (!hydrated || checkedInitialRoute.current) return;
    checkedInitialRoute.current = true;

    // Matching the first render prevents a hydration failure, but by itself
    // leaves the previous document's page under the new URL. Fetch the page
    // for that URL once. If navigation already moved elsewhere, let it finish.
    if (initialRoute.needsRefresh && clientPathname === initialRoute.pathname) {
      router.refresh();
    }
  }, [clientPathname, hydrated, initialRoute, router]);

  // React uses the server snapshot during hydration even if the browser URL
  // changed before Next booted. Later renders must follow the live router:
  // this layout persists across client navigation.
  return hydrated ? clientPathname ?? initialPathname : initialPathname;
}
