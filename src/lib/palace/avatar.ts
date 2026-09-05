import * as THREE from "three";

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
    const created = new THREE.MeshLambertMaterial({ color });

    disposables.push(created);

    return created;
  };
  const box = (width: number, height: number, depth: number) => {
    const geometry = new THREE.BoxGeometry(width, height, depth);

    disposables.push(geometry);

    return geometry;
  };

  const skin = material(0xf0c9a4);
  /*
   * One outfit, whatever district you are in: the character is the thing your
   * eye tracks across a city of pale buildings, so it stays the same saturated
   * indigo rather than borrowing the local colour and disappearing into it.
   */
  const shirt = material(0x4b3fbe);
  const jeans = material(0x2f3a56);
  const shoes = material(0xf2f2f4);
  const capColor = material(0xe0483c);

  const torso = new THREE.Mesh(box(0.78, 0.86, 0.44), shirt);
  const head = new THREE.Mesh(box(0.56, 0.54, 0.54), skin);
  const cap = new THREE.Mesh(box(0.6, 0.2, 0.58), capColor);
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

  const leftArm = limb(0.2, 0.72, 0.22, shirt, -0.5, 1.5);
  const rightArm = limb(0.2, 0.72, 0.22, shirt, 0.5, 1.5);
  const leftLeg = limb(0.26, 0.78, 0.28, jeans, -0.2, 0.78);
  const rightLeg = limb(0.26, 0.78, 0.28, jeans, 0.2, 0.78);
  const leftShoe = new THREE.Mesh(box(0.3, 0.16, 0.42), shoes);
  const rightShoe = new THREE.Mesh(box(0.3, 0.16, 0.42), shoes);

  /* Toes lead, so they point the way the figure faces. */
  leftShoe.position.set(0, -0.78, 0.06);
  rightShoe.position.set(0, -0.78, 0.06);
  leftLeg.add(leftShoe);
  rightLeg.add(rightShoe);

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
  shadow.position.y = 0.05;

  root.add(torso, head, cap, brim, backpack, shadow);
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

  return {
    root,
    update: (speed, airborne, delta) => {
      phase += delta * (2.4 + speed * 1.15);

      if (airborne) {
        /* Tuck in the air, so a jump reads as a jump from behind. */
        leftArm.rotation.x = -1.9;
        rightArm.rotation.x = -1.9;
        leftLeg.rotation.x = 0.5;
        rightLeg.rotation.x = -0.35;
        shadow.scale.setScalar(Math.max(0.4, 1 - root.position.y * 0.16));

        return;
      }

      const swing = Math.sin(phase) * Math.min(0.95, 0.18 + speed * 0.09);

      leftArm.rotation.x = swing;
      rightArm.rotation.x = -swing;
      leftLeg.rotation.x = -swing;
      rightLeg.rotation.x = swing;
      /* A small bounce on each step; standing still, it settles. */
      torso.position.y = 1.16 + Math.abs(Math.sin(phase)) * Math.min(0.09, speed * 0.012);
      shadow.scale.setScalar(1);
    },
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      root.clear();
    },
  };
}
