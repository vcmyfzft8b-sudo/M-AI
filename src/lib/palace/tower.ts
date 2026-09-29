import type { CityPart } from "./architecture.ts";
import { buildingProfile, LOBBY_HEIGHT } from "./architecture.ts";
import type { PalaceHouse } from "./layout.ts";
import type { RoomCollider, RoomPart, RoomSurface } from "./rooms.ts";

/**
 * Skyscrapers you can go up.
 *
 * The three towers — the spiral, the needle and the glass tower — are the
 * tallest things in town, and a memory palace wants its most striking places
 * to be places you can stand in. So each has a glass lift in the corner of its
 * lobby that carries you up past the storeys to a penthouse at the top — glass
 * on every side, a lounge, the town spread out below — and on up again to a
 * viewing deck on the roof, with a railing and telescopes. A stop remembered
 * in a tower waits in its penthouse.
 *
 * Described once, in the building's own axes (x across the front, +z out of
 * the door), for the renderer, the collision and the tests alike. Heights are
 * absolute. The lift itself runs in `lift.ts`.
 */

export const TOWER_KINDS = ["helix", "spire", "tower"] as const;
/** Floor to ceiling in the penthouse. */
export const PENTHOUSE_HEIGHT = 5.2;
/** The lift car's floor, square. */
export const LIFT_SIZE = 2.2;
const RAIL = 1.15;

/** Only a study landmark is ever a skyscraper (see `buildingProfile`). */
export function isTower(house: PalaceHouse) {
  return house.landmark && !house.monument && (TOWER_KINDS as readonly string[]).includes(buildingProfile(house, 0).kind);
}

export function towerPlan(house: PalaceHouse) {
  const profile = buildingProfile(house, 0);
  const floors = Math.max(3, Math.round(profile.height / 3));
  /* The storeys are three metres each; the penthouse sits on the last of them. */
  const floor = profile.kind === "helix" ? LOBBY_HEIGHT + profile.height + 2.4 : LOBBY_HEIGHT + floors * 3;
  const taper = profile.kind === "spire" ? 1 - Math.floor(((floors - 1) / floors) * 3) * 0.12 : 1;
  const width = profile.kind === "helix" ? Math.min(house.width, house.depth) * 0.84 : house.width * taper;
  const depth = profile.kind === "helix" ? Math.min(house.width, house.depth) * 0.84 : house.depth * taper;
  const roof = floor + PENTHOUSE_HEIGHT;
  /* The lift, in the back left corner; its door faces into the room (+z). */
  const lift = { x: -width / 2 + 0.25 + LIFT_SIZE / 2, z: -depth / 2 + 0.25 + LIFT_SIZE / 2 };

  return { kind: profile.kind, floors, floor, roof, width, depth, lift, stops: [0, floor, roof] as const };
}

/** The penthouse floor and the roof deck, both with the lift shaft left open. */
export function towerSurfaces(house: PalaceHouse): RoomSurface[] {
  const { floor, roof, width, depth, lift } = towerPlan(house);
  const shaftEdgeZ = lift.z + LIFT_SIZE / 2 + 0.05;
  const shaftEdgeX = lift.x + LIFT_SIZE / 2 + 0.05;

  return [floor, roof].flatMap((y) => [
    { x: 0, z: (shaftEdgeZ + depth / 2) / 2, width, depth: depth / 2 - shaftEdgeZ, y },
    { x: (shaftEdgeX + width / 2) / 2, z: (-depth / 2 + shaftEdgeZ) / 2, width: width / 2 - shaftEdgeX, depth: shaftEdgeZ + depth / 2, y },
  ]);
}

