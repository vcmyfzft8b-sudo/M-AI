import assert from "node:assert/strict";
import test from "node:test";

import { buildPalaceLayout } from "../src/lib/palace/layout.ts";
import { alongPath, guidePath, WALKING_OFFSET } from "../src/lib/palace/guide.ts";
import { roomPoint } from "../src/lib/palace/rooms.ts";

/*
 * The trail on the pavement leads to the next stop the way a person would
 * walk: along the streets, round the corners, never through a building.
 */

const layout = buildPalaceLayout({
  seedSource: "guide-routes",
  items: Array.from({ length: 60 }, (_, index) => ({ id: `g${index}`, kind: "card", sectionId: null })),
  sections: [],
});
const lines = [...new Set(layout.roads.filter((road) => road.width > road.depth).map((road) => road.z))].sort((a, b) => a - b);

/** Where you head for a stop: the door of its house, or the stop itself outdoors. */
function goal(station) {
  const house = layout.houses[station.houseIndex];

  return station.placement === "inside" ? roomPoint(house, 0, house.depth / 2 + 2.5) : { x: station.x, z: station.z };
}

function insideAHouse(point) {
  return layout.houses.some((house) => {
    const dx = point.x - house.x;
    const dz = point.z - house.z;
    const across = Math.abs(dx * Math.cos(house.facing) - dz * Math.sin(house.facing));
    const deep = Math.abs(dx * Math.sin(house.facing) + dz * Math.cos(house.facing));

    return across < house.width / 2 && deep < house.depth / 2;
  });
}

test("the trail never runs through a building", () => {
  let checked = 0;

  for (let from = 0; from < layout.stations.length; from += 3)
    for (let to = 1; to < layout.stations.length; to += 7) {
      if (from === to) continue;

      const path = guidePath(layout, goal(layout.stations[from]), goal(layout.stations[to]));

      for (let index = 1; index < path.length; index++) {
        const a = path[index - 1];
        const b = path[index];
        const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z));

        for (let step = 0; step <= steps; step++) {
          const t = steps === 0 ? 0 : step / steps;
          const point = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };

          assert.ok(!insideAHouse(point), `the trail from stop ${from} to ${to} crosses a house at ${point.x.toFixed(1)}, ${point.z.toFixed(1)}`);
        }
      }
      checked++;
    }

  assert.ok(checked > 50);
});

test("the trail turns at junctions, on the walking line", () => {
  const [a, b] = [lines[1], lines[2]];
  /* From one street to a crossing one: one corner, where the two pavements meet. */
  const corner = guidePath(layout, { x: -70, z: a + WALKING_OFFSET }, { x: b + WALKING_OFFSET, z: 60 });

  assert.deepEqual(corner, [
    { x: -70, z: a + WALKING_OFFSET },
    { x: b + WALKING_OFFSET, z: a + WALKING_OFFSET },
    { x: b + WALKING_OFFSET, z: 60 },
  ]);

  /* Between parallel streets: over by a cross street, two corners on its walking line. */
  const parallel = guidePath(layout, { x: -60, z: a + WALKING_OFFSET }, { x: -85, z: b - WALKING_OFFSET });
  const turns = parallel.slice(1, -1);

  assert.equal(turns.length, 2);
  assert.equal(turns[0].x, turns[1].x, "the cross street is not straight");
  assert.ok(lines.some((line) => Math.abs(Math.abs(turns[0].x - line) - WALKING_OFFSET) < 1e-9), "the cross is not along a street");
});

test("trail marks are evenly spaced along the route and point along it", () => {
  const marks = alongPath([{ x: 0, z: 0 }, { x: 0, z: 10 }, { x: 10, z: 10 }], 2, 1, 50);

  assert.deepEqual(marks.map((mark) => mark.distance), [1, 3, 5, 7, 9, 11, 13, 15, 17, 19]);
  assert.equal(marks[0].heading, 0);
  assert.equal(marks.at(-1).heading, Math.PI / 2);
  assert.equal(alongPath([{ x: 0, z: 0 }, { x: 0, z: 100 }], 1, 0, 12).length, 12);
});
