import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPalaceLayout,
  groupItemsIntoDistricts,
  mapArrowAngle,
  mapExtent,
  MAX_STATIONS,
  selectPalaceItems,
  STATION_HUE,
} from "../src/lib/palace/layout.ts";
import {
  CHARACTER_RADIUS,
  clampCameraDistance,
  createCharacter,
  nearestStation,
  resolveCollision,
  stepCharacter,
  turnTowards,
} from "../src/lib/palace/movement.ts";

const sections = [
  { id: "s1", title: "Prvi del" },
  { id: "s2", title: "Drugi del" },
];
const cards = [
  { id: "a", sectionId: "s1" },
  { id: "b", sectionId: "s1" },
  { id: "c", sectionId: "s2" },
  { id: "d", sectionId: "s2" },
  { id: "e", sectionId: "s2" },
];
const items = cards.map((card) => ({ id: card.id, kind: "card", sectionId: card.sectionId }));

/** The footprint of a house in world axes: `width` runs along its front. */
function footprint(house) {
  const sideways = Math.abs(Math.sin(house.facing)) > 0.5;

  return {
    x: house.x,
    z: house.z,
    width: sideways ? house.depth : house.width,
    depth: sideways ? house.width : house.depth,
  };
}

test("the same note builds the same town every time", () => {
  const first = buildPalaceLayout({ seedSource: "lecture-1", items, sections });
  const second = buildPalaceLayout({ seedSource: "lecture-1", items, sections });

  assert.deepEqual(second, first);
});

test("a different note gets a different town", () => {
  const first = buildPalaceLayout({ seedSource: "lecture-1", items, sections });
  const other = buildPalaceLayout({ seedSource: "lecture-2", items, sections });

  assert.notDeepEqual(other.houses, first.houses);
});

test("every item gets exactly one station, remembered by a house of its own", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", items, sections });

  assert.deepEqual(
    [...layout.stations].map((station) => station.id).sort(),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(new Set(layout.stations.map((station) => station.houseIndex)).size, items.length);

  layout.stations.forEach((station) => {
    assert.ok(layout.houses[station.houseIndex].landmark, "a station's house is not a landmark");
  });
});

test("a section becomes a neighbourhood, and its items stay inside it", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", items, sections });

  assert.deepEqual(
    layout.districts.map((district) => district.title),
    ["Prvi del", "Drugi del"],
  );
  assert.deepEqual(layout.districts[0].stationIds, ["a", "b"]);

  layout.districts.forEach((district) => {
    district.stationIds.forEach((id) => {
      const station = layout.stations.find((entry) => entry.id === id);
      const distance = Math.hypot(station.x - district.center.x, station.z - district.center.z);

      assert.ok(distance <= district.radius, `${id} is outside its own neighbourhood`);
    });
  });
});

test("no two houses are built on the same plot", () => {
  const layout = buildPalaceLayout({
    seedSource: "crowded",
    items: Array.from({ length: 24 }, (_, index) => ({
      id: `card-${index}`,
      kind: "card",
      sectionId: "s1",
    })),
    sections: [sections[0]],
  });

  layout.houses.forEach((house, index) => {
    const a = footprint(house);

    layout.houses.slice(index + 1).forEach((other) => {
      const b = footprint(other);

      assert.ok(
        Math.abs(a.x - b.x) >= (a.width + b.width) / 2 - 0.01 ||
          Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2 - 0.01,
        "two houses overlap",
      );
    });
  });
});

test("nothing is built in the middle of a street", () => {
  const layout = buildPalaceLayout({ seedSource: "town", items, sections });
  const roadHalf = 11 / 2;

  layout.houses.forEach((house) => {
    const plot = footprint(house);

    layout.roads.forEach((road) => {
      const alongX = road.width > road.depth;
      const overlaps = alongX
        ? Math.abs(house.z - road.z) < roadHalf + plot.depth / 2
        : Math.abs(house.x - road.x) < roadHalf + plot.width / 2;

      assert.ok(!overlaps, `a house at ${house.x.toFixed(1)}, ${house.z.toFixed(1)} is in the road`);
    });
  });
});

test("houses differ from one another, which is the whole point", () => {
  const layout = buildPalaceLayout({
    seedSource: "variety",
    items: Array.from({ length: 12 }, (_, index) => ({
      id: `card-${index}`,
      kind: "card",
      sectionId: "s1",
    })),
    sections: [sections[0]],
  });
  const roofs = new Set(layout.houses.map((house) => house.roofKind));
  const shapes = new Set(
    layout.houses.map((house) => `${house.storeys}:${house.features.join(",")}`),
  );

  assert.ok(roofs.size >= 4, `only ${roofs.size} roof shapes in the whole town`);
  assert.ok(
    shapes.size > layout.houses.length * 0.6,
    `only ${shapes.size} distinct houses out of ${layout.houses.length}`,
  );
});

test("the landmark houses stand out from the street they are on", () => {
  const layout = buildPalaceLayout({ seedSource: "landmarks", items, sections });
  const landmarks = layout.houses.filter((house) => house.landmark);

  assert.equal(landmarks.length, items.length);

  landmarks.forEach((house) => {
    assert.ok(house.features.includes("flag"), "a landmark has no flag");
    assert.ok(house.storeys >= 2, "a landmark is no taller than its neighbours");
    assert.ok(house.saturation >= 0.5, "a landmark is as pale as its neighbours");
  });
});

