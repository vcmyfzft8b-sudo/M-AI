"use client";

import type { ReactNode } from "react";

import { ViewportPortal } from "@/components/viewport-portal";

/**
 * A viewport portal that still sees the redesign's design tokens.
 *
 * `ViewportPortal` mounts on `document.body`, outside the `.memo` shell — so a
 * sheet or dialog portalled straight through it loses every `--bg`, `--surface`
 * and `--memo-safe-*` variable, and rules built on them silently compute to
 * `auto`/transparent. The `.memo-portal` wrapper carries the same token block
 * and is `display: contents`, so it adds no box of its own and fixed-position
 * children keep laying out against the viewport.
 */
export function MemoPortal({ children }: { children: ReactNode }) {
  return (
    <ViewportPortal>
      <div className="memo-portal">{children}</div>
    </ViewportPortal>
  );
}
