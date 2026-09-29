import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * The character you steer: Memo, the app's own mascot — the pink brain with a
 * face, a pen in one hand and its MEMO notepad in the other — stood up on two
 * short legs and walked through the town.
 *
 * It is built to look like the sticker the rest of the app uses: a soft pink
 * body with its folds shaded darker in the grooves, the dark outline the
 * artwork has (an inverted hull, one extra draw per part), big glossy eyes,
 * blush and a small smile. The camera spends its life behind and a little
 * above, so the back of the brain — the two hemispheres and the groove between
 * them — is the part drawn with the most care.
 *
 * The motion is a bouncy waddle: the body squashes as each foot lands and
 * stretches between steps, rocks side to side, leans into a sprint and rolls
 * into turns; standing still it breathes, blinks and looks about. After a stop
 * it acts out how it went (`react`). `avatar.root` is what the controller
 * moves; everything below it is local, facing +Z.
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
  /** A beat of acting after a stop: a hop and a twirl, or a droop. */
  react: (reaction: AvatarReaction) => void;
  dispose: () => void;
};

/* Walk and sprint speeds from `movement.ts`, for blending the gaits. */
const WALK_SPEED = 7.37;
const RUN_SPEED = 12.21;

/* The sticker's colours. */
const BRAIN_RIDGE = new THREE.Color(0xf2afb6);
const BRAIN_GROOVE = new THREE.Color(0xc9788a);
const LIMB = 0xeb9fa9;
const OUTLINE = 0x4a2436;
const EYE = 0x2a1a24;
const CHEEK = 0xf08c9c;
const SHOE = 0xf7f5f7;
const SOLE = 0xd9667a;

/** The brain's half-extents, before its folds: wider than tall, longer than wide. */
const BRAIN = { x: 0.56, y: 0.46, z: 0.6 };
/** Where the brain sits over the hips. */
const BODY_Y = 0.8;
const HIP_Y = 0.46;

/*
 * A small deterministic 3D value noise, enough to fold a brain. The grooves
 * are drawn along one contour of it — where it crosses the middle — so they
 * come out as the thin, winding lines the sticker has, with rounded folds
 * between them rather than lumps.
 */
function hash3(x: number, y: number, z: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;

  return value - Math.floor(value);
}

function noise3(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const corner = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);

  return lerp(
    lerp(lerp(corner(0, 0, 0), corner(1, 0, 0), ux), lerp(corner(0, 1, 0), corner(1, 1, 0), ux), uy),
    lerp(lerp(corner(0, 0, 1), corner(1, 0, 1), ux), lerp(corner(0, 1, 1), corner(1, 1, 1), ux), uy),
    uz,
  );
}

function smoothstep(edge0: number, edge1: number, value: number) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));

  return t * t * (3 - 2 * t);
}

/**
 * The brain's surface in a given direction: the ellipsoid, flattened
 * underneath, pushed out along its folds and pinched in along the groove
 * between the hemispheres. The face is kept nearly smooth, as it is on the
 * sticker. Returns the point and how much of a ridge it sits on (0 groove, 1
 * crest), which colours it.
 */
function brainSurface(direction: THREE.Vector3) {
  const d = direction;
  const foldNoise =
    noise3(d.x * 4.2 + 11, d.y * 4.2 + 3, d.z * 4.2 + 7) * 0.85 +
    noise3(d.x * 9 + 5, d.y * 9 + 13, d.z * 9 + 2) * 0.15;
  /* 0 on a groove, rising to 1 across the fold. */
  const ridge = Math.sqrt(Math.min(1, Math.abs(foldNoise * 2 - 1) * 3.2));
  /* The face: the front, a little below the middle. */
  const face = smoothstep(0.55, 0.85, d.z) * (1 - smoothstep(0.25, 0.6, Math.abs(d.y + 0.05)));
  const folds = 0.05 * ridge * (1 - face * 0.85);
  /* The longitudinal fissure, over the top and down the back, fading at the face. */
  const fissure =
    Math.exp(-((d.x / 0.07) ** 2)) * smoothstep(-0.35, 0.15, d.y) * (1 - smoothstep(0.35, 0.75, d.z));
  const radius = 1 + folds - fissure * 0.1 - (1 - face * 0.85) * 0.03;
  const point = new THREE.Vector3(d.x * BRAIN.x, d.y * BRAIN.y * (d.y < 0 ? 0.82 : 1), d.z * BRAIN.z).multiplyScalar(
    radius,
  );

  return { point, ridge: Math.min(1, ridge * (1 - fissure) + face * 0.8) };
}