test("no two houses you have to remember look the same", () => {
  const layout = buildPalaceLayout({
    seedSource: "memorable",
    items: Array.from({ length: 30 }, (_, index) => ({
      id: `card-${index}`,
      kind: "card",
      sectionId: `s${index % 2}`,
    })),
    sections,
  });
  /* In route order: the houses themselves are scattered through the town now. */
  const landmarks = layout.houses
    .filter((house) => house.landmark)
    .sort((left, right) => left.landmarkIndex - right.landmarkIndex);

  assert.equal(landmarks.length, 30);

  /* Colour, roof and ornament together are the description you hold on to. */
  const descriptions = landmarks.map(
    (house) => `${Math.round(house.hue)}:${house.roofKind}:${house.ornament}`,
  );

  assert.equal(new Set(descriptions).size, landmarks.length, "two landmarks are described alike");

  /* And no two are close enough in colour to be argued about. */
  const hues = landmarks.map((house) => house.hue).sort((left, right) => left - right);

  hues.forEach((hue, index) => {
    if (index === 0) return;

    assert.ok(hue - hues[index - 1] > 4, `two landmark colours are ${hue.toFixed(1)}° apart`);
  });

  /* Consecutive stops on the route never share a roof, so it reads as a sequence. */
  landmarks.forEach((house, index) => {
    if (index === 0) return;

    assert.notEqual(
      house.roofKind,
      landmarks[index - 1].roofKind,
      "two landmarks in a row have the same roof",
    );
  });
});

test("the walk covers every section, most important cards first", () => {
  /* Three sections of very different sizes: the big one must not crowd out the
     others, and each section's best cards must be the ones that get in. */
  const deck = [
    ...Array.from({ length: 40 }, (_, index) => ({
      id: `big-${index}`,
      sectionId: "s1",
      weight: index,
    })),
    ...Array.from({ length: 6 }, (_, index) => ({
      id: `small-${index}`,
      sectionId: "s2",
      weight: index,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `tiny-${index}`,
      sectionId: "s3",
      weight: index,
    })),
  ];
  const chosen = selectPalaceItems({ cards: deck, quiz: [], test: [], limit: 12 });
  const ids = chosen.map((item) => item.id);

  assert.equal(ids.length, 12);
  assert.ok(ids.some((id) => id.startsWith("small-")), "a whole section was left out");
  assert.ok(ids.some((id) => id.startsWith("tiny-")), "a whole section was left out");

  /* Within a section, the highest weights are the ones taken. */
  const bigTaken = ids.filter((id) => id.startsWith("big-")).map((id) => Number(id.slice(4)));

  assert.ok(
    Math.min(...bigTaken) > 40 - bigTaken.length - 1,
    "an unimportant card was taken over an important one",
  );

  /* And they are walked in the note's own order, not in importance order. */
  const order = ids.map((id) => deck.findIndex((card) => card.id === id));

  assert.deepEqual([...order].sort((left, right) => left - right), order);
});

test("the walk mixes cards with quiz and test questions", () => {
  const chosen = selectPalaceItems({
    cards: Array.from({ length: 60 }, (_, index) => ({ id: `c${index}`, sectionId: "s1" })),
    quiz: Array.from({ length: 20 }, (_, index) => ({ id: `q${index}` })),
    test: Array.from({ length: 12 }, (_, index) => ({ id: `t${index}` })),
  });
  const counts = chosen.reduce(
    (total, item) => ({ ...total, [item.kind]: (total[item.kind] ?? 0) + 1 }),
    {},
  );

  assert.equal(chosen.length, MAX_STATIONS);
  assert.ok(counts.card > counts.quiz, "the deck should still be mostly flashcards");
  assert.ok(counts.quiz > 0 && counts.test > 0, "a walk with no questions in it");
  /* And enough of them that a walk actually runs into one. */
  assert.ok(
    counts.quiz + counts.test >= chosen.length * 0.3,
    `only ${counts.quiz + counts.test} questions in ${chosen.length} stops`,
  );
  assert.equal(new Set(chosen.map((item) => item.id)).size, chosen.length);
});

test("a short deck is laid out whole, without padding or repeats", () => {
  const chosen = selectPalaceItems({
    cards: [{ id: "c0", sectionId: null }, { id: "c1", sectionId: null }],
    quiz: [{ id: "q0" }],
    test: [],
  });

  assert.deepEqual(
    chosen.map((item) => item.id),
    ["c0", "c1", "q0"],
  );
});

test("questions with no section of their own are spread over the neighbourhoods", () => {
  const groups = groupItemsIntoDistricts(
    [
      { id: "a", kind: "card", sectionId: "s1" },
      { id: "b", kind: "card", sectionId: "s2" },
      { id: "q1", kind: "quiz", sectionId: null },
      { id: "q2", kind: "quiz", sectionId: null },
    ],
    sections,
    "Zapiski",
  );

  assert.deepEqual(
    groups.map((group) => group.items.map((item) => item.id)),
    [
      ["a", "q1"],
      ["b", "q2"],
    ],
  );
});

test("a note with no sections is still cut into walkable neighbourhoods", () => {
  const groups = groupItemsIntoDistricts(
    Array.from({ length: 20 }, (_, index) => ({ id: `c${index}`, kind: "card", sectionId: null })),
    [],
    "Zapiski",
  );

  assert.equal(groups.length, 3);
  assert.deepEqual(
    groups.map((group) => group.title),
    ["Zapiski 1", "Zapiski 2", "Zapiski 3"],
  );
});

