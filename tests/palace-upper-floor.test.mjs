import assert from "node:assert/strict";
import test from "node:test";

import { buildPalaceLayout } from "../src/lib/palace/layout.ts";
import {
  CHARACTER_RADIUS,
  colliderApplies,
  createCharacter,
  floorHeight,
  nearestStation,
  stepCharacter,
} from "../src/lib/palace/movement.ts";
import {
  ROOM_DOOR_WIDTH,
  roomFurniture,
  roomIdentity,
  roomPoint,
  roomSurfaces,
  roomUpperColliders,
  roomUpperFloor,
  roomWalls,
  UPPER_FLOOR_Y,
  upperFurniture,
  upperStationPoint,
} from "../src/lib/palace/rooms.ts";

/*
 * Every house has a gallery over the back of its ground-floor room, reached by
 * stairs up the right-hand wall, and every other indoor stop waits up there.
 * These walk the same boxes the renderer builds, in every house of a large town
 * and so in all four orientations.
 */

const layout = buildPalaceLayout({
  seedSource: "upper-floors",
  items: Array.from({ length: 60 }, (_, index) => ({ id: `c${index}`, kind: "card", sectionId: null })),
  sections: [],
});

function worldBox(house, box) {
  const sideways = Math.abs(Math.sin(house.facing)) > 0.5;

  return {
    ...box,
    ...roomPoint(house, box.x, box.z),
    width: sideways ? box.depth : box.width,
    depth: sideways ? box.width : box.depth,
  };
}

/** The room as the world builds it: walls, stairs, rails and solid furniture on both floors. */
function room(house, index) {
  const identity = roomIdentity(house.landmark ? house.landmarkIndex : layout.stations.length + index);
  const station = house.landmark ? layout.stations[house.landmarkIndex] : undefined;
  const upstairs = station?.placement === "inside" && (station.y ?? 0) > 0;
  const colliders = [
    ...roomWalls(house),
    ...roomUpperColliders(house),
    ...roomFurniture(house, identity, station?.placement === "inside" && !upstairs)
      .filter((part) => part.solid)
      .map((part) => ({ ...part, top: UPPER_FLOOR_Y - 0.6 })),
    ...upperFurniture(house, identity, upstairs)
      .filter((part) => part.solid)
      .map((part) => ({ ...part, bottom: UPPER_FLOOR_Y - 0.1, top: UPPER_FLOOR_Y + 2 })),
  ].map((box) => worldBox(house, box));

  return { identity, colliders, surfaces: roomSurfaces(house).map((surface) => worldBox(house, surface)) };
}

/** Walk straight at a point in the room's axes; returns the walker when it arrives or gives up. */
function walkTo(character, house, local, world, frames = 400) {
  const target = roomPoint(house, local.x, local.z);

  for (let frame = 0; frame < frames; frame++) {
    const dx = target.x - character.x;
    const dz = target.z - character.z;

    if (Math.hypot(dx, dz) < 0.25) break;

    character = stepCharacter({
      state: character,
      input: { forward: 1, right: 0, jump: false, sprint: false },
      cameraYaw: Math.atan2(dx, dz),
      colliders: world.colliders,
      surfaces: world.surfaces,
      bounds: layout.bounds,
      delta: 1 / 60,
    });
  }

  return character;
}

test("every house's stairs lead from the door to the gallery", () => {
  layout.houses.forEach((house, index) => {
    const world = room(house, index);
    const upper = roomUpperFloor(house);
    const stairX = (upper.stair.x0 + upper.stair.x1) / 2;
    const door = roomPoint(house, 0, upper.innerZ - 0.8);
    let walker = createCharacter(door.x, door.z, house.facing + Math.PI);

    walker = walkTo(walker, house, { x: stairX, z: upper.stair.zBottom + 0.3 }, world);
    assert.equal(walker.y, 0, `house ${index}: the landing is not on the ground`);

    walker = walkTo(walker, house, { x: stairX, z: upper.edgeZ - 1 }, world);
    assert.ok(
      Math.abs(walker.y - UPPER_FLOOR_Y) < 1e-6,
      `house ${index}: the stairs top out at ${walker.y.toFixed(2)} m, not the gallery`,
    );

    /* Across the gallery to where an upstairs stop stands, still upstairs. */
    const stop = upperStationPoint(house, world.identity);

    walker = walkTo(walker, house, { x: stop.x, z: stop.z + 1.2 }, world);
    const reached = roomPoint(house, stop.x, stop.z);

    assert.ok(
      Math.hypot(walker.x - reached.x, walker.z - reached.z) < 1.8,
      `house ${index}: the upstairs stop is out of reach`,
    );
    assert.ok(Math.abs(walker.y - UPPER_FLOOR_Y) < 1e-6, `house ${index}: fell off the gallery`);

    /* And back down again. */
    walker = walkTo(walker, house, { x: stairX, z: upper.edgeZ - 0.8 }, world);
    walker = walkTo(walker, house, { x: stairX, z: upper.stair.zBottom + 0.3 }, world);
    assert.equal(walker.y, 0, `house ${index}: could not get back down`);
  });
});

test("the stairs stay clear of the doorway", () => {
  for (const house of layout.houses) {
    const { stair } = roomUpperFloor(house);

    assert.ok(stair.x0 > ROOM_DOOR_WIDTH / 2 + CHARACTER_RADIUS, "the stairs block the door");
    assert.ok(stair.run / stair.steps < 0.36 && stair.run / stair.steps > 0.18, "the treads are not walkable");
  }
});

test("downstairs, the gallery is a ceiling, not a wall", () => {
  const house = layout.houses[0];
  const world = room(house, 0);
  const upper = roomUpperFloor(house);
  const underneath = roomPoint(house, -upper.innerX + 1.2, upper.edgeZ - 0.5);

  /* Its floor is not something the ground floor stands on, and its rail is overhead. */
  assert.equal(floorHeight(underneath, 0, world.surfaces), 0);
  const rail = world.colliders.find((collider) => collider.bottom === UPPER_FLOOR_Y - 0.3);

  assert.ok(rail, "no gallery rail");
  assert.equal(colliderApplies(rail, 0), false, "the gallery rail blocks the ground floor");
  assert.equal(colliderApplies(rail, UPPER_FLOOR_Y), true, "the gallery rail does not stop a fall");
});

test("half the indoor stops wait upstairs, on their own house's gallery", () => {
  const inside = layout.stations.filter((station) => station.placement === "inside");
  const upstairs = inside.filter((station) => (station.y ?? 0) > 0);

  assert.ok(upstairs.length >= Math.floor(inside.length / 2) - 1, "too few stops upstairs");
  assert.ok(upstairs.length <= Math.ceil(inside.length / 2) + 1, "too many stops upstairs");

  for (const station of upstairs) {
    const house = layout.houses[station.houseIndex];
    const gallery = roomSurfaces(house).map((surface) => worldBox(house, surface)).at(-1);

    assert.equal(station.y, UPPER_FLOOR_Y);
    assert.ok(Math.abs(station.x - gallery.x) < gallery.width / 2, "an upstairs stop is off the gallery");
    assert.ok(Math.abs(station.z - gallery.z) < gallery.depth / 2, "an upstairs stop is off the gallery");
  }
});

test("a stop opens only on its own floor", () => {
  const stations = [{ id: "up", x: 0, z: 0, y: UPPER_FLOOR_Y }];

  assert.equal(nearestStation({ x: 0, z: 0.5, y: 0 }, stations, 1.8), null);
  assert.equal(nearestStation({ x: 0, z: 0.5, y: UPPER_FLOOR_Y }, stations, 1.8)?.id, "up");
});
