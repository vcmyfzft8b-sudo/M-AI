import { buildingProfile } from "./architecture.ts";
import { STATION_HUE, type PalaceLayout } from "./layout.ts";
import { SUN_DIRECTION } from "./sun.ts";

/**
 * The town as a model on a table: the card that opens the palace.
 *
 * The walk itself is 3D, and a flat plan of it undersold that — a grid of grey
 * squares says "map", not "place". So the card draws the same layout the engine
 * builds, turned forty-five degrees and seen from above: every building at its
 * real height and in its real colours, the shadows the sun throws in the game,
 * the trees in the gardens and a beam over every stop still waiting.
 *
 * It is plain 2D canvas on purpose. The card is on screen before anyone has
 * asked to play, and three.js is loaded only when they do; this costs one
 * paint, on the main thread, a few milliseconds even for a sixty-stop town.
 *
 * Shared by the app's palace tab and the landing page's demo of it, which also
 * walks Memo across it (`walker`).
 */

export type DioramaWalker = { x: number; z: number };

type Point = { x: number; y: number };
type Footprint = { x: number; z: number }[];

/* How much the ground is squashed, and how tall a metre stands, against a metre
   across it. Classic isometric is 0.5; a touch more shows more of the streets. */
const TILT = 0.56;
const RISE = 0.82;

const SKY_TOP = "#6fb2ea";
const SKY_BOTTOM = "#d9ecf8";
const GRASS_NEAR = "#63a843";
const GRASS_FAR = "#86c25e";
const PAVEMENT = "#dcded6";
const ROAD = "#555f68";
const ROAD_MARK = "rgba(255, 255, 255, 0.8)";
const SHADOW = "rgba(24, 48, 30, 0.26)";

function mix(hex: string, amount: number) {
  const value = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const base = (value >> shift) & 255;
    const shaded = amount >= 0 ? base + (255 - base) * amount : base * (1 + amount);

    return Math.round(Math.max(0, Math.min(255, shaded)));
  };

  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function hexColor(value: number) {
  return `#${value.toString(16).padStart(6, "0")}`;
}

