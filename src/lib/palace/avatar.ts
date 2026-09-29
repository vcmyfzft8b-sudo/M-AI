import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * The character you steer: a young man at real human proportions — about 1.78
 * metres, seven and a half heads tall — in a navy hoodie, light jeans, white
 * sneakers and an orange backpack.
 *
 * Everything is a smooth shaped surface rather than a block: the torso, the
 * limbs and the jeans are lathed from measured profiles (so a calf swells and
 * an ankle narrows), the head is a sphere sculpted into a skull with a jaw and
 * a chin, and the hair is a shell cut along a hairline with a quiff at the
 * front. The face has what a face needs to read at this distance: whites and
 * irises, lids, brows, a nose, lips and ears. The backpack is the colour
 * nothing else in the town wears, because the back is what the camera sees.
 *
 * The game's walking pace is a jog for a real person (seven metres a second),
 * so the gait is a running cycle — a flight phase, knees high on the swing,
 * elbows bent — that eases to a walk only at the slow end of the stick. The
 * hips and shoulders counter-rotate, the body leans into speed and rolls into
 * turns, the head stays level; standing still he breathes, shifts and looks
 * about. After a stop he acts out how it went (`react`).
 *
 * `avatar.root` is what the controller moves; everything below it is local,
 * facing +Z.
 */

export type AvatarReaction = "cheer" | "miss";

export type Avatar = {
  root: THREE.Group;
  /**
   * World-space effects (the dust kicked up by a sprint). Added to the scene
   * beside `root`, not under it, so a puff stays where it was kicked up.
   */
  effects: THREE.Group;
  /** Advance the walk cycle. `speed` is metres per second on the ground. */
  update: (speed: number, airborne: boolean, delta: number) => void;
  /** A beat of acting after a stop: a jump and a fist pump, or a head shake. */
  react: (reaction: AvatarReaction) => void;
  dispose: () => void;
};

/* Walk and sprint speeds from `movement.ts`, for blending the gaits. */
const WALK_SPEED = 7.37;
const RUN_SPEED = 12.21;

const SKIN = 0xd9a07c;
const LIP = 0xb87464;
const HAIR = 0x2e2119;
const HOODIE = 0x243a5e;
const HOODIE_RIB = 0x1d3050;
const JEANS = 0x7c9cc4;
const SNEAKER = 0xf3f3f1;
const SOLE = 0xd8d6d0;
const SNEAKER_ACCENT = 0x243a5e;
const BACKPACK = 0xe8742c;
const BACKPACK_SHADE = 0xc55d1d;
const IRIS = 0x4a3222;

/* Joint heights, in metres. */
const HIP_Y = 0.93;
const THIGH = 0.42;
const SHIN = 0.42;
const SHOULDER_Y = 1.45;
const UPPER_ARM = 0.29;
const FOREARM = 0.25;
const HEAD_Y = 1.665;

/**
 * A limb or a body from its silhouette: radius against height, spun round the
 * vertical axis. Heights run downwards from the joint for limbs.
 */
function lathe(profile: readonly (readonly [number, number])[], segments = 20) {
  return new THREE.LatheGeometry(
    profile.map(([radius, y]) => new THREE.Vector2(radius, y)),
    segments,
  );
}

/** A little woven texture, as a bump map: cloth that catches light like cloth. */
function fabricTexture(scale: number) {
  const canvas = document.createElement("canvas");

  canvas.width = canvas.height = 128;

  const context = canvas.getContext("2d");

  if (context) {
    context.fillStyle = "#808080";
    context.fillRect(0, 0, 128, 128);
    for (let y = 0; y < 128; y += 2)
      for (let x = 0; x < 128; x += 2) {
        const value = 110 + ((x * 7 + y * 13) % 5) * 8 + Math.random() * 30;

        context.fillStyle = `rgb(${value},${value},${value})`;
        context.fillRect(x, y, (x + y) % 4 === 0 ? 2 : 1, 2);
      }
  }

  const texture = new THREE.CanvasTexture(canvas);

  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(scale, scale);

  return texture;
}

