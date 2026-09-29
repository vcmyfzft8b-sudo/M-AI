import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * The character you steer: a small, rounded figure in a sunny hoodie, a coral
 * cap and a periwinkle backpack, built from a handful of primitives and moved
 * by a procedural walk cycle rather than an animation clip.
 *
 * Built for being looked at from behind and a little above, which is where the
 * camera spends its life: the cap, the hood and the backpack are the
 * silhouette, and the colours are the ones nothing else in the town wears —
 * the figure is what the eye tracks across a city of pale buildings, so it
 * must never borrow the local colour and disappear into it. The face is for
 * the moments the camera swings round: big eyes that blink, cheeks, a smile.
 *
 * The motion is what makes it read as someone rather than something: hips and
 * shoulders counter-rotate, knees bend on the swing, elbows bend more as it
 * runs, the body leans into speed and rolls into turns, and standing still it
 * breathes and looks about. `avatar.root` is what the controller moves;
 * everything below it is local, facing +Z.
 */

export type Avatar = {
  root: THREE.Group;
  /** Advance the walk cycle. `speed` is metres per second on the ground. */
  update: (speed: number, airborne: boolean, delta: number) => void;
  dispose: () => void;
};

/* Walk and sprint speeds from `movement.ts`, for blending the gaits. */
const WALK_SPEED = 7.37;
const RUN_SPEED = 12.21;

const SKIN = 0xf2c6a0;
const HAIR = 0x4a2f22;
const HOODIE = 0xf7b733;
const HOODIE_SHADE = 0xde9420;
const CAP = 0xf0574f;
const PANTS = 0x2f3b5c;
const BACKPACK = 0x6f7fe0;
const BACKPACK_SHADE = 0x5462c4;
const SHOE = 0xf5f5f7;
const SOLE = 0x3a3f4a;
const EYE = 0x1f1a24;
const CHEEK = 0xf49a9a;

