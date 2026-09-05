// Imported by its real filename so the Node test runner can load the layout
// directly; it cannot resolve the "@/" alias.
import { createRandom, seedFromString, type Random } from "./rng.ts";

/**
 * The town a note becomes.
 *
 * The method of loci works because a walk through a place is easier to hold
 * than a list — but only if the place is worth remembering. So this is a town
 * rather than a diagram: a street grid, blocks of houses that are each built
 * differently, and a study item waiting outside one of them. The house is the
 * hook. "The quiz at the yellow one with the green dome" is a memory; "card 7"
 * is not.
 *
 * Every decision comes from the note's own id through a seeded generator, so
 * one note's town is the same town on every device and at every visit, and two
 * notes are never the same town.
 *
 * There is no three.js in here: the renderer consumes this, and so do the tests.
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

/** Which study screen a station opens. */
export type StudyKind = "card" | "quiz" | "test";

/**
 * The colour a stop is marked with, on the ground and on the map: the same
 * three the note's own tabs use, so a purple ring is a flashcard here for the
 * same reason the Flashcards tab is purple there. The neighbourhood is told by
 * the houses and by the pill in the corner; the ring tells you what is waiting.
 */
export const STATION_HUE: Record<StudyKind, number> = {
  card: 272,
  quiz: 330,
  test: 150,
};

export type PalaceItem = {
  id: string;
  kind: StudyKind;
  /** Only flashcards carry one; it decides which neighbourhood they land in. */
  sectionId: string | null;
};

export type PalaceSection = {
  id: string;
  title: string;
};

export type RoofKind = "gable" | "hip" | "flat" | "spire" | "dome";

/**
 * The things that make one house different from the next. They are the whole
 * point — a street of identical boxes is a list again.
 */
export type HouseFeature =
  | "chimney"
  | "porch"
  | "balcony"
  | "garage"
  | "dormer"
  | "shopfront"
  | "flag"
  | "sideTower"
  | "hedge"
  | "gardenTree";

export type PalaceHouse = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Which way the front faces, in radians; 0 is towards +Z. */
  facing: number;
  hue: number;
  saturation: number;
  lightness: number;
  roofKind: RoofKind;
  /** Roofs come from a short list of roof colours, not from the whole wheel. */
  roofHue: number;
  roofSaturation: number;
  roofLightness: number;
  /** Rows of windows on the front. */
  storeys: number;
  features: HouseFeature[];
  /** True for the houses a study item waits outside. */
  landmark: boolean;
  /**
   * Which landmark this is, counted across the whole town. Its colour, roof and
   * garden ornament are all derived from it, so no two houses you have to
   * remember are alike anywhere in the town — which is the only reason "the one
   * with the green dome" works as a memory.
   */
  landmarkIndex: number;
  /** The ornament in a landmark's garden: another thing to remember it by. */
  ornament: "obelisk" | "orb" | "pyramid" | "arch" | "fountain" | null;
  districtIndex: number;
};

export type PalaceStation = {
  /** The flashcard, quiz question or practice question this is. */
  id: string;
  kind: StudyKind;
  index: number;
  districtIndex: number;
  /** Where the token floats, on the path outside its house. */
  x: number;
  z: number;
  hue: number;
  /** The house it belongs to, so the renderer can mark it. */
  houseIndex: number;
};

export type PalaceDistrict = {
  index: number;
  title: string;
  center: Vec2;
  radius: number;
  hue: number;
  stationIds: string[];
};

export type PropKind =
  | "tree"
  | "car"
  | "hydrant"
  | "bench"
  | "cloud"
  | "lamp"
  | "bin"
  | "hedge"
  | "hill"
  | "balloon";

export type PalaceProp = {
  kind: PropKind;
  x: number;
  z: number;
  y: number;
  rotation: number;
  scale: number;
  hue: number;
};

export type PalaceLayout = {
  seed: number;
  districts: PalaceDistrict[];
  houses: PalaceHouse[];
  props: PalaceProp[];
  stations: PalaceStation[];
  roads: Box[];
  pavements: Box[];
  kerbs: Box[];
  roadMarks: Box[];
  spawn: { x: number; z: number; yaw: number };
  /** Half-extent of the walkable world, measured from the origin. */
  bounds: number;
};