/** The glass walls of the penthouse, the rail round the roof deck, and the side of the lift shaft. */
export function towerColliders(house: PalaceHouse): RoomCollider[] {
  const { floor, roof, width, depth, lift } = towerPlan(house);
  const ring = (bottom: number, top: number): RoomCollider[] => [
    { x: 0, z: -depth / 2, width: width + 0.2, depth: 0.2, bottom, top },
    { x: 0, z: depth / 2, width: width + 0.2, depth: 0.2, bottom, top },
    { x: -width / 2, z: 0, width: 0.2, depth: depth + 0.2, bottom, top },
    { x: width / 2, z: 0, width: 0.2, depth: depth + 0.2, bottom, top },
  ];

  return [
    ...ring(floor - 0.3, roof),
    ...ring(roof - 0.3, roof + RAIL + 0.2),
    /* The shaft's glass side, from the penthouse up through the roof kiosk. */
    { x: lift.x + LIFT_SIZE / 2 + 0.05, z: (-depth / 2 + lift.z + LIFT_SIZE / 2) / 2, width: 0.1, depth: lift.z + LIFT_SIZE / 2 + depth / 2, bottom: floor - 0.3, top: roof + 2.8 },
  ];
}

/** Where a stop waits in a tower: by the penthouse's front windows, with the town below. */
export function penthouseStationPoint(house: PalaceHouse) {
  const { depth } = towerPlan(house);

  return { x: 0.6, z: depth / 2 - 1.9 };
}

/** The shell: floor and ceiling slabs, glass walls on their mullions, and the roof deck with its telescopes. */
export function towerParts(house: PalaceHouse): CityPart[] {
  const { floor, roof, width, depth, lift } = towerPlan(house);
  const parts: CityPart[] = [];
  const white = 0xf2f1e9;
  const silver = 0xc6d5d3;
  const dark = 0x2f3538;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<CityPart> = {}) =>
    parts.push({ shape: "box", x, y, z, width: w, height: h, depth: d, color, ...extra });

  /* Slabs, and the timber floor inside. */
  box(0, floor - 0.15, 0, width + 0.5, 0.3, depth + 0.5, white);
  box(0, floor + 0.02, 0, width - 0.2, 0.04, depth - 0.2, 0xb58a60, { surface: "wood" });
  box(0, roof - 0.12, 0, width + 0.4, 0.3, depth + 0.4, white);

  /* Floor-to-ceiling glass on every side, on slim mullions. */
  const wallHeight = roof - floor - 0.25;

  for (const side of [-1, 1]) {
    box(0, floor + wallHeight / 2, (side * depth) / 2, width, wallHeight, 0.05, 0xbfe3f0, { clear: true });
    box((side * width) / 2, floor + wallHeight / 2, 0, 0.05, wallHeight, depth, 0xbfe3f0, { clear: true });
    for (let along = -width / 2; along <= width / 2 + 0.01; along += width / Math.max(2, Math.round(width / 1.6)))
      box(along, floor + wallHeight / 2, (side * depth) / 2, 0.08, wallHeight, 0.1, silver);
    for (let along = -depth / 2; along <= depth / 2 + 0.01; along += depth / Math.max(2, Math.round(depth / 1.6)))
      box((side * width) / 2, floor + wallHeight / 2, along, 0.1, wallHeight, 0.08, silver);
  }

  /* The lift shaft's glass side, and the frame of its door. */
  const shaftX = lift.x + LIFT_SIZE / 2 + 0.05;
  const shaftDepth = lift.z + LIFT_SIZE / 2 + depth / 2;

  box(shaftX, floor + wallHeight / 2, -depth / 2 + shaftDepth / 2, 0.05, wallHeight, shaftDepth, 0xbfe3f0, { clear: true });
  box(shaftX, floor + wallHeight / 2, lift.z + LIFT_SIZE / 2, 0.14, wallHeight, 0.14, silver);

  /* The roof: decking, a glass balustrade with a steel rail, telescopes at the front corners, a bench. */
  box(0, roof + 0.07, 0, width - 0.1, 0.1, depth - 0.1, 0x9c7a55, { surface: "wood" });
  for (const side of [-1, 1]) {
    box(0, roof + 0.1 + RAIL / 2, (side * depth) / 2, width, RAIL, 0.04, 0xbfe3f0, { clear: true });
    box((side * width) / 2, roof + 0.1 + RAIL / 2, 0, 0.04, RAIL, depth, 0xbfe3f0, { clear: true });
    box(0, roof + 0.12 + RAIL, (side * depth) / 2, width + 0.1, 0.07, 0.1, silver);
    box((side * width) / 2, roof + 0.12 + RAIL, 0, 0.1, 0.07, depth + 0.1, silver);

    const tx = side * (width / 2 - 1.1);
    const tz = depth / 2 - 1;

    parts.push({ shape: "cylinder", x: tx, y: roof + 0.65, z: tz, width: 0.12, height: 1.1, depth: 0.12, color: dark });
    parts.push({ shape: "cylinder", x: tx, y: roof + 1.28, z: tz + 0.1, width: 0.24, height: 0.62, depth: 0.24, color: 0x3a6f8f, tiltX: 1.3 });
    parts.push({ shape: "cylinder", x: tx, y: roof + 1.35, z: tz - 0.18, width: 0.14, height: 0.16, depth: 0.14, color: dark, tiltX: 1.3 });
  }
  box(0, roof + 0.55, depth / 2 - 2.6, 2.2, 0.12, 0.6, 0x9c7a55, { surface: "wood" });
  box(0, roof + 0.3, depth / 2 - 2.6, 1.9, 0.45, 0.12, dark);

  /* The lift's rooftop kiosk: a roof over the car, open at the front. */
  const kioskTop = roof + 2.8;

  box(lift.x, kioskTop, lift.z, LIFT_SIZE + 0.6, 0.18, LIFT_SIZE + 0.6, white);
  box(shaftX, roof + 1.4, -depth / 2 + shaftDepth / 2, 0.06, 2.6, shaftDepth, 0xbfe3f0, { clear: true });
  box(-width / 2 + 0.05, roof + 1.4, lift.z, 0.06, 2.6, LIFT_SIZE + 0.4, 0xbfe3f0, { clear: true });

  return parts;
}

