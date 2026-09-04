// Imported by its real filename so the Node test runner can load the layout
// directly; it cannot resolve the "@/" alias.
import { createRandom, seedFromString } from "./rng.ts";

/**
 * The city a note becomes.
 *
 * The method of loci works because a route through a place is easier to hold
 * than a list: you remember the third pedestal on the left, and the fact comes
 * with it. So the layout is not decoration — it is the index. One district per
 * study section, one screen per card, always in the same order, always in the
 * same place, so "the card by the red tower" stays true tomorrow.
 *
 * Everything here is plain geometry with no three.js in sight: the renderer
 * consumes this, and the tests can too.
 */

export type Vec2 = { x: number; z: number };

/** An axis-aligned box on the ground plane. `x`/`z` are its centre. */
export type Box = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
};

export type BuildingKind = "tower" | "block" | "shop";

export type PalaceBuilding = Box & {
  kind: BuildingKind;
  /** Hue in degrees, so a district's buildings share a family of colours. */
  hue: number;
  /** Rows of windows on the facade, 0 for the plain shopfronts. */
  floors: number;
  /** Which way the facade faces, in radians (0 = towards -Z). */
  facing: number;
};

export type PropKind =
  | "tree"
  | "car"
  | "hydrant"
  | "bench"
  | "balloon"
  | "cloud"
  | "lamp"
  | "bin"
  | "hedge"
  | "hill";

export type PalaceProp = {
  kind: PropKind;
  x: number;
  z: number;
  /** Height off the ground for the things that float. */
  y: number;
  rotation: number;
  scale: number;
  hue: number;
};

export type PalaceStation = {
  /** The flashcard's id — the station *is* the card. */
  id: string;
  index: number;
  districtIndex: number;
  /** Where the collectible floats, a step in front of the screen. */
  x: number;
  z: number;
  /** The screen's centre and the way it faces, in radians. */
  screen: { x: number; z: number; y: number; width: number; height: number; facing: number };
  hue: number;
};

export type PalaceDistrict = {
  index: number;
  title: string;
  center: Vec2;
  radius: number;
  hue: number;
  stationIds: string[];
};

export type PalaceLayout = {
  seed: number;
  districts: PalaceDistrict[];
  buildings: PalaceBuilding[];
  props: PalaceProp[];
  stations: PalaceStation[];
  roads: Box[];
  /** The footpaths either side of every street. */
  pavements: Box[];
  /** The raised edge between road and pavement. */
  kerbs: Box[];
  /** Centre lines and zebra crossings, painted flat on the road. */
  roadMarks: Box[];
  spawn: { x: number; z: number; yaw: number };
  /** Half-extent of the walkable world, measured from the origin. */
  bounds: number;
};

export type PalaceCard = {
  id: string;
  sectionId: string | null;
};

export type PalaceSection = {
  id: string;
  title: string;
};

/** A district's plaza is a circle; the buildings stand just outside it. */
const MIN_PLAZA_RADIUS = 16;
const MAX_PLAZA_RADIUS = 26;
/**
 * How much room a plaza needs around it before the next street: the ring of
 * buildings the cards hang on reaches about twenty metres past the plaza edge,
 * and a street has to clear that ring, not cut through it.
 */
const PLAZA_MARGIN = 30;
const DISTRICT_GAP = PLAZA_MARGIN * 2;
const ROAD_WIDTH = 11;
const PAVEMENT_WIDTH = 5;
const SCREEN_WIDTH = 7.2;
const SCREEN_HEIGHT = 4.4;
/** The collectible floats this far in front of its screen, inside the plaza. */
const STATION_STANDOFF = 4.6;

/**
 * Districts sit on a square grid rather than a line, so a note with twelve
 * sections is still a city you can cross in a few seconds rather than a
 * corridor you jog down for a minute.
 */
