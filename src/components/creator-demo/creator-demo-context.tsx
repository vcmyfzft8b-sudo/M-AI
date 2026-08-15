"use client";

import { createContext, useContext } from "react";

import {
  creatorDemoVariantForBasePath,
  mapAppHref,
  unmapDemoPathname,
} from "@/lib/creator-demo/paths";

/**
 * Null everywhere except inside a creator demo tree, where it holds the demo
 * base path (`/creator`, or `/creator/college` for the student cut). Kept in
 * context (not a module global) so server and client renders agree on every
 * href.
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

/**
 * True only under `/creator/college`, which swaps the record flow for the live
 * note-writing takeover. Never true in the real app.
 */
export function useIsCollegeCreatorDemo() {
  return creatorDemoVariantForBasePath(useContext(CreatorDemoBasePathContext)) === "college";
}

/** Rewrites an `/app` href to the demo base path when inside the demo. */
export function useAppHref(href: string) {
  return mapAppHref(href, useContext(CreatorDemoBasePathContext));
}

/** Turns the live pathname back into the `/app` shape the components expect. */
export function useAppPathname(pathname: string) {
  return unmapDemoPathname(pathname, useContext(CreatorDemoBasePathContext));
}