/**
 * The skull: a sphere pressed into a head — narrower than it is deep, a jaw
 * that tapers to the chin, a fuller back — and sized to a real head.
 */
function headGeometry() {
  let geometry: THREE.BufferGeometry = new THREE.SphereGeometry(1, 48, 36);

  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  geometry = mergeVertices(geometry);

  const positions = geometry.getAttribute("position");
  const point = new THREE.Vector3();

  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index);

    const below = Math.max(0, -point.y);
    /* The jaw narrows towards the chin, the cheeks less so. */
    const jaw = 1 - 0.34 * Math.pow(below, 1.6) * (point.z > -0.2 ? 1 : 0.6);
    const x = point.x * 0.079 * jaw;
    const y = point.y * 0.117;
    /* The face is flatter than the back of the head; the chin comes forward a touch. */
    const z = point.z * (point.z > 0 ? 0.097 + below * 0.01 : 0.108);

    positions.setXYZ(index, x, y, z);
  }

  geometry.computeVertexNormals();

  return geometry;
}

/**
 * Short hair: the skull again, a shade larger, pulled inside the head below a
 * hairline — high at the forehead, down to the ears at the sides, the nape at
 * the back — and lifted into a quiff at the front, with a little noise so it
 * reads as hair rather than a helmet.
 */
function hairGeometry() {
  let geometry: THREE.BufferGeometry = new THREE.SphereGeometry(1, 56, 40);

  geometry.deleteAttribute("normal");
  geometry.deleteAttribute("uv");
  geometry = mergeVertices(geometry);

  const positions = geometry.getAttribute("position");
  const point = new THREE.Vector3();

  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index);

    const front = Math.max(0, point.z);
    const side = Math.abs(point.x);
    /* The hairline, as a height on the unit sphere. */
    const hairline = 0.42 * front * front - 0.32 * (1 - front) + 0.05 * side - 0.05;
    const covered = point.y > hairline;
    const tuft =
      0.045 * Math.sin(point.x * 23 + point.z * 7) * Math.sin(point.z * 19 - point.y * 11) +
      0.03 * Math.sin(point.x * 41 + point.y * 37);
    const quiff = Math.max(0, point.y - 0.35) * Math.max(0, point.z + 0.1) * 0.55;
    const grow = covered ? 1.075 + Math.max(0, point.y) * 0.05 + tuft * Math.max(0, point.y + 0.2) + quiff : 0.85;
    const below = Math.max(0, -point.y);
    const jaw = 1 - 0.34 * Math.pow(below, 1.6);

    positions.setXYZ(
      index,
      point.x * 0.079 * jaw * grow,
      point.y * 0.117 * grow + quiff * 0.06,
      point.z * (point.z > 0 ? 0.097 : 0.108) * grow + quiff * 0.03,
    );
  }

  geometry.computeVertexNormals();

  return geometry;
}

/*
 * A thin cool rim round the silhouette, brightest where the surface turns
 * away from the camera: what lifts the figure off a busy street behind it.
 */
