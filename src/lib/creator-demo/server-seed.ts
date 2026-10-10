import "server-only";

import { cache } from "react";

import { buildDemoSeed } from "@/lib/creator-demo/build";
import { getLocale } from "@/lib/i18n/server";

/**
 * One seed per request, shared by the `/creator` layout and its pages so the
 * markup the client hydrates matches the state the demo store is seeded with.
 *
 * Written in the request's locale — the visitor's chosen language, else their
 * country's, else English — so the notes match the app around them.
 */
export const getCreatorDemoSeed = cache(async () => buildDemoSeed(await getLocale()));
