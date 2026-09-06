import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

/**
 * The character you steer: a jointed figure built out of boxes, with a walk
 * cycle driven by a sine wave rather than an animation clip.
 *
 * Deliberately a silhouette rather than a portrait — a cap, a backpack and a
 * pair of swinging arms read as "you" at the camera distance this game uses,
 * and cost nothing to download. `avatar.root` is what the controller moves;
 * everything below it is local.
 */

export type Avatar = {
  root: THREE.Group;
  /** Advance the walk cycle. `speed` is metres per second on the ground. */
  update: (speed: number, airborne: boolean, delta: number) => void;
  dispose: () => void;
};

export function createAvatar(): Avatar {
  const root = new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const material = (color: THREE.ColorRepresentation) => {
    const created = new THREE.MeshStandardMaterial({ color, roughness: 0.82 });

    disposables.push(created);

    return created;
  };
  const box = (width: number, height: number, depth: number) => {
    const geometry = new RoundedBoxGeometry(
      width,
      height,
      depth,
      2,
      Math.min(width, height, depth) * 0.28,
    );

    disposables.push(geometry);

    return geometry;
  };

  const skin = material(0xf0c9a4);
  /*
   * One outfit, whatever district you are in: the character is the thing your
   * eye tracks across a city of pale buildings, so it stays the same saturated
   * indigo rather than borrowing the local colour and disappearing into it.
   */
  const shirt = material(0x5265a8);
  const jeans = material(0x354355);
  const shoes = material(0xf2f2f4);
  const capColor = material(0xe0483c);

  const torso = new THREE.Mesh(box(0.78, 0.86, 0.44), shirt);
  const head = new THREE.Mesh(box(0.56, 0.54, 0.54), skin);
  const cap = new THREE.Mesh(box(0.62, 0.2, 0.6), capColor);
  const brim = new THREE.Mesh(box(0.6, 0.08, 0.34), capColor);
  const backpack = new THREE.Mesh(box(0.5, 0.6, 0.22), jeans);

  /*
   * The figure faces local +Z, because that is the way the controller walks.
   * `facing` moves the character along `(sin facing, cos facing)` and the
   * camera sits at the negative of that, behind the head — so a figure built
   * facing -Z, as this one was, is turned exactly half a circle from the way it
   * is going, and the whole town is walked backwards with the brim of the cap
   * leading and the backpack pointed where the player is looking.
   */
  torso.position.y = 1.16;
  head.position.y = 1.86;
  cap.position.set(0, 2.18, 0);
  brim.position.set(0, 2.12, 0.42);
  backpack.position.set(0, 1.2, -0.3);

  // The original red-cap silhouette, with a simple friendly block-avatar face.
  const faceMaterial = material(0x302d35);
  const eyeGeometry = new THREE.SphereGeometry(0.028, 10, 8);
  disposables.push(eyeGeometry);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeometry, faceMaterial);
    eye.position.set(side * 0.105, 1.93, 0.266);
    eye.scale.set(0.8, 1.2, 0.35);
    root.add(eye);
  }
  const smileCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.105, 1.83, 0.273),
    new THREE.Vector3(0, 1.775, 0.279),
    new THREE.Vector3(0.105, 1.83, 0.273),
  ]);
  const smileGeometry = new THREE.TubeGeometry(smileCurve, 12, 0.011, 6, false);
  disposables.push(smileGeometry);
  root.add(new THREE.Mesh(smileGeometry, faceMaterial));

  /*
   * Limbs hang from pivots at the shoulder and hip, so rotating the pivot
   * swings the limb the way a limb swings instead of spinning it about its
   * middle.
   */
  const limb = (
    width: number,
    height: number,
    depth: number,
    limbMaterial: THREE.Material,
    x: number,
    y: number,
  ) => {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(box(width, height, depth), limbMaterial);

    mesh.position.y = -height / 2;
    pivot.position.set(x, y, 0);
    pivot.add(mesh);
    root.add(pivot);

    return pivot;
  };

  const leftArm = limb(0.24, 0.62, 0.26, shirt, -0.51, 1.5);
  const rightArm = limb(0.24, 0.62, 0.26, shirt, 0.51, 1.5);
  const leftLeg = limb(0.28, 0.36, 0.3, jeans, -0.2, 0.78);
  const rightLeg = limb(0.28, 0.36, 0.3, jeans, 0.2, 0.78);
  const leftKnee = limb(0.27, 0.34, 0.29, jeans, 0, -0.36);
  const rightKnee = limb(0.27, 0.34, 0.29, jeans, 0, -0.36);
  leftLeg.add(leftKnee);
  rightLeg.add(rightKnee);
  const leftShoe = new THREE.Mesh(box(0.3, 0.16, 0.42), shoes);
  const rightShoe = new THREE.Mesh(box(0.3, 0.16, 0.42), shoes);

  /* Toes lead, so they point the way the figure faces. */
  leftShoe.position.set(0, -0.34, 0.07);
  rightShoe.position.set(0, -0.34, 0.07);
  leftKnee.add(leftShoe);
  rightKnee.add(rightShoe);

  /* A painted blob instead of a shadow map: the same read, none of the cost. */
  const shadowGeometry = new THREE.CircleGeometry(0.62, 20);
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: 0x1a2a12,
    transparent: true,
    opacity: 0.28,
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);

  disposables.push(shadowGeometry, shadowMaterial);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.14;

  const strapMaterial = material(0x222d41);
  for (const side of [-1, 1]) {
    const strap = new THREE.Mesh(box(0.09, 0.72, 0.06), strapMaterial);
    strap.position.set(side * 0.25, 1.22, 0.245);
    root.add(strap);
    const hand = new THREE.Mesh(box(0.17, 0.22, 0.18), skin);
    hand.position.y = -0.69;
    (side === -1 ? leftArm : rightArm).add(hand);
  }
  const detailMaterial = material(0xc7d5d7);
  const seamMaterial = material(0x394f85);
  const addDetail = (
    parent: THREE.Group | THREE.Mesh,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    mat: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(box(w, h, d), mat);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  // Jacket seams and collar, fitted cuffs, and rounded mitten-style hands.
  addDetail(root, 0.025, 0.65, 0.015, 0, 1.17, 0.229, detailMaterial);
  addDetail(
    root,
    0.12,
    0.075,
    0.06,
    -0.09,
    1.57,
    0.21,
    seamMaterial,
  ).rotation.z = -0.3;
  addDetail(
    root,
    0.12,
    0.075,
    0.06,
    0.09,
    1.57,
    0.21,
    seamMaterial,
  ).rotation.z = 0.3;
  for (const side of [-1, 1]) {
    const arm = side === -1 ? leftArm : rightArm;
    addDetail(arm, 0.245, 0.08, 0.27, 0, -0.59, 0, seamMaterial);
    addDetail(arm, 0.065, 0.12, 0.1, -side * 0.1, -0.69, 0.05, skin);
    addDetail(root, 0.14, 0.12, 0.025, side * 0.19, 1.01, 0.235, seamMaterial);
    // Ears and hair beneath the cap retain the simple, friendly face.
    addDetail(root, 0.065, 0.13, 0.12, side * 0.28, 1.86, 0, skin);
    addDetail(root, 0.025, 0.09, 0.25, side * 0.273, 2.06, -0.05, faceMaterial);
    const knee = side === -1 ? leftKnee : rightKnee;
    addDetail(knee, 0.31, 0.045, 0.43, 0, -0.397, 0.07, detailMaterial);
    for (const lace of [0, 0.055, 0.11])
      addDetail(knee, 0.19, 0.016, 0.019, 0, -0.252, 0.07 + lace, seamMaterial);
  }
  addDetail(root, 0.39, 0.065, 0.03, 0, 2.08, -0.274, faceMaterial);
  addDetail(root, 0.12, 0.085, 0.015, 0, 2.19, 0.305, shoes);
  addDetail(root, 0.032, 0.047, 0.022, 0, 2.19, 0.315, capColor);
  const zip = new THREE.Mesh(box(0.29, 0.025, 0.025), detailMaterial);
  zip.position.set(0, 1.24, -0.5);
  const handle = new THREE.Mesh(box(0.18, 0.08, 0.06), jeans);
  handle.position.set(0, 1.56, -0.3);
  root.add(zip, handle);
  const pocket = new THREE.Mesh(box(0.38, 0.25, 0.1), shirt);
  pocket.position.set(0, 1.1, -0.44);
  root.add(torso, head, cap, brim, backpack, pocket, shadow);
  // Move the whole rig together: the jacket no longer bounces away from the
  // head and backpack. The ground contact shadow stays planted.
  const rig = new THREE.Group();
  for (const child of [...root.children]) if (child !== shadow) rig.add(child);
  root.add(rig);
  /*
   * The figure is built at about two metres and then taken down to human
   * height: everything else in the town — a car, a door, a bench — is at its
   * real size, and the character was quietly making all of it look like toys.
   */
  root.scale.setScalar(0.86);
  /* The character casts a real shadow now; the painted blob under it stays as
     the contact patch a shadow map at this distance cannot resolve. */
  root.traverse((part) => {
    if (part instanceof THREE.Mesh && part !== shadow) {
      part.castShadow = true;
    }
  });

  let phase = 0;
  let easedSpeed = 0;

  return {
    root,
    update: (speed, airborne, delta) => {
      easedSpeed += (speed - easedSpeed) * (1 - Math.exp(-delta * 12));
      phase += delta * (2.4 + easedSpeed * 1.15);

      if (airborne) {
        /* Tuck in the air, so a jump reads as a jump from behind. */
        leftArm.rotation.x = -1.9;
        rightArm.rotation.x = -1.9;
        leftLeg.rotation.x = 0.5;
        rightLeg.rotation.x = -0.35;
        shadow.scale.setScalar(Math.max(0.4, 1 - root.position.y * 0.16));

        return;
      }

      const stride = Math.min(1, easedSpeed / 7);
      const swing = Math.sin(phase) * Math.min(0.85, easedSpeed * 0.1);

      leftArm.rotation.x = swing;
      rightArm.rotation.x = -swing;
      leftLeg.rotation.x = -swing;
      rightLeg.rotation.x = swing;
      leftKnee.rotation.x = Math.max(0, Math.sin(phase)) * 0.65 * stride;
      rightKnee.rotation.x = Math.max(0, -Math.sin(phase)) * 0.65 * stride;
      leftArm.rotation.z = 0.035 + stride * 0.04;
      rightArm.rotation.z = -0.035 - stride * 0.04;
      /* A small bounce on each step; standing still, it settles. */
      rig.position.y =
        Math.abs(Math.sin(phase)) * Math.min(0.045, easedSpeed * 0.006);
      rig.rotation.z = Math.sin(phase) * 0.012 * stride;
      backpack.rotation.x = Math.sin(phase * 2) * 0.015 * stride;
      shadow.scale.setScalar(1);
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      root.clear();
    },
  };
}
