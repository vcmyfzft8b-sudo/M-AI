import type { PalaceHouse } from "./layout";

export const ROOM_THEMES = [
  "library",
  "observatory",
  "music",
  "greenhouse",
  "gallery",
  "workshop",
  "bakery",
  "clockroom",
] as const;
export const ROOM_COLORS = [
  "amber",
  "teal",
  "rose",
  "blue",
  "sage",
  "plum",
  "terracotta",
  "ivory",
] as const;
export const ROOM_HUES = [38, 178, 343, 215, 105, 280, 17, 48] as const;
export type RoomIdentity = {
  theme: (typeof ROOM_THEMES)[number];
  color: (typeof ROOM_COLORS)[number];
  hue: number;
  number: number;
  anchorX: number;
  anchorZ: number;
};

/** Sixty-four distinct color/room combinations, before architecture and position
 * add their cues. The assignment never depends on progress or device size. */
export function roomIdentity(index: number): RoomIdentity {
  const palette = Math.floor(index / ROOM_THEMES.length) % ROOM_COLORS.length;
  return {
    theme: ROOM_THEMES[index % ROOM_THEMES.length],
    color: ROOM_COLORS[palette],
    hue: ROOM_HUES[palette],
    number: index + 1,
    anchorX: [-0.9, 0, 0.9][palette % 3],
    anchorZ: [-0.8, 0.6, -0.2][Math.floor(index / 3) % 3],
  };
}

export function roomPoint(house: PalaceHouse, x: number, z: number) {
  return {
    x: house.x + Math.cos(house.facing) * x + Math.sin(house.facing) * z,
    z: house.z - Math.sin(house.facing) * x + Math.cos(house.facing) * z,
  };
}

export function insideHouse(
  point: { x: number; z: number },
  house: PalaceHouse,
) {
  const dx = point.x - house.x,
    dz = point.z - house.z;
  return (
    Math.abs(dx * Math.cos(house.facing) - dz * Math.sin(house.facing)) <
      house.width / 2 - 0.2 &&
    Math.abs(dx * Math.sin(house.facing) + dz * Math.cos(house.facing)) <
      house.depth / 2 - 0.2
  );
}

export const ROOM_DOOR_WIDTH = 2.8;

export const OUTDOOR_LANDMARKS = [
  "bench",
  "planter",
  "globe",
  "sculpture",
] as const;

export function outdoorLandmark(index: number) {
  return OUTDOOR_LANDMARKS[Math.floor(index / 2) % OUTDOOR_LANDMARKS.length];
}

/** Compact landmarks fit on a pavement, with room to approach on every side. */
export function outdoorFurniture(index: number): RoomPart[] {
  const parts: RoomPart[] = [];
  const add = (
    shape: RoomPart["shape"],
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: number,
  ) => parts.push({ shape, x, y, z, width, height, depth, color });
  const type = outdoorLandmark(index);
  if (type === "bench") {
    add("box", 0, 0.6, 0, 1.8, 0.16, 0.7, 0x684837);
    add("box", 0, 0.95, -0.3, 1.8, 0.6, 0.12, 0x684837);
    for (const side of [-1, 1])
      add("box", side * 0.65, 0.3, 0, 0.16, 0.6, 0.6, 0x29343d);
  } else if (type === "planter") {
    add("box", 0, 0.4, 0, 1.2, 0.8, 1.2, 0xb58b43);
    for (const side of [-1, 1]) {
      add("cylinder", side * 0.3, 0.95, 0, 0.08, 0.7, 0.08, 0x46734a);
      add("sphere", side * 0.3, 1.2, 0, 0.4, 0.3, 0.4, 0xf1b3cf);
    }
  } else {
    add("box", 0, 0.3, 0, 1.1, 0.6, 1.1, 0xded1b7);
    if (type === "globe") {
      add("sphere", 0, 0.95, 0, 0.75, 0.75, 0.75, 0x659ec1);
      add("cylinder", 0, 0.64, 0, 0.55, 0.08, 0.55, 0xb58b43);
    } else {
      add("cone", 0, 0.95, 0, 0.85, 0.8, 0.85, 0xb58b43);
    }
  }
  return parts;
}