const ROAD_WIDTH = 11;
const PAVEMENT_WIDTH = 5;
/** A city block, edge to edge, not counting the roads around it. */
const BLOCK_SIZE = 62;
/** Houses per side of a block. */
const HOUSES_PER_SIDE = 3;
/**
 * How far a house's centre sits inside the block edge. The pavement eats the
 * outer five metres of every block, so this has to leave room for that *and* a
 * front garden — otherwise the hedges and trees meant to be in the garden end
 * up standing in the street, which is what makes a town look like scattered
 * scenery rather than a place.
 */
const FRONT_GARDEN = 15;
/**
 * The most stations a town is laid out with. Enough to cover a long note
 * properly; past it a session stops being a walk and becomes a commute.
 */
export const MAX_STATIONS = 60;

const ROOF_KINDS: RoofKind[] = ["gable", "gable", "hip", "hip", "flat", "spire", "dome"];
/** Cycled rather than drawn, so consecutive landmarks never share a roof. */
const LANDMARK_ROOFS: RoofKind[] = ["spire", "dome", "hip", "gable", "flat"];
const ORNAMENTS = ["obelisk", "orb", "pyramid", "arch", "fountain"] as const;
/**
 * Roughly the golden angle: successive landmarks land as far apart on the
 * colour wheel as they can, so a town of thirty of them still has thirty
 * tellable-apart colours rather than five families of six.
 */
const LANDMARK_HUE_STEP = 137.508;
/**
 * Terracotta, slate, charcoal, moss, teal, plum. A roof drawn from the whole
 * colour wheel gives you bright green domes that read as hills; these read as
 * roofs, and still tell one house from another.
 */
const ROOF_COLOURS: { hue: number; saturation: number; lightness: number }[] = [
  { hue: 18, saturation: 0.52, lightness: 0.42 },
  { hue: 215, saturation: 0.2, lightness: 0.38 },
  { hue: 262, saturation: 0.08, lightness: 0.29 },
  { hue: 120, saturation: 0.24, lightness: 0.3 },
  { hue: 195, saturation: 0.3, lightness: 0.35 },
  { hue: 322, saturation: 0.24, lightness: 0.36 },
];

/**
 * More than this and a session stops being a walk and becomes a commute, so a
 * long deck is sampled rather than laid out in full.
 */
const SELECTION_LIMIT = MAX_STATIONS;

/**
 * What goes into the town.
 *
 * The point of the walk is that it covers the note, so the selection is not the
 * first forty cards: it is every section's most important cards first, taken in
 * turn so no section is left out, and then the quiz and practice questions, so
 * a walk covers all three ways of being asked. A deck that fits under the limit
 * goes in whole.
 *
 * "Important" is the coverage rank the study pipeline already assigns — higher
 * is more important — so the town agrees with the deck about what matters.
 */