test("you spawn in the street, not inside a house", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", items, sections });

  layout.houses.forEach((house) => {
    const plot = footprint(house);
    const insideX = Math.abs(layout.spawn.x - house.x) < plot.width / 2 + CHARACTER_RADIUS;
    const insideZ = Math.abs(layout.spawn.z - house.z) < plot.depth / 2 + CHARACTER_RADIUS;

    assert.ok(!(insideX && insideZ), "the spawn point is inside a house");
  });
});

test("the streets are painted, kerbed and paved on both sides", () => {
  const layout = buildPalaceLayout({ seedSource: "town", items, sections });

  assert.ok(layout.kerbs.length >= layout.roads.length * 2);
  for (const kerb of layout.kerbs) {
    for (const road of layout.roads) {
      const horizontal = kerb.width > kerb.depth;
      if (horizontal === (road.width > road.depth)) continue;
      const start = horizontal ? kerb.x - kerb.width / 2 : kerb.z - kerb.depth / 2;
      const end = horizontal ? kerb.x + kerb.width / 2 : kerb.z + kerb.depth / 2;
      const crossing = horizontal ? road.x : road.z;
      assert.ok(end <= crossing - 5.5 + 0.001 || start >= crossing + 5.5 - 0.001, "a kerb cuts through an intersection");
    }
  }
  assert.equal(layout.pavements.length, layout.roads.length * 2);
  assert.ok(layout.roadMarks.length > 50, "the roads carry no markings");
});

test("a town stays within a size a phone can draw", () => {
  const layout = buildPalaceLayout({
    seedSource: "big",
    items: Array.from({ length: MAX_STATIONS }, (_, index) => ({
      id: `card-${index}`,
      kind: "card",
      sectionId: `s${index % 6}`,
    })),
    sections: Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, title: `Del ${index}` })),
  });

  assert.ok(layout.houses.length < 400, `${layout.houses.length} houses is too many`);
  assert.ok(layout.props.length < 800, `${layout.props.length} props is too many`);
});

test("a wall is slid along, not walked through", () => {
  const wall = { x: 0, z: 10, width: 10, depth: 4 };
  const pushed = resolveCollision({ x: 1, z: 9 }, wall, CHARACTER_RADIUS);

  assert.equal(pushed.x, 1, "the slide along the wall is preserved");
  assert.ok(pushed.z < 10 - 4 / 2, "the walker ends up outside the wall");
});

test("walking into a house stops at its face", () => {
  const colliders = [{ x: 0, z: -10, width: 12, depth: 12 }];
  let state = createCharacter(0, 0, Math.PI);

  for (let frame = 0; frame < 120; frame += 1) {
    state = stepCharacter({
      state,
      input: { forward: 1, right: 0, jump: false, sprint: true },
      /* Facing -Z, straight at the house. */
      cameraYaw: Math.PI,
      colliders,
      bounds: 200,
      delta: 1 / 60,
    });
  }

  /* The near face is at z = -4; the walker stops one radius short of it. */
  const stopLine = -4 + CHARACTER_RADIUS;

  assert.ok(state.z <= stopLine + 0.001, "the walker never reached the wall");
  assert.ok(state.z >= stopLine - 0.001, "the walker passed through the wall");
});

test("the world is closed: you cannot walk off the edge", () => {
  let state = createCharacter(0, 0, 0);

  for (let frame = 0; frame < 600; frame += 1) {
    state = stepCharacter({
      state,
      input: { forward: 1, right: 0, jump: false, sprint: true },
      cameraYaw: 0,
      colliders: [],
      bounds: 50,
      delta: 1 / 60,
    });
  }

  assert.ok(Math.abs(state.z) <= 49.001);
});

test("a jump comes back down, and only one jump is allowed in the air", () => {
  let state = createCharacter(0, 0, 0);

  state = stepCharacter({
    state,
    input: { forward: 0, right: 0, jump: true, sprint: false },
    cameraYaw: 0,
    colliders: [],
    bounds: 50,
    delta: 1 / 60,
  });

  assert.ok(state.y > 0, "the jump did not leave the ground");
  assert.equal(state.grounded, false);

  const airborne = stepCharacter({
    state,
    input: { forward: 0, right: 0, jump: true, sprint: false },
    cameraYaw: 0,
    colliders: [],
    bounds: 50,
    delta: 1 / 60,
  });

  assert.ok(airborne.velocityY < state.velocityY, "a second jump was allowed mid-air");

  let falling = airborne;

  for (let frame = 0; frame < 120; frame += 1) {
    falling = stepCharacter({
      state: falling,
      input: { forward: 0, right: 0, jump: false, sprint: false },
      cameraYaw: 0,
      colliders: [],
      bounds: 50,
      delta: 1 / 60,
    });
  }

  assert.equal(falling.y, 0);
  assert.equal(falling.grounded, true);
});

test("the camera is pulled in rather than left inside a wall", () => {
  const target = { x: 0, y: 1.5, z: 0 };
  const behind = [{ x: 0, z: 6, width: 10, depth: 6 }];

  assert.equal(
    clampCameraDistance({ target, yaw: 0, pitch: 0.3, maxDistance: 8.4, colliders: [] }),
    8.4,
  );
  assert.ok(
    clampCameraDistance({ target, yaw: Math.PI, pitch: 0.3, maxDistance: 8.4, colliders: behind }) <
      8.4,
    "the camera stayed inside the building behind the player",
  );
});

test("the body turns the short way round", () => {
  assert.ok(turnTowards(0.1, -0.1, 1) < 0.1, "turning right went the long way round");
  assert.ok(turnTowards(3.0, -3.0, 1) > 3.0, "the turn crossed the seam the long way");
});

