import * as THREE from "three";

import type { Avatar } from "./avatar";
import { UNOCCLUDED_LAYER } from "./atmosphere";
import { createHero, type HeroLook } from "./hero";
import { createRandom, type Random } from "./rng";
import type { PalaceLayout } from "./layout";
import type { Collider } from "./movement";

/**
 * People on the pavements.
 *
 * Each one is the player's own character model in someone else's clothes — a
 * different skin tone, hair, height and colours of their own (`hero.ts`). They
 * walk one pavement at an easy pace, on the house side of the lamps and
 * benches, cross at the junctions where the zebra stripes are (the cars stop
 * for them), pause now and then to look about, and turn back at the edge of
 * town. They wait rather than walk through the player.
 *
 * A dozen people spread over a whole town is an empty street wherever you
 * stand, so they are kept near the player instead: anyone who has fallen far
 * behind is quietly moved to a pavement a little way off, behind the camera,
 * where their arrival is not seen.
 */

const SKINS = [0xf1c7a5, 0xe2b08c, 0xd9a07c, 0xb57b55, 0x8d5a3b, 0x5e3b27];
const HAIRS = [0x2e2119, 0x5a3a22, 0xc9a26b, 0x151212, 0x8a4b2a, 0x9a9a98];
const TOPS = [0xb33b3b, 0x2f6b4f, 0xe0b340, 0x4a4f8c, 0xf0efe9, 0x6b3f75, 0x2b2b2b, 0xd97b3a, 0x7fa7c9];
const TROUSERS = [0x2f3542, 0x5c6f8a, 0x3e3a33, 0xc9b99a, 0x1f2328, 0x6d7b5a];
/** Distance from a street's centre line to the walking line: inside the pavement, behind the lamps. */
const WALK_OFFSET = 9.2;
/** Beyond this, a walker is out of the player's world and is brought back near it. */
const RECALL_DISTANCE = 85;

type Walker = {
  avatar: Avatar;
  axis: "x" | "z";
  line: number;
  side: 1 | -1;
  lateral: number;
  direction: 1 | -1;
  along: number;
  pace: number;
  speed: number;
  /** Seconds left standing still, and seconds until the next pause. */
  resting: number;
  nextRest: number;
  x: number;
  z: number;
};

export type Crowd = {
  group: THREE.Group;
  /** Where everyone is this frame: for the player to be kept out of, and the cars to stop for. */
  colliders: Collider[];
  /** `view` is the direction the camera looks, so people only reappear behind it. */
  update: (delta: number, player: { x: number; z: number }, view: { x: number; z: number }) => void;
  dispose: () => void;
};

function lookFor(random: Random): HeroLook {
  return {
    skin: random.pick(SKINS),
    hair: random.pick(HAIRS),
    top: random.pick(TOPS),
    trousers: random.pick(TROUSERS),
    shoes: random.chance(0.6) ? 0xf3f3f1 : 0x2a2a2a,
    scale: random.range(0.92, 1.03),
    /* Left out of ambient occlusion: they move, and they are many. */
    layer: UNOCCLUDED_LAYER,
  };
}

