import * as THREE from "three";

import type { Lift } from "./lift";
import { LIFT_SIZE, SHAFT_CROWN, SHAFT_HALF, SHAFT_OPENING } from "./tower";

/**
 * What a skyscraper's lift looks like: a glass shaft on a steel frame from the
 * lobby floor to above the roof, and in it a proper cabin — a stone floor, a
 * timber back wall with a handrail, glass sides, a lit ceiling, a button panel
 * and a floor indicator — with sliding doors on the car and at every landing
 * that part as it arrives and close before it leaves.
 *
 * Built in the building's own axes (the doors face +z, towards the front
 * door) and placed at the lift, in the middle of the building, where every
 * floor it passes has an opening for it (`aroundShaft`). The car's ceiling is a single downward-facing plane, so
 * a camera looking in from above sees the rider rather than the roof of the
 * car.
 */

const DOOR_WIDTH = 1.4;
const DOOR_HEIGHT = 2.3;
const CAR_HEIGHT = 2.6;

export type LiftVisual = {
  group: THREE.Group;
  update: (lift: Lift) => void;
  dispose: () => void;
};

export function createLiftVisual(lift: Lift): LiftVisual {
  const disposables: { dispose: () => void }[] = [];
  const track = <Item extends { dispose: () => void }>(item: Item) => {
    disposables.push(item);

    return item;
  };
  const box = track(new THREE.BoxGeometry(1, 1, 1));
  const plane = track(new THREE.PlaneGeometry(1, 1));
  const steel = track(new THREE.MeshStandardMaterial({ color: 0xb7c2c6, roughness: 0.28, metalness: 0.85 }));
  const darkSteel = track(new THREE.MeshStandardMaterial({ color: 0x3a4146, roughness: 0.35, metalness: 0.7 }));
  const timber = track(new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 0.55 }));
  const stone = track(new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.25, metalness: 0.1 }));
  const ceiling = track(new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }));
  const light = track(new THREE.MeshStandardMaterial({ color: 0xfff6e2, emissive: 0xfff1d2, emissiveIntensity: 1.4 }));
  const lamp = track(new THREE.MeshStandardMaterial({ color: 0x9fe7c2, emissive: 0x4fe09a, emissiveIntensity: 0 }));
  const glass = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xeaf6fa,
      transparent: true,
      opacity: 0.12,
      roughness: 0.02,
      metalness: 0,
      envMapIntensity: 1.1,
      depthWrite: false,
    }),
  );
  const doorGlass = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xd9ecf2,
      transparent: true,
      opacity: 0.28,
      roughness: 0.05,
      metalness: 0.2,
      envMapIntensity: 1.2,
      depthWrite: false,
    }),
  );

  const piece = (
    parent: THREE.Object3D,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
  ) => {
    const mesh = new THREE.Mesh(box, material);

    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = material !== glass && material !== doorGlass;
    parent.add(mesh);

    return mesh;
  };

  const group = new THREE.Group();
  const frame = new THREE.Group();

  group.position.set(lift.x, 0, lift.z);
  frame.rotation.y = lift.house.facing;
  group.add(frame);

  const top = lift.stops[lift.stops.length - 1] + SHAFT_CROWN;
  const half = SHAFT_HALF;

  /* ---- the shaft: four steel columns, glass on three sides, bands at every storey, a cap ---- */
  for (const [x, z] of [[-half, -half], [half, -half], [-half, half], [half, half]]) piece(frame, steel, x, top / 2, z, 0.14, top, 0.14);
  piece(frame, glass, 0, top / 2, -half, half * 2, top, 0.03);
  piece(frame, glass, -half, top / 2, 0, 0.03, top, half * 2);
  piece(frame, glass, half, top / 2, 0, 0.03, top, half * 2);
  for (let y = 3; y < top; y += 3) {
    piece(frame, steel, 0, y, -half, half * 2, 0.06, 0.06);
    piece(frame, steel, -half, y, 0, 0.06, 0.06, half * 2);
    piece(frame, steel, half, y, 0, 0.06, 0.06, half * 2);
  }
  piece(frame, darkSteel, 0, top + 0.1, 0, half * 2 + 0.3, 0.2, half * 2 + 0.3);

  /* The front: glass between the landings, a steel surround at each landing, doors, a call button, an indicator. */
  const landings = lift.stops.map((stop) => {
    const sideWidth = half - DOOR_WIDTH / 2;

    for (const side of [-1, 1]) piece(frame, darkSteel, side * (DOOR_WIDTH / 2 + sideWidth / 2), stop + CAR_HEIGHT / 2, half, sideWidth, CAR_HEIGHT, 0.08);
    piece(frame, darkSteel, 0, stop + DOOR_HEIGHT + (CAR_HEIGHT - DOOR_HEIGHT) / 2, half, DOOR_WIDTH, CAR_HEIGHT - DOOR_HEIGHT, 0.08);
    /* A steel sill across the threshold, from the car's floor to the edge of the floor's opening. */
    piece(frame, steel, 0, stop - 0.01, (LIFT_SIZE / 2 + SHAFT_OPENING) / 2 + 0.01, DOOR_WIDTH + 0.2, 0.03, SHAFT_OPENING - LIFT_SIZE / 2 + 0.02);

    const doors = [-1, 1].map((side) => {
      const door = new THREE.Group();

      door.position.set(side * (DOOR_WIDTH / 4), stop, half + 0.06);
      piece(door, doorGlass, 0, DOOR_HEIGHT / 2, 0, DOOR_WIDTH / 2, DOOR_HEIGHT, 0.03);
      piece(door, steel, side * (DOOR_WIDTH / 4 - 0.02), DOOR_HEIGHT / 2, 0.02, 0.04, DOOR_HEIGHT, 0.04);
      piece(door, steel, 0, DOOR_HEIGHT - 0.03, 0.02, DOOR_WIDTH / 2, 0.05, 0.04);
      frame.add(door);

      return { door, side };
    });
    const button = piece(frame, lamp.clone(), DOOR_WIDTH / 2 + 0.2, stop + 1.15, half + 0.07, 0.07, 0.07, 0.02);
    const indicator = piece(frame, lamp.clone(), 0, stop + DOOR_HEIGHT + 0.15, half + 0.07, 0.34, 0.07, 0.02);

    track(button.material as THREE.Material);
    track(indicator.material as THREE.Material);

    return { doors, button, indicator, stop };
  });

  /* Glass on the front between landings. */
  lift.stops.forEach((stop, index) => {
    const from = stop + CAR_HEIGHT;
    const to = index + 1 < lift.stops.length ? lift.stops[index + 1] : top;

    if (to - from > 0.1) piece(frame, glass, 0, (from + to) / 2, half, half * 2, to - from, 0.03);
  });

  /* ---- the car ---- */
  const car = new THREE.Group();
  const inner = LIFT_SIZE / 2;

  frame.add(car);
  piece(car, stone, 0, -0.06, 0, LIFT_SIZE, 0.12, LIFT_SIZE);
  piece(car, steel, 0, 0.005, inner - 0.04, LIFT_SIZE, 0.02, 0.08);
  piece(car, timber, 0, CAR_HEIGHT / 2, -inner + 0.03, LIFT_SIZE, CAR_HEIGHT, 0.05);
  piece(car, glass, -inner + 0.02, CAR_HEIGHT / 2, 0, 0.03, CAR_HEIGHT, LIFT_SIZE);
  piece(car, glass, inner - 0.02, CAR_HEIGHT / 2, 0, 0.03, CAR_HEIGHT, LIFT_SIZE);
  for (const [x, z] of [[-inner, -inner], [inner, -inner], [-inner, inner], [inner, inner]]) piece(car, steel, x, CAR_HEIGHT / 2, z, 0.06, CAR_HEIGHT, 0.06);
  /* A handrail round three sides. */
  piece(car, steel, 0, 0.95, -inner + 0.1, LIFT_SIZE - 0.3, 0.04, 0.04);
  for (const side of [-1, 1]) piece(car, steel, side * (inner - 0.1), 0.95, -0.1, 0.04, 0.04, LIFT_SIZE - 0.5);

  /* The ceiling faces down only: from inside it is a lit ceiling, from above it is not there. */
  const roof = new THREE.Mesh(plane, ceiling);

  roof.rotation.x = Math.PI / 2;
  roof.position.y = CAR_HEIGHT;
  roof.scale.set(LIFT_SIZE, LIFT_SIZE, 1);
  car.add(roof);

  const panel = new THREE.Mesh(plane, light);

  panel.rotation.x = Math.PI / 2;
  panel.position.y = CAR_HEIGHT - 0.01;
  panel.scale.set(LIFT_SIZE * 0.55, LIFT_SIZE * 0.55, 1);
  car.add(panel);

  /* A button panel beside the door, and a floor indicator over it. */
  piece(car, darkSteel, inner - 0.3, 1.2, inner - 0.08, 0.22, 0.5, 0.03);
  const carButtons = lift.stops.map((_, index) => piece(car, lamp.clone(), inner - 0.3, 1.05 + index * 0.13, inner - 0.1, 0.07, 0.07, 0.02));

  carButtons.forEach((button) => track(button.material as THREE.Material));

  const carDoors = [-1, 1].map((side) => {
    const door = new THREE.Group();

    door.position.set(side * (DOOR_WIDTH / 4), 0, inner - 0.08);
    piece(door, doorGlass, 0, DOOR_HEIGHT / 2, 0, DOOR_WIDTH / 2, DOOR_HEIGHT, 0.03);
    piece(door, steel, side * (DOOR_WIDTH / 4 - 0.02), DOOR_HEIGHT / 2, -0.02, 0.04, DOOR_HEIGHT, 0.04);
    car.add(door);

    return { door, side };
  });
  /* The car's front beside and over the door opening. */
  const sideWidth = inner - DOOR_WIDTH / 2;

  for (const side of [-1, 1]) piece(car, steel, side * (DOOR_WIDTH / 2 + sideWidth / 2), CAR_HEIGHT / 2, inner - 0.02, sideWidth, CAR_HEIGHT, 0.04);
  piece(car, steel, 0, DOOR_HEIGHT + (CAR_HEIGHT - DOOR_HEIGHT) / 2, inner - 0.02, DOOR_WIDTH, CAR_HEIGHT - DOOR_HEIGHT, 0.04);

  const glow = (mesh: THREE.Mesh, on: boolean) => {
    (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.6 : 0;
  };

  return {
    group,
    update: (state) => {
      car.position.y = state.y;

      /* Each door panel slides out to its side by the width of the other, easing in and out of its travel. */
      const slide = (DOOR_WIDTH / 2) * (state.doors * state.doors * (3 - 2 * state.doors));

      carDoors.forEach(({ door, side }) => {
        door.position.x = side * (DOOR_WIDTH / 4 + slide);
      });
      landings.forEach((landing, index) => {
        const here = state.target === null && state.at === index;

        landing.doors.forEach(({ door, side }) => {
          door.position.x = side * (DOOR_WIDTH / 4 + (here ? slide : 0));
        });
        glow(landing.button, state.target === index);
        glow(landing.indicator, here && state.doors > 0.5);
      });
      carButtons.forEach((button, index) => glow(button, state.target === index || (state.target === null && state.at === index)));
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      group.clear();
    },
  };
}
