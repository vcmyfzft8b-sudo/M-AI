import type { PalaceHouse, PalaceLayout } from "./layout.ts";
import type { Collider, Surface } from "./movement.ts";
import { roomPoint } from "./rooms.ts";
import { isTower, LIFT_SIZE, towerPlan } from "./tower.ts";

/**
 * The skyscrapers' lifts, as logic: where each car is, where it is going, and
 * what it lets you stand on. The drawing is in `game.ts`; this part is plain
 * numbers so it can be tested.
 *
 * Step into the car and stand still for a moment and it goes to the next stop
 * — lobby, penthouse, roof deck, and back down to the lobby. Walk up to the
 * shaft on another floor and the car comes to you. The doors — the car's and
 * the landing's, which move together — close before the car moves and open
 * when it arrives; wherever the car is not, or its doors are shut, the landing
 * is barred, so nobody steps into an empty shaft or a closing door.
 */

const SPEED = 6.5;
/** How long you stand in the car before it goes. */
const BOARDING_TIME = 0.9;
/** How long the car waits at a stop before it will leave again: time to step out. */
const DWELL = 2.5;
/** How near the shaft counts as waiting for the lift. */
const CALL_REACH = 3.2;
/** Doors open or close in about two thirds of a second. */
const DOOR_SPEED = 1.6;

export type Lift = {
  house: PalaceHouse;
  x: number;
  z: number;
  stops: readonly number[];
  /** The car's floor, live. */
  y: number;
  at: number;
  target: number | null;
  dwell: number;
  boarding: number;
  /** How far the doors are open, 0 shut to 1 open. */
  doors: number;
  /** What you stand on in the car: the same object every frame, its height updated. */
  surface: Surface;
};

export function createLiftState(layout: Pick<PalaceLayout, "houses">): Lift[] {
  return layout.houses.filter(isTower).map((house) => {
    const plan = towerPlan(house);
    const centre = roomPoint(house, plan.lift.x, plan.lift.z);

    return {
      house,
      ...centre,
      stops: plan.stops,
      y: 0,
      at: 0,
      target: null,
      dwell: 0,
      boarding: 0,
      doors: 1,
      surface: { ...centre, width: LIFT_SIZE, depth: LIFT_SIZE, y: 0 },
    };
  });
}

function inCar(lift: Lift, player: { x: number; z: number }) {
  return Math.abs(player.x - lift.x) < LIFT_SIZE / 2 - 0.15 && Math.abs(player.z - lift.z) < LIFT_SIZE / 2 - 0.15;
}

/** The lift whose car the player is standing in, if any. */
export function liftCarrying(lifts: readonly Lift[], player: { x: number; y: number; z: number }) {
  return lifts.find((lift) => inCar(lift, player) && Math.abs(player.y - lift.y) < 0.5) ?? null;
}

/**
 * Advance every lift by `delta` seconds, given where the player is, and return
 * the barriers across the landings the cars are not at.
 */
export function stepLifts(lifts: readonly Lift[], player: { x: number; y: number; z: number }, delta: number): Collider[] {
  const barriers: Collider[] = [];

  for (const lift of lifts) {
    const riding = inCar(lift, player) && Math.abs(player.y - lift.y) < 0.4;

    if (lift.target !== null && lift.doors > 0) {
      /* The doors shut first; only then does the car move. */
      lift.doors = Math.max(0, lift.doors - DOOR_SPEED * delta);
    } else if (lift.target !== null) {
      const goal = lift.stops[lift.target];
      const remaining = goal - lift.y;
      /* Ease in and out of each stop, rather than slamming into it. */
      const speed = Math.min(SPEED, 0.6 + Math.abs(remaining) * 2.2, 0.6 + Math.abs(lift.y - lift.stops[lift.at]) * 2.2);
      const travel = Math.sign(remaining) * Math.min(Math.abs(remaining), speed * delta);

      lift.y += travel;
      if (Math.abs(goal - lift.y) < 1e-3) {
        lift.y = goal;
        lift.at = lift.target;
        lift.target = null;
        lift.dwell = DWELL;
        lift.boarding = 0;
      }
    } else {
      lift.doors = Math.min(1, lift.doors + DOOR_SPEED * delta);
      lift.dwell = Math.max(0, lift.dwell - delta);
      lift.boarding = riding ? lift.boarding + delta : 0;

      if (riding && lift.boarding >= BOARDING_TIME && lift.dwell === 0) {
        lift.target = (lift.at + 1) % lift.stops.length;
      } else if (!riding) {
        /* Waiting at the shaft on another floor calls the car. */
        const floor = lift.stops.findIndex((stop) => Math.abs(player.y - stop) < 0.5);
        const near = Math.hypot(player.x - lift.x, player.z - lift.z) < CALL_REACH;

        if (floor >= 0 && floor !== lift.at && near) lift.target = floor;
      }
    }

    lift.surface.y = lift.y;

    /* Bar every landing but the one the car stands open at — not for someone inside it. */
    if (inCar(lift, player)) continue;
    lift.stops.forEach((stop, index) => {
      if (lift.target === null && lift.at === index && lift.doors > 0.6) return;
      barriers.push({ x: lift.x, z: lift.z, width: LIFT_SIZE, depth: LIFT_SIZE, bottom: stop - 0.3, top: stop + 2.4 });
    });
  }

  return barriers;
}
