/**
 * Where the light comes from: low in the west, so shadows are long and the town
 * has some relief. A unit vector pointing at the sun.
 *
 * Plain numbers rather than a three.js vector, because the card that opens the
 * palace draws the same shadows (`diorama.ts`) before the engine is loaded.
 */
const LENGTH = Math.hypot(-78, 70, 52);

export const SUN_DIRECTION = { x: -78 / LENGTH, y: 70 / LENGTH, z: 52 / LENGTH } as const;
