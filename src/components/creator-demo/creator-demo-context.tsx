"use client";

import { createContext, useContext } from "react";

import { mapAppHref, unmapDemoPathname } from "@/lib/creator-demo/paths";

/**
 * Null everywhere except inside the `/creator` demo tree, where it holds the
 * demo base path. Kept in context (not a module global) so server and client
 * renders agree on every href.
 */
const CreatorDemoBasePathContext = createContext<string | null>(null);

export const CreatorDemoBasePathProvider = CreatorDemoBasePathContext.Provider;

export function useCreatorDemoBasePath() {
  return useContext(CreatorDemoBasePathContext);
}

/** True inside the creator demo tree. */
export function useIsCreatorDemo() {
  return useContext(CreatorDemoBasePathContext) != null;
}

/** Rewrites an `/app` href to the demo base path when inside the demo. */
export function useAppHref(href: string) {
  return mapAppHref(href, useContext(CreatorDemoBasePathContext));
}

/** Turns the live pathname back into the `/app` shape the components expect. */
export function useAppPathname(pathname: string) {
  return unmapDemoPathname(pathname, useContext(CreatorDemoBasePathContext));
}