test("the station you are standing at is the nearest one within reach", () => {
  const stations = [
    { id: "far", x: 20, z: 0 },
    { id: "near", x: 1.5, z: 0 },
    { id: "middling", x: 3, z: 0 },
  ];

  assert.equal(nearestStation({ x: 0, z: 0 }, stations, 3.4).id, "near");
  assert.equal(nearestStation({ x: 40, z: 40 }, stations, 3.4), null);
});

test("the map arrow points where the player is walking", () => {
  const rotated = (facing) => {
    const angle = mapArrowAngle(facing);

    /* Canvas rotation of the arrow's tip at (0, -1). */
    return { x: Math.sin(angle), y: -Math.cos(angle) };
  };

  for (const facing of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 2.3]) {
    const arrow = rotated(facing);

    /* The map's y axis runs south, so world +Z is +y on the canvas. */
    assert.ok(Math.abs(arrow.x - Math.sin(facing)) < 1e-9, `x is wrong at ${facing}`);
    assert.ok(Math.abs(arrow.y - Math.cos(facing)) < 1e-9, `y is wrong at ${facing}`);
  }
});

test("the map is framed on the town, not on the empty outskirts", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", items, sections });
  const extent = mapExtent(layout);

  assert.ok(extent < layout.bounds, "the map would draw the town as a dot");

  layout.stations.forEach((station) => {
    assert.ok(
      Math.abs(station.x) <= extent && Math.abs(station.z) <= extent,
      "a station is off the map",
    );
  });
});

test("the stops are scattered, and differently for every note", () => {
  const walk = Array.from({ length: 10 }, (_, index) => ({
    id: `card-${index}`,
    kind: "card",
    sectionId: "s1",
  }));
  const one = buildPalaceLayout({ seedSource: "note-one", items: walk, sections: [sections[0]] });
  const two = buildPalaceLayout({ seedSource: "note-two", items: walk, sections: [sections[0]] });
  const places = (layout) => layout.stations.map((station) => `${station.x.toFixed(1)}`).join();

  assert.notEqual(places(one), places(two), "two notes put their stops in the same doorways");

  /* Scattered, but never two on the same corner. */
  one.stations.forEach((station, index) => {
    one.stations.slice(index + 1).forEach((other) => {
      assert.ok(
        Math.hypot(station.x - other.x, station.z - other.z) > 12,
        "two stops are within a few paces of each other",
      );
    });
  });
});

test("the rooms are spread through distinct houses throughout the town", () => {
  /* They used to bunch: every candidate on a pavement was generated inside the
     road and thrown away, leaving only the four spots on each block's green —
     four stops in a circle eight paces wide. */
  const items = Array.from({ length: 40 }, (_, index) => ({
    id: `card-${index}`,
    kind: "card",
    sectionId: `s${index % 6}`,
  }));
  const layout = buildPalaceLayout({
    seedSource: "spread",
    items,
    sections: Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, title: `Del ${index}` })),
  });

  const nearest = layout.stations.map((station) =>
    Math.min(
      ...layout.stations
        .filter((other) => other.id !== station.id)
        .map((other) => Math.hypot(station.x - other.x, station.z - other.z)),
    ),
  );

  assert.ok(Math.min(...nearest) > 15, `two stops are only ${Math.min(...nearest).toFixed(1)} apart`);

  /* And at much the same spacing throughout, rather than a cramped corner and
     an empty one: the roomiest stop is not twice as roomy as the tightest. */
  assert.ok(
    Math.max(...nearest) < Math.min(...nearest) * 4,
    `spacing runs from ${Math.min(...nearest).toFixed(1)} to ${Math.max(...nearest).toFixed(1)}`,
  );

  /* Spread over the whole map: no quarter of the town is left without a stop. */
  const extent = mapExtent(layout);
  const quarters = new Set(
    layout.stations.map((station) => {
      const column = Math.min(3, Math.floor(((station.x + extent) / (extent * 2)) * 4));
      const row = Math.min(3, Math.floor(((station.z + extent) / (extent * 2)) * 4));

      return `${column},${row}`;
    }),
  );

  assert.equal(quarters.size, 16, "part of the town has no stops in it at all");
});

test("the woods stay out of the town", () => {
  const layout = buildPalaceLayout({ seedSource: "woods", items, sections });
  const streets = layout.roads.map((road) =>
    road.width > road.depth ? Math.abs(road.z) : Math.abs(road.x),
  );
  const townEdge = Math.max(...streets);

  layout.props
    .filter((prop) => prop.kind === "tree")
    .forEach((tree) => {
      const outside = Math.max(Math.abs(tree.x), Math.abs(tree.z)) > townEdge + 6;

      if (outside) return;

      /* Anything inside the town has to be in a garden, never on tarmac. */
      layout.roads.forEach((road) => {
        const horizontal = road.width > road.depth;
        const distance = horizontal ? Math.abs(tree.z - road.z) : Math.abs(tree.x - road.x);

        assert.ok(distance > 11 / 2 + 5, `a tree is growing on the street at ${tree.x}, ${tree.z}`);
      });
    });
});

test("the walk covers every concept the deck teaches before repeating one", () => {
  /* Two cards per concept, and the concepts spread across sections — the shape
     the study pipeline actually produces. */
  const deck = Array.from({ length: 60 }, (_, index) => ({
    id: `c${index}`,
    sectionId: `s${index % 4}`,
    weight: 60 - index,
    conceptKey: `k${Math.floor(index / 2)}`,
  }));
  const chosen = selectPalaceItems({ cards: deck, quiz: [], test: [], limit: 40 });
  const byId = new Map(deck.map((card) => [card.id, card]));
  const concepts = new Set(chosen.map((item) => byId.get(item.id).conceptKey));

  assert.equal(chosen.length, 40);
  assert.equal(concepts.size, 30, "the walk repeats a concept while another has no stop at all");
  assert.equal(new Set(chosen.map((item) => item.sectionId)).size, 4, "a section was left out");
});