function districtGridPosition(index: number, count: number, pitch: number): Vec2 {
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const column = index % columns;
  const row = Math.floor(index / columns);

  return {
    x: (column - (columns - 1) / 2) * pitch,
    z: (row - (rows - 1) / 2) * pitch,
  };
}

function plazaRadius(stationCount: number) {
  /* Enough arc for every screen to be read without its neighbour crowding it. */
  const needed = (Math.max(stationCount, 1) * (SCREEN_WIDTH + 4.5)) / (2 * Math.PI);

  return Math.min(MAX_PLAZA_RADIUS, Math.max(MIN_PLAZA_RADIUS, needed));
}

/**
 * Cards keep the order the deck gives them, grouped by the section they were
 * written from. Cards with no section — older notes, and anything generated
 * before sections existed — are spread over the districts that do exist rather
 * than piled into one nameless corner.
 */
export function groupCardsIntoDistricts(
  cards: readonly PalaceCard[],
  sections: readonly PalaceSection[],
  fallbackTitle: string,
) {
  const sectioned = sections.filter((section) =>
    cards.some((card) => card.sectionId === section.id),
  );

  if (sectioned.length === 0) {
    /*
     * No usable sections: cut the deck into blocks of a walkable size so the
     * city still has more than one place in it.
     */
    const perDistrict = 8;
    const groupCount = Math.max(1, Math.ceil(cards.length / perDistrict));

    return Array.from({ length: groupCount }, (_, index) => ({
      title: groupCount === 1 ? fallbackTitle : `${fallbackTitle} ${index + 1}`,
      cards: cards.slice(index * perDistrict, (index + 1) * perDistrict),
    })).filter((group) => group.cards.length > 0);
  }

  const groups = sectioned.map((section) => ({
    title: section.title,
    cards: cards.filter((card) => card.sectionId === section.id),
  }));
  const orphans = cards.filter(
    (card) => !sectioned.some((section) => section.id === card.sectionId),
  );

  orphans.forEach((card, index) => {
    groups[index % groups.length].cards.push(card);
  });

  return groups.filter((group) => group.cards.length > 0);
}

/**
 * How far the map has to reach to hold the whole city, with a little air around
 * the outermost plaza. Taken from the districts rather than from `bounds`,
 * which includes the empty outskirts and would draw the city as a dot.
 */
export function mapExtent(layout: Pick<PalaceLayout, "districts">) {
  return (
    Math.max(
      ...layout.districts.map(
        (district) =>
          Math.max(Math.abs(district.center.x), Math.abs(district.center.z)) + district.radius,
      ),
    ) + 12
  );
}

/**
 * The angle to rotate a north-pointing arrow by so it points where the player
 * is facing, on a canvas whose y axis runs south. Facing 0 is +Z, which is
 * down the map, so the arrow starts turned all the way round.
 */
export function mapArrowAngle(facing: number) {
  return Math.PI - facing;
}