export function selectPalaceItems({
  cards,
  quiz,
  test,
  limit = SELECTION_LIMIT,
}: {
  cards: readonly {
    id: string;
    sectionId: string | null;
    weight?: number;
    /** The concept the card teaches, so the walk does not take it twice. */
    conceptKey?: string | null;
  }[];
  quiz: readonly { id: string }[];
  test: readonly { id: string; weight?: number }[];
  limit?: number;
}): PalaceItem[] {
  /*
   * Two cards to a question, near enough: a walk that is nine-tenths flashcards
   * does not feel like it has a quiz in it at all, and being asked in three
   * different ways is most of what makes the walk worth taking over the deck.
   */
  const quizWanted = Math.min(quiz.length, Math.round(limit * 0.25));
  const testWanted = Math.min(test.length, Math.round(limit * 0.15));
  const cardsWanted = Math.min(cards.length, limit - quizWanted - testWanted);

  /*
   * One queue per section, each in importance order, drained a card at a time
   * round the sections. A note whose third section is short still gets its
   * best cards in, and a long first section cannot crowd the others out.
   */
  const bySection = new Map<string, typeof cards[number][]>();

  cards.forEach((card) => {
    const key = card.sectionId ?? "";
    const queue = bySection.get(key);

    if (queue) {
      queue.push(card);
    } else {
      bySection.set(key, [card]);
    }
  });

  /*
   * The queues are drained a card at a time round the sections, so a long first
   * section cannot crowd the others out — and on the first pass a card is only
   * taken if its concept has not been covered yet, anywhere in the note. A walk
   * that asks about photosynthesis three times and never about respiration has
   * not covered the note, however important those three cards were. Only once
   * every concept the deck teaches has a stop does the walk start doubling up,
   * and then it doubles up on the most important ones first.
   */
  const queues = [...bySection.values()].map((queue) =>
    [...queue].sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0)),
  );
  const chosenCards: (typeof cards)[number][] = [];
  const takenIds = new Set<string>();
  const takenConcepts = new Set<string>();
  const conceptOf = (card: (typeof cards)[number]) => card.conceptKey ?? card.id;

  const drain = (freshConceptsOnly: boolean) => {
    for (;;) {
      let progressed = false;

      for (const queue of queues) {
        if (chosenCards.length >= cardsWanted) return;

        const card = queue.find(
          (candidate) =>
            !takenIds.has(candidate.id) &&
            (!freshConceptsOnly || !takenConcepts.has(conceptOf(candidate))),
        );

        if (!card) continue;

        takenIds.add(card.id);
        takenConcepts.add(conceptOf(card));
        chosenCards.push(card);
        progressed = true;
      }

      if (!progressed) return;
    }
  };

  drain(true);
  drain(false);

  /* The order they are walked in follows the note, not their importance. */
  const cardOrder = new Map(cards.map((card, index) => [card.id, index]));

  chosenCards.sort(
    (left, right) => (cardOrder.get(left.id) ?? 0) - (cardOrder.get(right.id) ?? 0),
  );

  /* Questions are spread across their set rather than taken from the front. */
  const spread = <Item,>(items: readonly Item[], wanted: number) => {
    if (wanted >= items.length) return [...items];

    const step = items.length / wanted;

    return Array.from({ length: wanted }, (_, index) => items[Math.floor(index * step)]);
  };

  const chosenTest = [...test]
    .sort((left, right) => (right.weight ?? 0) - (left.weight ?? 0))
    .slice(0, testWanted);

  return [
    ...chosenCards.map((card) => ({
      id: card.id,
      kind: "card" as const,
      sectionId: card.sectionId,
    })),
    ...spread(quiz, quizWanted).map((question) => ({
      id: question.id,
      kind: "quiz" as const,
      sectionId: null,
    })),
    ...chosenTest.map((question) => ({
      id: question.id,
      kind: "test" as const,
      sectionId: null,
    })),
  ];
}

/**
 * Neighbourhoods come from the note's own sections, so the part of town an item
 * lives in means something. Items with no section of their own — the quiz and
 * practice questions — are spread across the neighbourhoods that do exist.
 */
export function groupItemsIntoDistricts(
  items: readonly PalaceItem[],
  sections: readonly PalaceSection[],
  fallbackTitle: string,
) {
  const used = sections.filter((section) =>
    items.some((item) => item.sectionId === section.id),
  );

  const groups =
    used.length > 0
      ? used.map((section) => ({
          title: section.title,
          items: items.filter((item) => item.sectionId === section.id),
        }))
      : (() => {
          const perDistrict = 8;
          const count = Math.max(1, Math.ceil(items.length / perDistrict));

          return Array.from({ length: count }, (_, index) => ({
            title: count === 1 ? fallbackTitle : `${fallbackTitle} ${index + 1}`,
            items: items.slice(index * perDistrict, (index + 1) * perDistrict),
          }));
        })();

  const loose = items.filter(
    (item) => !used.some((section) => section.id === item.sectionId),
  );

  loose.forEach((item, index) => {
    groups[index % groups.length].items.push(item);
  });

  return groups.filter((group) => group.items.length > 0);
}

/**
 * How far the map has to reach to hold the town, with a little air around it.
 * Measured from the streets and the stations rather than from `bounds`, which
 * includes the woods and would draw the town as a dot in a field.
 */
export function mapExtent(layout: Pick<PalaceLayout, "roads" | "stations">) {
  const streets = layout.roads.map((road) =>
    road.width > road.depth ? Math.abs(road.z) : Math.abs(road.x),
  );
  const stations = layout.stations.flatMap((station) => [
    Math.abs(station.x),
    Math.abs(station.z),
  ]);

  return Math.max(...streets, ...stations, 1) + 14;
}

/**
 * The angle to rotate a north-pointing arrow by so it points where the player
 * is facing, on a canvas whose y axis runs south.
 */
export function mapArrowAngle(facing: number) {
  return Math.PI - facing;
}

