import type { PalaceHouse } from "./layout";
import { neighborhoodBuilding, type NeighborhoodKind } from "./neighborhood.ts";
import { landmarkBuilding } from "./landmarks.ts";
import { isMonument, monumentBuilding } from "./monuments.ts";
import { aroundShaft, SHAFT_OPENING, towerParts } from "./tower.ts";

export type CityPart = {
  shape: "box" | "rounded" | "cylinder" | "sphere" | "ribbon" | "ring" | "gable" | "bow" | "dome" | "cone" | "sail" | "pyramid" | "disc";
  surface?: "wood" | "stone" | "water";
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  color: number;
  glass?: boolean;
  rotation?: number;
  tiltX?: number;
  tiltZ?: number;
  /** Something at walking height outside the walls that a walker must go round. */
  solid?: boolean;
  /** See-through glass, both sides, for a place you can stand inside (a penthouse). */
  clear?: boolean;
  /** A `disc` (a round slab) has a square opening this wide through its middle, for a lift. */
  hole?: number;
};

/*
 * The ground-floor room's height: tall enough for a gallery with real headroom
 * under it and over it (see `rooms.ts`).
 */
export const LOBBY_HEIGHT = 8;
export const ENTRY_HEIGHT = 3.6;

const STUDY_ARCHETYPES = [
  "helix",
  "cottage",
  "houseboat",
  "terrace",
  "clocktower",
  "observatory",
  "spire",
  "tower",
  "courtyard",
  "townhouse",
  "greenhouse",
  "warehouse",
  "pavilion",
  "windmill",
  /* Appended, so the first fourteen addresses of every existing town keep their building. */
  "temple",
  "pagoda",
  "castle",
  "lighthouse",
  "cathedral",
  "cafe",
] as const;
export const CITY_ARCHETYPES = [...STUDY_ARCHETYPES, "pyramid"] as const;

// Skyscrapers belong to one memorable study address each, never background lots.
// Ordinary streets stay low so their roofs do not hide those unique landmarks.
const BACKGROUND_KINDS = [
  "townhouse", "cottage", "greenhouse", "warehouse", "pavilion",
  "courtyard", "townhouse", "observatory", "cottage", "pavilion",
  "warehouse", "pavilion", "houseboat", "townhouse", "greenhouse",
  "terrace", "cottage", "windmill", "clocktower", "townhouse",
  "cafe", "pavilion", "cafe",
] as const;

/** The building a study address would have by its place in the route, before the town picks its skyscrapers. */
export function studyArchetype(landmarkIndex: number) {
  return STUDY_ARCHETYPES[landmarkIndex % STUDY_ARCHETYPES.length];
}

/** Stable silhouettes give each address a landmark in the skyline. */
export function buildingProfile(house: PalaceHouse, index: number) {
  const variant = house.landmark ? house.landmarkIndex : index + house.districtIndex * 7;
  let kind: typeof CITY_ARCHETYPES[number] = house.landmark
    ? studyArchetype(variant)
    : BACKGROUND_KINDS[variant % BACKGROUND_KINDS.length];
  // The skyscrapers are wherever the town put them (`placeSkyscrapers`), spread
  // across it; an address whose turn in the route would have made it one gets
  // another architectural family instead.
  if (house.skyscraper) kind = house.skyscraper;
  else if (house.landmark && ["helix", "spire", "tower"].includes(kind)) {
    const alternatives = ["townhouse", "temple", "warehouse", "cafe", "pavilion", "observatory", "castle", "cottage", "windmill", "greenhouse"] as const;
    kind = alternatives[(Math.floor(variant / STUDY_ARCHETYPES.length) * 3 + variant) % alternatives.length];
  }
  if (house.monument === "pyramid") kind = "pyramid";
  const tall = kind === "helix" || kind === "spire" || kind === "tower";
  const height = tall ? (house.landmark ? 30 + (variant % 5) * 6 : 18 + (variant % 3) * 6)
    : kind === "terrace" ? 11.2 + (variant % 2) * 3
    : kind === "courtyard" ? 8.2 + (variant % 2) * 3
    : kind === "clocktower" ? 18.7 : kind === "houseboat" || kind === "observatory" ? 12.2
    : kind === "temple" ? 12.7 : kind === "pagoda" ? 24.2 : kind === "castle" ? 15.7
    : kind === "lighthouse" ? 27.2 : kind === "cathedral" ? 26.7 : kind === "cafe" ? 11.7 : 8;
  const palette = [0xe2c8ac,0xb6c8bc,0xd2b3a6,0xcecadb,0xd6cda9];
  const wall = tall || kind === "terrace" || kind === "courtyard" ? 0xeeeede
    : kind === "pyramid" ? 0xc8a971 : kind === "houseboat" ? 0xe7e1cf
    : kind === "temple" ? 0xefe9dc : kind === "pagoda" ? 0xb23a2e : kind === "castle" ? 0xa8a397
    : kind === "lighthouse" ? 0xf4f1ea : kind === "cathedral" ? 0xd8d2c4
    : palette[(variant + Math.floor(index/5)) % palette.length];
  return { kind, height, wall, variant,
    glass: [0x48c1e8, 0x76aebc, 0x65b4bd, 0x608b9e, 0x78b9b0][variant % 5],
  };
}

