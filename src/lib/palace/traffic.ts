import * as THREE from "three";

import { carBodyGeometry, carCabinGeometry, carFrameGeometry, carRoofGeometry } from "./scenery";
import { createRandom } from "./rng";
import type { PalaceLayout } from "./layout";
import type { Collider } from "./movement";

/**
 * Cars that drive.
 *
 * A town with every car parked is a model railway with the power off. A few
 * cars going about their business — keeping to their lane, slowing behind one
 * another, giving way in a junction, stopping for whoever steps into the road
 * — is most of what makes the place feel lived in rather than built.
 *
 * Each car keeps to the right-hand lane of one street, turns round in a tight
 * half-circle at the edge of town and comes back the other way. The lanes run
 * inside the parked cars along the kerbs, so the two never meet. Nothing here
 * is instanced: there are only a handful, and each moves on its own.
 *
 * Like the people on the pavements, the cars are kept near the player: one
 * that has driven far away comes back on a street behind the camera.
 */

const LANE_OFFSET = 1.9;
const CRUISE_SPEED = 7.5;
const TURN_SPEED = 3.6;
const WHEEL_RADIUS = 0.415;
const PAINTS = [0xb9ccce, 0xe2e6df, 0x4f626b, 0xe77743, 0xe6be53, 0x4798b7, 0xc1523d, 0x2b2f33];

/** Someone the cars must not run into: the player, a pedestrian. */
export type RoadUser = { x: number; z: number };

export type Traffic = {
  group: THREE.Group;
  /** Where each car is this frame, for the walker to be pushed out of. */
  colliders: Collider[];
  /** The first road user is the player; `view` is where the camera looks. */
  update: (delta: number, roadUsers: readonly RoadUser[], view: { x: number; z: number }) => void;
  dispose: () => void;
};

type Car = {
  root: THREE.Group;
  wheels: THREE.Object3D[];
  axis: "x" | "z";
  line: number;
  direction: 1 | -1;
  along: number;
  speed: number;
  /** Progress round a turn at the end of the street, 0..π, or null on the straight. */
  turn: number | null;
  x: number;
  z: number;
  heading: { x: number; z: number };
};