/** One house, built from the seed rather than from a catalogue. */
function makeHouse({
  random,
  x,
  z,
  facing,
  hue,
  districtIndex,
  landmarkIndex = -1,
}: {
  random: Random;
  x: number;
  z: number;
  facing: number;
  hue: number;
  districtIndex: number;
  /** -1 for an ordinary house; otherwise its number across the town. */
  landmarkIndex?: number;
}): PalaceHouse {
  const landmark = landmarkIndex >= 0;
  const storeys = landmark ? 2 + (landmarkIndex % 3) : random.int(1, 3);
  const roofKind = landmark
    ? LANDMARK_ROOFS[landmarkIndex % LANDMARK_ROOFS.length]
    : random.pick(ROOF_KINDS);
  const features: HouseFeature[] = [];
  const maybe = (feature: HouseFeature, chance: number) => {
    if (random.chance(chance)) features.push(feature);
  };

  maybe("chimney", roofKind === "flat" ? 0.15 : 0.6);
  maybe("porch", 0.45);
  maybe("balcony", storeys > 1 ? 0.4 : 0.05);
  maybe("garage", 0.3);
  maybe("dormer", roofKind === "gable" || roofKind === "hip" ? 0.35 : 0);
  maybe("shopfront", storeys > 1 ? 0.25 : 0.12);
  maybe("hedge", 0.45);
  maybe("gardenTree", 0.22);

  if (landmark) {
    /*
     * A landmark is meant to be describable from the far end of the street, and
     * describable *differently* from the last one: the features are cycled, not
     * rolled, so the fifth house you have to remember cannot be the second one
     * again.
     */
    features.push("flag");

    const signature = landmarkIndex % 4;

    if (signature === 0) features.push("sideTower");
    if (signature === 1) features.push("balcony", "shopfront");
    if (signature === 2) features.push("garage", "dormer");
    if (signature === 3) features.push("porch", "chimney");
  }

  const roof = random.pick(ROOF_COLOURS);

  return {
    x,
    z,
    width: random.range(9, 13),
    depth: random.range(8, 11),
    height: 3.1 * storeys + random.range(-0.3, 0.6),
    facing,
    /*
     * A neighbourhood has a colour family, but not a uniform: about one house
     * in six ignores it completely, which is what stops a street reading as
     * wallpaper and gives you something to steer by.
     */
    hue: landmark
      ? (landmarkIndex * LANDMARK_HUE_STEP) % 360
      : random.chance(0.16)
        ? random.range(0, 360)
        : (hue + random.range(-55, 55) + 360) % 360,
    saturation: landmark ? random.range(0.5, 0.72) : random.range(0.22, 0.5),
    lightness: landmark ? random.range(0.52, 0.62) : random.range(0.58, 0.76),
    roofKind,
    roofHue: (roof.hue + random.range(-8, 8) + 360) % 360,
    roofSaturation: roof.saturation,
    roofLightness: roof.lightness + random.range(-0.04, 0.04),
    storeys,
    features,
    landmark,
    landmarkIndex,
    ornament: landmark ? ORNAMENTS[landmarkIndex % ORNAMENTS.length] : null,
    districtIndex,
  };
}