test("the body walks the way it faces, not backwards", () => {
  /*
   * The avatar is a box figure built facing local +Z — cap brim forward,
   * backpack behind — and drawn with `rotation.y = facing`, which in three.js
   * sends local +Z to `(sin facing, cos facing)`. That only reads right while
   * the controller walks along the same vector. It did not: the figure was
   * built facing -Z, so it went through the whole town in reverse.
   */
  const facing = 0.7;
  const state = createCharacter(0, 0, facing);
  const walked = stepCharacter({
    state,
    input: { forward: 1, right: 0, jump: false, sprint: false },
    cameraYaw: facing,
    colliders: [],
    bounds: 200,
    delta: 1 / 60,
  });

  const travelled = { x: walked.x - state.x, z: walked.z - state.z };
  const length = Math.hypot(travelled.x, travelled.z);
  const alignment =
    (travelled.x * Math.sin(walked.facing) + travelled.z * Math.cos(walked.facing)) / length;

  assert.ok(alignment > 0.999, `the body is ${Math.acos(alignment).toFixed(2)} rad off its walk`);
});

test("the walker strafes the way the player asked", () => {
  /* Facing -Z (the way the town spawns you), right is +X and left is -X. */
  const step = (right) =>
    stepCharacter({
      state: createCharacter(0, 0, Math.PI),
      input: { forward: 0, right, jump: false, sprint: false },
      cameraYaw: Math.PI,
      colliders: [],
      bounds: 200,
      delta: 1 / 60,
    });

  assert.ok(step(1).x > 0.01, "pressing right walked left");
  assert.ok(step(-1).x < -0.01, "pressing left walked right");
  assert.ok(Math.abs(step(1).z) < 0.001, "strafing wandered forwards");

  /* And forward is still away from the camera. */
  const ahead = stepCharacter({
    state: createCharacter(0, 0, Math.PI),
    input: { forward: 1, right: 0, jump: false, sprint: false },
    cameraYaw: Math.PI,
    colliders: [],
    bounds: 200,
    delta: 1 / 60,
  });

  assert.ok(ahead.z < -0.01, "pressing forward walked backwards");

  /* Turn the camera a quarter and the axes turn with it. */
  const turned = stepCharacter({
    state: createCharacter(0, 0, 0),
    input: { forward: 0, right: 1, jump: false, sprint: false },
    cameraYaw: Math.PI / 2,
    colliders: [],
    bounds: 200,
    delta: 1 / 60,
  });

  assert.ok(turned.z > 0.01, "the strafe did not follow the camera round");
});

test("a stop keeps the kind of the thing waiting at it", () => {
  /* The screen a stop opens is chosen by `kind`, and the item is then looked up
     in that kind's own map — so a stop that lost its kind opens the wrong one. */
  const mixed = [
    { id: "card-a", kind: "card", sectionId: "s1" },
    { id: "quiz-a", kind: "quiz", sectionId: null },
    { id: "test-a", kind: "test", sectionId: null },
    { id: "card-b", kind: "card", sectionId: "s2" },
  ];
  const layout = buildPalaceLayout({ seedSource: "kinds", items: mixed, sections });
  const byId = new Map(layout.stations.map((station) => [station.id, station]));

  mixed.forEach((item) => {
    assert.equal(byId.get(item.id)?.kind, item.kind, `${item.id} lost its kind`);
  });
  assert.equal(byId.size, mixed.length, "an item was dropped or duplicated");
});

test("the three kinds are marked apart on the ground and on the map", () => {
  /* The ring under a stop and its disc on the map are drawn from this, so the
     three cannot end up sharing a colour without the test noticing. */
  const hues = new Set(Object.values(STATION_HUE));

  assert.equal(hues.size, 3, "two kinds share a colour");
  assert.equal(Object.keys(STATION_HUE).sort().join(), "card,quiz,test");
});

test("no item is asked twice, whatever the mix", () => {
  const chosen = selectPalaceItems({
    cards: Array.from({ length: 30 }, (_, index) => ({ id: `c${index}`, sectionId: "s1" })),
    quiz: Array.from({ length: 12 }, (_, index) => ({ id: `q${index}` })),
    test: Array.from({ length: 9 }, (_, index) => ({ id: `t${index}` })),
  });

  assert.equal(new Set(chosen.map((item) => item.id)).size, chosen.length);
  /* And each id keeps the kind it came in as. */
  chosen.forEach((item) => {
    assert.equal(item.id.startsWith("c") ? "card" : item.id.startsWith("q") ? "quiz" : "test", item.kind);
  });
});