export function createTraffic(layout: PalaceLayout, count: number): Traffic {
  const group = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <Item extends { dispose: () => void }>(item: Item) => {
    disposables.push(item);

    return item;
  };

  const body = track(carBodyGeometry());
  const cabin = track(carCabinGeometry());
  const roof = track(carRoofGeometry());
  const frame = track(carFrameGeometry());
  const tyre = track(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.25, 20));
  const hub = track(new THREE.CylinderGeometry(0.28, 0.28, 0.04, 16));
  const lamp = track(new THREE.SphereGeometry(1, 12, 8));
  const glass = track(
    new THREE.MeshPhysicalMaterial({ color: 0x24566a, roughness: 0.08, metalness: 0.2, clearcoat: 1, envMapIntensity: 1.4 }),
  );
  const rubber = track(new THREE.MeshStandardMaterial({ color: 0x1d2124, roughness: 0.9 }));
  const alloy = track(new THREE.MeshStandardMaterial({ color: 0xc6d1d1, roughness: 0.3, metalness: 0.8 }));
  const headlight = track(new THREE.MeshStandardMaterial({ color: 0xf4faf5, emissive: 0xfff6d8, emissiveIntensity: 0.6 }));
  const taillight = track(new THREE.MeshStandardMaterial({ color: 0xeb453e, emissive: 0xb0201a, emissiveIntensity: 0.5 }));
  /* Double-sided: the roof frame is a thin shell seen from inside through the glass. */
  const paints = PAINTS.map((color) =>
    track(
      new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.28,
        metalness: 0.45,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
        side: THREE.DoubleSide,
      }),
    ),
  );

  /* The streets, from the roads: each value is the centre line of one across and one down. */
  const lines = [...new Set(layout.roads.filter((road) => road.width > road.depth).map((road) => road.z))].sort(
    (a, b) => a - b,
  );
  const random = createRandom(layout.seed ^ 0x7ca5);
  const limit = layout.bounds - 7;

  const cars: Car[] = Array.from({ length: lines.length ? count : 0 }, (_, index) => {
    const root = new THREE.Group();
    const paint = paints[Math.floor(random.next() * paints.length)];
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D = root) => {
      const mesh = new THREE.Mesh(geometry, material);

      mesh.castShadow = true;
      parent.add(mesh);

      return mesh;
    };

    add(body, paint);
    add(roof, paint);
    add(frame, paint);
    add(cabin, glass);

    const wheels: THREE.Object3D[] = [];

    for (const axle of [-1.38, 1.35])
      for (const side of [-1, 1]) {
        const wheel = new THREE.Group();

        wheel.position.set(axle, WHEEL_RADIUS, side * 0.93);
        wheel.rotation.x = Math.PI / 2;
        add(tyre, rubber, wheel);
        add(hub, alloy, wheel).position.y = side * 0.13;
        root.add(wheel);
        wheels.push(wheel);
      }
    for (const end of [-1, 1])
      for (const side of [-1, 1]) {
        const light = add(lamp, end === 1 ? headlight : taillight);

        light.position.set(end * 2.05, 0.86, side * 0.65);
        light.scale.set(0.085, 0.145, 0.16);
      }

    group.add(root);

    return {
      root,
      wheels,
      axis: index % 2 === 0 ? "x" : "z",
      line: lines[(index * 3 + 1) % lines.length],
      direction: random.chance(0.5) ? 1 : -1,
      along: random.range(-limit, limit),
      speed: CRUISE_SPEED,
      turn: null,
      x: 0,
      z: 0,
      heading: { x: 1, z: 0 },
    };
  });

  const colliders: Collider[] = cars.map(() => ({ x: 0, z: 0, width: 1, depth: 1 }));

  /** Where a car stands and which way it points, from where it is on its street. */
  const place = (car: Car) => {
    const forward = car.axis === "x" ? { x: car.direction, z: 0 } : { x: 0, z: car.direction };
    const right = { x: -forward.z, z: forward.x };
    const centre = car.axis === "x" ? { x: car.along, z: car.line } : { x: car.line, z: car.along };

    if (car.turn === null) {
      car.x = centre.x + right.x * LANE_OFFSET;
      car.z = centre.z + right.z * LANE_OFFSET;
      car.heading = forward;
    } else {
      /* A half-circle round the end of the street, from one lane to the other. */
      const angle = car.turn;

      car.x = centre.x + (right.x * Math.cos(angle) + forward.x * Math.sin(angle)) * LANE_OFFSET;
      car.z = centre.z + (right.z * Math.cos(angle) + forward.z * Math.sin(angle)) * LANE_OFFSET;
      car.heading = {
        x: -right.x * Math.sin(angle) + forward.x * Math.cos(angle),
        z: -right.z * Math.sin(angle) + forward.z * Math.cos(angle),
      };
    }

    car.root.position.set(car.x, 0, car.z);
    /* The body is built facing +x. */
    car.root.rotation.y = Math.atan2(-car.heading.z, car.heading.x);
  };

  /** Whether something at `point` is in this car's path, and how far ahead. */
  const ahead = (car: Car, point: { x: number; z: number }, reach: number, width: number) => {
    const dx = point.x - car.x;
    const dz = point.z - car.z;
    const along = dx * car.heading.x + dz * car.heading.z;
    const across = Math.abs(dx * -car.heading.z + dz * car.heading.x);

    return along > 0 && along < reach && across < width ? along : null;
  };

  cars.forEach(place);

  return {
    group,
    colliders,
    update: (delta, roadUsers, view) => {
      const player = roadUsers[0];

      cars.forEach((car, index) => {
        if (player && Math.hypot(car.x - player.x, car.z - player.z) > 110) {
          const behind = { x: player.x - view.x * random.range(45, 75), z: player.z - view.z * random.range(45, 75) };

          car.axis = random.chance(0.5) ? "x" : "z";
          car.line = lines.reduce((best, line) =>
            Math.abs(line - (car.axis === "x" ? behind.z : behind.x)) < Math.abs(best - (car.axis === "x" ? behind.z : behind.x)) ? line : best,
          );
          car.along = Math.max(-limit, Math.min(limit, car.axis === "x" ? behind.x : behind.z));
          car.direction = random.chance(0.5) ? 1 : -1;
          car.turn = null;
          car.speed = CRUISE_SPEED;
          place(car);
        }

        /* Stop for anyone in the road ahead; slow behind a car, and give way in a junction. */
        let target = car.turn === null ? CRUISE_SPEED : TURN_SPEED;

        for (const user of roadUsers) {
          const gap = ahead(car, user, 9, 1.9);

          if (gap !== null) target = Math.min(target, gap < 4.6 ? 0 : CRUISE_SPEED * ((gap - 4.6) / 4.4));
        }
        cars.forEach((other, otherIndex) => {
          if (other === car) return;

          const gap = ahead(car, other, 8, 1.7);

          if (gap === null) return;
          /* Two cars each in the other's way: the lower number goes first. */
          if (ahead(other, car, 8, 1.7) !== null && index < otherIndex) return;
          target = Math.min(target, gap < 5.6 ? 0 : CRUISE_SPEED * ((gap - 5.6) / 2.4));
        });

        const rate = target < car.speed ? 9 : 2.5;

        car.speed += Math.max(-rate * delta, Math.min(rate * delta, target - car.speed));

        const travelled = car.speed * delta;

        if (car.turn === null) {
          car.along += travelled * car.direction;
          if (car.along * car.direction > limit) {
            car.along = limit * car.direction;
            car.turn = 0;
          }
        } else {
          car.turn += travelled / LANE_OFFSET;
          if (car.turn >= Math.PI) {
            car.turn = null;
            car.direction = car.direction === 1 ? -1 : 1;
          }
        }

        place(car);
        car.wheels.forEach((wheel) => {
          wheel.rotation.y -= travelled / WHEEL_RADIUS;
        });

        const lengthwise = Math.abs(car.heading.x) > Math.abs(car.heading.z);
        const collider = colliders[index];

        collider.x = car.x;
        collider.z = car.z;
        collider.width = car.turn !== null ? 3.2 : lengthwise ? 4.4 : 2.1;
        collider.depth = car.turn !== null ? 3.2 : lengthwise ? 2.1 : 4.4;
      });
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      group.clear();
    },
  };
}