export function createCrowd(layout: PalaceLayout, count: number): Crowd {
  const group = new THREE.Group();
  const random = createRandom(layout.seed ^ 0x9e0b1e);
  const lines = [...new Set(layout.roads.filter((road) => road.width > road.depth).map((road) => road.z))];
  const limit = layout.bounds - 4;
  /* Outdoor stops stand on pavements; people step round them. */
  const stops = layout.stations.filter((station) => station.placement === "outside");

  const walkers: Walker[] = Array.from({ length: lines.length ? count : 0 }, (_, index) => {
    const avatar = createHero(lookFor(random));
    const pace = random.range(1.15, 1.65);

    group.add(avatar.root);

    return {
      avatar,
      axis: index % 2 === 0 ? "x" : "z",
      line: random.pick(lines),
      side: random.chance(0.5) ? 1 : -1,
      lateral: WALK_OFFSET + random.range(-0.35, 0.35),
      direction: random.chance(0.5) ? 1 : -1,
      along: random.range(-limit, limit),
      pace,
      speed: pace,
      resting: 0,
      nextRest: random.range(8, 30),
      x: 0,
      z: 0,
    };
  });

  const colliders: Collider[] = walkers.map(() => ({ x: 0, z: 0, width: 0.6, depth: 0.6 }));

  const place = (walker: Walker, offset: number) => {
    if (walker.axis === "x") {
      walker.x = walker.along;
      walker.z = walker.line + walker.side * offset;
    } else {
      walker.x = walker.line + walker.side * offset;
      walker.z = walker.along;
    }
  };

  walkers.forEach((walker) => place(walker, walker.lateral));

  return {
    group,
    colliders,
    update: (delta, player, view) => {
      walkers.forEach((walker, index) => {
        /* Too far from the player to matter: bring them back somewhere nearby, out of sight. */
        if (Math.hypot(walker.x - player.x, walker.z - player.z) > RECALL_DISTANCE) {
          const behind = { x: player.x - view.x * random.range(25, 55), z: player.z - view.z * random.range(25, 55) };

          walker.axis = random.chance(0.5) ? "x" : "z";
          walker.line = lines.reduce((best, line) =>
            Math.abs(line - (walker.axis === "x" ? behind.z : behind.x)) < Math.abs(best - (walker.axis === "x" ? behind.z : behind.x)) ? line : best,
          );
          walker.side = random.chance(0.5) ? 1 : -1;
          walker.along = Math.max(-limit, Math.min(limit, (walker.axis === "x" ? behind.x : behind.z) + random.range(-15, 15)));
          walker.direction = random.chance(0.5) ? 1 : -1;
          walker.resting = 0;
          place(walker, walker.lateral);
        }

        const forward = walker.axis === "x" ? { x: walker.direction, z: 0 } : { x: 0, z: walker.direction };
        let target = walker.pace;

        /* Wait for the player rather than walk through them. */
        const toPlayer = { x: player.x - walker.x, z: player.z - walker.z };
        const ahead = toPlayer.x * forward.x + toPlayer.z * forward.z;
        const across = Math.abs(toPlayer.x * forward.z - toPlayer.z * forward.x);

        if (ahead > 0 && ahead < 1.8 && across < 0.9) target = 0;

        /* Now and then, stop and look about. */
        walker.nextRest -= delta;
        if (walker.nextRest <= 0 && walker.resting <= 0) {
          walker.resting = random.range(1.5, 4.5);
          walker.nextRest = random.range(12, 40);
        }
        if (walker.resting > 0) {
          walker.resting -= delta;
          target = 0;
        }

        walker.speed += (target - walker.speed) * (1 - Math.exp(-delta * 6));
        walker.along += walker.speed * walker.direction * delta;

        /* The edge of town: turn and walk back. */
        if (walker.along * walker.direction > limit) {
          walker.along = limit * walker.direction;
          walker.direction = walker.direction === 1 ? -1 : 1;
          walker.resting = Math.max(walker.resting, 0.8);
        }

        /* Step out round an outdoor stop on the walking line. */
        let offset = walker.lateral;

        place(walker, offset);
        for (const stop of stops) {
          const dx = stop.x - walker.x;
          const dz = stop.z - walker.z;
          const along = dx * forward.x + dz * forward.z;
          const side = Math.abs(dx * forward.z - dz * forward.x);

          if (Math.abs(along) < 3 && side < 1.6) offset = walker.lateral + 1.3 * (1 - Math.abs(along) / 3) + 0.2;
        }
        place(walker, Math.min(offset, 10.1));

        walker.avatar.root.position.set(walker.x, 0, walker.z);
        walker.avatar.root.rotation.y = Math.atan2(forward.x, forward.z);
        walker.avatar.update(walker.speed, false, delta);

        colliders[index].x = walker.x;
        colliders[index].z = walker.z;
      });
    },
    dispose: () => {
      walkers.forEach((walker) => walker.avatar.dispose());
      group.clear();
    },
  };
}