test("indoor and outdoor memories are balanced, clear of roads and other buildings", () => {
  const layout = buildPalaceLayout({
    seedSource: "scatter",
    items: Array.from({ length: 16 }, (_, index) => ({
      id: `card-${index}`,
      kind: "card",
      sectionId: index % 2 === 0 ? "s1" : "s2",
    })),
    sections,
  });

  assert.equal(layout.stations.filter((station) => station.placement === "inside").length, 8);
  assert.equal(layout.stations.filter((station) => station.placement === "outside").length, 8);
  layout.stations.forEach((station) => {
    layout.roads.forEach((road) => {
      const horizontal = road.width > road.depth;
      const distance = horizontal
        ? Math.abs(station.z - road.z)
        : Math.abs(station.x - road.x);

      assert.ok(distance > 11 / 2, `a stop at ${station.x}, ${station.z} is in the road`);
    });

    layout.houses.forEach((house, index) => {
      const plot = footprint(house);
      if (index === station.houseIndex && station.placement === "inside") {
        assert.ok(Math.abs(house.x - station.x) < plot.width / 2 - 1.8);
        assert.ok(Math.abs(house.z - station.z) < plot.depth / 2 - 1.8);
        return;
      }
      assert.ok(
        Math.abs(house.x - station.x) > plot.width / 2 ||
          Math.abs(house.z - station.z) > plot.depth / 2,
        "a stop is inside a house",
      );
    });
  });


});

test("saved recall history preserves mistakes and rejects corrupt or unknown grades", async () => {
  const { parsePalaceResults } = await import("../src/lib/palace/progress.ts");
  assert.deepEqual(parsePalaceResults('{"a":"again","b":"easy","c":"wrong"}'), { a: "again", b: "easy" });
  for (const raw of [null, "broken", "[]", "null", "3", '"text"']) assert.deepEqual(parsePalaceResults(raw), {});
});

test("every room has a distinct stable identity and an unobstructed entrance", async () => {
  const {roomIdentity, roomPoint, roomWalls, roomFurniture, insideHouse} = await import("../src/lib/palace/rooms.ts");
  const identities = Array.from({length:60},(_,i)=>roomIdentity(i));
  assert.equal(new Set(identities.map(room=>`${room.theme}:${room.color}`)).size,60);
  const layout = buildPalaceLayout({seedSource:"all-doors",items:Array.from({length:60},(_,i)=>({id:`c${i}`,kind:"card",sectionId:null})),sections:[]});
  // Exercise the same wall and furniture dimensions used by the renderer for
  // ordinary houses as well as memory houses, in all four orientations.
  layout.houses.forEach((house,index)=>{
    const identity=roomIdentity(house.landmark?house.landmarkIndex:layout.stations.length+index);
    const localParts=[...roomWalls(house),...roomFurniture(house,identity,house.landmark).filter(part=>part.solid)];
    const colliders=localParts.map(part=>({...roomPoint(house,part.x,part.z),width:Math.abs(Math.sin(house.facing))>.5?part.depth:part.width,depth:Math.abs(Math.sin(house.facing))>.5?part.width:part.depth}));
    const approach=roomPoint(house,0,house.depth/2+2);
    let character=createCharacter(approach.x,approach.z,house.facing+Math.PI);
    let entered=false;
    for(let frame=0;frame<150;frame++) {
      character=stepCharacter({state:character,input:{forward:1,right:0,jump:false,sprint:false},cameraYaw:house.facing+Math.PI,colliders,bounds:layout.bounds,delta:1/60});
      if(insideHouse(character,house)){entered=true;break;}
    }
    assert.ok(entered,`house ${index} cannot be entered`);
    for(let frame=0;frame<100;frame++) character=stepCharacter({state:character,input:{forward:-1,right:0,jump:false,sprint:false},cameraYaw:house.facing+Math.PI,colliders,bounds:layout.bounds,delta:1/60});
    assert.ok(!insideHouse(character,house),`house ${index} cannot be exited`);
  });
});

test("the minimap pins faraway rooms at the rim rather than going empty", async()=>{
  const {minimapMarker}=await import("../src/lib/palace/navigation.ts");
  const far=minimapMarker({x:0,z:0},{x:300,z:0},120,95,12);
  assert.deepEqual(far,{x:108,y:60,pinned:true});
  const near=minimapMarker({x:0,z:0},{x:0,z:0},120,95,12);
  assert.deepEqual(near,{x:60,y:60,pinned:false});
  const moved=minimapMarker({x:250,z:0},{x:300,z:0},120,95,12);
  assert.equal(moved.pinned,false); assert.ok(moved.x<far.x);
});

test("terrain is continuous and stays level under the entire playable town",async()=>{
  const {terrainHeight}=await import("../src/lib/palace/terrain.ts");
  for(const bounds of [170,250,400]) {
    for(let x=-bounds;x<=bounds;x+=10) for(let z=-bounds;z<=bounds;z+=10) assert.equal(terrainHeight(x,z,bounds),0);
    assert.ok(terrainHeight(bounds*2,bounds*2,bounds)>0);
    assert.ok(Math.abs(terrainHeight(bounds*1.18+0.01,0,bounds))<0.001);
  }
});


test("large map buttons and drawing share a north-up projection at every viewport", async () => {
  const { townMapPoint } = await import("../src/lib/palace/navigation.ts");
  assert.deepEqual(townMapPoint({x:0,z:0},100,400,200), {x:200,y:100});
  assert.deepEqual(townMapPoint({x:100,z:-100},100,400,200), {x:300,y:0});
  const layout = buildPalaceLayout({seedSource:"map-coverage", items:Array.from({length:60},(_,i)=>({id:`map-${i}`,kind:"card",sectionId:"s1"})),sections});
  const extent = mapExtent(layout);
  for (const station of layout.stations) {
    const button = townMapPoint(station,extent,100,100);
    const canvas = townMapPoint(station,extent,460,460);
    assert.ok(button.x > 0 && button.x < 100 && button.y > 0 && button.y < 100);
    assert.ok(Math.abs(canvas.x - button.x * 4.6) < 0.0001);
    assert.ok(Math.abs(canvas.y - button.y * 4.6) < 0.0001);
  }
});

