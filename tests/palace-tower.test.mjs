import assert from "node:assert/strict";
import test from "node:test";

import { buildingProfile } from "../src/lib/palace/architecture.ts";
import { buildPalaceLayout } from "../src/lib/palace/layout.ts";
import { createLiftState, liftTravel, stepLifts } from "../src/lib/palace/lift.ts";
import { CHARACTER_RADIUS, colliderApplies, createCharacter, resolveCollision, stepCharacter } from "../src/lib/palace/movement.ts";
import { roomFurniture, roomIdentity, roomPoint, roomWalls } from "../src/lib/palace/rooms.ts";
import {
  isTower,
  penthouseFurniture,
  penthouseStationPoint,
  TOWER_KINDS,
  towerColliders,
  towerPlan,
  towerSurfaces,
} from "../src/lib/palace/tower.ts";

/*
 * The skyscrapers can be gone up: a glass lift up their middle, from the lobby to a penthouse,
 * and on to a viewing deck on the roof. These ride it in every tower of a
 * large town, with the same boxes the renderer builds.
 */

const layout = buildPalaceLayout({
  seedSource: "towers",
  items: Array.from({ length: 60 }, (_, index) => ({ id: `t${index}`, kind: "card", sectionId: null })),
  sections: [],
});
const towers = layout.houses.filter(isTower);

function worldBox(house, box) {
  const sideways = Math.abs(Math.sin(house.facing)) > 0.5;

  return { ...box, ...roomPoint(house, box.x, box.z), width: sideways ? box.depth : box.width, depth: sideways ? box.width : box.depth };
}

function world(house) {
  const plan = towerPlan(house);
  const station = layout.stations[house.landmarkIndex];
  const upstairs = station?.placement === "inside";
  const colliders = [
    ...roomWalls(house),
    ...towerColliders(house),
    ...roomFurniture(house, roomIdentity(house.landmarkIndex), false).filter((part) => part.solid).map((part) => ({ ...part, top: Math.max(part.y + part.height / 2, 0.7) })),
    ...penthouseFurniture(house, upstairs).filter((part) => part.solid).map((part) => ({ ...part, bottom: plan.floor - 0.1, top: plan.floor + 2 })),
  ].map((box) => worldBox(house, box));

  return { plan, colliders, surfaces: towerSurfaces(house).map((surface) => worldBox(house, surface)) };
}

/** Walk (and ride) towards a point in the building's axes, for up to `frames`, the lifts running. */
function go(state, house, scene, lifts, local, frames = 600, until = () => false) {
  const target = roomPoint(house, local.x, local.z);
  const surfaces = [...scene.surfaces, ...lifts.map((lift) => lift.surface)];

  for (let frame = 0; frame < frames && !until(state); frame++) {
    const dx = target.x - state.x;
    const dz = target.z - state.z;
    const moving = Math.hypot(dx, dz) > 0.2;

    state = stepCharacter({
      state,
      input: { forward: moving ? 1 : 0, right: 0, jump: false, sprint: false },
      cameraYaw: Math.atan2(dx, dz),
      colliders: scene.colliders,
      surfaces,
      bounds: layout.bounds,
      delta: 1 / 60,
    });
    for (const barrier of stepLifts(lifts, state, 1 / 60)) {
      if (colliderApplies(barrier, state.y)) state = { ...state, ...resolveCollision(state, barrier, CHARACTER_RADIUS) };
    }
  }

  return state;
}