function withRim<Material extends THREE.MeshStandardMaterial>(material: Material, strength = 0.22) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      float avatarRim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance += vec3(0.9, 0.95, 1.0) * pow(avatarRim, 3.5) * ${strength.toFixed(2)};`,
    );
  };
  material.customProgramCacheKey = () => `avatar-rim-${strength.toFixed(2)}`;

  return material;
}

export function createAvatar(): Avatar {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <Item extends { dispose: () => void }>(item: Item) => {
    disposables.push(item);

    return item;
  };

  const knit = track(fabricTexture(6));
  const denim = track(fabricTexture(10));
  const material = (
    color: THREE.ColorRepresentation,
    roughness: number,
    bump?: THREE.Texture,
    bumpScale = 0.6,
  ) =>
    track(
      withRim(
        new THREE.MeshStandardMaterial({ color, roughness, ...(bump ? { bumpMap: bump, bumpScale } : {}) }),
      ),
    );

  const skin = track(
    withRim(
      new THREE.MeshPhysicalMaterial({
        color: SKIN,
        roughness: 0.55,
        sheen: 0.4,
        sheenColor: new THREE.Color(0xffc8b0),
        sheenRoughness: 0.6,
      }),
      0.18,
    ),
  );
  const lip = material(LIP, 0.45);
  const hair = material(HAIR, 0.75, knit, 1.4);
  const hoodie = material(HOODIE, 0.9, knit);
  const rib = material(HOODIE_RIB, 0.95, knit, 1.2);
  const jeans = material(JEANS, 0.85, denim, 0.8);
  const sneaker = material(SNEAKER, 0.5);
  const sole = material(SOLE, 0.7);
  const accent = material(SNEAKER_ACCENT, 0.5);
  const pack = material(BACKPACK, 0.6);
  const packShade = material(BACKPACK_SHADE, 0.65);
  const strap = material(0x2a2a2e, 0.7);
  const white = track(new THREE.MeshStandardMaterial({ color: 0xf6f2ee, roughness: 0.3 }));
  const iris = track(new THREE.MeshStandardMaterial({ color: IRIS, roughness: 0.2 }));
  const pupil = track(new THREE.MeshStandardMaterial({ color: 0x0c0a0a, roughness: 0.1 }));

  const sphere = track(new THREE.SphereGeometry(1, 20, 14));

  const add = (
    geometry: THREE.BufferGeometry,
    partMaterial: THREE.Material,
    parent: THREE.Object3D,
    position: [number, number, number] = [0, 0, 0],
    scale: [number, number, number] = [1, 1, 1],
    rotation: [number, number, number] = [0, 0, 0],
  ) => {
    const mesh = new THREE.Mesh(geometry, partMaterial);

    mesh.position.set(...position);
    mesh.scale.set(...scale);
    mesh.rotation.set(...rotation);
    parent.add(mesh);

    return mesh;
  };
  const pivot = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const group = new THREE.Group();

    group.position.set(x, y, z);
    parent.add(group);

    return group;
  };

  /*
   * root
   * └ body     — bobs and sways with each stride
   *   ├ pelvis — twists with the stride; the legs hang from it
   *   └ spine  — counter-twists, leans into speed; torso, arms, backpack
   *     └ head — stays level, looks about
   */
  const body = new THREE.Group();
  const pelvis = pivot(body, 0, HIP_Y);
  const spine = pivot(body, 0, HIP_Y);

  root.add(body);

  /* ---- hips: the top of the jeans ---- */
  add(
    track(lathe([[0.0, -0.1], [0.12, -0.1], [0.155, -0.04], [0.158, 0.04], [0.148, 0.1], [0.0, 0.1]], 24)),
    jeans,
    pelvis,
    [0, 0.02, 0],
    [1, 1, 0.68],
  );

  /* ---- torso: a hoodie, loose at the hem, broad at the shoulders ---- */
  const torsoProfile = [
    [0.0, -0.1],
    [0.158, -0.1],
    [0.163, -0.04],
    [0.158, 0.06],
    [0.162, 0.16],
    [0.176, 0.28],
    [0.184, 0.38],
    [0.176, 0.46],
    [0.14, 0.52],
    [0.08, 0.56],
    [0.0, 0.565],
  ] as const;
  const torso = add(track(lathe(torsoProfile, 28)), hoodie, spine, [0, 0, 0], [1.02, 1, 0.64]);

  /* The ribbed hem and the kangaroo pocket. */
  add(track(lathe([[0.165, -0.1], [0.166, -0.05], [0.0, -0.05]], 28)), rib, spine, [0, 0, 0], [1.03, 1, 0.655]);
  add(track(new RoundedBoxGeometry(0.22, 0.13, 0.04, 2, 0.015)), rib, spine, [0, 0.07, 0.098], [1, 1, 1], [-0.08, 0, 0]);

  /* Shoulders, rounded into the sleeves. */
  for (const side of [-1, 1]) add(sphere, hoodie, spine, [side * 0.17, SHOULDER_Y - HIP_Y - 0.035, -0.005], [0.066, 0.05, 0.064]);

  /* The hood, lying on the shoulders behind the neck, and its drawstrings. */
  add(
    track(new THREE.TorusGeometry(0.085, 0.035, 10, 20, Math.PI * 1.25)),
    hoodie,
    spine,
    [0, 0.555, -0.035],
    [1, 1, 1],
    [Math.PI / 2 + 0.25, 0, Math.PI * 0.375 + Math.PI],
  );
  add(sphere, hoodie, spine, [0, 0.57, -0.1], [0.1, 0.07, 0.055]);
  for (const side of [-1, 1]) {
    add(track(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 6)), white, spine, [side * 0.035, 0.44, 0.117], [1, 1, 1], [0.15, 0, side * 0.05]);
    add(sphere, white, spine, [side * 0.036, 0.36, 0.123], [0.007, 0.012, 0.007]);
  }

  /* ---- backpack ---- */
  const backpack = pivot(spine, 0, 0.3, -0.16);

  add(track(new RoundedBoxGeometry(0.3, 0.42, 0.15, 4, 0.05)), pack, backpack);
  add(track(new RoundedBoxGeometry(0.23, 0.17, 0.06, 3, 0.025)), packShade, backpack, [0, -0.1, -0.09]);
  add(track(new THREE.TorusGeometry(0.045, 0.012, 6, 14, Math.PI)), strap, backpack, [0, 0.21, 0], [1, 1, 1], [0, Math.PI / 2, 0]);
  add(track(new THREE.BoxGeometry(0.2, 0.012, 0.01)), strap, backpack, [0, -0.01, -0.121]);
  for (const side of [-1, 1]) {
    /* Straps over the shoulders and down the chest. */
    add(track(new RoundedBoxGeometry(0.045, 0.3, 0.018, 2, 0.006)), strap, spine, [side * 0.1, 0.33, 0.113], [1, 1, 1], [-0.08, 0, 0]);
    add(track(new RoundedBoxGeometry(0.05, 0.02, 0.26, 2, 0.006)), strap, spine, [side * 0.105, 0.5, -0.005], [1, 1, 1], [0.15, 0, 0]);
  }

  /* ---- neck and head ---- */
  add(track(lathe([[0.048, -0.02], [0.046, 0.06], [0.05, 0.12]], 16)), skin, spine, [0, 0.52, 0.005]);

  const head = pivot(spine, 0, HEAD_Y - HIP_Y, 0.012);

  add(track(headGeometry()), skin, head);
  add(track(hairGeometry()), hair, head);

  /* Ears. */
  for (const side of [-1, 1]) add(sphere, skin, head, [side * 0.078, -0.005, -0.006], [0.012, 0.03, 0.02], [0, side * 0.3, 0]);

  /* Eyes: whites, irises, pupils — and lids that close for a blink. */
  const lids: THREE.Mesh[] = [];

  for (const side of [-1, 1]) {
    const eye = pivot(head, side * 0.031, 0.01, 0.08);

    add(sphere, white, eye, [0, 0, 0], [0.0125, 0.0105, 0.009]);
    add(sphere, iris, eye, [0, 0, 0.0065], [0.0068, 0.0068, 0.0035]);
    add(sphere, pupil, eye, [0, 0, 0.0086], [0.0032, 0.0032, 0.0015]);
    lids.push(add(sphere, skin, eye, [0, 0.0045, 0.001], [0.0135, 0.0065, 0.0098]));
    /* Brows. */
    add(track(new RoundedBoxGeometry(0.03, 0.007, 0.008, 2, 0.003)), hair, head, [side * 0.033, 0.034, 0.093], [1, 1, 1], [0.1, side * -0.15, side * -0.06]);
  }

  /* Nose: a bridge and a tip. */
  add(sphere, skin, head, [0, -0.006, 0.098], [0.009, 0.022, 0.012], [0.3, 0, 0]);
  add(sphere, skin, head, [0, -0.026, 0.103], [0.014, 0.011, 0.012]);

  /* Lips. */
  add(sphere, lip, head, [0, -0.052, 0.094], [0.021, 0.0055, 0.008]);
  add(sphere, lip, head, [0, -0.061, 0.092], [0.019, 0.0065, 0.008]);

  /* ---- arms ---- */
  const arms = [-1, 1].map((side) => {
    const shoulder = pivot(spine, side * 0.195, SHOULDER_Y - HIP_Y - 0.02);

    add(track(lathe([[0.062, 0.02], [0.06, -0.08], [0.052, -0.2], [0.046, -UPPER_ARM]], 18)), hoodie, shoulder);

    const elbow = pivot(shoulder, 0, -UPPER_ARM);

    add(sphere, hoodie, elbow, [0, 0, 0], [0.044, 0.044, 0.044]);
    add(track(lathe([[0.046, 0], [0.045, -0.1], [0.04, -FOREARM + 0.05]], 18)), hoodie, elbow);
    add(track(lathe([[0.038, -FOREARM + 0.05], [0.036, -FOREARM + 0.005]], 16)), rib, elbow);

    /* A hand: palm, fingers curled a little, a thumb. */
    const wrist = pivot(elbow, 0, -FOREARM);

    add(sphere, skin, wrist, [0, -0.005, 0], [0.024, 0.024, 0.02]);
    add(track(new RoundedBoxGeometry(0.075, 0.085, 0.03, 3, 0.012)), skin, wrist, [side * -0.004, -0.05, 0.004]);
    add(track(new RoundedBoxGeometry(0.07, 0.07, 0.024, 3, 0.01)), skin, wrist, [side * -0.004, -0.115, 0.014], [1, 1, 1], [0.35, 0, 0]);
    add(track(new THREE.CapsuleGeometry(0.012, 0.035, 4, 8)), skin, wrist, [side * -0.035, -0.06, 0.022], [1, 1, 1], [0.4, 0, side * 0.5]);

    return { shoulder, elbow, wrist, side };
  });

  /* ---- legs ---- */
  const legs = [-1, 1].map((side) => {
    const hip = pivot(pelvis, side * 0.092, 0);

    add(track(lathe([[0.083, 0.03], [0.08, -0.08], [0.071, -0.25], [0.062, -THIGH + 0.02], [0.06, -THIGH]], 20)), jeans, hip);

    const knee = pivot(hip, 0, -THIGH);

    add(sphere, jeans, knee, [0, 0, 0], [0.058, 0.058, 0.058]);
    add(track(lathe([[0.059, 0], [0.058, -0.14], [0.055, -0.3], [0.054, -SHIN + 0.04], [0.056, -SHIN + 0.02]], 20)), jeans, knee);

    /* The sneaker: a rounded upper with a toe box, a sole, laces and a side stripe. */
    const ankle = pivot(knee, 0, -SHIN);

    add(track(new RoundedBoxGeometry(0.1, 0.075, 0.25, 4, 0.03)), sneaker, ankle, [0, -0.035, 0.045]);
    add(sphere, sneaker, ankle, [0, -0.045, 0.14], [0.05, 0.032, 0.06]);
    add(track(new RoundedBoxGeometry(0.108, 0.03, 0.28, 3, 0.012)), sole, ankle, [0, -0.07, 0.05]);
    add(track(new RoundedBoxGeometry(0.004, 0.022, 0.12, 2, 0.002)), accent, ankle, [side * 0.051, -0.035, 0.05], [1, 1, 1], [0.12, 0, 0]);
    for (const step of [0, 1, 2])
      add(track(new THREE.BoxGeometry(0.045, 0.005, 0.008)), white, ankle, [0, 0.004 - step * 0.008, 0.07 + step * 0.025], [1, 1, 1], [0.35, 0, 0]);

    return { hip, knee, ankle, side };
  });

  /*
   * A soft contact patch under the feet: a shadow map at this distance cannot
   * resolve where the shoes meet the ground, and without it the figure floats.
   */
  const shadowCanvas = document.createElement("canvas");

  shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext("2d");

  if (shadowContext) {
    const gradient = shadowContext.createRadialGradient(32, 32, 0, 32, 32, 32);

    gradient.addColorStop(0, "rgba(20, 24, 30, 0.45)");
    gradient.addColorStop(0.6, "rgba(20, 24, 30, 0.18)");
    gradient.addColorStop(1, "rgba(20, 24, 30, 0)");
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 64, 64);
  }

  const shadow = new THREE.Mesh(
    track(new THREE.PlaneGeometry(0.9, 0.9)),
    track(new THREE.MeshBasicMaterial({ map: track(new THREE.CanvasTexture(shadowCanvas)), transparent: true, depthWrite: false })),
  );

  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.012;
  root.add(shadow);

  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object !== shadow) object.castShadow = true;
  });

  /*
   * Dust from a sprint: a small pool of soft puffs, one kicked up at each
   * footfall and left behind in the world to swell and fade.
   */
  const effects = new THREE.Group();
  const puffCanvas = document.createElement("canvas");

  puffCanvas.width = puffCanvas.height = 64;
  const puffContext = puffCanvas.getContext("2d");

  if (puffContext) {
    const gradient = puffContext.createRadialGradient(32, 32, 0, 32, 32, 32);

    gradient.addColorStop(0, "rgba(235, 230, 220, 0.8)");
    gradient.addColorStop(0.5, "rgba(225, 218, 205, 0.35)");
    gradient.addColorStop(1, "rgba(225, 218, 205, 0)");
    puffContext.fillStyle = gradient;
    puffContext.fillRect(0, 0, 64, 64);
  }

  const puffTexture = track(new THREE.CanvasTexture(puffCanvas));
  const puffs = Array.from({ length: 14 }, () => {
    const puffMaterial = track(
      new THREE.SpriteMaterial({ map: puffTexture, transparent: true, depthWrite: false, opacity: 0 }),
    );
    const sprite = new THREE.Sprite(puffMaterial);

    sprite.visible = false;
    effects.add(sprite);

    return { sprite, material: puffMaterial, age: 1, drift: new THREE.Vector3() };
  });
  let nextPuff = 0;
  const kickDust = (sideways: number) => {
    const puff = puffs[nextPuff];

    nextPuff = (nextPuff + 1) % puffs.length;

    const facing = root.rotation.y;
    const back = -0.2;

    puff.sprite.position.set(
      root.position.x + Math.sin(facing) * back + Math.cos(facing) * sideways,
      root.position.y + 0.1,
      root.position.z + Math.cos(facing) * back - Math.sin(facing) * sideways,
    );
    puff.drift.set(-Math.sin(facing) * 0.6 + (Math.random() - 0.5) * 0.4, 0.45, -Math.cos(facing) * 0.6 + (Math.random() - 0.5) * 0.4);
    puff.age = 0;
    puff.sprite.visible = true;
  };

  let phase = 0;
  let easedSpeed = 0;
  let clock = 0;
  let idleTime = 0;
  let nextBlink = 2.5;
  let lastFacing: number | null = null;
  let turnLean = 0;
  let airborneBlend = 0;
  let lastStep = 0;
  /* The acting after a stop: which beat, and how far into it. */
  let reaction: AvatarReaction | null = null;
  let reactionTime = 0;
  const REACTION_LENGTH = { cheer: 1.4, miss: 1.2 } as const;

  return {
    root,
    effects,
    react: (next) => {
      reaction = next;
      reactionTime = 0;
    },
    update: (speed, airborne, delta) => {
      clock += delta;
      easedSpeed += (speed - easedSpeed) * (1 - Math.exp(-delta * 9));

      const moving = Math.min(1, easedSpeed / 0.8);
      /* 0 a walk, 1 a jog at the game's walking pace, and on towards a sprint. */
      const jog = Math.max(0, Math.min(1, (easedSpeed - 1.5) / 4));
      const sprint = Math.max(0, Math.min(1, (easedSpeed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));

      /* Cadence: about 1.4 strides a second at a jog, 1.75 flat out. */
      phase += delta * Math.PI * 2 * (0.9 + Math.min(easedSpeed, RUN_SPEED) * 0.07);
      idleTime = moving > 0.2 ? 0 : idleTime + delta;

      /* How fast the controller is turning the body, for leaning into it. */
      const facing = root.rotation.y;
      let turnRate = 0;

      if (lastFacing !== null && delta > 0) {
        let change = facing - lastFacing;

        change = Math.atan2(Math.sin(change), Math.cos(change));
        turnRate = change / delta;
      }

      lastFacing = facing;
      turnLean += (Math.max(-0.22, Math.min(0.22, -turnRate * 0.03 * moving)) - turnLean) * (1 - Math.exp(-delta * 8));
      airborneBlend += ((airborne ? 1 : 0) - airborneBlend) * (1 - Math.exp(-delta * 14));

      const swing = Math.sin(phase);
      const lift = Math.cos(phase);
      const thighReach = (0.42 + jog * 0.28 + sprint * 0.25) * moving;

      legs.forEach(({ hip, knee, ankle }, index) => {
        const direction = index === 0 ? 1 : -1;
        const stride = swing * direction;
        /* The swing leg's knee comes up high at a run; the stance leg stays nearly straight. */
        const swingForward = Math.max(0, lift * direction);

        hip.rotation.x = -stride * thighReach - swingForward * (0.15 + jog * 0.35 + sprint * 0.2) * moving;
        knee.rotation.x = (0.06 + swingForward * (0.5 + jog * 0.9 + sprint * 0.5) + Math.max(0, stride) * 0.25 * jog) * moving;
        ankle.rotation.x = -hip.rotation.x * 0.3 - knee.rotation.x * 0.4 + Math.max(0, -stride) * 0.25 * moving;
      });

      arms.forEach(({ shoulder, elbow, side }, index) => {
        const direction = index === 0 ? -1 : 1;
        const idleSway = Math.sin(clock * 1.3 + index) * 0.025 * (1 - moving);

        shoulder.rotation.x = -swing * direction * (0.3 + jog * 0.35 + sprint * 0.3) * moving + idleSway;
        shoulder.rotation.z = side * (0.09 + jog * 0.06);
        elbow.rotation.x = -(0.15 + jog * 1.05 + sprint * 0.25) * (0.3 + 0.7 * moving) - Math.max(0, swing * direction) * 0.25 * jog;
      });

      /*
       * The body: lowest as a foot lands, highest mid-stride (a flight phase at
       * a run), hips and shoulders turning against each other, a lean into
       * speed and into turns. The head stays level whatever the spine does.
       */
      const bounce = (1 - Math.abs(swing)) * (0.02 + jog * 0.045) * moving;
      const breath = Math.sin(clock * 1.9) * (1 - moving);

      body.position.y = bounce - (0.01 + jog * 0.02) * moving;
      body.rotation.z = turnLean;
      pelvis.rotation.y = swing * (0.1 + jog * 0.06) * moving;
      pelvis.rotation.z = -lift * 0.03 * moving;
      spine.rotation.y = -swing * (0.12 + jog * 0.08) * moving;
      spine.rotation.x = (0.04 * jog + 0.14 * sprint) * moving;
      torso.scale.y = 1 + breath * 0.008;

      /* Standing still, weight shifts and, after a moment, he looks about. */
      const lookAbout = Math.min(1, Math.max(0, idleTime - 2.5) / 1.5);

      body.position.x = Math.sin(clock * 0.45) * 0.012 * (1 - moving);
      head.rotation.x = -spine.rotation.x * 0.8 + Math.sin(clock * 0.4) * 0.05 * lookAbout;
      head.rotation.y =
        -spine.rotation.y * 0.8 + Math.sin(clock * 0.55) * 0.5 * lookAbout + Math.max(-0.3, Math.min(0.3, turnRate * 0.06)) * moving;
      backpack.rotation.x = -Math.cos(phase * 2) * 0.04 * jog * moving;

      /* Blink every few seconds. */
      nextBlink -= delta;
      if (nextBlink < -0.12) nextBlink = 2.4 + Math.abs(Math.sin(clock * 12.9898)) * 2.8;
      lids.forEach((lidMesh) => {
        lidMesh.scale.y = nextBlink < 0 ? 0.0112 : 0.0065;
        lidMesh.position.y = nextBlink < 0 ? 0.001 : 0.0045;
      });

      /* Each footfall of a sprint kicks up dust. */
      const step = Math.floor(phase / Math.PI);

      if (step !== lastStep) {
        lastStep = step;
        if (sprint > 0.35 && !airborne) kickDust(step % 2 === 0 ? 0.1 : -0.1);
      }

      puffs.forEach((puff) => {
        if (!puff.sprite.visible) return;
        puff.age += delta / 0.7;
        if (puff.age >= 1) {
          puff.sprite.visible = false;

          return;
        }
        puff.sprite.position.addScaledVector(puff.drift, delta);
        puff.sprite.scale.setScalar(0.25 + puff.age * 0.6);
        puff.material.opacity = (1 - puff.age) * 0.45;
      });

      /*
       * The acting after a stop, laid over the gait and faded in and out so it
       * never snaps. A right answer: a small jump and a fist pump. A miss: the
       * head drops and shakes, a hand goes to the back of the head.
       */
      let hop = 0;

      if (reaction) {
        reactionTime += delta;

        const t = reactionTime / REACTION_LENGTH[reaction];

        if (t >= 1) {
          reaction = null;
        } else {
          const weight = Math.min(1, t * 6, (1 - t) * 5) * (1 - moving * 0.7);
          const [left, right] = arms;

          if (reaction === "cheer") {
            const jump = t > 0.1 && t < 0.5 ? Math.sin(((t - 0.1) / 0.4) * Math.PI) : 0;
            const pump = Math.sin(t * Math.PI * 5) * 0.2;

            hop = jump * 0.28;
            legs.forEach(({ knee, hip }) => {
              knee.rotation.x += jump * 0.6 * weight;
              hip.rotation.x -= jump * 0.3 * weight;
            });
            right.shoulder.rotation.x += (-2.8 + pump - right.shoulder.rotation.x) * weight;
            right.shoulder.rotation.z += (0.25 - right.shoulder.rotation.z) * weight;
            right.elbow.rotation.x += (-0.6 - right.elbow.rotation.x) * weight;
            left.elbow.rotation.x += (-1.4 - left.elbow.rotation.x) * weight * 0.8;
            head.rotation.x -= 0.15 * weight;
          } else {
            head.rotation.y += Math.sin(t * Math.PI * 4) * 0.35 * weight;
            head.rotation.x += 0.22 * weight;
            spine.rotation.x += 0.08 * weight;
            right.shoulder.rotation.x += (-2.5 - right.shoulder.rotation.x) * weight;
            right.shoulder.rotation.z += (0.55 - right.shoulder.rotation.z) * weight;
            right.elbow.rotation.x += (-2.2 - right.elbow.rotation.x) * weight;
          }
        }
      }

      body.position.y += hop;
      shadow.scale.setScalar(1 - airborneBlend * 0.4 - Math.max(0, hop) * 0.6);
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      root.clear();
      effects.clear();
    },
  };
}
