import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPalaceLayout,
  groupCardsIntoDistricts,
  mapArrowAngle,
  mapExtent,
} from "../src/lib/palace/layout.ts";
import {
  CHARACTER_RADIUS,
  createCharacter,
  nearestStation,
  resolveCollision,
  stepCharacter,
  turnTowards,
} from "../src/lib/palace/movement.ts";
import { clampLines, wrapText } from "../src/lib/palace/text-texture.ts";

const card = (id, sectionId = null) => ({ id, sectionId });
const sections = [
  { id: "s1", title: "Prvi del" },
  { id: "s2", title: "Drugi del" },
];
const cards = [
  card("a", "s1"),
  card("b", "s1"),
  card("c", "s2"),
  card("d", "s2"),
  card("e", "s2"),
];

test("the same note builds the same city every time", () => {
  const first = buildPalaceLayout({ seedSource: "lecture-1", cards, sections });
  const second = buildPalaceLayout({ seedSource: "lecture-1", cards, sections });

  assert.deepEqual(second, first);
});

test("a different note gets a different city", () => {
  const first = buildPalaceLayout({ seedSource: "lecture-1", cards, sections });
  const other = buildPalaceLayout({ seedSource: "lecture-2", cards, sections });

  assert.notDeepEqual(other.buildings, first.buildings);
});

test("every card gets exactly one station, in deck order", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", cards, sections });

  assert.deepEqual(
    layout.stations.map((station) => station.id),
    ["a", "b", "c", "d", "e"],
  );
  assert.equal(new Set(layout.stations.map((station) => station.id)).size, cards.length);
});

test("a section becomes a district, and its cards stay inside it", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", cards, sections });

  assert.deepEqual(
    layout.districts.map((district) => district.title),
    ["Prvi del", "Drugi del"],
  );
  assert.deepEqual(layout.districts[0].stationIds, ["a", "b"]);
  assert.deepEqual(layout.districts[1].stationIds, ["c", "d", "e"]);

  layout.districts.forEach((district) => {
    district.stationIds.forEach((id) => {
      const station = layout.stations.find((entry) => entry.id === id);
      const distance = Math.hypot(station.x - district.center.x, station.z - district.center.z);

      assert.ok(distance < district.radius, `${id} is outside its own plaza`);
    });
  });
});

test("stations never overlap each other", () => {
  const layout = buildPalaceLayout({
    seedSource: "crowded",
    cards: Array.from({ length: 24 }, (_, index) => card(`card-${index}`, "s1")),
    sections: [sections[0]],
  });

  layout.stations.forEach((station, index) => {
    layout.stations.slice(index + 1).forEach((other) => {
      assert.ok(
        Math.hypot(station.x - other.x, station.z - other.z) > 2,
        "two cards landed on the same spot",
      );
    });
  });
});

test("cards with no section still land somewhere", () => {
  const groups = groupCardsIntoDistricts(
    [card("a", "s1"), card("loose"), card("also-loose")],
    sections,
    "Zapiski",
  );

  assert.deepEqual(groups.map((group) => group.cards.map((entry) => entry.id)).flat().sort(), [
    "a",
    "also-loose",
    "loose",
  ]);
});

test("a note with no sections is still cut into walkable districts", () => {
  const groups = groupCardsIntoDistricts(
    Array.from({ length: 20 }, (_, index) => card(`c${index}`)),
    [],
    "Zapiski",
  );

  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((group) => group.title), ["Zapiski 1", "Zapiski 2", "Zapiski 3"]);
});

test("you spawn on the street, not inside a building", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", cards, sections });

  layout.buildings.forEach((building) => {
    const insideX = Math.abs(layout.spawn.x - building.x) < building.width / 2 + CHARACTER_RADIUS;
    const insideZ = Math.abs(layout.spawn.z - building.z) < building.depth / 2 + CHARACTER_RADIUS;

    assert.ok(!(insideX && insideZ), "the spawn point is inside a building");
  });
});

test("a wall is slid along, not walked through", () => {
  const wall = { x: 0, z: 10, width: 10, depth: 4 };
  const pushed = resolveCollision({ x: 1, z: 9 }, wall, CHARACTER_RADIUS);

  assert.equal(pushed.x, 1, "the slide along the wall is preserved");
  assert.ok(pushed.z < 10 - 4 / 2, "the walker ends up outside the wall");
});

