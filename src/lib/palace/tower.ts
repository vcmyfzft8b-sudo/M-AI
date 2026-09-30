import type { CityPart } from "./architecture.ts";
import { buildingProfile, LOBBY_HEIGHT } from "./architecture.ts";
import type { PalaceHouse } from "./layout.ts";
import type { RoomBox, RoomCollider, RoomPart, RoomSurface } from "./rooms.ts";

/**
 * Skyscrapers you can go up.
 *
 * The three towers — the spiral, the needle and the glass tower — are the
 * tallest things in town, and a memory palace wants its most striking places
 * to be places you can stand in. So each has a glass lift at its heart — the
 * core of the building, facing the front door — that rises through an opening
 * in every floor and carries you up past the storeys to a penthouse at the top — glass
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
/** The shaft round it, half-width to the centre of its walls. */
export const SHAFT_HALF = LIFT_SIZE / 2 + 0.12;
/** How far the shaft rises above the roof deck: the car's height and a cap. */
export const SHAFT_CROWN = 3.1;
/** Half the opening every floor, ceiling and roof leaves for the shaft: flush with its steel frame. */
export const SHAFT_OPENING = SHAFT_HALF + 0.08;
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
  /* The lift, in the middle of the building; its door faces the front door (+z). */
  const lift = { x: 0, z: 0 };

  return { kind: profile.kind, floors, floor, roof, width, depth, lift, stops: [0, floor, roof] as const };
}

/**
 * A slab `width` by `depth`, centred on the building, as the four pieces
 * round the opening the lift rises through: front, back, left and right.
 */
export function aroundShaft(width: number, depth: number, opening = SHAFT_OPENING): RoomBox[] {
  return [
    { x: 0, z: (opening + depth / 2) / 2, width, depth: depth / 2 - opening },
    { x: 0, z: -(opening + depth / 2) / 2, width, depth: depth / 2 - opening },
    { x: -(opening + width / 2) / 2, z: 0, width: width / 2 - opening, depth: opening * 2 },
    { x: (opening + width / 2) / 2, z: 0, width: width / 2 - opening, depth: opening * 2 },
  ];
}

/** The penthouse floor and the roof deck, both with the lift shaft left open. */
export function towerSurfaces(house: PalaceHouse): RoomSurface[] {
  const { floor, roof, width, depth } = towerPlan(house);

  /* Walkable right up to the car's edge; the sill at each landing covers the seam. */
  return [floor, roof].flatMap((y) => aroundShaft(width, depth, LIFT_SIZE / 2 + 0.05).map((piece) => ({ ...piece, y })));
}

/** The glass walls of the penthouse, the rail round the roof deck, and the lift shaft's walls. */
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
    /* The shaft's walls — back, left, right — from the lobby floor to the top of the lift. */
    ...[
      { x: lift.x, z: lift.z - SHAFT_HALF, width: SHAFT_HALF * 2, depth: 0.12 },
      { x: lift.x - SHAFT_HALF, z: lift.z, width: 0.12, depth: SHAFT_HALF * 2 },
      { x: lift.x + SHAFT_HALF, z: lift.z, width: 0.12, depth: SHAFT_HALF * 2 },
    ].map((wall) => ({ ...wall, bottom: -1, top: roof + SHAFT_CROWN })),
  ];
}

/** Where a stop waits in a tower: in the front left corner, by the windows, with the town below. */
export function penthouseStationPoint(house: PalaceHouse) {
  const { width, depth } = towerPlan(house);

  /* By the glass, but kept well inside the building's own plot. */
  return { x: -Math.min(width / 2 - 1.3, house.width / 2 - 1.9), z: Math.min(depth / 2 - 1.3, house.depth / 2 - 1.9) };
}