/** Four walls with an actual opening; used by both geometry and collision. */
export function roomWalls(house: PalaceHouse) {
  const half = house.width / 2,
    depth = house.depth / 2,
    thickness = 0.24;
  const sideWidth = (house.width - ROOM_DOOR_WIDTH) / 2;
  return [
    { x: -half, z: 0, width: thickness, depth: house.depth },
    { x: half, z: 0, width: thickness, depth: house.depth },
    { x: 0, z: -depth, width: house.width, depth: thickness },
    ...[-1, 1].map((side) => ({
      x: side * (ROOM_DOOR_WIDTH / 2 + sideWidth / 2),
      z: depth,
      width: sideWidth,
      depth: thickness,
    })),
  ];
}

export type RoomPart = {
  shape: "box" | "sphere" | "cylinder" | "cone";
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  color: number;
  solid?: boolean;
};

/** Furniture sits at the edges; the door-to-memory corridor stays clear. */
export function roomFurniture(
  house: PalaceHouse,
  identity: RoomIdentity,
  hasMemory = true,
): RoomPart[] {
  const parts: RoomPart[] = [];
  const back = -house.depth / 2 + 0.65;
  const wood = 0x684837,
    brass = 0xb58b43,
    cream = 0xded1b7,
    ink = 0x29343d;
  const box = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: number,
    solid = false,
  ) =>
    parts.push({ shape: "box", x, y, z, width, height, depth, color, solid });
  const ball = (x: number, y: number, z: number, size: number, color: number) =>
    parts.push({
      shape: "sphere",
      x,
      y,
      z,
      width: size,
      height: size,
      depth: size,
      color,
    });
  const cylinder = (
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    color: number,
    solid = false,
  ) =>
    parts.push({
      shape: "cylinder",
      x,
      y,
      z,
      width,
      height,
      depth: width,
      color,
      solid,
    });
  const desk = (x: number, z: number, width = 2.8) => {
    box(x, 0.85, z, width, 0.16, 1.2, wood, true);
    for (const side of [-1, 1])
      for (const end of [-1, 1])
        box(
          x + side * (width / 2 - 0.15),
          0.42,
          z + end * 0.45,
          0.13,
          0.84,
          0.13,
          wood,
        );
  };
  if (identity.theme === "library") {
    for (const x of [-2.7, 0, 2.7]) {
      box(x, 1.6, back, 2.4, 3.2, 0.5, wood, true);
      for (let row = 0; row < 4; row++)
        for (let book = 0; book < 8; book++)
          box(
            x - 1 + book * 0.27,
            0.4 + row * 0.72,
            back + 0.32,
            0.19,
            0.4 + (book % 3) * 0.08,
            0.32,
            [0x76575a, 0x526c6a, 0xd3bd88, 0x394b6a][(book + row) % 4],
          );
    }
    desk(-2.8, 0);
    box(-2.8, 0.99, 0, 0.9, 0.1, 0.65, cream);
  } else if (identity.theme === "observatory") {
    cylinder(0, 0.5, back + 1, 0.3, 1, brass, true);
    ball(0, 1.75, back + 1, 2, 0x477d8c);
    // Brass equator and small orbital bodies.
    cylinder(0, 1.75, back + 1, 2.08, 0.055, brass);
    for (let i = 0; i < 5; i++)
      ball(
        -2.6 + i * 1.3,
        2.7,
        back + 0.05,
        0.18 + i * 0.045,
        [brass, 0xa36650, cream][i % 3],
      );
    desk(3, 0, 1.4);
    box(3, 1, 0, 1.1, 0.12, 0.8, 0x253f58);
  } else if (identity.theme === "music") {
    box(0, 0.65, back + 0.4, 3.8, 1.3, 0.9, ink, true);
    box(0, 1.4, back, 3.8, 1.1, 0.42, wood);
    box(0, 1.05, back + 1, 3.8, 0.13, 0.6, cream);
    for (let key = 0; key < 22; key++)
      box(-1.8 + key * 0.17, 1.13, back + 0.9, 0.055, 0.1, 0.3, ink);
    box(0, 0.48, back + 2, 1.7, 0.15, 0.65, wood, true);
    for (const side of [-1, 1]) {
      cylinder(side * 3, 0.75, back + 0.4, 0.18, 1.5, brass, true);
      ball(side * 3, 1.65, back + 0.4, 0.65, brass);
    }
  } else if (identity.theme === "greenhouse") {
    for (let i = 0; i < 7; i++) {
      const x = -3 + i,
        z = back + 0.3 + (i % 2) * 0.6;
      cylinder(x, 0.35, z, 0.7, 0.7, 0xa26345, true);
      cylinder(x, 1.1, z, 0.08, 1.5, 0x527341);
      for (let leaf = 0; leaf < 3; leaf++)
        ball(
          x + Math.sin(leaf * 2 + i) * 0.25,
          1.15 + leaf * 0.35,
          z,
          0.55,
          [0x58764b, 0x769359, 0x466552][(i + leaf) % 3],
        );
    }
    desk(-3, 0, 1.4);
    cylinder(-3, 1.1, 0, 0.4, 0.4, brass);
  } else if (identity.theme === "gallery") {
    for (const side of [-1, 1]) {
      box(side * 2.5, 2, back, 1.9, 2.3, 0.16, brass);
      box(
        side * 2.5,
        2,
        back + 0.1,
        1.65,
        2.05,
        0.08,
        side < 0 ? 0x48767f : 0xb87165,
      );
      ball(side * 2.5, 2.1, back + 0.17, 0.7, cream);
    }
    box(0, 0.55, back + 1.2, 1.2, 1.1, 1.2, cream, true);
    parts.push({
      shape: "cone",
      x: 0,
      y: 1.95,
      z: back + 1.2,
      width: 1.5,
      height: 1.7,
      depth: 1.5,
      color: brass,
    });
  } else if (identity.theme === "workshop") {
    desk(0, back + 0.6, 5.8);
    box(0, 2.15, back, 5.8, 1.5, 0.18, wood);
    for (let i = 0; i < 6; i++) {
      box(-2.2 + i * 0.85, 2.05, back + 0.15, 0.1, 0.7, 0.13, ink);
      box(-2.2 + i * 0.85, 2.4, back + 0.2, 0.45, 0.15, 0.15, brass);
    }
    box(-1.4, 1.05, back + 0.6, 0.9, 0.28, 0.6, 0x7c9792);
    ball(1.5, 1.2, back + 0.6, 0.55, brass);
  } else if (identity.theme === "bakery") {
    box(-2.6, 1.25, back + 0.35, 2.3, 2.5, 1.2, 0xb58b71, true);
    box(-2.6, 1.25, back + 1, 1.5, 1, 0.09, ink);
    desk(1.5, back + 0.8, 3.3);
    for (let i = 0; i < 5; i++) {
      const x = 0.3 + i * 0.55;
      parts.push({
        shape: "sphere",
        x,
        y: 1.06,
        z: back + 0.8,
        width: 0.4,
        height: 0.3,
        depth: 0.7,
        color: 0xc89853,
      });
    }
    for (let i = 0; i < 3; i++)
      box(1.3, 1.7 + i * 0.6, back, 3.8, 0.1, 0.65, wood);
  } else {
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 2.8;
      box(x, 1.4, back + 0.3, 1.5, 2.8, 0.65, wood, true);
      ball(x, 2.3, back + 0.67, 1.1, cream);
      box(x, 2.45, back + 1.22, 0.035, 0.35, 0.025, ink);
      box(x + 0.14, 2.3, back + 1.22, 0.3, 0.035, 0.025, ink);
      cylinder(x, 1.05, back + 0.68, 0.04, 0.9, brass);
      ball(x, 0.63, back + 0.75, 0.3, brass);
    }
  }
  // Each mascot belongs to a small, reachable display stand inside its room.
  if (hasMemory) {
    cylinder(identity.anchorX, 0.4, identity.anchorZ, 0.85, 0.8, cream, true);
    cylinder(identity.anchorX, 0.84, identity.anchorZ, 1.15, 0.08, brass);
  }
  return parts;
}