export function buildPalaceLayout({
  seedSource,
  items,
  sections,
  fallbackTitle = "Notes",
}: {
  seedSource: string;
  items: readonly PalaceItem[];
  sections: readonly PalaceSection[];
  fallbackTitle?: string;
}): PalaceLayout {
  const seed = seedFromString(seedSource);
  const random = createRandom(seed);
  const groups = groupItemsIntoDistricts(items, sections, fallbackTitle);
  const stationCount = groups.reduce((total, group) => total + group.items.length, 0);

  /*
   * The grid is sized to the deck: two stations to a block, and never fewer
   * than nine blocks, so even a five-card note is a town with corners to turn
   * rather than a single street. Never fewer blocks than neighbourhoods
   * either, or the last sections share one and their stops pile up.
   */
  const blocksNeeded = Math.max(9, groups.length, Math.ceil(stationCount / 3));
  const gridSize = Math.ceil(Math.sqrt(blocksNeeded));
  const pitch = BLOCK_SIZE + ROAD_WIDTH;
  const half = ((gridSize - 1) * pitch) / 2;
  const blockCenter = (column: number, row: number) => ({
    x: column * pitch - half,
    z: row * pitch - half,
  });

  /* Blocks are handed out to neighbourhoods in reading order, so a section is a
     contiguous corner of town rather than a scatter of houses. */
  const blocks = Array.from({ length: gridSize * gridSize }, (_, index) => ({
    column: index % gridSize,
    row: Math.floor(index / gridSize),
    ...blockCenter(index % gridSize, Math.floor(index / gridSize)),
  }));

  /* Streets: one down the middle of every gap between blocks, and one around
     the outside — which is the same rule, half a pitch off each block centre.
     Known before anything is placed, because nothing may be placed in one. */
  const lines = Array.from(
    { length: gridSize + 1 },
    (_, index) => index * pitch - half - pitch / 2,
  );
  const bounds = Math.max(...lines.map(Math.abs)) + 34;

  /*
   * Every stop already placed, across the whole town rather than per
   * neighbourhood: two neighbourhoods sampling independently put their stops
   * within a few paces of each other wherever they meet.
   */
  const taken: Vec2[] = [];
  const districts: PalaceDistrict[] = [];
  const houses: PalaceHouse[] = [];
  const props: PalaceProp[] = [];
  const stations: PalaceStation[] = [];

  /*
   * How many blocks each neighbourhood gets: one each to start with, then the
   * rest handed out one at a time to whichever is carrying the most stops per
   * block it already has. An even split gave every leftover block to the last
   * section, so a note with six sections had five cramped neighbourhoods and
   * one that sprawled — which is what put some stops a street apart and others
   * on the same square of grass.
   */
  const quota = groups.map(() => 1);

  for (let spare = blocks.length - groups.length; spare > 0; spare -= 1) {
    let tightest = 0;

    quota.forEach((count, index) => {
      const crowding = groups[index].items.length / count;

      if (crowding > groups[tightest].items.length / quota[tightest]) tightest = index;
    });

    quota[tightest] += 1;
  }

  /* Still handed out in reading order, so a section is a contiguous corner of
     town rather than a scatter of houses. */
  const firstBlock = quota.map(
    (_, index) => quota.slice(0, index).reduce((total, count) => total + count, 0),
  );

  groups.forEach((group, districtIndex) => {
    const hue = (districtIndex * 47 + 20) % 360;
    const mine = blocks.slice(
      firstBlock[districtIndex],
      firstBlock[districtIndex] + quota[districtIndex],
    );
    /*
     * Houses go up first and the study items are hung on them afterwards. A
     * house that would have overlapped its neighbour round a corner is simply
     * not built, and doing it in this order means a skipped plot never takes an
     * item down with it.
     */
    const placed: number[] = [];

    mine.forEach((block) => {
      const inBlock: { x: number; z: number; width: number; depth: number }[] = [];

      [0, 1, 2, 3].forEach((side) => {
        for (let slot = 0; slot < HOUSES_PER_SIDE; slot += 1) {
          const along = (slot - (HOUSES_PER_SIDE - 1) / 2) * (BLOCK_SIZE / HOUSES_PER_SIDE);
          const setBack = BLOCK_SIZE / 2 - FRONT_GARDEN;
          const facing = [Math.PI, 0, -Math.PI / 2, Math.PI / 2][side];
          const position =
            side === 0
              ? { x: block.x + along, z: block.z - setBack }
              : side === 1
                ? { x: block.x + along, z: block.z + setBack }
                : side === 2
                  ? { x: block.x - setBack, z: block.z + along }
                  : { x: block.x + setBack, z: block.z + along };

          const house = makeHouse({
            random,
            x: position.x,
            z: position.z,
            facing,
            hue,
            districtIndex,
          });
          /* Along the facade is `width`; into the plot is `depth`. */
          const sideways = side > 1;
          const footprint = {
            x: house.x,
            z: house.z,
            width: sideways ? house.depth : house.width,
            depth: sideways ? house.width : house.depth,
          };

          const clashes = inBlock.some(
            (taken) =>
              Math.abs(taken.x - footprint.x) < (taken.width + footprint.width) / 2 + 1.5 &&
              Math.abs(taken.z - footprint.z) < (taken.depth + footprint.depth) / 2 + 1.5,
          );

          if (clashes) continue;

          inBlock.push(footprint);
          houses.push(house);
          placed.push(houses.length - 1);
        }
      });
    });

    /*
     * Where the Memos wait is drawn from the seed, and it is a place in the
     * town rather than a doorstep: the pavement outside a row, a corner, the
     * green in the middle of a block. One per house was a rule you could see
     * after two streets, and a town you can predict is a town you stop looking
     * at.
     *
     * The nearest house to each spot is still rebuilt as a landmark, because
     * "the one by the house with the green dome" is the thing that makes the
     * walk a memory rather than a scavenger hunt.
     */
    const spots: Vec2[] = [];

    /*
     * The pavement runs half a road and half a pavement inside the road's
     * centre line, which is itself half a pitch out from the block's middle.
     * Deriving it any other way — as this once did — walks the candidates into
     * the carriageway, where the filter below throws every one of them out and
     * leaves nothing but the four spots on the green: four stops in a circle
     * eight paces wide, which is exactly how they used to bunch.
     */
    const pavement = pitch / 2 - ROAD_WIDTH / 2 - PAVEMENT_WIDTH / 2;

    mine.forEach((block) => {
      /* Along the pavements on all four sides of the block, at even intervals
         rather than at four random points that can land on top of each other. */
      const perSide = 4;

      for (let side = 0; side < 4; side += 1) {
        for (let step = 0; step < perSide; step += 1) {
          const reach = BLOCK_SIZE / 2 - 7;
          const along =
            (step / (perSide - 1) - 0.5) * 2 * reach + random.range(-2.5, 2.5);

          spots.push(
            side === 0
              ? { x: block.x + along, z: block.z - pavement }
              : side === 1
                ? { x: block.x + along, z: block.z + pavement }
                : side === 2
                  ? { x: block.x - pavement, z: block.z + along }
                  : { x: block.x + pavement, z: block.z + along },
          );
        }
      }

      /* And on the green in the middle, which the houses ring but do not fill —
         spread around it rather than dropped anywhere inside it. */
      const turn = random.range(0, Math.PI * 2);

      for (let step = 0; step < 4; step += 1) {
        const angle = turn + (step / 4) * Math.PI * 2;
        const reach = random.range(5, 9);

        spots.push({
          x: block.x + Math.cos(angle) * reach,
          z: block.z + Math.sin(angle) * reach,
        });
      }
    });

    /* Nothing standing inside a wall, or in the road where the traffic is. */
    const walkable = spots.filter((spot) => {
      const clear = houses.every((house) => {
        const sideways = Math.abs(Math.sin(house.facing)) > 0.5;
        const width = sideways ? house.depth : house.width;
        const depth = sideways ? house.width : house.depth;

        return (
          Math.abs(house.x - spot.x) > width / 2 + 1.8 ||
          Math.abs(house.z - spot.z) > depth / 2 + 1.8
        );
      });

      if (!clear) return false;

      return !lines.some(
        (line) =>
          Math.abs(line - spot.x) < ROAD_WIDTH / 2 + 0.5 ||
          Math.abs(line - spot.z) < ROAD_WIDTH / 2 + 0.5,
      );
    });

    for (let index = walkable.length - 1; index > 0; index -= 1) {
      const swap = random.int(0, index);

      [walkable[index], walkable[swap]] = [walkable[swap], walkable[index]];
    }

    /*
     * Farthest-point sampling over the shuffled candidates: each stop goes
     * wherever is furthest from every stop already placed. The shuffle is what
     * makes it a different town per note; taking the farthest is what stops a
     * greedy walk painting itself into a corner and dropping the last two stops
     * on the same pavement.
     */
    group.items.forEach((item) => {
      let spot = walkable[0] ?? { x: 0, z: 0 };
      let best = -1;

      walkable.forEach((candidate) => {
        const nearest = taken.reduce(
          (closest, other) =>
            Math.min(closest, Math.hypot(candidate.x - other.x, candidate.z - other.z)),
          Number.POSITIVE_INFINITY,
        );

        if (nearest > best) {
          best = nearest;
          spot = candidate;
        }
      });

      taken.push(spot);

      const found = walkable.indexOf(spot);

      if (found >= 0) walkable.splice(found, 1);

      /* The house this stop is remembered by: the closest one that is not
         already somebody else's landmark. */
      let houseIndex = placed[0] ?? 0;
      let closest = Number.POSITIVE_INFINITY;

      placed.forEach((candidate) => {
        const house = houses[candidate];

        if (house.landmark) return;

        const distance = Math.hypot(house.x - spot.x, house.z - spot.z);

        if (distance < closest) {
          closest = distance;
          houseIndex = candidate;
        }
      });

      const plain = houses[houseIndex];

      houses[houseIndex] = makeHouse({
        random,
        x: plain.x,
        z: plain.z,
        facing: plain.facing,
        hue,
        districtIndex,
        landmarkIndex: stations.length,
      });

      stations.push({
        id: item.id,
        kind: item.kind,
        index: stations.length,
        districtIndex,
        x: spot.x,
        z: spot.z,
        hue,
        houseIndex,
      });
    });

    const center = {
      x: mine.reduce((total, block) => total + block.x, 0) / mine.length,
      z: mine.reduce((total, block) => total + block.z, 0) / mine.length,
    };

    districts.push({
      index: districtIndex,
      title: group.title,
      center,
      radius:
        Math.max(
          ...mine.map((block) => Math.hypot(block.x - center.x, block.z - center.z)),
        ) +
        BLOCK_SIZE / 2,
      hue,
      stationIds: group.items.map((item) => item.id),
    });
  });


  const roads: Box[] = [];
  const pavements: Box[] = [];
  const kerbs: Box[] = [];
  const roadMarks: Box[] = [];

  const addStreet = (value: number, horizontal: boolean) => {
    const long = bounds * 2;

    roads.push(
      horizontal
        ? { x: 0, z: value, width: long, depth: ROAD_WIDTH, height: 0 }
        : { x: value, z: 0, width: ROAD_WIDTH, depth: long, height: 0 },
    );

    for (const side of [-1, 1]) {
      const edge = value + (side * ROAD_WIDTH) / 2;
      const path = edge + (side * PAVEMENT_WIDTH) / 2;

      kerbs.push(
        horizontal
          ? { x: 0, z: edge, width: long, depth: 0.7, height: 0.16 }
          : { x: edge, z: 0, width: 0.7, depth: long, height: 0.16 },
      );
      pavements.push(
        horizontal
          ? { x: 0, z: path, width: long, depth: PAVEMENT_WIDTH, height: 0 }
          : { x: path, z: 0, width: PAVEMENT_WIDTH, depth: long, height: 0 },
      );
    }
  };

  lines.forEach((value) => {
    addStreet(value, true);
    addStreet(value, false);
  });

  const nearJunction = (value: number) =>
    lines.some((line) => Math.abs(line - value) < ROAD_WIDTH + 4);

  lines.forEach((z) => {
    for (let x = -bounds + 6; x < bounds - 6; x += 9) {
      if (nearJunction(x)) continue;

      roadMarks.push({ x, z, width: 3.4, depth: 0.4, height: 0 });
    }
  });

  lines.forEach((x) => {
    for (let z = -bounds + 6; z < bounds - 6; z += 9) {
      if (nearJunction(z)) continue;

      roadMarks.push({ x, z, width: 0.4, depth: 3.4, height: 0 });
    }
  });

  /*
   * Zebra crossings on every approach to every junction, drawn tight against
   * the junction: any further out and a town this size is more paint than road.
   */
  const crossingOffset = ROAD_WIDTH / 2 + 2.2;
  const crossingLength = ROAD_WIDTH - 3.5;

  lines.forEach((z) => {
    lines.forEach((x) => {
      for (let stripe = 0; stripe < 4; stripe += 1) {
        const offset = (stripe - 1.5) * 2.1;

        roadMarks.push({ x: x + offset, z: z - crossingOffset, width: 0.85, depth: crossingLength, height: 0 });
        roadMarks.push({ x: x + offset, z: z + crossingOffset, width: 0.85, depth: crossingLength, height: 0 });
        roadMarks.push({ x: x - crossingOffset, z: z + offset, width: crossingLength, depth: 0.85, height: 0 });
        roadMarks.push({ x: x + crossingOffset, z: z + offset, width: crossingLength, depth: 0.85, height: 0 });
      }
    });
  });

  /*
   * Street furniture along the kerbs, but never across somebody's front path.
   * A lamp post growing out of a garden gate is the single thing that most
   * gives away a town assembled by a loop rather than laid out.
   */
  const blocksAPath = (x: number, z: number) =>
    houses.some((house) => {
      const outX = Math.sin(house.facing);
      const outZ = Math.cos(house.facing);
      const toProp = { x: x - house.x, z: z - house.z };
      const forward = toProp.x * outX + toProp.z * outZ;
      const sideways = toProp.x * outZ - toProp.z * outX;

      return forward > 0 && forward < house.depth / 2 + 9 && Math.abs(sideways) < 3.2;
    });

  lines.forEach((line) => {
    for (let along = -bounds + 12; along < bounds - 12; along += 19) {
      if (nearJunction(along)) continue;

      const side = random.chance(0.5) ? -1 : 1;
      const kerb = line + side * (ROAD_WIDTH / 2 + 1.8);

      if (!blocksAPath(along, kerb)) {
        props.push({ kind: "lamp", x: along, z: kerb, y: 0, rotation: 0, scale: 1, hue: 0 });
      }

      if (!blocksAPath(kerb, along)) {
        props.push({ kind: "lamp", x: kerb, z: along, y: 0, rotation: 0, scale: 1, hue: 0 });
      }

      if (random.chance(0.45)) {
        props.push({
          kind: "car",
          x: along + random.range(-3, 3),
          z: line + side * (ROAD_WIDTH / 2 - 1.4),
          y: 0,
          rotation: 0,
          scale: 1,
          hue: random.range(0, 360),
        });
      }

      if (random.chance(0.45)) {
        props.push({
          kind: "car",
          x: line + side * (ROAD_WIDTH / 2 - 1.4),
          z: along + random.range(-3, 3),
          y: 0,
          rotation: Math.PI / 2,
          scale: 1,
          hue: random.range(0, 360),
        });
      }

      if (random.chance(0.3) && !blocksAPath(along + 3, kerb)) {
        props.push({ kind: "bin", x: along + 3, z: kerb, y: 0, rotation: 0, scale: 1, hue: 0 });
      }

      if (random.chance(0.25) && !blocksAPath(kerb, along + 3)) {
        props.push({ kind: "bench", x: kerb, z: along + 3, y: 0, rotation: 0, scale: 1, hue: 0 });
      }
    }
  });

  /* Back gardens: the middle of every block, which no house stands on. */
  blocks.forEach((block) => {
    const trees = random.int(1, 3);

    for (let index = 0; index < trees; index += 1) {
      props.push({
        kind: "tree",
        x: block.x + random.range(-8, 8),
        z: block.z + random.range(-8, 8),
        y: 0,
        rotation: random.range(0, Math.PI * 2),
        scale: random.range(0.7, 1.05),
        hue: random.range(95, 140),
      });
    }

    if (random.chance(0.4)) {
      props.push({
        kind: "hedge",
        x: block.x + random.range(-10, 10),
        z: block.z + random.range(-10, 10),
        y: 0,
        rotation: random.range(0, Math.PI),
        scale: random.range(0.8, 1.2),
        hue: random.range(100, 135),
      });
    }
  });

  /* A wood around the outside, so the edge of the world is a tree line. */
  const townEdge = Math.max(...lines.map(Math.abs));

  for (let index = 0; index < 110; index += 1) {
    /*
     * Outside the town *square*, not outside a circle drawn round it: a circle
     * of radius `townEdge` cuts the corners off the grid, and every tree meant
     * for the woods on a diagonal landed on somebody's street instead.
     */
    const x = random.range(-bounds + 2, bounds - 2);
    const z = random.range(-bounds + 2, bounds - 2);

    if (Math.max(Math.abs(x), Math.abs(z)) < townEdge + 10) continue;

    props.push({
      kind: "tree",
      x,
      z,
      y: 0,
      rotation: random.range(0, Math.PI * 2),
      scale: random.range(0.9, 1.6),
      hue: random.range(95, 140),
    });
  }

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
      y: random.range(58, 88),
      rotation: random.range(0, Math.PI * 2),
      scale: random.range(1, 2.4),
      hue: 0,
    });
  }

  /* A balloon over each neighbourhood: the thing you steer by from a street away. */
  districts.forEach((district) => {
    props.push({
      kind: "balloon",
      x: district.center.x,
      z: district.center.z,
      y: random.range(30, 42),
      rotation: 0,
      scale: random.range(1, 1.4),
      hue: district.hue,
    });
  });

  /*
   * You start a few paces from the first stop, looking at it — the same corner
   * every time, which is what makes the walk repeatable. The direction comes
   * from the house the stop is remembered by, so you arrive facing both.
   */
  const first = stations[0];
  const firstHouse = first ? houses[first.houseIndex] : null;
  const away = firstHouse
    ? { x: first.x - firstHouse.x, z: first.z - firstHouse.z }
    : { x: 0, z: 1 };
  const length = Math.hypot(away.x, away.z) || 1;
  const spawn = first
    ? {
        x: first.x + (away.x / length) * 7,
        z: first.z + (away.z / length) * 7,
        yaw: Math.atan2(-away.x / length, -away.z / length),
      }
    : { x: 0, z: 0, yaw: 0 };

  return {
    seed,
    districts,
    houses,
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
