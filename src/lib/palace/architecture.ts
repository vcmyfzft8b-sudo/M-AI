import type { PalaceHouse } from "./layout";
import { landmarkBuilding } from "./landmarks.ts";

export type CityPart = {
  shape: "box" | "rounded" | "cylinder" | "sphere" | "ribbon" | "ring" | "gable" | "bow" | "dome" | "cone" | "sail" | "pyramid";
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
};

export const LOBBY_HEIGHT = 5.8;
export const ENTRY_HEIGHT = 3.6;

export const CITY_ARCHETYPES = [
  "helix",
  "cottage",
  "houseboat",
  "terrace",
  "clocktower",
  "observatory",
  "spire",
  "tower",
  "courtyard",
] as const;

/** Stable silhouettes give each address a landmark in the skyline. */
export function buildingProfile(house: PalaceHouse, index: number) {
  const variant = house.landmark ? house.landmarkIndex : index + 3;
  const kind = CITY_ARCHETYPES[variant % CITY_ARCHETYPES.length];
  const height = kind === "cottage" ? 4.6 : kind === "houseboat" ? 10 : kind === "clocktower" ? 16.5 : kind === "observatory" ? 10 : house.landmark ? 42 + (variant % 5) * 6 : 18 + (index % 7) * 3;
  const wall = kind === "cottage" ? [0xead6bb,0xd4ded3,0xdfc9bc,0xe5dfd0][Math.floor(variant/9)%4] : kind === "houseboat" ? 0xe7e1cf : kind === "clocktower" ? 0xcebea3 : kind === "observatory" ? 0xd4d0c4 : 0xeeeede;
  return {
    kind,
    height,
    wall,
    glass: [0x48c1e8, 0x42b4e5, 0x65d0e7, 0x4cb7e2, 0x49c9d8][variant % 5],
  };
}

/** Ground floors stay open; the skyline begins above the furnished lobby. */
export function cityBuilding(house: PalaceHouse, index: number): CityPart[] {
  const parts: CityPart[] = [];
  const profile = buildingProfile(house, index);
  if (["cottage", "houseboat", "clocktower", "observatory"].includes(profile.kind)) {
    return landmarkBuilding(house, profile.kind as "cottage" | "houseboat" | "clocktower" | "observatory", LOBBY_HEIGHT, house.landmark ? house.landmarkIndex : index + 3);
  }
  const white = 0xf2f1e9,
    silver = 0xc6d5d3,
    green = 0x80b84f;
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
    box(
      side * (1.7 + panelWidth / 2),
      2.6,
      depth / 2 + 0.14,
      panelWidth,
      4.6,
      0.08,
      profile.glass,
      true,
    );
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
  box(0, base, 0, width + 0.4, 0.35, depth + 0.4);

  if (profile.kind === "helix") {
    const diameter = Math.min(width, depth) * 0.88;
    add(
      "cylinder",
      0,
      base + height / 2,
      0,
      diameter,
      height,
      diameter,
      profile.glass,
      true,
    );
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
  } else {
    const floors = Math.max(3, Math.round(height / 3));
    for (let floor = 0; floor < floors; floor++) {
      const t = floor / floors;
      const taper =
        profile.kind === "spire"
          ? 1 - t * 0.7
          : profile.kind === "terrace"
            ? 1 - Math.floor(t * 3) * 0.17
            : 1;
      const w = width * taper,
        d = depth * (profile.kind === "courtyard" ? 0.84 : taper);
      const x = profile.kind === "spire" ? (width - w) * 0.36 : 0;
      const y = base + floor * 3;
      const floorShape = profile.kind === "courtyard" ? "rounded" : "box";
      add(floorShape, x, y + 1.5, 0, w, 2.8, d, profile.glass, true);
      add(floorShape, x, y + 0.08, 0, w + 0.35, 0.24, d + 0.35);
      for (const side of [-1, 1]) {
        for (let column = 0; column < 4; column++) {
          const mullionSpread = profile.kind === "courtyard" ? 0.62 : 1;
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
        ? 1 - ((floors - 1) / floors) * 0.7
        : profile.kind === "terrace"
          ? 0.66
          : 1;
    const roofX = profile.kind === "spire" ? width * (1 - roofScale) * 0.36 : 0;
    if (profile.kind === "courtyard") {
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
    if (profile.kind === "tower")
      for (const side of [-1, 1])
        box(
          (side * width) / 2,
          base + floors * 1.5,
          0,
          0.45,
          floors * 3 + 1,
          depth + 0.35,
        );
  }
  return parts;
}