export function createAvatar(): Avatar {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <Item extends { dispose: () => void }>(item: Item) => {
    disposables.push(item);

    return item;
  };
  const material = (color: THREE.ColorRepresentation, roughness = 0.72) =>
    track(new THREE.MeshStandardMaterial({ color, roughness }));

  const skin = material(SKIN, 0.6);
  const hair = material(HAIR, 0.85);
  const hoodie = material(HOODIE, 0.78);
  const hoodieShade = material(HOODIE_SHADE, 0.8);
  const cap = material(CAP, 0.6);
  const pants = material(PANTS, 0.85);
  const backpackMaterial = material(BACKPACK, 0.55);
  const backpackShade = material(BACKPACK_SHADE, 0.6);
  const shoe = material(SHOE, 0.5);
  const sole = material(SOLE, 0.8);
  const eyeMaterial = material(EYE, 0.15);
  const white = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const cheek = track(
    new THREE.MeshStandardMaterial({ color: CHEEK, roughness: 0.9, transparent: true, opacity: 0.75 }),
  );

  const sphereGeometry = track(new THREE.SphereGeometry(1, 28, 20));
  const lowSphere = track(new THREE.SphereGeometry(1, 12, 10));
  const capsule = (radius: number, length: number) =>
    track(new THREE.CapsuleGeometry(radius, length, 6, 16));
  const rounded = (width: number, height: number, depth: number, radius = 0.35) =>
    track(new RoundedBoxGeometry(width, height, depth, 3, Math.min(width, height, depth) * radius));

  const mesh = (
    geometry: THREE.BufferGeometry,
    meshMaterial: THREE.Material,
    parent: THREE.Object3D,
    position: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
  ) => {
    const created = new THREE.Mesh(geometry, meshMaterial);

    created.position.set(...position);
    created.scale.set(...scale);
    parent.add(created);

    return created;
  };

  /*
   * body   — everything, bobs on each step
   * └ spine — pivots at the hips: the upper body leans, twists and breathes
   *   └ head — nods and looks about
   */
  const body = new THREE.Group();
  const spine = new THREE.Group();
  const HIP_Y = 0.7;

  spine.position.y = HIP_Y;
  body.add(spine);
  root.add(body);

  /* ---- torso: a hoodie with a front pocket, drawstrings and a hood ---- */
  const torso = mesh(rounded(0.45, 0.56, 0.3, 0.42), hoodie, spine, [0, 0.3, 0]);

  mesh(rounded(0.28, 0.12, 0.05), hoodieShade, spine, [0, 0.21, 0.155]);
  mesh(rounded(0.465, 0.045, 0.31, 0.45), hoodieShade, spine, [0, 0.04, 0]);
  mesh(lowSphere, hoodie, spine, [0, 0.58, -0.1], [0.19, 0.1, 0.13]);
  for (const side of [-1, 1]) {
    const string = mesh(capsule(0.012, 0.09), white, spine, [side * 0.05, 0.47, 0.16]);

    string.rotation.x = -0.25;
  }

  /* ---- backpack, with straps over the shoulders and a Memo-pink patch ---- */
  const backpack = new THREE.Group();

  backpack.position.set(0, 0.34, -0.22);
  spine.add(backpack);
  mesh(rounded(0.34, 0.4, 0.17), backpackMaterial, backpack, [0, 0, 0]);
  mesh(rounded(0.26, 0.15, 0.06), backpackShade, backpack, [0, -0.09, -0.09]);
  mesh(lowSphere, material(0xf6a4bf, 0.7), backpack, [0.07, 0.07, -0.088], [0.045, 0.045, 0.012]);
  const handle = mesh(track(new THREE.TorusGeometry(0.05, 0.014, 6, 14, Math.PI)), backpackShade, backpack, [0, 0.2, 0]);

  handle.rotation.y = Math.PI / 2;
  for (const side of [-1, 1]) {
    mesh(rounded(0.05, 0.34, 0.025, 0.4), backpackShade, spine, [side * 0.12, 0.36, 0.16]);
    mesh(rounded(0.055, 0.03, 0.34, 0.4), backpackShade, spine, [side * 0.13, 0.585, -0.02]);
  }

  /* ---- head ---- */
  const head = new THREE.Group();
  const HEAD_RADIUS = 0.27;

  head.position.y = 0.82;
  spine.add(head);
  mesh(capsule(0.07, 0.06), skin, spine, [0, 0.63, 0]);
  mesh(sphereGeometry, skin, head, [0, 0, 0], [HEAD_RADIUS, HEAD_RADIUS * 0.95, HEAD_RADIUS * 0.96]);
  /* Hair shows at the nape and the sides, under the cap. */
  mesh(sphereGeometry, hair, head, [0, 0.02, -0.035], [0.276, 0.25, 0.265]);

  /* A point on the face, with the orientation of the skin there. */
  const onFace = (x: number, y: number, lift = 0) => {
    const normal = new THREE.Vector3(x / HEAD_RADIUS, y / HEAD_RADIUS, 0);
    normal.z = Math.sqrt(Math.max(0, 1 - normal.x ** 2 - normal.y ** 2));
    const point = new THREE.Vector3(normal.x, normal.y * 0.95, normal.z * 0.96).multiplyScalar(HEAD_RADIUS + lift);

    return { point, rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal) };
  };
  const decal = (
    geometry: THREE.BufferGeometry,
    decalMaterial: THREE.Material,
    x: number,
    y: number,
    scale: [number, number, number],
    parent: THREE.Object3D = head,
    lift = 0,
  ) => {
    const { point, rotation } = onFace(x, y, lift);
    const created = mesh(geometry, decalMaterial, parent, [point.x, point.y, point.z], scale);

    created.quaternion.copy(rotation);

    return created;
  };

  const eyes = new THREE.Group();

  head.add(eyes);
  for (const side of [-1, 1]) {
    decal(sphereGeometry, eyeMaterial, side * 0.095, 0.0, [0.042, 0.06, 0.024], eyes, -0.004);
    decal(lowSphere, white, side * 0.095 + 0.016, 0.024, [0.014, 0.014, 0.008], eyes, 0.015);
    decal(lowSphere, cheek, side * 0.155, -0.07, [0.045, 0.028, 0.01], head, -0.002);
    /* Ears. */
    mesh(lowSphere, skin, head, [side * 0.262, -0.01, 0], [0.04, 0.065, 0.055]);
  }
  decal(lowSphere, material(0xe7ab86, 0.6), 0, -0.035, [0.026, 0.022, 0.02], head, -0.004);
  const smile = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(
      [-0.05, 0, 0.05].map((x) => {
        const { point } = onFace(x, -0.095 - (x === 0 ? 0.022 : 0), 0.002);

        return point;
      }),
    ),
    14,
    0.009,
    6,
    false,
  );

  mesh(track(smile), eyeMaterial, head, [0, 0, 0]);

  /* The cap: a dome, a brim that shades the eyes, a button on top. */
  const capGroup = new THREE.Group();

  capGroup.position.set(0, 0.06, -0.005);
  capGroup.rotation.x = -0.12;
  head.add(capGroup);
  mesh(
    track(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.52)),
    cap,
    capGroup,
    [0, 0, 0],
    [0.285, 0.27, 0.285],
  );
  const brim = mesh(track(new THREE.CylinderGeometry(0.19, 0.2, 0.026, 28)), cap, capGroup, [0, 0.01, 0.25], [1, 1, 0.95]);

  brim.rotation.x = 0.2;
  mesh(lowSphere, material(0xffffff, 0.5), capGroup, [0, 0.27, 0], [0.03, 0.02, 0.03]);
  mesh(rounded(0.1, 0.07, 0.02), white, capGroup, [0, 0.14, 0.247]).rotation.x = -0.57;

  /* ---- limbs: pivots at shoulder, elbow, hip and knee ---- */
  const pivot = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const group = new THREE.Group();

    group.position.set(x, y, z);
    parent.add(group);

    return group;
  };

  const arms = [-1, 1].map((side) => {
    const shoulder = pivot(spine, side * 0.29, 0.47);
    mesh(capsule(0.072, 0.15), hoodie, shoulder, [0, -0.13, 0]);
    const elbow = pivot(shoulder, 0, -0.26);

    mesh(capsule(0.066, 0.1), hoodie, elbow, [0, -0.09, 0]);
    mesh(track(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 16)), hoodieShade, elbow, [0, -0.17, 0]);
    mesh(sphereGeometry, skin, elbow, [0, -0.24, 0.005], [0.068, 0.078, 0.07]);
    return { shoulder, elbow };
  });

  const legs = [-1, 1].map((side) => {
    const hip = pivot(body, side * 0.105, HIP_Y);

    mesh(capsule(0.092, 0.14), pants, hip, [0, -0.15, 0]);
    const knee = pivot(hip, 0, -0.31);

    mesh(capsule(0.082, 0.16), pants, knee, [0, -0.14, 0]);
    const ankle = pivot(knee, 0, -0.3);

    mesh(rounded(0.17, 0.12, 0.29), shoe, ankle, [0, -0.02, 0.045]);
    mesh(rounded(0.18, 0.04, 0.3, 0.4), sole, ankle, [0, -0.07, 0.045]);
    mesh(rounded(0.176, 0.028, 0.12, 0.4), cap, ankle, [0, 0.0, 0.02]);

    return { hip, knee, ankle };
  });

  /* Hips: the top of the trousers, joining the legs to the hoodie. */
  mesh(rounded(0.36, 0.18, 0.25, 0.45), pants, body, [0, HIP_Y + 0.02, 0]);

  /*
   * A soft contact patch under the feet: a shadow map at this distance cannot
   * resolve where the shoes meet the ground, and without it the figure floats.
   */
  const shadowCanvas = document.createElement("canvas");

  shadowCanvas.width = shadowCanvas.height = 64;
  const shadowContext = shadowCanvas.getContext("2d");

  if (shadowContext) {
    const gradient = shadowContext.createRadialGradient(32, 32, 0, 32, 32, 32);

    gradient.addColorStop(0, "rgba(20, 30, 20, 0.5)");
    gradient.addColorStop(0.6, "rgba(20, 30, 20, 0.22)");
    gradient.addColorStop(1, "rgba(20, 30, 20, 0)");
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 64, 64);
  }

  const shadowTexture = track(new THREE.CanvasTexture(shadowCanvas));
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  const shadow = new THREE.Mesh(track(new THREE.PlaneGeometry(1.2, 1.2)), shadowMaterial);

  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.13;
  root.add(shadow);

  root.traverse((part) => {
    if (part instanceof THREE.Mesh && part !== shadow) part.castShadow = true;
  });

  /* About human height: everything else in the town — cars, doors, benches — is real size. */
  root.scale.setScalar(1.02);

  let phase = 0;
  let easedSpeed = 0;
  let clock = 0;
  let idleTime = 0;
  let nextBlink = 2.5;
  let lastFacing: number | null = null;
  let turnLean = 0;
  let airborneBlend = 0;

  return {
    root,
    update: (speed, airborne, delta) => {
      clock += delta;
      easedSpeed += (speed - easedSpeed) * (1 - Math.exp(-delta * 10));

      const walk = Math.min(1, easedSpeed / WALK_SPEED);
      const run = Math.max(0, Math.min(1, (easedSpeed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
      const moving = Math.min(1, easedSpeed / 1.2);

      /* Steps quicken with speed, but less than proportionally: a run is a longer stride too. */
      phase += delta * (2 + easedSpeed * 1.05);
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
      turnLean += (Math.max(-0.2, Math.min(0.2, -turnRate * 0.035 * walk)) - turnLean) * (1 - Math.exp(-delta * 8));

      airborneBlend += ((airborne ? 1 : 0) - airborneBlend) * (1 - Math.exp(-delta * 14));

      const swing = Math.sin(phase);
      const lift = Math.cos(phase);
      const legReach = (0.55 + run * 0.35) * moving;
      const armReach = (0.45 + run * 0.4) * moving;

      legs.forEach(({ hip, knee, ankle }, index) => {
        const direction = index === 0 ? 1 : -1;
        const stride = swing * direction;
        /* The knee bends on the swing forward, not while the foot is planted. */
        const swingForward = Math.max(0, lift * direction);

        hip.rotation.x = -stride * legReach * (1 - airborneBlend) + airborneBlend * (index === 0 ? -0.6 : 0.2);
        knee.rotation.x = (0.08 + swingForward * (0.9 + run * 0.5)) * moving * (1 - airborneBlend) + airborneBlend * 0.9;
        ankle.rotation.x = -hip.rotation.x * 0.35 - knee.rotation.x * 0.25;
      });

      arms.forEach(({ shoulder, elbow }, index) => {
        const direction = index === 0 ? -1 : 1;
        const idleSway = Math.sin(clock * 1.6 + index) * 0.04 * (1 - moving);

        shoulder.rotation.x = -swing * direction * armReach * (1 - airborneBlend) - airborneBlend * 2.4 + idleSway;
        shoulder.rotation.z = (index === 0 ? -1 : 1) * (0.08 + run * 0.08 + airborneBlend * 0.3);
        elbow.rotation.x = -(0.15 + walk * 0.35 + run * 0.75) * (1 - airborneBlend * 0.6);
      });

      /* Lowest as the feet land, highest as one passes the other. */
      body.position.y = (1 - Math.abs(swing)) * (0.035 + run * 0.03) * moving;
      body.rotation.y = swing * 0.07 * moving;
      spine.rotation.y = -swing * (0.14 + run * 0.06) * moving;
      spine.rotation.x = (0.05 * walk + 0.16 * run) * (1 - airborneBlend);
      body.rotation.z = turnLean + Math.sin(phase) * 0.015 * moving;

      /* Standing still it breathes, and after a moment it looks about. */
      const breath = Math.sin(clock * 2.1) * 0.012 * (1 - moving);
      const lookAbout = Math.min(1, Math.max(0, idleTime - 2.5) / 1.5);

      torso.scale.y = 1 + breath;
      head.position.y = 0.82 + breath * 0.6;
      head.rotation.y = Math.sin(clock * 0.55) * 0.45 * lookAbout + Math.max(-0.3, Math.min(0.3, turnRate * 0.06)) * walk;
      head.rotation.x = -spine.rotation.x * 0.6 + Math.sin(phase * 2) * 0.025 * moving + Math.sin(clock * 0.4) * 0.05 * lookAbout;
      backpack.rotation.x = -Math.cos(phase * 2) * 0.05 * moving;
      backpack.position.y = 0.34 + Math.abs(swing) * 0.012 * moving;

      /* Blink every few seconds. */
      nextBlink -= delta;
      if (nextBlink < -0.12) nextBlink = 2.2 + Math.abs(Math.sin(clock * 12.9898)) * 2.8;
      eyes.scale.y = nextBlink < 0 ? 0.12 : 1;
      eyes.position.y = nextBlink < 0 ? 0.004 : 0;

      shadow.scale.setScalar(1 - airborneBlend * 0.4 - Math.max(0, root.position.y) * 0.12);
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      root.clear();
    },
  };
}