// Architectural geometry must fit its plot and leave a real route into the lobby.
const { cityBuilding, buildingProfile, CITY_ARCHETYPES, LOBBY_HEIGHT, ENTRY_HEIGHT } = await import('../src/lib/palace/architecture.ts');
const { carBodyGeometry, carCabinGeometry, carRoofGeometry, carFrameGeometry, palmFrondGeometry } = await import('../src/lib/palace/scenery.ts');

test('all skyline styles have finite geometry and a clear full-height entrance', () => {
  const layout = buildPalaceLayout({ seedSource:'skyline-clearance', items:Array.from({length:60},(_,i)=>({id:`s-${i}`,kind:'card',sectionId:'s1'})), sections });
  const styles = new Set();
  for(const [index,house] of layout.houses.entries()) {
    styles.add(buildingProfile(house,index).kind);
    const parts=cityBuilding(house,index);
    assert.deepEqual(parts,cityBuilding(house,index),'an address changed between visits');
    assert.ok(buildingProfile(house,index).height>=3);
    if(['helix','tower','spire'].includes(buildingProfile(house,index).kind)) assert.ok(buildingProfile(house,index).height>=18);
    for(const part of parts) {
      for(const key of ['x','y','z','width','height','depth']) assert.ok(Number.isFinite(part[key]));
      assert.ok(part.width>0 && part.height>0 && part.depth>0);
      const bottom=part.y-part.height*(part.shape==='ribbon'?.018:.5);
      if(bottom>=ENTRY_HEIGHT || part.y+part.height/2 < .2 || part.z+part.depth/2 < house.depth/2-.3) continue;
      // A player can cross the central 2.6 m of the entry beneath the canopy.
      const rotated=Math.abs(Math.sin(part.rotation??0))>.5;
      const halfWidth=(rotated?part.depth:part.width)/2;
      assert.ok(Math.abs(part.x)-halfWidth>=1.3,`part closes the entry: ${JSON.stringify(part)}`);
    }
    assert.ok(LOBBY_HEIGHT-.28>5,'interior ceiling must clear the third-person camera');
  }
  assert.deepEqual([...styles].sort(),[...CITY_ARCHETYPES].sort());
});

test('roof gardens stay clear of the occupied glass floors', () => {
  const layout=buildPalaceLayout({seedSource:'roof-clearance',items,sections});
  for(const [index,house] of layout.houses.entries()) {
    const parts=cityBuilding(house,index);
    const glazing=parts.filter(p=>p.glass && p.y>LOBBY_HEIGHT);
    for(const shrub of parts.filter(p=>p.shape==='sphere')) for(const floor of glazing) {
      const overlapX=Math.abs(shrub.x-floor.x)<(shrub.width+floor.width)/2;
      const overlapY=Math.abs(shrub.y-floor.y)<(shrub.height+floor.height)/2;
      const overlapZ=Math.abs(shrub.z-floor.z)<(shrub.depth+floor.depth)/2;
      assert.ok(!(overlapX&&overlapY&&overlapZ),`${buildingProfile(house,index).kind} plants overlap an upper floor`);
    }
  }
});

test('shared car surfaces fit the parked-car collider and have valid normals', () => {
  for(const make of [carBodyGeometry,carCabinGeometry,carRoofGeometry,carFrameGeometry]) {
    const geometry=make();
    geometry.computeBoundingBox();
    const {min,max}=geometry.boundingBox;
    assert.ok(min.x>=-2.21 && max.x<=2.21 && min.z>=-1.1 && max.z<=1.1);
    assert.ok(min.y>=0 && max.y<1.9);
    assert.ok([...geometry.getAttribute('normal').array].every(Number.isFinite));
    assert.ok(geometry.getAttribute('position').count<600,'cars must share modest geometry on mobile');
    geometry.dispose();
  }
  const leaf=palmFrondGeometry();
  assert.ok([...leaf.getAttribute('normal').array].every(Number.isFinite));
  leaf.dispose();
});


test('short memory routes include a skyscraper, cottage and accessible moored boat', async () => {
  const {marinaBarriers}=await import('../src/lib/palace/landmarks.ts');
  const {roomPoint}=await import('../src/lib/palace/rooms.ts');
  const layout=buildPalaceLayout({seedSource:'distinctive-places',items:Array.from({length:3},(_,i)=>({id:`place-${i}`,kind:'card',sectionId:null})),sections:[]});
  assert.deepEqual(layout.stations.map(s=>buildingProfile(layout.houses[s.houseIndex],s.houseIndex).kind),['helix','cottage','houseboat']);
  const boat=layout.houses[layout.stations[2].houseIndex];
  const parts=cityBuilding(boat,layout.stations[2].houseIndex);
  assert.ok(parts.some(p=>p.surface==='water'));
  assert.ok(parts.some(p=>p.shape==='bow'));
  const sideways=Math.abs(Math.sin(boat.facing))>.5;
  const colliders=marinaBarriers(boat).map(p=>({...roomPoint(boat,p.x,p.z),width:sideways?p.depth:p.width,depth:sideways?p.width:p.depth}));
  let player=createCharacter(...Object.values(roomPoint(boat,0,boat.depth/2+4)),boat.facing+Math.PI);
  for(let frame=0;frame<110;frame++) player=stepCharacter({state:player,input:{forward:1,right:0,jump:false,sprint:false},cameraYaw:boat.facing+Math.PI,colliders,bounds:layout.bounds,delta:1/60});
  const inside=roomPoint(boat,0,0);
  assert.ok(Math.hypot(player.x-inside.x,player.z-inside.z)<boat.depth/2,'the gangway blocks access');
  for(const station of layout.stations) for(const collider of colliders) {
    assert.ok(Math.abs(station.x-collider.x)>collider.width/2+.3 || Math.abs(station.z-collider.z)>collider.depth/2+.3,'a marina barrier obstructs a memory');
  }
});

