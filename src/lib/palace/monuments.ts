import type { PalaceHouse } from "./layout";
import type { CityPart } from "./architecture";

/**
 * Six more places to remember things by, each from a different architectural
 * tradition so no two can be confused: a classical temple, a pagoda, a castle
 * keep, a lighthouse, a cathedral and a corner café.
 *
 * That is the whole point of a memory palace — "the thing I learned at the
 * lighthouse" only works if the lighthouse could be nothing else — so each is
 * built around one unmistakable silhouette (a pediment on columns, stacked
 * eaves, crenellated towers, a striped tower with a lantern, a spire over a
 * rose window, striped awnings and parasols) and a colour of its own.
 *
 * Like every building here, it stands on the house's walkable ground-floor
 * room: nothing below the lintel crosses the central doorway, and anything
 * solid a walker could run into outside the walls is marked `solid`.
 * Coordinates are the house's own: x across the front, +z out of the door.
 */

export const MONUMENT_KINDS = ["temple", "pagoda", "castle", "lighthouse", "cathedral", "cafe"] as const;
export type MonumentKind = (typeof MONUMENT_KINDS)[number];

export function isMonument(kind: string): kind is MonumentKind {
  return (MONUMENT_KINDS as readonly string[]).includes(kind);
}

export function monumentBuilding(house: PalaceHouse, kind: MonumentKind, base: number, variant: number): CityPart[] {
  const parts: CityPart[] = [];
  const w = house.width;
  const d = house.depth;
  const front = d / 2;
  const add = (
    shape: CityPart["shape"],
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    color: number,
    extra: Partial<CityPart> = {},
  ) => {
    parts.push({ shape, x, y, z, width, height, depth, color, ...extra });
  };
  const box = (x: number, y: number, z: number, width: number, height: number, depth: number, color: number, extra: Partial<CityPart> = {}) =>
    add("box", x, y, z, width, height, depth, color, extra);
  /** A pitched roof: the gable body, and two sloped roof planes with a ridge. */
  const pitched = (y: number, width: number, depth: number, rise: number, body: number, roof: number, z = 0) => {
    add("gable", 0, y + rise / 2, z, width, rise, depth, body);
    const angle = Math.atan2(rise, width / 2);

    for (const side of [-1, 1])
      box(side * width / 4, y + rise / 2 + 0.09, z, Math.hypot(width / 2, rise) + 0.35, 0.17, depth + 0.5, roof, {
        tiltZ: -side * angle,
        surface: "stone",
      });
  };
  /** A door surround, clear of the 2.8 m opening. */
  const doorway = (color: number) => {
    for (const side of [-1, 1]) box(side * 1.55, 1.85, front + 0.18, 0.22, 3.7, 0.35, color);
    box(0, 3.8, front + 0.18, 3.3, 0.24, 0.35, color);
  };

  if (kind === "temple") {
    const marble = 0xefe9dc;
    const shade = 0xd6cdb9;
    const roof = [0xb07a4a, 0x8f9aa0, 0x9a6b4f][variant % 3];
    const porch = 2.3;

    /* Three shallow steps up to the portico, too low to trip over. */
    for (let step = 0; step < 3; step++)
      box(0, 0.03 + step * 0.03, front + porch / 2 + 0.4 - step * 0.35, w + 1.6 - step * 0.4, 0.06, porch + 1 - step * 0.7, shade, { surface: "stone" });

    /* A colonnade across the front, the doorway left open between the middle pair. */
    const columnXs: number[] = [];

    for (let x = 1.95; x <= w / 2 + 0.35; x += 1.55) columnXs.push(x, -x);
    for (const x of columnXs) {
      add("cylinder", x, 0.14, front + porch - 0.25, 0.86, 0.28, 0.86, shade);
      add("cylinder", x, 2.75, front + porch - 0.25, 0.62, 5.0, 0.62, marble, { solid: true });
      box(x, 5.4, front + porch - 0.25, 0.9, 0.3, 0.9, shade);
    }
    for (const side of [-1, 1]) {
      /* Pilasters at the corners of the walls. */
      box(side * (w / 2 + 0.05), base / 2, front + 0.05, 0.5, base, 0.5, marble, { surface: "stone" });
      box(side * (w / 2 + 0.05), base / 2, -front - 0.05, 0.5, base, 0.5, marble, { surface: "stone" });
    }

    /* Entablature over walls and portico, with a frieze of triglyphs. */
    const deep = d + porch + 0.3;
    const centre = porch / 2;

    box(0, base + 0.05, centre, w + 1.1, 0.9, deep, marble, { surface: "stone" });
    for (let x = -w / 2; x <= w / 2 + 0.01; x += 0.9) box(x, base + 0.15, front + porch + 0.03, 0.3, 0.5, 0.08, shade);
    box(0, base + 0.55, centre, w + 1.35, 0.14, deep + 0.25, shade);

    /* The pediment, and a gilded medallion in its tympanum. */
    pitched(base + 0.62, w + 1.2, deep, 2.3, marble, roof, centre);
    add("cylinder", 0, base + 1.45, front + porch + 0.2, 1.2, 0.12, 1.2, 0xc9a54a, { tiltX: Math.PI / 2 });
  } else if (kind === "pagoda") {
    const red = 0xb23a2e;
    const wood = 0x3b2a24;
    const roof = [0x2f4a45, 0x3d3a44, 0x5a3a2c][variant % 3];
    const gold = 0xd4a64a;

    /* Red posts at the corners of the ground floor. */
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) box(sx * (w / 2 + 0.05), base / 2, sz * (front + 0.05), 0.45, base, 0.45, red, { surface: "wood" });

    /* A torii gate on the approach: posts clear of the path, beams overhead. */
    const gateZ = front + 2.2;

    for (const side of [-1, 1]) {
      add("cylinder", side * 2.3, 2.15, gateZ, 0.42, 4.3, 0.42, red, { solid: true });
      box(side * 3.35, 4.62, gateZ, 0.9, 0.2, 0.55, wood, { tiltZ: side * 0.22 });
    }
    box(0, 4.45, gateZ, 5.8, 0.28, 0.55, wood);
    box(0, 3.85, gateZ, 5.1, 0.22, 0.3, red);
    box(0, 4.15, gateZ, 0.3, 0.4, 0.25, red);

    /* Tiers, each narrower, each under a broad eave with gilded upturned corners. */
    const plan = Math.min(w, d);
    let y = base;

    add("pyramid", 0, y + 0.55, 0, w + 3, 1.1, d + 3, roof);
    box(0, y + 0.02, 0, w + 3.1, 0.12, d + 3.1, wood);
    for (let tier = 0; tier < 4; tier++) {
      const size = plan * (0.78 - tier * 0.13);

      y += tier === 0 ? 0.9 : 0.4;
      box(0, y + 1.1, 0, size, 2.2, size, red, { surface: "wood" });
      for (let face = 0; face < 4; face++) {
        const a = (face * Math.PI) / 2;

        box(Math.sin(a) * (size / 2 + 0.03), y + 1.2, Math.cos(a) * (size / 2 + 0.03), size * 0.5, 1.1, 0.06, wood, { rotation: a });
      }
      y += 2.2;
      add("pyramid", 0, y + 0.5, 0, size + 2.6, 1.0, size + 2.6, roof);
      box(0, y + 0.02, 0, size + 2.7, 0.1, size + 2.7, wood);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          add("cone", sx * (size / 2 + 1.25), y + 0.2, sz * (size / 2 + 1.25), 0.22, 0.55, 0.22, gold, {
            tiltX: -sz * 0.5,
            tiltZ: sx * 0.5,
          });
    }

    /* The finial: a gilded mast of rings. */
    add("cylinder", 0, y + 2.6, 0, 0.16, 4.2, 0.16, gold);
    for (let ring = 0; ring < 6; ring++) add("cylinder", 0, y + 1.3 + ring * 0.45, 0, 0.62 - ring * 0.05, 0.1, 0.62 - ring * 0.05, gold);
    add("sphere", 0, y + 4.8, 0, 0.35, 0.45, 0.35, gold);
  } else if (kind === "castle") {
    const stone = 0xa8a397;
    const dark = 0x5f5b55;
    const slate = [0x3f5872, 0x5a3f3f, 0x3f5a4a][variant % 3];
    const banner = [0xc0392b, 0x2e5fa3, 0xd4a64a][variant % 3];

    doorway(dark);
    /* A portcullis above the doorway, raised. */
    for (let bar = -3; bar <= 3; bar++) box(bar * 0.4, 4.6, front + 0.2, 0.06, 1.2, 0.06, 0x2c2c2c);
    for (const y of [4.2, 4.6, 5.0]) box(0, y, front + 0.2, 2.8, 0.06, 0.06, 0x2c2c2c);

    /* Round towers at the four corners, with slate cones. */
    const towerHeight = base + 3.6;

    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx * w / 2;
        const z = sz * front;

        add("cylinder", x, towerHeight / 2, z, 2.7, towerHeight, 2.7, stone, { surface: "stone", solid: true });
        add("cylinder", x, towerHeight + 0.15, z, 3.0, 0.3, 3.0, dark);
        add("cone", x, towerHeight + 1.9, z, 3.3, 3.4, 3.3, slate);
        for (const y of [2.6, base + 1.6]) box(x + sx * 1.3, y, z, 0.1, 0.9, 0.18, 0x2c2c2c, { rotation: Math.PI / 2 });
      }

    /* The keep above the hall: a ledge, the walls, arrow slits, battlements. */
    box(0, base + 0.12, 0, w + 0.4, 0.25, d + 0.4, dark);
    const keepW = w - 1.6;
    const keepD = d - 1.6;
    const keepTop = base + 5.2;

    box(0, base + 2.6, 0, keepW, 5.2, keepD, stone, { surface: "stone" });
    for (const side of [-1, 1]) {
      for (const x of [-keepW * 0.3, 0, keepW * 0.3]) box(x, base + 2.8, side * (keepD / 2 + 0.03), 0.16, 1.1, 0.06, 0x2c2c2c);
      for (const z of [-keepD * 0.25, keepD * 0.25]) box(side * (keepW / 2 + 0.03), base + 2.8, z, 0.06, 1.1, 0.16, 0x2c2c2c);
    }
    for (let x = -keepW / 2 + 0.3; x <= keepW / 2 - 0.2; x += 1.1)
      for (const side of [-1, 1]) box(x, keepTop + 0.35, side * (keepD / 2 - 0.2), 0.55, 0.7, 0.4, stone, { surface: "stone" });
    for (let z = -keepD / 2 + 0.85; z <= keepD / 2 - 0.8; z += 1.1)
      for (const side of [-1, 1]) box(side * (keepW / 2 - 0.2), keepTop + 0.35, z, 0.4, 0.7, 0.55, stone, { surface: "stone" });

    /* A banner on a pole over the keep. */
    add("cylinder", 0, keepTop + 2.2, 0, 0.12, 4.4, 0.12, 0x3a3a3a);
    add("sail", 0.75, keepTop + 3.7, 0, 1.5, 1.1, 0.04, banner);
  } else if (kind === "lighthouse") {
    const white = 0xf4f1ea;
    const red = [0xc8372d, 0x2d5fa0, 0x2f7d55][variant % 3];
    const dark = 0x2d3338;

    doorway(red);
    for (const side of [-1, 1]) {
      box(side * w * 0.3, 2.7, front + 0.1, 1.5, 1.8, 0.1, 0x659ea7, { glass: true });
      box(side * w * 0.3, 2.7, front + 0.08, 1.8, 2.1, 0.08, white);
    }
    /* The keeper's house roof. */
    pitched(base, w + 0.4, d + 0.2, 2.4, white, red);

    /* The tower: stacked bands, red and white, narrowing as they rise. */
    const tz = -d * 0.12;
    const bands = 5;
    const bandHeight = 3.1;

    for (let band = 0; band < bands; band++) {
      const diameter = 4 - band * 0.28;

      add("cylinder", 0, base + bandHeight * (band + 0.5), tz, diameter, bandHeight, diameter, band % 2 === 0 ? white : red, {
        surface: "stone",
      });
    }
    const top = base + bands * bandHeight;

    add("cylinder", 0, top + 0.15, tz, 4.4, 0.3, 4.4, dark);
    add("ring", 0, top + 0.75, tz, 4.2, 0.9, 4.2, dark);
    add("cylinder", 0, top + 1.35, tz, 2.3, 2.2, 2.3, 0x9fd3e0, { glass: true });
    add("cylinder", 0, top + 1.35, tz, 0.8, 1.2, 0.8, 0xfff0a0);
    add("dome", 0, top + 2.45, tz, 2.7, 1.4, 2.7, red);
    add("cone", 0, top + 4.1, tz, 0.3, 0.6, 0.3, dark);
    for (let window = 0; window < 3; window++)
      box(0, base + 4 + window * 3.4, tz + 2 - window * 0.14, 0.5, 0.9, 0.08, 0x2f4e5a, { glass: true });
  } else if (kind === "cathedral") {
    const stone = 0xd8d2c4;
    const slate = [0x4d5561, 0x5b4d4d, 0x3f5560][variant % 3];
    const glassColors = [0x3f6fb5, 0xb5443f, 0xd4a64a, 0x4f9a6a];

    doorway(0xb9b1a0);
    /* A pointed arch over the door. */
    for (const side of [-1, 1]) box(side * 0.75, 4.35, front + 0.2, 1.8, 0.22, 0.3, 0xb9b1a0, { tiltZ: -side * 0.6 });

    /* The nave's steep roof. */
    pitched(base, w + 0.3, d + 0.2, 5.2, stone, slate);

    /* Tall stained windows down both sides, between buttresses. */
    for (const side of [-1, 1]) {
      for (const z of [-d * 0.3, 0, d * 0.3]) {
        box(side * (w / 2 + 0.1), 2.9, z, 0.08, 3.2, 0.9, glassColors[(Math.round(z) + side + 4) % 4], { glass: true });
        box(side * (w / 2 + 0.1), 4.6, z, 0.08, 0.64, 0.64, glassColors[(Math.round(z) + side + 5) % 4], { glass: true, tiltX: Math.PI / 4 });
      }
      for (const z of [-d * 0.45, -d * 0.15, d * 0.15, d * 0.45]) {
        box(side * (w / 2 + 0.45), 2.3, z, 0.7, 4.6, 0.55, stone, { surface: "stone", solid: true });
        box(side * (w / 2 + 0.3), 5.0, z, 0.5, 1.6, 0.5, stone, { tiltZ: side * 0.35 });
        add("cone", side * (w / 2 + 0.45), 5.3, z, 0.45, 1.2, 0.45, slate);
      }
    }

    /* The bell tower over the entrance, a rose window, and the spire. */
    const tz = front - 1.9;
    const towerTop = base + 8.5;

    box(0, base + 4.25, tz, 3.8, 8.5, 3.6, stone, { surface: "stone" });
    add("cylinder", 0, base + 2.6, tz + 1.84, 2.9, 0.1, 2.9, 0xb9b1a0, { tiltX: Math.PI / 2 });
    add("cylinder", 0, base + 2.6, tz + 1.9, 2.4, 0.08, 2.4, 0x7b5ea7, { glass: true, tiltX: Math.PI / 2 });
    for (let face = 0; face < 4; face++) {
      const a = (face * Math.PI) / 2;

      box(Math.sin(a) * 1.92, base + 6.6, tz + Math.cos(a) * 1.82, 0.9, 1.8, 0.08, 0x2c2c30, { rotation: a });
    }
    box(0, towerTop + 0.15, tz, 4.2, 0.3, 4.0, 0xb9b1a0);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) add("cone", sx * 1.7, towerTop + 1.1, tz + sz * 1.6, 0.5, 1.8, 0.5, slate);
    add("cone", 0, towerTop + 5.2, tz, 3.4, 10, 3.4, slate);
    box(0, towerTop + 10.7, tz, 0.12, 1.3, 0.12, 0xd4a64a);
    box(0, towerTop + 10.9, tz, 0.7, 0.12, 0.12, 0xd4a64a);
  } else {
    /* The corner café. */
    const stripes = [
      [0xd9534f, 0xf6f1e7],
      [0x3f7d5a, 0xf6f1e7],
      [0x2d5fa0, 0xf6f1e7],
    ][variant % 3];
    const trim = 0x2f3a36;

    doorway(trim);
    for (const side of [-1, 1]) {
      const cx = side * (w / 4 + 0.7);
      const span = w / 2 - 2.2;

      /* A big shop window, and a striped awning over it. */
      box(cx, 1.9, front + 0.1, span - 0.3, 2.3, 0.08, 0x8ec1cf, { glass: true });
      box(cx, 1.9, front + 0.07, span, 2.6, 0.08, trim);
      box(cx, 0.45, front + 0.2, span, 0.9, 0.3, trim);
      const count = Math.max(4, Math.round(span / 0.4));

      for (let stripe = 0; stripe < count; stripe++) {
        const x = cx - span / 2 + (stripe + 0.5) * (span / count);

        box(x, 3.55, front + 0.85, span / count + 0.01, 0.05, 1.7, stripes[stripe % 2], { tiltX: 0.4 });
        box(x, 3.12, front + 1.63, span / count + 0.01, 0.28, 0.04, stripes[stripe % 2]);
      }

      /* Two tables out front under parasols, clear of the doorway. */
      for (const offset of [-0.25, 0.25]) {
        const tx = cx + offset * span;
        const tz = front + 2.4;

        add("cylinder", tx, 0.37, tz, 0.08, 0.74, 0.08, trim);
        add("cylinder", tx, 0.76, tz, 0.8, 0.05, 0.8, 0xf1ece2, { solid: true });
        add("cylinder", tx, 1.35, tz, 0.05, 2.7, 0.05, 0xe8e2d4);
        add("cone", tx, 2.55, tz, 2.1, 0.55, 2.1, stripes[0]);
        for (const chair of [-1, 1]) box(tx + chair * 0.65, 0.45, tz, 0.4, 0.05, 0.4, trim);
      }
    }
    /* The sign over the door: a board and a gilded cup. */
    box(0, 4.45, front + 0.25, 3.4, 0.7, 0.12, trim);
    add("cylinder", -1.2, 4.45, front + 0.33, 0.36, 0.08, 0.36, 0xd4a64a, { tiltX: Math.PI / 2 });

    /* An apartment over the café: windows with flower boxes, a parapet. */
    const wall = [0xe9c9b3, 0xd9e2cf, 0xe5d9ef][variant % 3];

    box(0, base + 1.7, 0, w, 3.4, d, wall);
    for (const x of [-w * 0.3, 0, w * 0.3]) {
      box(x, base + 1.9, front + 0.05, 1.3, 1.6, 0.08, 0x8ec1cf, { glass: true });
      box(x, base + 1.9, front + 0.03, 1.55, 1.85, 0.06, 0xf6f1e7);
      box(x, base + 0.95, front + 0.22, 1.5, 0.28, 0.35, 0x6b4a36);
      for (let flower = 0; flower < 4; flower++)
        add("rounded", x - 0.54 + flower * 0.36, base + 1.18, front + 0.24, 0.26, 0.2, 0.26, [0xe0525f, 0xf2c94c, 0xe07aa8, 0xf2f2f2][flower]);
    }
    box(0, base + 3.55, 0, w + 0.2, 0.3, d + 0.2, 0xf6f1e7);
  }

  return parts;
}