export function buildPalaceLayout({
  seedSource,
  cards,
  sections,
  fallbackTitle = "Notes",
}: {
  seedSource: string;
  cards: readonly PalaceCard[];
  sections: readonly PalaceSection[];
  fallbackTitle?: string;
}): PalaceLayout {
  const seed = seedFromString(seedSource);
  const random = createRandom(seed);
  const groups = groupCardsIntoDistricts(cards, sections, fallbackTitle);
  const radii = groups.map((group) => plazaRadius(group.cards.length));
  const pitch = Math.max(...radii) * 2 + DISTRICT_GAP;

  const districts: PalaceDistrict[] = [];
  const buildings: PalaceBuilding[] = [];
  const props: PalaceProp[] = [];
  const stations: PalaceStation[] = [];

  groups.forEach((group, districtIndex) => {
    const center = districtGridPosition(districtIndex, groups.length, pitch);
    const radius = radii[districtIndex];
    /* Districts are told apart by colour before they are told apart by name. */
    const hue = (districtIndex * 47 + 20) % 360;

    const districtStations: PalaceStation[] = group.cards.map((card, cardIndex) => {
      /*
       * The first card of every district sits at the same bearing, so walking in
       * from the street always puts card one on your right and the route runs
       * clockwise from there.
       */
      const angle = (cardIndex / group.cards.length) * Math.PI * 2 - Math.PI / 2;
      const screenX = center.x + Math.cos(angle) * radius;
      const screenZ = center.z + Math.sin(angle) * radius;
      /* Facing the plaza: the screen looks back at the district's centre. */
      const facing = Math.atan2(center.x - screenX, center.z - screenZ);

      return {
        id: card.id,
        index: stations.length + cardIndex,
        districtIndex,
        x: center.x + Math.cos(angle) * (radius - STATION_STANDOFF),
        z: center.z + Math.sin(angle) * (radius - STATION_STANDOFF),
        screen: {
          x: screenX,
          z: screenZ,
          y: 5.2,
          width: SCREEN_WIDTH,
          height: SCREEN_HEIGHT,
          facing,
        },
        hue,
      };
    });

    stations.push(...districtStations);
    districts.push({
      index: districtIndex,
      title: group.title,
      center,
      radius,
      hue,
      stationIds: districtStations.map((station) => station.id),
    });

    /* A building behind every screen, so each card has a face to hang on. */
    districtStations.forEach((station, cardIndex) => {
      const angle = Math.atan2(station.screen.z - center.z, station.screen.x - center.x);
      const depth = random.range(9, 14);
      const distance = radius + depth / 2 + 0.4;
      /*
       * Towers and blocks only: a board hangs at five metres and a shopfront is
       * barely taller than that, so the card would overhang its own building.
       */
      const kind: BuildingKind = cardIndex % 2 === 0 ? "tower" : "block";
      const height = kind === "tower" ? random.range(18, 34) : random.range(12, 17);

      buildings.push({
        x: center.x + Math.cos(angle) * distance,
        z: center.z + Math.sin(angle) * distance,
        width: random.range(10, 13.5),
        depth,
        height,
        kind,
        hue: (hue + random.range(-16, 16) + 360) % 360,
        floors: Math.max(2, Math.round(height / 3.2)),
        facing: station.screen.facing,
      });

      /* Street furniture in the gap between one screen and the next. */
      const gapAngle = angle + Math.PI / Math.max(group.cards.length, 3);
      props.push({
        kind: random.chance(0.55) ? "tree" : random.chance(0.5) ? "lamp" : "bench",
        x: center.x + Math.cos(gapAngle) * (radius - 2.2),
        z: center.z + Math.sin(gapAngle) * (radius - 2.2),
        y: 0,
        rotation: gapAngle + Math.PI,
        scale: random.range(0.85, 1.25),
        hue: random.range(95, 140),
      });
    });

    /*
     * The plaza's own furniture: planters and benches on an inner ring, so the
     * open middle you arrive in still has something in it, and the walk round
     * the cards passes something at every quarter turn.
     */
    for (let seat = 0; seat < 6; seat += 1) {
      const angle = (seat / 6) * Math.PI * 2 + 0.4;

      props.push({
        kind: seat % 2 === 0 ? "hedge" : "bench",
        x: center.x + Math.cos(angle) * radius * 0.46,
        z: center.z + Math.sin(angle) * radius * 0.46,
        y: 0,
        rotation: angle + Math.PI / 2,
        /* Planters, not the garden hedges outside: knee height, so the plaza stays open. */
        scale: random.range(0.42, 0.55),
        hue: random.range(100, 135),
      });
    }

    /* A landmark in the middle of the plaza — the thing you steer by. */
    props.push({
      kind: "balloon",
      x: center.x,
      z: center.z,
      y: random.range(15, 21),
      rotation: random.range(0, Math.PI * 2),
      scale: random.range(0.9, 1.3),
      hue,
    });
  });

  /*
   * Streets run *between* the plazas, never through one: a plaza is a block of
   * its own, and a road drawn across it would run straight into the building a
   * card hangs on. So the grid is the midpoints between the district rows and
   * columns, plus one street past each outer edge to give the town a boundary
   * to build along.
   */
  const roads: Box[] = [];
  const pavements: Box[] = [];
  const kerbs: Box[] = [];
  const roadMarks: Box[] = [];
  const ringOffset = Math.max(...radii) + PLAZA_MARGIN;
  const streetsBetween = (centres: number[]) => {
    const sorted = [...new Set(centres.map((value) => Number(value.toFixed(2))))].sort(
      (left, right) => left - right,
    );
    const streets = sorted
      .slice(0, -1)
      .map((value, index) => (value + sorted[index + 1]) / 2);

    return [sorted[0] - ringOffset, ...streets, sorted[sorted.length - 1] + ringOffset];
  };

  const streetX = streetsBetween(districts.map((district) => district.center.x));
  const streetZ = streetsBetween(districts.map((district) => district.center.z));
  /* Room past the last street for the houses that line it, and a wood beyond. */
  const townEdge = Math.max(...streetX.map(Math.abs), ...streetZ.map(Math.abs));
  const bounds = townEdge + 26;

  /* Road, kerb, and a footpath either side — without the path it is a lane through a field. */
  streetZ.forEach((z) => {
    roads.push({ x: 0, z, width: bounds * 2, depth: ROAD_WIDTH, height: 0 });

    for (const side of [-1, 1]) {
      const edge = z + (side * ROAD_WIDTH) / 2;

      kerbs.push({ x: 0, z: edge, width: bounds * 2, depth: 0.7, height: 0.16 });
      pavements.push({
        x: 0,
        z: edge + (side * PAVEMENT_WIDTH) / 2,
        width: bounds * 2,
        depth: PAVEMENT_WIDTH,
        height: 0,
      });
    }
  });

  streetX.forEach((x) => {
    roads.push({ x, z: 0, width: ROAD_WIDTH, depth: bounds * 2, height: 0 });

    for (const side of [-1, 1]) {
      const edge = x + (side * ROAD_WIDTH) / 2;

      kerbs.push({ x: edge, z: 0, width: 0.7, depth: bounds * 2, height: 0.16 });
      pavements.push({
        x: edge + (side * PAVEMENT_WIDTH) / 2,
        z: 0,
        width: PAVEMENT_WIDTH,
        depth: bounds * 2,
        height: 0,
      });
    }
  });

  const nearAJunction = (x: number, z: number) =>
    streetX.some((value) => Math.abs(value - x) < ROAD_WIDTH + 4) ||
    streetZ.some((value) => Math.abs(value - z) < ROAD_WIDTH + 4);

  /* Centre lines, broken at the junctions the way real ones are. */
  streetZ.forEach((z) => {
    for (let x = -bounds + 6; x < bounds - 6; x += 9) {
      if (nearAJunction(x, z + 1000)) continue;

      roadMarks.push({ x, z, width: 3.4, depth: 0.4, height: 0 });
    }
  });

  streetX.forEach((x) => {
    for (let z = -bounds + 6; z < bounds - 6; z += 9) {
      if (nearAJunction(x + 1000, z)) continue;

      roadMarks.push({ x, z, width: 0.4, depth: 3.4, height: 0 });
    }
  });

  /* Zebra crossings on every approach to a junction. */
  streetZ.forEach((z) => {
    streetX.forEach((x) => {
      for (let stripe = 0; stripe < 5; stripe += 1) {
        const offset = (stripe - 2) * 1.8;

        roadMarks.push({ x: x + offset, z: z - ROAD_WIDTH, width: 0.9, depth: ROAD_WIDTH - 2, height: 0 });
        roadMarks.push({ x: x + offset, z: z + ROAD_WIDTH, width: 0.9, depth: ROAD_WIDTH - 2, height: 0 });
        roadMarks.push({ x: x - ROAD_WIDTH, z: z + offset, width: ROAD_WIDTH - 2, depth: 0.9, height: 0 });
        roadMarks.push({ x: x + ROAD_WIDTH, z: z + offset, width: ROAD_WIDTH - 2, depth: 0.9, height: 0 });
      }
    });
  });

  /*
   * The town itself: houses and shops down both sides of every street, which is
   * what turns a set of plazas into somewhere you can get lost. Anything that
   * would land on a plaza, in the road, or on top of a building already placed
   * is simply skipped — the gaps read as side streets and yards.
   */
  const occupied: { x: number; z: number; width: number; depth: number }[] = buildings.map(
    (building) => ({
      x: building.x,
      z: building.z,
      width: building.width,
      depth: building.depth,
    }),
  );

  const isFree = (x: number, z: number, width: number, depth: number) => {
    if (Math.abs(x) > bounds - 6 || Math.abs(z) > bounds - 6) return false;

    const onAPlaza = districts.some(
      (district) =>
        Math.hypot(district.center.x - x, district.center.z - z) <
        district.radius + Math.max(width, depth) / 2 + 7,
    );

    if (onAPlaza) return false;

    const inTheRoad =
      streetX.some((value) => Math.abs(value - x) < ROAD_WIDTH / 2 + width / 2 + 2.5) ||
      streetZ.some((value) => Math.abs(value - z) < ROAD_WIDTH / 2 + depth / 2 + 2.5);

    if (inTheRoad) return false;

    return !occupied.some(
      (taken) =>
        Math.abs(taken.x - x) < (taken.width + width) / 2 + 2 &&
        Math.abs(taken.z - z) < (taken.depth + depth) / 2 + 2,
    );
  };

  const addTownBuilding = (x: number, z: number, facing: number, hue: number) => {
    const kind: BuildingKind = random.chance(0.42) ? "shop" : random.chance(0.7) ? "block" : "tower";
    const width = random.range(8, 13);
    const depth = random.range(8, 12);
    const height =
      kind === "tower" ? random.range(15, 26) : kind === "block" ? random.range(9, 14) : random.range(5.5, 7.5);

    if (!isFree(x, z, width, depth)) return false;

    occupied.push({ x, z, width, depth });
    buildings.push({
      x,
      z,
      width,
      depth,
      height,
      kind,
      hue,
      floors: kind === "shop" ? 0 : Math.max(2, Math.round(height / 3.4)),
      facing,
    });

    return true;
  };

  const setBack = ROAD_WIDTH / 2 + 8;

  streetZ.forEach((z) => {
    for (let x = -bounds + 14; x < bounds - 14; x += random.range(15, 21)) {
      /* The two sides of a street face each other. */
      addTownBuilding(x, z - setBack, 0, random.range(0, 360));
      addTownBuilding(x, z + setBack, Math.PI, random.range(0, 360));
    }
  });

  streetX.forEach((x) => {
    for (let z = -bounds + 14; z < bounds - 14; z += random.range(15, 21)) {
      addTownBuilding(x - setBack, z, Math.PI / 2, random.range(0, 360));
      addTownBuilding(x + setBack, z, -Math.PI / 2, random.range(0, 360));
    }
  });

  /* Street furniture down the kerbs: lamps, bins, benches and parked cars. */
  streetZ.forEach((z) => {
    for (let x = -bounds + 12; x < bounds - 12; x += 17) {
      const side = random.chance(0.5) ? -1 : 1;
      const kerb = z + side * (ROAD_WIDTH / 2 + 1.6);

      props.push({ kind: "lamp", x, z: kerb, y: 0, rotation: 0, scale: 1, hue: 0 });

      if (random.chance(0.5) && !nearAJunction(x, z + 1000)) {
        props.push({
          kind: "car",
          x: x + random.range(-4, 4),
          z: z + side * (ROAD_WIDTH / 2 - 1.4),
          y: 0,
          rotation: 0,
          scale: 1,
          hue: random.range(0, 360),
        });
      }

      if (random.chance(0.35)) {
        props.push({ kind: "bin", x: x + 3.2, z: kerb, y: 0, rotation: 0, scale: 1, hue: 0 });
      }
    }
  });

  streetX.forEach((x) => {
    for (let z = -bounds + 12; z < bounds - 12; z += 17) {
      const side = random.chance(0.5) ? -1 : 1;
      const kerb = x + side * (ROAD_WIDTH / 2 + 1.6);

      props.push({ kind: "lamp", x: kerb, z, y: 0, rotation: 0, scale: 1, hue: 0 });

      if (random.chance(0.5) && !nearAJunction(x + 1000, z)) {
        props.push({
          kind: "car",
          x: x + side * (ROAD_WIDTH / 2 - 1.4),
          z: z + random.range(-4, 4),
          y: 0,
          rotation: Math.PI / 2,
          scale: 1,
          hue: random.range(0, 360),
        });
      }

      if (random.chance(0.3)) {
        props.push({ kind: "bench", x: kerb, z: z + 3.4, y: 0, rotation: 0, scale: 1, hue: 0 });
      }
    }
  });

  /*
   * A wood around the outside, so the edge of the walkable world is a tree line
   * rather than the moment the grass runs out.
   */
  for (let index = 0; index < 120; index += 1) {
    const angle = random.range(0, Math.PI * 2);
    const distance = random.range(townEdge + 9, bounds - 2);

    props.push({
      kind: "tree",
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      y: 0,
      rotation: random.range(0, Math.PI * 2),
      scale: random.range(0.9, 1.6),
      hue: random.range(95, 140),
    });
  }

  /* Gardens: hedges and trees in whatever the streets left over. */
  for (let index = 0; index < 260; index += 1) {
    const x = random.range(-bounds, bounds);
    const z = random.range(-bounds, bounds);

    if (!isFree(x, z, 4, 4)) continue;

    const kind: PropKind = random.chance(0.6) ? "tree" : random.chance(0.55) ? "hedge" : "hydrant";

    props.push({
      kind,
      x,
      z,
      y: 0,
      rotation: random.range(0, Math.PI * 2),
      scale: random.range(0.8, 1.35),
      hue: kind === "hydrant" ? 2 : random.range(95, 140),
    });
  }

  /* Hills on the horizon, past everything you can walk to. */
  for (let index = 0; index < 16; index += 1) {
    const angle = (index / 16) * Math.PI * 2 + random.range(-0.1, 0.1);
    const distance = bounds * random.range(1.15, 1.5);

    props.push({
      kind: "hill",
      x: Math.cos(angle) * distance,
      z: Math.sin(angle) * distance,
      y: 0,
      rotation: 0,
      scale: random.range(1, 2.1),
      hue: random.range(95, 130),
    });
  }

  for (let index = 0; index < 18; index += 1) {
    props.push({
      kind: "cloud",
      x: random.range(-bounds, bounds),
      z: random.range(-bounds, bounds),
      y: random.range(30, 52),
      rotation: random.range(0, Math.PI * 2),
      scale: random.range(1, 2.4),
      hue: 0,
    });
  }

  /*
   * You start in the middle of the first plaza, looking north at card one — the
   * same view every time, which is what makes the route memorable. In the
   * middle rather than at the kerb because the camera trails several metres
   * behind you, and from the kerb it would open inside a wall.
   */
  const first = districts[0];
  const spawn = {
    x: first.center.x,
    z: first.center.z,
    yaw: Math.PI,
  };

  return {
    seed,
    districts,
    buildings,
    props,
    stations,
    roads,
    pavements,
    kerbs,
    roadMarks,
    spawn,
    bounds,
  };
}