test("walking into a building stops at its face", () => {
  const colliders = [{ x: 0, z: -10, width: 12, depth: 12 }];
  let state = createCharacter(0, 0, Math.PI);

  for (let frame = 0; frame < 120; frame += 1) {
    state = stepCharacter({
      state,
      input: { forward: 1, right: 0, jump: false, sprint: true },
      /* Facing -Z, straight at the building. */
      cameraYaw: Math.PI,
      colliders,
      bounds: 200,
      delta: 1 / 60,
    });
  }

  /* The building's near face is at z = -4; the walker stops one radius short of it. */
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

test("the body turns the short way round", () => {
  assert.ok(turnTowards(0.1, -0.1, 1) < 0.1, "turning right went the long way round");
  assert.ok(turnTowards(3.0, -3.0, 1) > 3.0, "the turn crossed the seam the long way");
});

test("the card you are standing at is the nearest one within reach", () => {
  const stations = [
    { id: "far", x: 20, z: 0 },
    { id: "near", x: 1.5, z: 0 },
    { id: "middling", x: 3, z: 0 },
  ];

  assert.equal(nearestStation({ x: 0, z: 0 }, stations, 3.4).id, "near");
  assert.equal(nearestStation({ x: 40, z: 40 }, stations, 3.4), null);
});

test("board text wraps on words and never overflows the board", () => {
  /* A fake measurer: one unit per character, which is all wrapping needs. */
  const measure = (text) => text.length;
  const lines = wrapText("Kaj je fotosinteza in zakaj je pomembna", 12, measure);

  lines.forEach((line) => assert.ok(line.length <= 12, `"${line}" is wider than the board`));
  assert.equal(lines.join(" "), "Kaj je fotosinteza in zakaj je pomembna");
});

test("a word wider than the board is broken rather than clipped", () => {
  const measure = (text) => text.length;
  const lines = wrapText("elektroencefalografija", 8, measure);

  lines.forEach((line) => assert.ok(line.length <= 8));
  assert.equal(lines.join(""), "elektroencefalografija");
});

test("more text than fits ends in an ellipsis", () => {
  const clamped = clampLines(["one", "two", "three", "four"], 2);

  assert.deepEqual(clamped, ["one", "two…"]);
});

test("the map arrow points where the player is walking", () => {
  /* Rotate the north-pointing arrow the way a canvas would, then compare with
     the direction the character actually moves in: x = sin(facing), z = cos(facing). */
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

test("the map is framed on the districts, not on the empty outskirts", () => {
  const layout = buildPalaceLayout({ seedSource: "lecture-1", cards, sections });
  const extent = mapExtent(layout);

  assert.ok(extent < layout.bounds, "the map would draw the city as a dot");

  layout.stations.forEach((station) => {
    assert.ok(Math.abs(station.x) <= extent && Math.abs(station.z) <= extent, "a card is off the map");
  });
});

test("the town is built around the plazas, not on top of them", () => {
  const layout = buildPalaceLayout({ seedSource: "town", cards, sections });

  assert.ok(layout.buildings.length > 40, "the streets were left empty");

  layout.buildings.forEach((building) => {
    layout.districts.forEach((district) => {
      const distance = Math.hypot(district.center.x - building.x, district.center.z - building.z);

      assert.ok(
        distance > district.radius - 1,
        "a building was dropped inside a plaza the cards stand in",
      );
    });
  });
});

test("nothing is built in the middle of a street", () => {
  const layout = buildPalaceLayout({ seedSource: "town", cards, sections });
  const roadHalf = 11 / 2;

  layout.buildings.forEach((building) => {
    layout.roads.forEach((road) => {
      const alongX = road.width > road.depth;
      const overlapsRoad = alongX
        ? Math.abs(building.z - road.z) < roadHalf + building.depth / 2
        : Math.abs(building.x - road.x) < roadHalf + building.width / 2;
      const withinRoadLength = alongX
        ? Math.abs(building.x - road.x) < road.width / 2
        : Math.abs(building.z - road.z) < road.depth / 2;

      assert.ok(
        !(overlapsRoad && withinRoadLength),
        `a building at ${building.x.toFixed(1)}, ${building.z.toFixed(1)} is in the road`,
      );
    });
  });
});

test("the streets are painted and kerbed", () => {
  const layout = buildPalaceLayout({ seedSource: "town", cards, sections });

  assert.equal(layout.kerbs.length, layout.roads.length * 2, "every road has two kerbs");
  assert.ok(layout.roadMarks.length > 50, "the roads carry no markings");
});

test("a city stays within a size a phone can draw", () => {
  /* Forty cards is the biggest deck the pipeline produces for one note. */
  const layout = buildPalaceLayout({
    seedSource: "big",
    cards: Array.from({ length: 40 }, (_, index) => card(`card-${index}`, `s${index % 6}`)),
    sections: Array.from({ length: 6 }, (_, index) => ({ id: `s${index}`, title: `Del ${index}` })),
  });

  assert.ok(layout.buildings.length < 400, `${layout.buildings.length} buildings is too many`);
  assert.ok(layout.props.length < 700, `${layout.props.length} props is too many`);
});