/** The shell: floor and ceiling slabs, glass walls on their mullions, and the roof deck with its telescopes. */
export function towerParts(house: PalaceHouse): CityPart[] {
  const { floor, roof, width, depth } = towerPlan(house);
  const parts: CityPart[] = [];
  const white = 0xf2f1e9;
  const silver = 0xc6d5d3;
  const dark = 0x2f3538;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, color: number, extra: Partial<CityPart> = {}) =>
    parts.push({ shape: "box", x, y, z, width: w, height: h, depth: d, color, ...extra });

  /* Slabs, and the timber floor inside, each open where the lift comes through. */
  const slab = (y: number, w: number, h: number, d: number, color: number, extra: Partial<CityPart> = {}) =>
    aroundShaft(w, d).forEach((piece) => box(piece.x, y, piece.z, piece.width, h, piece.depth, color, extra));

  slab(floor - 0.15, width + 0.5, 0.3, depth + 0.5, white);
  slab(floor + 0.02, width - 0.2, 0.04, depth - 0.2, 0xb58a60, { surface: "wood" });
  slab(roof - 0.12, width + 0.4, 0.3, depth + 0.4, white);

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

  /* The roof: decking, a glass balustrade with a steel rail, telescopes at the front corners, a bench. */
  slab(roof + 0.07, width - 0.1, 0.1, depth - 0.1, 0x9c7a55, { surface: "wood" });
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
  /* The bench is behind the lift, looking out over the back of the town. */
  const benchZ = -(SHAFT_OPENING + depth / 2) / 2 - 0.2;

  box(0, roof + 0.55, benchZ, 2.2, 0.12, 0.6, 0x9c7a55, { surface: "wood" });
  box(0, roof + 0.3, benchZ, 1.9, 0.45, 0.12, dark);

  return parts;
}

/**
 * The penthouse, arranged round the lift in its middle: a sofa on the right
 * facing the windows, on a rug, a dining table behind the lift, plants in the
 * corners and a floor lamp — and, in the front left corner, the display stand
 * when a stop waits here. The way from the lift's door to the stand is open.
 * Heights are absolute.
 */
export function penthouseFurniture(house: PalaceHouse, hasMemory: boolean): RoomPart[] {
  const { floor, width, depth } = towerPlan(house);
  const parts: RoomPart[] = [];
  const add = (shape: RoomPart["shape"], x: number, y: number, z: number, w: number, h: number, d: number, color: number, solid = false) =>
    parts.push({ shape, x, y: floor + y, z, width: w, height: h, depth: d, color, solid });
  const sofa = 0x3f4f6b;
  const core = SHAFT_OPENING + 0.15;
  /* The sofa's back to the lift, looking out of the right-hand windows. */
  const sofaX = core + 0.45;
  const room = width / 2 - (sofaX + 0.45);

  add("box", (core + width / 2) / 2, 0.02, 0, width / 2 - core - 0.3, 0.02, Math.min(3.4, depth - 2.4), 0xc9b99a);
  add("box", sofaX, 0.25, 0, 0.9, 0.5, 2.6, sofa, true);
  add("box", sofaX - 0.34, 0.7, 0, 0.22, 0.55, 2.6, sofa);
  if (room > 1.3) add("box", sofaX + 0.45 + room / 2, 0.22, 0, Math.min(0.7, room - 0.7), 0.08, 1.2, 0x2b2b2b, true);
  add("cylinder", width / 2 - 0.45, 0.8, (core + depth / 2) / 2, 0.05, 1.6, 0.05, 0x2b2b2b);
  add("cone", width / 2 - 0.45, 1.65, (core + depth / 2) / 2, 0.5, 0.35, 0.5, 0xf2e6c8);

  /* A round dining table behind the lift, by the back windows. */
  const tableZ = -(core + depth / 2) / 2;

  add("cylinder", 0, 0.74, tableZ, 1.2, 0.05, 1.2, 0xf2efe8, true);
  add("cylinder", 0, 0.37, tableZ, 0.12, 0.72, 0.12, 0x2b2b2b);
  for (const side of [-1, 1]) add("box", side * 0.95, 0.45, tableZ, 0.45, 0.9, 0.45, 0x8a5a3c, true);

  for (const [x, z] of [[width / 2 - 0.6, depth / 2 - 0.6], [width / 2 - 0.6, -depth / 2 + 0.6], [-width / 2 + 0.6, -depth / 2 + 0.6]]) {
    add("cylinder", x, 0.3, z, 0.55, 0.6, 0.55, 0xf2efe8, true);
    add("sphere", x, 1.0, z, 0.9, 1.1, 0.9, 0x58764b);
  }

  if (hasMemory) {
    const stand = penthouseStationPoint(house);

    add("cylinder", stand.x, 0.4, stand.z, 0.85, 0.8, 0.85, 0xded1b7, true);
    add("cylinder", stand.x, 0.84, stand.z, 1.15, 0.08, 1.15, 0xb58b43);
  }

  return parts;
}