/**
 * The penthouse lounge: a rug and an L-shaped sofa on the right, a coffee
 * table, a dining table by the window on the left, plants, a floor lamp — and the display stand when a
 * stop waits here. Heights are absolute.
 */
export function penthouseFurniture(house: PalaceHouse, hasMemory: boolean): RoomPart[] {
  const { floor, width, depth } = towerPlan(house);
  const parts: RoomPart[] = [];
  const add = (shape: RoomPart["shape"], x: number, y: number, z: number, w: number, h: number, d: number, color: number, solid = false) =>
    parts.push({ shape, x, y: floor + y, z, width: w, height: h, depth: d, color, solid });
  const sofa = 0x3f4f6b;
  /* The lounge on the right, so the way from the lift to the windows is open. */
  const lounge = width / 2 - 2.3;

  add("box", lounge, 0.02, -0.2, 3.6, 0.02, 3.2, 0xc9b99a);
  add("box", lounge, 0.25, -1.2, 3.0, 0.5, 0.9, sofa, true);
  add("box", lounge, 0.7, -1.6, 3.0, 0.55, 0.22, sofa);
  add("box", lounge + 1.1, 0.25, -0.1, 0.8, 0.5, 1.4, sofa, true);
  add("box", lounge - 0.3, 0.22, 0.1, 1.2, 0.08, 0.7, 0x2b2b2b, true);
  add("cylinder", -width / 2 + 1.2, 0.38, depth / 2 - 1.3, 1.2, 0.05, 1.2, 0xf2efe8, true);
  add("cylinder", -width / 2 + 1.2, 0.36, depth / 2 - 1.3, 0.12, 0.72, 0.12, 0x2b2b2b);
  for (const [x, z] of [[width / 2 - 0.6, -depth / 2 + 0.6], [width / 2 - 0.6, depth / 2 - 0.6]]) {
    add("cylinder", x, 0.3, z, 0.55, 0.6, 0.55, 0xf2efe8, true);
    add("sphere", x, 1.0, z, 0.9, 1.1, 0.9, 0x58764b);
  }
  add("cylinder", lounge - 1.8, 0.8, -1.6, 0.05, 1.6, 0.05, 0x2b2b2b);
  add("cone", lounge - 1.8, 1.65, -1.6, 0.5, 0.35, 0.5, 0xf2e6c8);

  if (hasMemory) {
    const stand = penthouseStationPoint(house);

    add("cylinder", stand.x, 0.4, stand.z, 0.85, 0.8, 0.85, 0xded1b7, true);
    add("cylinder", stand.x, 0.84, stand.z, 1.15, 0.08, 1.15, 0xb58b43);
  }

  return parts;
}