test("a large town has each skyscraper once, and every one can be gone up", () => {
  assert.deepEqual(new Set(towers.map((house) => buildingProfile(house, 0).kind)), new Set(TOWER_KINDS));

  for (const house of towers) {
    const scene = world(house);
    const { plan } = scene;
    const lifts = createLiftState({ houses: [house] });
    const door = roomPoint(house, 0, house.depth / 2 - 0.8);
    let walker = createCharacter(door.x, door.z, house.facing + Math.PI);
    const kind = buildingProfile(house, 0).kind;

    /* Into the car, and wait: it takes you to the penthouse. */
    walker = go(walker, house, scene, lifts, plan.lift, 900, (state) => state.y > plan.floor - 0.01);
    assert.ok(Math.abs(walker.y - plan.floor) < 0.01, `${kind}: the lift did not reach the penthouse (at ${walker.y.toFixed(2)} m)`);

    /* Out of the door and across to the stop in the front corner. */
    const stop = penthouseStationPoint(house);

    walker = go(walker, house, scene, lifts, { x: plan.lift.x, z: plan.lift.z + 2.2 }, 200);
    walker = go(walker, house, scene, lifts, { x: stop.x + 1.3, z: stop.z }, 400);
    const reached = roomPoint(house, stop.x, stop.z);

    assert.ok(Math.hypot(walker.x - reached.x, walker.z - reached.z) < 1.8, `${kind}: the penthouse stop is out of reach`);
    assert.ok(Math.abs(walker.y - plan.floor) < 0.01, `${kind}: fell out of the penthouse`);

    /* The glass holds: walking at the front wall stops there, still upstairs. */
    walker = go(walker, house, scene, lifts, { x: stop.x, z: plan.depth / 2 + 3 }, 240);
    assert.ok(Math.abs(walker.y - plan.floor) < 0.01, `${kind}: walked out through the penthouse glass`);

    /* Back to the lift (it comes when called), up to the roof, and out onto the deck. */
    walker = go(walker, house, scene, lifts, { x: plan.lift.x, z: plan.lift.z + 2.2 }, 300);
    walker = go(walker, house, scene, lifts, plan.lift, 1400, (state) => state.y > plan.roof - 0.01);
    assert.ok(Math.abs(walker.y - plan.roof) < 0.01, `${kind}: the lift did not reach the roof`);
    walker = go(walker, house, scene, lifts, { x: 0, z: plan.depth / 2 + 4 }, 300);
    assert.ok(Math.abs(walker.y - plan.roof) < 0.01, `${kind}: walked off the roof deck`);

    /* And all the way back down to the lobby. */
    walker = go(walker, house, scene, lifts, { x: plan.lift.x, z: plan.lift.z + 2.2 }, 300);
    walker = go(walker, house, scene, lifts, plan.lift, 2400, (state) => state.y < 0.01 && lifts[0].target === null);
    /* Within a centimetre: the car settles a frame after the walker steps. */
    assert.ok(walker.y < 0.01, `${kind}: could not get back down to the lobby`);
  }
});

test("a stop in a skyscraper waits in its penthouse", () => {
  for (const station of layout.stations) {
    const house = layout.houses[station.houseIndex];

    if (station.placement !== "inside" || !isTower(house)) continue;
    assert.equal(station.y, towerPlan(house).floor);
  }
  assert.ok(layout.stations.some((station) => station.placement === "inside" && isTower(layout.houses[station.houseIndex])));
});

test("an empty shaft is barred at the landings the car is not at", () => {
  const house = towers[0];
  const lifts = createLiftState({ houses: [house] });
  const plan = towerPlan(house);
  const barriers = stepLifts(lifts, { x: 1e4, y: plan.floor, z: 1e4 }, 1 / 60);

  assert.equal(barriers.length, 2, "the penthouse and roof landings are open with the car in the lobby");
  assert.ok(barriers.every((barrier) => colliderApplies(barrier, barrier.bottom + 0.3)));
});

test("the car sets off and stops without a jolt, on long rides and short", () => {
  for (const distance of [0.8, 5.2, 50, 72]) {
    const { duration } = liftTravel(distance, 0);
    const step = 1 / 240;
    let last = 0;
    let lastSpeed = 0;
    let top = 0;

    assert.ok(duration > 0);
    for (let time = step; time <= duration + step; time += step) {
      const { covered } = liftTravel(distance, time);
      const speed = (covered - last) / step;

      assert.ok(covered >= last - 1e-9, `${distance} m: the car went backwards`);
      /* No step change in speed: acceleration stays within what a passenger lift does. */
      assert.ok(Math.abs(speed - lastSpeed) / step < 7, `${distance} m: a jolt of ${((speed - lastSpeed) / step).toFixed(1)} m/s² at ${time.toFixed(2)} s`);
      top = Math.max(top, speed);
      last = covered;
      lastSpeed = speed;
    }
    assert.ok(Math.abs(last - distance) < 1e-9, `${distance} m: the car stopped short`);
    assert.ok(lastSpeed < 0.01, `${distance} m: the car was still moving at the stop`);
    assert.ok(top <= 7 + 1e-6, `${distance} m: over the top speed`);
    assert.ok(liftTravel(distance, step).covered < 0.001, `${distance} m: the car lurched off`);
  }
});
