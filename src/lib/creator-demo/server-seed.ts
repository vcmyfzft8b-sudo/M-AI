import "server-only";

import { cache } from "react";

import { buildDemoSeed } from "@/lib/creator-demo/build";

/**
 * One seed per request, shared by the `/creator` layout and its pages so the
 * markup the client hydrates matches the state the demo store is seeded with.
 */
export const getCreatorDemoSeed = cache(() => buildDemoSeed());