/** Ground floors stay open; the skyline begins above the furnished lobby. */
export function cityBuilding(house: PalaceHouse, index: number): CityPart[] {
  const parts: CityPart[] = [];
  const profile = buildingProfile(house, index);
  if (["townhouse", "greenhouse", "warehouse", "pavilion", "windmill", "pyramid"].includes(profile.kind)) {
    return neighborhoodBuilding(house, profile.kind as NeighborhoodKind, LOBBY_HEIGHT, profile.variant);
  }
  if (isMonument(profile.kind)) {
    return monumentBuilding(house, profile.kind, LOBBY_HEIGHT, profile.variant);
  }
  if (["cottage", "houseboat", "clocktower", "observatory"].includes(profile.kind)) {
    return landmarkBuilding(house, profile.kind as "cottage" | "houseboat" | "clocktower" | "observatory", LOBBY_HEIGHT, profile.variant);
  }
  const white = 0xf2f1e9,
    silver = 0xc6d5d3,
    green = 0x80b84f;
  const tallKind = profile.kind === "helix" || profile.kind === "spire" || profile.kind === "tower";
  /* The lift rises up the middle of a skyscraper; every floor it passes leaves it an opening. */
  const slabWithShaft = (y: number, w: number, d: number, color: number, thickness = 0.24) => {
    if (!tallKind) {
      box(0, y, 0, w, thickness, d, color);

      return;
    }
    aroundShaft(w, d).forEach((piece) => box(piece.x, y, piece.z, piece.width, thickness, piece.depth, color));
  };
  /* A storey you can see into: clear glass all round, desks by the windows, a lit ceiling round the lift. */
  const glassStorey = (y: number, w: number, d: number) => {
    for (const side of [-1, 1]) {
      parts.push({ shape: "box", x: 0, y: y + 1.5, z: (side * d) / 2, width: w, height: 2.8, depth: 0.05, color: profile.glass, clear: true });
      parts.push({ shape: "box", x: (side * w) / 2, y: y + 1.5, z: 0, width: 0.05, height: 2.8, depth: d, color: profile.glass, clear: true });
      box(side * w * 0.22, y + 0.78, d / 2 - 1.1, 1.6, 0.07, 0.8, 0x6b5440);
      box(side * w * 0.22, y + 0.4, d / 2 - 1.1, 1.4, 0.7, 0.06, 0x3a3a3a);
    }
    aroundShaft(w * 0.62, d * 0.62, SHAFT_OPENING + 0.3).forEach((piece) => box(piece.x, y + 2.86, piece.z, piece.width, 0.04, piece.depth, 0xfff3d4));
  };
  const base = LOBBY_HEIGHT,
    height = profile.height;
  const width = house.width,
    depth = house.depth;
  const add = (
    shape: CityPart["shape"],
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color = white,
    glass = false,
    rotation = 0,
    tiltX = 0,
    tiltZ = 0,
  ) =>
    parts.push({
      shape,
      x,
      y,
      z,
      width: w,
      height: h,
      depth: d,
      color,
      glass,
      rotation,
      tiltX,
      tiltZ,
    });
  const box = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color = white,
    glass = false,
  ) => add("box", x, y, z, w, h, d, color, glass);
  const roofGarden = (y: number, w: number, d: number, cx = 0) => {
    box(cx, y, 0, w, 0.25, d, silver);
    box(cx, y + 0.18, 0, w - 0.65, 0.12, d - 0.65, green);
    for (const side of [-1, 1]) {
      box(cx + (side * w) / 2, y + 0.4, 0, 0.18, 0.8, d);
      box(cx, y + 0.4, (side * d) / 2, w, 0.8, 0.18);
      for (const along of [-0.28, 0, 0.28]) {
        add(
          "sphere",
          cx + along * w,
          y + 0.8,
          side * (d / 2 - 0.7),
          0.75,
          1.2,
          0.75,
          0x66a646,
        );
      }
    }
  };
  // Framed glazing beside the clear 2.8 m entry, and visibly folded glass doors.
  for (const side of [-1, 1]) {
    const panelWidth = Math.max(0.6, (width - 3.4) / 2);
    parts.push({
      shape: "box",
      x: side * (1.7 + panelWidth / 2),
      y: 2.6,
      z: depth / 2 + 0.14,
      width: panelWidth,
      height: 4.6,
      depth: 0.08,
      color: profile.glass,
      /* A skyscraper's lobby is glass you can see into. */
      ...(tallKind ? { clear: true } : { glass: true }),
    });
    box(
      side * 1.5,
      ENTRY_HEIGHT / 2,
      depth / 2 + 0.13,
      0.12,
      ENTRY_HEIGHT,
      0.15,
      silver,
    );
    add(
      "box",
      side * 1.48,
      ENTRY_HEIGHT / 2,
      depth / 2 + 0.65,
      1.25,
      ENTRY_HEIGHT - 0.1,
      0.08,
      profile.glass,
      true,
      Math.PI / 2,
    );
    box(side * (width / 2 - 0.3), base / 2, depth / 2 + 0.25, 0.45, base, 0.45);
  }
  box(0, ENTRY_HEIGHT + 0.2, depth / 2 + 0.8, 3.8, 0.16, 1.6);
  slabWithShaft(base, width + 0.4, depth + 0.4, white, 0.35);

  if (profile.kind === "helix") {
    const diameter = Math.min(width, depth) * 0.88;
    /* See-through glass, and round floors at every storey with the lift rising through the middle. */
    const disc = (y: number, size: number, thick: number, color: number, hole = SHAFT_OPENING * 2) =>
      parts.push({ shape: "disc", x: 0, y, z: 0, width: size, height: thick, depth: size, color, hole });

    parts.push({ shape: "cylinder", x: 0, y: base + height / 2, z: 0, width: diameter, height, depth: diameter, color: profile.glass, clear: true });
    for (let level = 0; level < height; level += 3) {
      disc(base + level + 0.1, diameter - 0.1, 0.22, white);
      disc(base + level + 2.86, diameter * 0.62, 0.04, 0xfff3d4, SHAFT_OPENING * 2 + 0.6);
    }
    disc(base + height, diameter - 0.1, 0.22, white);
    for (let level = 0; level <= height; level += 3)
      add(
        "ring",
        0,
        base + level,
        0,
        diameter + 0.06,
        0.07,
        diameter + 0.06,
        silver,
      );
    for (let rib = 0; rib < 12; rib++) {
      const angle = (rib * Math.PI) / 6;
      box(
        (Math.sin(angle) * diameter) / 2,
        base + height / 2,
        (Math.cos(angle) * diameter) / 2,
        0.055,
        height,
        0.055,
        silver,
      );
    }
    add("ribbon", 0, base, 0, diameter + 0.4, height, diameter + 0.4);
    add("ring", 0, base + height + 0.3, 0, diameter + 0.6, 0.7, diameter + 0.6);
    add(
      "ring",
      0,
      base + height + 1.5,
      0,
      diameter + 0.9,
      0.7,
      diameter + 0.9,
      white,
      false,
      0,
      0.48,
      0.3,
    );
    /* A drum from the crown up to the penthouse: a wall round the outside, open in the middle for the lift. */
    add("ring", 0, base + height + 1.2, 0, diameter * 0.9, 2.4, diameter * 0.9, silver);
    parts.push(...towerParts(house));
  } else {
    const floors = Math.max(3, Math.round(height / 3));
    for (let floor = 0; floor < floors; floor++) {
      const t = floor / floors;
      // Three centered volumes keep the landmark slender without a staircase silhouette.
      const taper =
        profile.kind === "spire"
          ? 1 - Math.floor(t * 3) * 0.12
          : profile.kind === "terrace"
            ? 1 - Math.floor(t * 3) * 0.17
            : 1;
      const w = width * taper,
        d = depth * (profile.kind === "courtyard" ? 0.84 : taper);
      const x = 0;
      const y = base + floor * 3;
      const floorShape = profile.kind === "courtyard" || profile.kind === "spire" ? "rounded" : "box";
      if (tallKind) {
        glassStorey(y, w, d);
        slabWithShaft(y + 0.08, w + 0.35, d + 0.35, white);
      } else {
        add(floorShape, x, y + 1.5, 0, w, 2.8, d, profile.glass, true);
        add(floorShape, x, y + 0.08, 0, w + 0.35, 0.24, d + 0.35);
      }
      for (const side of [-1, 1]) {
        for (let column = 0; column < 4; column++) {
          const mullionSpread = profile.kind === "courtyard" || profile.kind === "spire" ? 0.62 : 1;
          const along = (column / 3 - 0.5) * (w - 0.2) * mullionSpread;
          box(x + along, y + 1.5, (side * d) / 2, 0.07, 2.9, 0.09, silver);
          box(
            x + (side * w) / 2,
            y + 1.5,
            (column / 3 - 0.5) * (d - 0.2) * mullionSpread,
            0.09,
            2.9,
            0.07,
            silver,
          );
        }
      }
      const previousTaper =
        1 - Math.floor((Math.max(0, floor - 1) / floors) * 3) * 0.17;
      if (profile.kind === "terrace" && floor > 0 && previousTaper > taper) {
        const oldW = width * previousTaper,
          oldD = depth * previousTaper;
        box(0, y - 0.05, 0, oldW + 0.22, 0.22, oldD + 0.22);
        // Only the exposed ledges are planted; no shrubs inside the next floor.
        for (const side of [-1, 1]) {
          const ledge = (oldD - d) / 2;
          box(
            0,
            y + 0.1,
            side * (d / 2 + ledge / 2),
            oldW - 0.3,
            0.12,
            ledge - 0.1,
            green,
          );
          box(0, y + 0.35, (side * oldD) / 2, oldW, 0.55, 0.14);
          for (const along of [-0.32, 0, 0.32])
            add(
              "sphere",
              along * w,
              y + 0.55,
              side * (d / 2 + ledge / 2),
              0.55,
              0.85,
              Math.min(0.6, ledge - 0.15),
              0x66a646,
            );
        }
      }
    }
    const roofScale =
      profile.kind === "spire"
        ? 0.76
        : profile.kind === "terrace"
          ? 0.66
          : 1;
    const roofX = 0;
    if (profile.kind === "spire" || profile.kind === "tower") {
      /* The skyscrapers end in a glass penthouse and a viewing deck (`tower.ts`). */
      parts.push(...towerParts(house));
    } else if (profile.kind === "courtyard") {
      add(
        "rounded",
        0,
        base + floors * 3,
        0,
        width + 0.35,
        0.3,
        depth * 0.84 + 0.35,
      );
      roofGarden(base + floors * 3 + 0.12, width * 0.72, depth * 0.6);
    } else
      roofGarden(
        base + floors * 3,
        width * roofScale,
        depth * roofScale,
        roofX,
      );
    /* The glass tower stands on four corner piers, so its sides are glass you can see through too. */
    if (profile.kind === "tower")
      for (const sideX of [-1, 1])
        for (const sideZ of [-1, 1])
          box((sideX * width) / 2, base + floors * 1.5, (sideZ * depth) / 2, 0.55, floors * 3 + 1, 0.55);
  }
  return parts;
}