function hslToHex(hue: number, saturation: number, lightness: number) {
  const s = Math.max(0, Math.min(1, saturation));
  const l = Math.max(0, Math.min(1, lightness));
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const byte = (n: number) => Math.round(f(n) * 255);

  return `#${[byte(0), byte(8), byte(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  const upper: Point[] = [];

  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) lower.pop();
    lower.push(point);
  }

  for (const point of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) upper.pop();
    upper.push(point);
  }

  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function paintTownDiorama(
  canvas: HTMLCanvasElement | null,
  {
    layout,
    collected,
    walker = null,
  }: {
    layout: PalaceLayout;
    collected: ReadonlySet<string>;
    walker?: DioramaWalker | null;
  },
) {
  if (!canvas) return;

  /* The element's own size, not its on-screen one: the landing may be showing it scaled. */
  const box = canvas.getBoundingClientRect();
  const width = Math.round(canvas.clientWidth || box.width);
  const height = Math.round(canvas.clientHeight || box.height);

  if (width === 0 || height === 0) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);

  const context = canvas.getContext("2d");

  if (!context) return;

  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  const profiles = layout.houses.map((house, index) => buildingProfile(house, index));
  const tallest = Math.max(10, ...profiles.map((profile) => profile.height));
  /*
   * The whole walkable square, cut out as a slab of ground with its soil
   * showing at the front edges: a model on a table, which is the reading that
   * makes a 2D picture look 3D at a glance.
   */
  const slab = layout.bounds;
  const soil = Math.max(6, slab * 0.07);
  const diagonal = slab * Math.SQRT2;
  const scale = Math.min(
    width / (diagonal * 2 * 1.04),
    height / (diagonal * 2 * TILT + soil * RISE + tallest * RISE * 0.45),
  );
  /* Centred on the slab and its soil, with the towers allowed into the sky. */
  const centreY = height / 2 + (tallest * RISE * scale * 0.45 - soil * RISE * scale) / 2;

  const project = (x: number, z: number, y = 0): Point => {
    const across = (x - z) / Math.SQRT2;
    const depth = (x + z) / Math.SQRT2;

    return { x: width / 2 + across * scale, y: centreY + depth * scale * TILT - y * scale * RISE };
  };
  const depthOf = (x: number, z: number) => x + z;

  const trace = (points: Point[]) => {
    context.beginPath();
    points.forEach((point, index) => (index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y)));
    context.closePath();
  };
  const polygon = (points: Point[], fill: string | CanvasGradient) => {
    trace(points);
    context.fillStyle = fill;
    context.fill();
  };
  const flat = (x: number, z: number, w: number, d: number, fill: string, y = 0) =>
    polygon(
      [project(x - w / 2, z - d / 2, y), project(x + w / 2, z - d / 2, y), project(x + w / 2, z + d / 2, y), project(x - w / 2, z + d / 2, y)],
      fill,
    );

  context.clearRect(0, 0, width, height);
  context.save();
  context.beginPath();
  context.roundRect(0, 0, width, height, 18);
  context.clip();

  const sky = context.createLinearGradient(0, 0, 0, height);

  sky.addColorStop(0, SKY_TOP);
  sky.addColorStop(1, SKY_BOTTOM);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, height);

  /* A few clouds, always the same few: the card is a picture of this note's town. */
  context.fillStyle = "rgba(255, 255, 255, 0.75)";
  [[0.14, 0.2, 1], [0.8, 0.14, 0.8], [0.9, 0.62, 0.7], [0.1, 0.7, 0.6]].forEach(([u, v, size]) => {
    const radius = Math.min(width, height) * 0.07 * size;
    const x = width * u;
    const y = height * v;

    context.beginPath();
    context.ellipse(x, y, radius * 1.6, radius * 0.6, 0, 0, Math.PI * 2);
    context.ellipse(x - radius * 0.6, y - radius * 0.3, radius * 0.7, radius * 0.55, 0, 0, Math.PI * 2);
    context.ellipse(x + radius * 0.5, y - radius * 0.4, radius * 0.8, radius * 0.65, 0, 0, Math.PI * 2);
    context.fill();
  });

  const north = project(-slab, -slab);
  const east = project(slab, -slab);
  const south = project(slab, slab);
  const west = project(-slab, slab);
  const drop = soil * RISE * scale;
  const below = (point: Point) => ({ x: point.x, y: point.y + drop });

  /* Its shadow on the table. */
  context.save();
  context.shadowColor = "rgba(20, 40, 70, 0.35)";
  context.shadowBlur = 24;
  context.shadowOffsetY = 10;
  polygon([north, east, below(east), below(south), below(west), west], "#6d4a30");
  context.restore();

  /* The soil at the two front edges, darker on the side away from the sun. */
  const earthLeft = context.createLinearGradient(0, west.y, 0, below(south).y);

  earthLeft.addColorStop(0, "#8a6040");
  earthLeft.addColorStop(1, "#5e3f28");
  polygon([west, south, below(south), below(west)], earthLeft);

  const earthRight = context.createLinearGradient(0, east.y, 0, below(south).y);

  earthRight.addColorStop(0, "#9c6e4a");
  earthRight.addColorStop(1, "#6b4830");
  polygon([south, east, below(east), below(south)], earthRight);

  /* A lip of turf over the soil. */
  const lip = drop * 0.16;

  polygon([west, south, { x: south.x, y: south.y + lip }, { x: west.x, y: west.y + lip }], "#4f8f35");
  polygon([south, east, { x: east.x, y: east.y + lip }, { x: south.x, y: south.y + lip }], "#5c9d3f");

  const grass = context.createLinearGradient(0, north.y, 0, south.y);

  grass.addColorStop(0, GRASS_FAR);
  grass.addColorStop(1, GRASS_NEAR);
  polygon([north, east, south, west], grass);

  /* Everything on the ground stays on the slab. */
  context.save();
  trace([north, east, south, west]);
  context.clip();

  /* Streets: pavement under tarmac under paint, as the engine stacks them. */
  layout.pavements.forEach((path) => flat(path.x, path.z, path.width, path.depth, PAVEMENT));
  layout.roads.forEach((road) => flat(road.x, road.z, road.width, road.depth, ROAD));
  layout.roadMarks.forEach((mark) => flat(mark.x, mark.z, mark.width, mark.depth, ROAD_MARK));

  const footprint = (index: number): Footprint => {
    const house = layout.houses[index];
    const out = { x: Math.sin(house.facing), z: Math.cos(house.facing) };
    const along = { x: Math.cos(house.facing), z: -Math.sin(house.facing) };
    const corner = (forward: number, sideways: number) => ({
      x: house.x + out.x * forward + along.x * sideways,
      z: house.z + out.z * forward + along.z * sideways,
    });

    return [
      corner(house.depth / 2, -house.width / 2),
      corner(house.depth / 2, house.width / 2),
      corner(-house.depth / 2, house.width / 2),
      corner(-house.depth / 2, -house.width / 2),
    ];
  };

  /* Shadows first, all of them, so no building's shadow lands on another's wall. */
  const shadowReach = { x: -SUN_DIRECTION.x / SUN_DIRECTION.y, z: -SUN_DIRECTION.z / SUN_DIRECTION.y };

  layout.houses.forEach((_, index) => {
    const base = footprint(index);
    const rise = profiles[index].height;
    const cast = base.map((corner) => ({ x: corner.x + shadowReach.x * rise, z: corner.z + shadowReach.z * rise }));

    polygon(convexHull([...base, ...cast].map((corner) => project(corner.x, corner.z))), SHADOW);
  });

  context.restore();

  type Drawable = { depth: number; draw: () => void };
  const drawables: Drawable[] = [];

  /*
   * A face is lit by how squarely it meets the sun, which is what makes a box
   * read as a box: the sunny side, the shaded side and the roof are three tones
   * of one colour rather than three colours.
   */
  const light = { x: -SUN_DIRECTION.x, z: -SUN_DIRECTION.z };
  const lightLength = Math.hypot(light.x, light.z);

  layout.houses.forEach((house, index) => {
    const profile = profiles[index];
    const base = footprint(index);
    const rise = profile.height;
    const tall = profile.kind === "helix" || profile.kind === "spire" || profile.kind === "tower";
    const wall = tall ? hexColor(profile.glass) : hexColor(profile.wall);
    const roof = tall
      ? mix(hexColor(profile.glass), 0.35)
      : hslToHex(house.roofHue, house.roofSaturation, house.roofLightness);

    drawables.push({
      depth: depthOf(house.x, house.z),
      draw: () => {
        for (let side = 0; side < 4; side++) {
          const a = base[side];
          const b = base[(side + 1) % 4];
          /* Outward normal of this wall, in the ground plane. */
          const normal = { x: b.z - a.z, z: -(b.x - a.x) };
          const length = Math.hypot(normal.x, normal.z) || 1;
          const facing = (normal.x + normal.z) / length;

          if (facing <= 0) continue;

          const sun = (normal.x * light.x + normal.z * light.z) / (length * lightLength);
          const tone = mix(wall, sun > 0 ? -0.04 : -0.2 + sun * 0.12);

          polygon([project(a.x, a.z), project(b.x, b.z), project(b.x, b.z, rise), project(a.x, a.z, rise)], tone);

          /* Floors on the towers, a row of windows on everything else. */
          context.strokeStyle = tall ? "rgba(255, 255, 255, 0.28)" : "rgba(30, 60, 80, 0.3)";
          context.lineWidth = Math.max(0.6, scale * 0.35);
          const rows = tall ? Math.floor(rise / 3.6) : Math.max(1, house.storeys);

          for (let row = 1; row <= rows; row++) {
            const y = tall ? row * 3.6 : (rise * (row - 0.45)) / (rows + 0.2);

            if (y >= rise - 0.4) break;

            const from = project(a.x + (b.x - a.x) * 0.12, a.z + (b.z - a.z) * 0.12, y);
            const to = project(a.x + (b.x - a.x) * 0.88, a.z + (b.z - a.z) * 0.88, y);

            context.beginPath();
            context.moveTo(from.x, from.y);
            context.lineTo(to.x, to.y);
            context.stroke();
          }
        }

        const top = base.map((corner) => project(corner.x, corner.z, rise));

        polygon(top, roof);

        /* A lighter inset on the roof, so a flat top reads as a roof and not a lid. */
        const inset = base.map((corner) => ({
          x: house.x + (corner.x - house.x) * 0.72,
          z: house.z + (corner.z - house.z) * 0.72,
        }));

        polygon(inset.map((corner) => project(corner.x, corner.z, rise)), mix(roof, 0.12));
      },
    });
  });

  layout.props.forEach((prop) => {
    if (prop.kind !== "tree" && prop.kind !== "hedge") return;

    const radius = (prop.kind === "tree" ? 1.9 : 1.1) * prop.scale;
    const rise = (prop.kind === "tree" ? 4.4 : 1.2) * prop.scale;

    drawables.push({
      depth: depthOf(prop.x, prop.z),
      draw: () => {
        const foot = project(prop.x, prop.z);
        const crown = project(prop.x, prop.z, rise);
        const size = Math.max(1.4, radius * scale);

        context.fillStyle = SHADOW;
        context.beginPath();
        context.ellipse(foot.x + size * 0.5, foot.y + size * 0.15, size, size * TILT, 0, 0, Math.PI * 2);
        context.fill();

        if (prop.kind === "tree") {
          context.strokeStyle = "#7a5a3c";
          context.lineWidth = Math.max(1, scale * 0.45);
          context.beginPath();
          context.moveTo(foot.x, foot.y);
          context.lineTo(crown.x, crown.y);
          context.stroke();
        }

        const leaves = context.createRadialGradient(
          crown.x - size * 0.35,
          crown.y - size * 0.4,
          size * 0.1,
          crown.x,
          crown.y,
          size,
        );

        leaves.addColorStop(0, "#8fd16a");
        leaves.addColorStop(1, "#3f8a3a");
        context.fillStyle = leaves;
        context.beginPath();
        context.ellipse(crown.x, crown.y, size, size * 0.86, 0, 0, Math.PI * 2);
        context.fill();
      },
    });
  });

  /*
   * The stops: a beam over every one still waiting, in its ring's colour, the
   * same signal the game raises over the roofs. Collected ones keep a faint
   * mark, so the route stays on the model.
   */
  layout.stations.forEach((entry) => {
    const done = collected.has(entry.id);

    drawables.push({
      depth: depthOf(entry.x, entry.z) + 0.5,
      draw: () => {
        const foot = project(entry.x, entry.z);
        const size = Math.max(3.2, scale * 1.8);

        if (done) {
          context.fillStyle = "rgba(255, 255, 255, 0.55)";
          context.beginPath();
          context.ellipse(foot.x, foot.y, size * 0.7, size * 0.7 * TILT, 0, 0, Math.PI * 2);
          context.fill();

          return;
        }

        const hue = STATION_HUE[entry.kind];
        const tip = project(entry.x, entry.z, 26);
        const beam = context.createLinearGradient(0, foot.y, 0, tip.y);

        beam.addColorStop(0, `hsl(${hue} 90% 66% / 0.85)`);
        beam.addColorStop(1, `hsl(${hue} 90% 70% / 0)`);
        context.fillStyle = beam;
        context.fillRect(foot.x - size * 0.45, tip.y, size * 0.9, foot.y - tip.y);

        context.fillStyle = `hsl(${hue} 85% 60% / 0.35)`;
        context.beginPath();
        context.ellipse(foot.x, foot.y, size * 1.7, size * 1.7 * TILT, 0, 0, Math.PI * 2);
        context.fill();

        context.fillStyle = `hsl(${hue} 80% 58%)`;
        context.strokeStyle = "#ffffff";
        context.lineWidth = Math.max(1, size * 0.28);
        context.beginPath();
        context.arc(foot.x, foot.y - size * 0.6, size * 0.75, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      },
    });
  });

  if (walker) {
    drawables.push({
      depth: depthOf(walker.x, walker.z) + 1,
      draw: () => {
        const foot = project(walker.x, walker.z);
        const size = Math.max(3, scale * 1.6);

        context.fillStyle = "rgba(14, 12, 20, 0.3)";
        context.beginPath();
        context.ellipse(foot.x, foot.y, size, size * TILT, 0, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#ffffff";
        context.strokeStyle = "rgba(14, 12, 20, 0.85)";
        context.lineWidth = 1.4;
        context.beginPath();
        context.arc(foot.x, foot.y - size * 1.1, size * 0.85, 0, Math.PI * 2);
        context.fill();
        context.stroke();
      },
    });
  }

  drawables.sort((a, b) => a.depth - b.depth).forEach((drawable) => drawable.draw());

  context.restore();
}