function brainGeometry() {
  let geometry: THREE.BufferGeometry = new THREE.SphereGeometry(1, 120, 84);

  geometry.deleteAttribute("uv");
  geometry.deleteAttribute("normal");
  geometry = mergeVertices(geometry);

  const positions = geometry.getAttribute("position");
  const colors: number[] = [];
  const direction = new THREE.Vector3();
  const color = new THREE.Color();

  for (let index = 0; index < positions.count; index++) {
    direction.fromBufferAttribute(positions, index).normalize();

    const { point, ridge } = brainSurface(direction);

    positions.setXYZ(index, point.x, point.y, point.z);
    color.copy(BRAIN_GROOVE).lerp(BRAIN_RIDGE, smoothstep(0.1, 0.55, ridge));
    colors.push(color.r, color.g, color.b);
  }

  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  return geometry;
}

/*
 * A thin warm rim round the silhouette, brightest where the surface turns away
 * from the camera: what lifts the figure off a busy street behind it.
 */
function withRim<Material extends THREE.MeshStandardMaterial>(material: Material, strength = 0.35) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
      float avatarRim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      totalEmissiveRadiance += vec3(1.0, 0.9, 0.9) * pow(avatarRim, 3.0) * ${strength.toFixed(2)};`,
    );
  };
  material.customProgramCacheKey = () => `avatar-rim-${strength.toFixed(2)}`;

  return material;
}

/** The notepad's page: MEMO at the top, a few ruled lines, as on the sticker. */
function notepadTexture() {
  const canvas = document.createElement("canvas");

  canvas.width = 192;
  canvas.height = 240;

  const context = canvas.getContext("2d");

  if (context) {
    context.fillStyle = "#fbfafc";
    context.fillRect(0, 0, 192, 240);
    context.fillStyle = "#3b2a3a";
    context.font = "bold 44px system-ui, -apple-system, sans-serif";
    context.textAlign = "center";
    /* The brand name, as drawn on the mascot; not user-facing copy. */
    context.fillText("MEMO", 96, 78);
    context.strokeStyle = "#5b4a5a";
    context.lineWidth = 7;
    context.lineCap = "round";
    for (const [y, length] of [[118, 120], [150, 132], [182, 104], [212, 70]] as const) {
      context.beginPath();
      context.moveTo(30, y);
      context.lineTo(30 + length, y);
      context.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;

  return texture;
}

export function createAvatar(): Avatar {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const track = <Item extends { dispose: () => void }>(item: Item) => {
    disposables.push(item);

    return item;
  };
  const material = (color: THREE.ColorRepresentation, roughness = 0.6) =>
    track(withRim(new THREE.MeshStandardMaterial({ color, roughness })));

  const limb = material(LIMB, 0.55);
  const shoe = material(SHOE, 0.45);
  const sole = material(SOLE, 0.6);
  const outline = track(new THREE.MeshBasicMaterial({ color: OUTLINE, side: THREE.BackSide }));
  const eyeMaterial = track(new THREE.MeshStandardMaterial({ color: EYE, roughness: 0.12 }));
  const white = track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
  const cheek = track(
    new THREE.MeshStandardMaterial({ color: CHEEK, roughness: 0.9, transparent: true, opacity: 0.7 }),
  );
  const brainMaterial = track(
    withRim(
      new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.5,
        clearcoat: 0.35,
        clearcoatRoughness: 0.45,
        sheen: 0.6,
        sheenColor: new THREE.Color(0xffc9d2),
        sheenRoughness: 0.5,
      }),
      0.3,
    ),
  );

  const sphere = track(new THREE.SphereGeometry(1, 24, 18));
  const capsule = (radius: number, length: number) =>
    track(new THREE.CapsuleGeometry(radius, length, 6, 14));

  /** The sticker's outline for a mesh: itself again, a touch larger, inside out. */
  const addOutline = (surface: THREE.Mesh, width: number, scale: number) => {
    surface.geometry.computeBoundingSphere();

    const size = surface.geometry.boundingSphere?.radius ?? 1;
    const hull = new THREE.Mesh(surface.geometry, outline);

    hull.scale.setScalar(1 + width / (size * scale));
    hull.userData.outline = true;
    surface.parent?.add(hull);
  };

  const part = (
    geometry: THREE.BufferGeometry,
    partMaterial: THREE.Material,
    parent: THREE.Object3D,
    position: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
    outlineWidth = 0.022,
  ) => {
    const group = new THREE.Group();
    const surface = new THREE.Mesh(geometry, partMaterial);

    group.position.set(...position);
    group.scale.set(...scale);
    group.add(surface);
    parent.add(group);
    if (outlineWidth > 0) addOutline(surface, outlineWidth, Math.max(...scale));

    return group;
  };
  const plain = (
    geometry: THREE.BufferGeometry,
    partMaterial: THREE.Material,
    parent: THREE.Object3D,
    position: [number, number, number],
    scale: [number, number, number] = [1, 1, 1],
  ) => {
    const created = new THREE.Mesh(geometry, partMaterial);

    created.position.set(...position);
    created.scale.set(...scale);
    parent.add(created);

    return created;
  };

  /*
   * body  — bobs, rocks and squashes with each step
   * └ brain — the head that is also the body: leans, twists, nods
   */
  const body = new THREE.Group();
  const brain = new THREE.Group();

  brain.position.y = BODY_Y;
  body.add(brain);
  root.add(body);

  part(track(brainGeometry()), brainMaterial, brain, [0, 0, 0], [1, 1, 1], 0.028);

  /* ---- the face ---- */
  const onBrain = (x: number, y: number, lift = 0) => {
    const direction = new THREE.Vector3(x, y, 1).normalize();
    const { point } = brainSurface(direction);
    const normal = new THREE.Vector3(
      point.x / BRAIN.x ** 2,
      point.y / BRAIN.y ** 2,
      point.z / BRAIN.z ** 2,
    ).normalize();

    point.addScaledVector(normal, lift);

    return { point, rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal) };
  };
  const onFace = (
    geometry: THREE.BufferGeometry,
    faceMaterial: THREE.Material,
    parent: THREE.Object3D,
    x: number,
    y: number,
    scale: [number, number, number],
    lift = 0,
  ) => {
    const { point, rotation } = onBrain(x, y, lift);
    const created = plain(geometry, faceMaterial, parent, [point.x, point.y, point.z], scale);

    created.quaternion.copy(rotation);

    return created;
  };

  const face = new THREE.Group();
  const eyes = new THREE.Group();

  brain.add(face);
  face.add(eyes);
  for (const side of [-1, 1]) {
    onFace(sphere, eyeMaterial, eyes, side * 0.2, 0.02, [0.05, 0.07, 0.03], -0.008);
    onFace(sphere, white, eyes, side * 0.2 + 0.035, 0.07, [0.016, 0.016, 0.01], 0.014);
    onFace(sphere, cheek, face, side * 0.33, -0.1, [0.06, 0.036, 0.012], -0.004);
  }

  const smileGeometry = track(
    new THREE.TubeGeometry(
      new THREE.CatmullRomCurve3(
        [-0.07, -0.035, 0, 0.035, 0.07].map((x) => onBrain(x, -0.1 - (0.0049 - x * x) * 5.2, 0.004).point),
      ),
      18,
      0.011,
      6,
      false,
    ),
  );

  plain(smileGeometry, eyeMaterial, face, [0, 0, 0]);

  /* ---- arms: pen on the left of the face, notepad on the right, as drawn ---- */
  const pivot = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
    const group = new THREE.Group();

    group.position.set(x, y, z);
    parent.add(group);

    return group;
  };

  const arms = [-1, 1].map((side) => {
    const shoulder = pivot(brain, side * 0.47, -0.14, 0.12);
    const arm = pivot(shoulder, 0, 0);

    arm.rotation.set(-0.9, 0, side * 0.35);
    part(capsule(0.068, 0.17), limb, arm, [0, -0.12, 0]);
    part(sphere, limb, arm, [0, -0.25, 0.01], [0.092, 0.092, 0.092], 0.02);

    return { arm, side };
  });

  /* The pen, in the hand on the face's left. */
  const pen = new THREE.Group();

  pen.position.set(0, -0.27, 0.07);
  pen.scale.setScalar(1.35);
  pen.rotation.set(0.5, 0, -0.7);
  arms[0].arm.add(pen);
  part(track(new THREE.CylinderGeometry(0.018, 0.018, 0.26, 12)), material(0xf4f1fa, 0.35), pen, [0, 0.06, 0], [1, 1, 1], 0.008);
  part(track(new THREE.ConeGeometry(0.018, 0.05, 12)), material(0x9a8cc8, 0.4), pen, [0, -0.095, 0], [1, 1, 1], 0.006).rotation.x = Math.PI;
  plain(track(new THREE.CylinderGeometry(0.02, 0.02, 0.05, 12)), material(0xb8a9e6, 0.4), pen, [0, 0.17, 0]);

  /* The notepad, in the other hand, its page facing out. */
  const notepad = new THREE.Group();

  notepad.position.set(0.03, -0.3, 0.1);
  notepad.scale.setScalar(1.35);
  notepad.rotation.set(0.75, -0.35, 0.15);
  arms[1].arm.add(notepad);

  const pageMaterial = track(new THREE.MeshStandardMaterial({ map: track(notepadTexture()), roughness: 0.8 }));
  const coverMaterial = material(0xe9e4ef, 0.8);
  /* RoundedBoxGeometry's groups run +x, -x, +y, -y, +z, -z: the page is the +z face. */
  const pad = new THREE.Mesh(track(new RoundedBoxGeometry(0.2, 0.25, 0.022, 2, 0.008)), [
    coverMaterial,
    coverMaterial,
    coverMaterial,
    coverMaterial,
    pageMaterial,
    coverMaterial,
  ]);

  notepad.add(pad);
  addOutline(pad, 0.01, 1);
  for (const x of [-0.06, -0.02, 0.02, 0.06]) {
    const ring = plain(track(new THREE.TorusGeometry(0.012, 0.004, 6, 12)), material(0x8a8595, 0.3), notepad, [x, 0.125, 0]);

    ring.rotation.y = Math.PI / 2;
  }

  /* ---- legs, short, with little sneakers ---- */
  const legs = [-1, 1].map((side) => {
    const hip = pivot(body, side * 0.17, HIP_Y);

    part(capsule(0.1, 0.12), limb, hip, [0, -0.13, 0]);
    const ankle = pivot(hip, 0, -0.3);

    part(track(new RoundedBoxGeometry(0.21, 0.13, 0.3, 3, 0.055)), shoe, ankle, [0, -0.07, 0.05], [1, 1, 1], 0.016);
    plain(track(new RoundedBoxGeometry(0.215, 0.04, 0.31, 2, 0.014)), sole, ankle, [0, -0.13, 0.05]);

    return { hip, ankle };
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

    gradient.addColorStop(0, "rgba(40, 20, 30, 0.5)");
    gradient.addColorStop(0.6, "rgba(40, 20, 30, 0.22)");
    gradient.addColorStop(1, "rgba(40, 20, 30, 0)");
    shadowContext.fillStyle = gradient;
    shadowContext.fillRect(0, 0, 64, 64);
  }

  const shadowTexture = track(new THREE.CanvasTexture(shadowCanvas));
  const shadowMaterial = track(
    new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }),
  );
  const shadow = new THREE.Mesh(track(new THREE.PlaneGeometry(1.4, 1.4)), shadowMaterial);

  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.13;
  root.add(shadow);

  root.traverse((object) => {
    if (object instanceof THREE.Mesh && object !== shadow && !object.userData.outline) object.castShadow = true;
  });

  /* About a metre and a half: a friendly size next to real cars and doors. */
  root.scale.setScalar(1.22);

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

    gradient.addColorStop(0, "rgba(255, 250, 240, 0.9)");
    gradient.addColorStop(0.5, "rgba(240, 232, 218, 0.45)");
    gradient.addColorStop(1, "rgba(240, 232, 218, 0)");
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
    const back = -0.15;

    puff.sprite.position.set(
      root.position.x + Math.sin(facing) * back + Math.cos(facing) * sideways,
      root.position.y + 0.12,
      root.position.z + Math.cos(facing) * back - Math.sin(facing) * sideways,
    );
    puff.drift.set(-Math.sin(facing) * 0.6 + (Math.random() - 0.5) * 0.4, 0.5, -Math.cos(facing) * 0.6 + (Math.random() - 0.5) * 0.4);
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
  const REACTION_LENGTH = { cheer: 1.3, miss: 1.1 } as const;

  return {
    root,
    effects,
    react: (next) => {
      reaction = next;
      reactionTime = 0;
    },
    update: (speed, airborne, delta) => {
      clock += delta;
      easedSpeed += (speed - easedSpeed) * (1 - Math.exp(-delta * 10));

      const walk = Math.min(1, easedSpeed / WALK_SPEED);
      const run = Math.max(0, Math.min(1, (easedSpeed - WALK_SPEED) / (RUN_SPEED - WALK_SPEED)));
      const moving = Math.min(1, easedSpeed / 1.2);

      /* Short legs take quick steps. */
      phase += delta * (2.4 + easedSpeed * 1.25);
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
      const legReach = (0.6 + run * 0.3) * moving;

      legs.forEach(({ hip, ankle }, index) => {
        const direction = index === 0 ? 1 : -1;

        hip.rotation.x = -swing * direction * legReach * (1 - airborneBlend) + airborneBlend * 0.4;
        /* The foot lifts on the swing forward, and stays flat on the ground. */
        hip.position.y = HIP_Y + Math.max(0, lift * direction) * 0.07 * moving;
        ankle.rotation.x = -hip.rotation.x;
      });

      arms.forEach(({ arm, side }, index) => {
        const direction = index === 0 ? -1 : 1;
        const idleSway = Math.sin(clock * 1.6 + index) * 0.05 * (1 - moving);

        arm.rotation.x = -0.9 - swing * direction * (0.3 + run * 0.3) * moving - airborneBlend * 1.2 + idleSway;
        arm.rotation.z = side * (0.35 + run * 0.15);
      });

      /* A waddle: up between steps, down and squashed as each foot lands. */
      const landing = Math.pow(Math.abs(swing), 4) * moving;
      const breath = Math.sin(clock * 2.1) * 0.018 * (1 - moving);

      body.position.y = (1 - Math.abs(swing)) * (0.06 + run * 0.04) * moving;
      body.rotation.z = turnLean + swing * 0.07 * moving;
      body.rotation.y = swing * 0.05 * moving;
      body.scale.set(1 + landing * 0.05 - breath * 0.4, 1 - landing * 0.07 + breath, 1 + landing * 0.05 - breath * 0.4);
      brain.rotation.x = (0.05 * walk + 0.16 * run) * (1 - airborneBlend);

      /* Standing still it looks about. */
      const lookAbout = Math.min(1, Math.max(0, idleTime - 2.5) / 1.5);

      brain.rotation.y = Math.sin(clock * 0.55) * 0.4 * lookAbout + Math.max(-0.25, Math.min(0.25, turnRate * 0.05)) * walk;
      brain.rotation.z = Math.sin(clock * 0.8) * 0.05 * lookAbout;

      /* Blink every few seconds. */
      nextBlink -= delta;
      if (nextBlink < -0.12) nextBlink = 2.2 + Math.abs(Math.sin(clock * 12.9898)) * 2.8;
      eyes.scale.y = nextBlink < 0 ? 0.15 : 1;

      /* Each footfall of a sprint kicks up dust. */
      const step = Math.floor(phase / Math.PI);

      if (step !== lastStep) {
        lastStep = step;
        if (run > 0.35 && !airborne) kickDust(step % 2 === 0 ? 0.17 : -0.17);
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
        puff.material.opacity = (1 - puff.age) * 0.55;
      });

      /*
       * The acting after a stop, laid over the gait and faded in and out so it
       * never snaps. A cheer: a hop, a full twirl, pen and pad held high and
       * eyes squeezed happy. A miss: a droop, a shake of the whole head.
       */
      let hop = 0;

      if (reaction) {
        reactionTime += delta;

        const t = reactionTime / REACTION_LENGTH[reaction];

        if (t >= 1) {
          reaction = null;
        } else {
          const weight = Math.min(1, t * 6, (1 - t) * 5);

          if (reaction === "cheer") {
            const jump = t < 0.55 ? Math.sin((t / 0.55) * Math.PI) : 0;

            hop = jump * 0.5;
            body.rotation.y += Math.min(1, t / 0.55) * Math.PI * 2 * (1 - moving);
            body.scale.y *= 1 + jump * 0.08;
            arms.forEach(({ arm, side }) => {
              const pump = Math.sin(t * Math.PI * 6) * 0.15;

              arm.rotation.x += (-2.9 + pump - arm.rotation.x) * weight;
              arm.rotation.z += (side * 0.2 - arm.rotation.z) * weight;
            });
            eyes.scale.y = Math.min(eyes.scale.y, 1 - weight * 0.6);
          } else {
            brain.rotation.y += Math.sin(t * Math.PI * 5) * 0.3 * weight;
            brain.rotation.x += 0.18 * weight;
            body.scale.y *= 1 - 0.05 * weight;
            arms.forEach(({ arm, side }) => {
              arm.rotation.x += (-0.25 - arm.rotation.x) * weight;
              arm.rotation.z += (side * 0.15 - arm.rotation.z) * weight;
            });
          }
        }
      }

      body.position.y += hop;
      shadow.scale.setScalar(1 - airborneBlend * 0.4 - Math.max(0, root.position.y + hop) * 0.25);
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      root.clear();
      effects.clear();
    },
  };
}