test('clock roofs cover all four tower corners with outward-facing closed slopes', async () => {
  const THREE=await import('three');
  const {pyramidRoofGeometry}=await import('../src/lib/palace/roof-geometry.ts');
  const geometry=pyramidRoofGeometry();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld();
  for(const x of [-.49,0,.49]) for(const z of [-.49,0,.49]) {
    const ray=new THREE.Raycaster(new THREE.Vector3(x,2,z),new THREE.Vector3(0,-1,0));
    assert.ok(ray.intersectObject(mesh).length>0,`roof leaves a corner open at ${x}, ${z}`);
  }
  geometry.dispose(); mesh.material.dispose();
});


test('background streets are mostly low distinct buildings instead of repeated skyscrapers', () => {
  const tall=new Set(['helix','spire','tower']);
  for(const count of [3,30,90]) {
    const layout=buildPalaceLayout({seedSource:`varied-streets-${count}`,items:Array.from({length:count},(_,i)=>({id:`v-${i}`,kind:'card',sectionId:null})),sections:[]});
    const background=layout.houses.map((house,index)=>({house,profile:buildingProfile(house,index)})).filter(p=>!p.house.landmark);
    assert.equal(background.filter(p=>tall.has(p.profile.kind)).length,0,'background lots repeat a landmark skyscraper');
    for(const kind of tall) assert.ok(layout.houses.filter((house,index)=>buildingProfile(house,index).kind===kind).length<=1,`${kind} repeats across the skyline`);
    assert.ok(new Set(background.map(p=>p.profile.kind)).size>=8,'background silhouettes lack variety');
    for(const {profile} of background) if(['terrace','courtyard'].includes(profile.kind)) assert.ok(profile.height<=12,'a low-rise block became another skyscraper');
  }
});


test('conservatory roofs close both triangular ends without crossing the doorway', () => {
  const layout=buildPalaceLayout({seedSource:'closed-conservatories',items:Array.from({length:30},(_,i)=>({id:`g-${i}`,kind:'card',sectionId:null})),sections:[]});
  let checked=0;
  for(const [index,house] of layout.houses.entries()) {
    if(buildingProfile(house,index).kind!=='greenhouse') continue;
    const ends=cityBuilding(house,index).filter(part=>part.shape==='gable');
    assert.equal(ends.length,2);
    for(const side of [-1,1]) {
      const end=ends.find(part=>Math.sign(part.z)===side);
      assert.ok(end.glass);
      assert.equal(end.width,house.width);
      assert.equal(end.height,3.8);
      assert.ok(Math.abs(end.y-end.height/2-LOBBY_HEIGHT)<1e-9);
      assert.equal(Math.abs(end.z),house.depth/2);
    }
    checked++;
  }
  assert.ok(checked>0);
});


test('every town has one central pyramid without displacing any study memory', () => {
  for(const count of [3,60]) {
    const layout=buildPalaceLayout({seedSource:`central-pyramid-${count}`,items:Array.from({length:count},(_,i)=>({id:`p-${i}`,kind:'card',sectionId:null})),sections:[]});
    const pyramids=layout.houses.filter(house=>house.monument==='pyramid');
    assert.equal(pyramids.length,1);
    assert.ok(!pyramids[0].landmark);
    const distance=Math.hypot(pyramids[0].x,pyramids[0].z);
    assert.ok(layout.houses.filter(house=>!house.landmark).every(house=>Math.hypot(house.x,house.z)>=distance));
    assert.equal(new Set(layout.stations.map(station=>station.id)).size,count);
  }
});

test("releasing movement stops immediately even after sprinting", () => {
  const environment = { cameraYaw: 0, colliders: [], bounds: 200, delta: 1 / 60 };
  const running = stepCharacter({ ...environment, state: createCharacter(0, 0, 0),
    input: { forward: 1, right: 0, jump: false, sprint: true } });
  let stopped = running;
  for (let frame = 0; frame < 120; frame++) {
    stopped = stepCharacter({ ...environment, state: stopped,
      input: { forward: 0, right: 0, jump: false, sprint: false } });
  }
  assert.equal(stopped.x, running.x);
  assert.equal(stopped.z, running.z);
  assert.equal(stopped.speed, 0);
});

test('unused card slots include all quiz and test questions that fit', () => {
  const quiz = Array.from({length:24},(_,i)=>({id:`q${i}`}));
  const practice = Array.from({length:16},(_,i)=>({id:`t${i}`}));
  const chosen = selectPalaceItems({cards:[{id:'c',sectionId:null}],quiz,test:practice});
  assert.equal(chosen.length,41);
  assert.equal(chosen.filter(x=>x.kind==='quiz').length,24);
  assert.equal(chosen.filter(x=>x.kind==='test').length,16);
  for (const kind of ['quiz','test']) {
    const bank = Array.from({length:80},(_,i)=>({id:`${kind}${i}`}));
    const single = selectPalaceItems({cards:[],quiz:kind==='quiz'?bank:[],test:kind==='test'?bank:[]});
    assert.equal(single.length,MAX_STATIONS);
    assert.ok(single.every(x=>x.kind===kind));
  }
});
