import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPalaceLayout,
  groupItemsIntoDistricts,
  mapArrowAngle,
  mapExtent,
  MAX_STATIONS,
  selectPalaceItems,
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

test("every item gets exactly one station outside a house of its own", () => {
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
  const landmarks = layout.houses.filter((house) => house.landmark);

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

  /* Consecutive stops never share a roof, so a route reads as a sequence. */
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

  assert.equal(layout.kerbs.length, layout.roads.length * 2);
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
