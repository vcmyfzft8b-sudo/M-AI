import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";

import { createAvatar, type Avatar, type AvatarReaction } from "./avatar";

/**
 * The people in the town, as a game draws them: a rigged, animated character
 * model rather than a figure assembled from primitives.
 *
 * The model is Quaternius's "Hoodie Character" (CC0, public domain; from the
 * Ultimate Modular Men pack via poly.pizza), 4,300 triangles with a 62-bone
 * rig and its own idle, walk, run, wave and hit-reaction clips. Everyone in
 * the town is that one model — the player in Memo's periwinkle, the passers-by
 * in colours of their own — cloned with its skeleton, so a pedestrian costs
 * four draws instead of the two dozen a hand-built figure took.
 *
 * Movement blends the clips by speed: idle standing still, walk at the slow end
 * of the stick, run at the game's walking pace and faster into a sprint, each
 * clip's playback rate scaled to the ground speed so the feet do not skate.
 * After a stop the player waves (a right answer) or takes a hit (a miss).
 *
 * Until the model has loaded — or if it never does — the player is the
 * procedural figure from `avatar.ts`, which also keeps providing the sprint
 * dust. The palace waits for the model behind its loading screen
 * (`loadHeroModel`), so in practice nobody sees the stand-in.
 */

const MODEL_URL = "/palace/hoodie-character.glb";
const PLAYER_HEIGHT = 1.78;
/* Ground speeds the walk and run clips were animated for, measured by eye against the pavement. */
const WALK_CLIP_SPEED = 1.7;
const RUN_CLIP_SPEED = 6.2;

let pending: Promise<GLTF | null> | null = null;
let loaded: GLTF | null = null;

/** Fetch the model once for the whole session; resolves null if it cannot be had. */
export function loadHeroModel(): Promise<GLTF | null> {
  if (loaded) return Promise.resolve(loaded);
  if (!pending) {
    pending = new GLTFLoader()
      .loadAsync(MODEL_URL)
      .then((gltf) => {
        loaded = gltf;

        return gltf;
      })
      .catch(() => {
        pending = null;

        return null;
      });
  }

  return pending;
}

export type HeroLook = {
  top?: number;
  trousers?: number;
  skin?: number;
  hair?: number;
  shoes?: number;
  /** Height as a multiple of 1.78 m. */
  scale?: number;
  /** The player: casts shadows, and stands in as the procedural figure until the model arrives. */
  player?: boolean;
  /** A render layer for every mesh (the passers-by stay out of ambient occlusion). */
  layer?: number;
};

/* The player's colours: Memo's periwinkle hoodie, light jeans, white trainers. */
const PLAYER_LOOK = { top: 0x6574f2, trousers: 0x7fa3d6, skin: 0xe0a47c, hair: 0x3a2618, shoes: 0xf4f4f2 };
/* Everyone's trainers have a coral sole. */
const SOLE = 0xf0574f;

function clip(gltf: GLTF, name: string) {
  return gltf.animations.find((animation) => animation.name.endsWith(`|${name}`) || animation.name === name) ?? null;
}

export function createHero(look: HeroLook = {}): Avatar {
  const root = new THREE.Group();
  const player = look.player ?? false;
  /* The stand-in, for the player only: shown until the model is in, and the source of the sprint dust. */
  const standIn = player ? createAvatar() : null;
  const effects = standIn?.effects ?? new THREE.Group();
  const disposables: { dispose: () => void }[] = [];
  const colours = {
    top: look.top ?? PLAYER_LOOK.top,
    trousers: look.trousers ?? PLAYER_LOOK.trousers,
    skin: look.skin ?? PLAYER_LOOK.skin,
    hair: look.hair ?? PLAYER_LOOK.hair,
    shoes: look.shoes ?? PLAYER_LOOK.shoes,
  };

  if (standIn) root.add(standIn.root);

  /* A soft contact patch under the feet, for the passers-by (the stand-in has its own). */
  let shadow: THREE.Mesh | null = null;

  if (!player) {
    const canvas = document.createElement("canvas");

    canvas.width = canvas.height = 64;
    const context = canvas.getContext("2d");

    if (context) {
      const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);

      gradient.addColorStop(0, "rgba(20, 24, 30, 0.4)");
      gradient.addColorStop(1, "rgba(20, 24, 30, 0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, 64, 64);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
    const geometry = new THREE.PlaneGeometry(0.9, 0.9);

    disposables.push(texture, material, geometry);
    shadow = new THREE.Mesh(geometry, material);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.012;
    if (look.layer !== undefined) shadow.layers.set(look.layer);
    root.add(shadow);
  }

  /* A wrapper for the model, so leaning into turns does not fight the animation. */
  const body = new THREE.Group();

  root.add(body);

  let mixer: THREE.AnimationMixer | null = null;
  let idle: THREE.AnimationAction | null = null;
  let walk: THREE.AnimationAction | null = null;
  let run: THREE.AnimationAction | null = null;
  let wave: THREE.AnimationAction | null = null;
  let hit: THREE.AnimationAction | null = null;
  let disposed = false;

  const attach = (gltf: GLTF) => {
    if (disposed) return;

    const model = cloneSkinned(gltf.scene);

    /*
     * Stand it on the ground at a person's height, measured from the skinned
     * vertices themselves: the rig carries a hundredfold scale that the
     * meshes' own bind-pose bounds know nothing about.
     */
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model, true);
    const height = bounds.max.y - bounds.min.y || 1;
    const scale = (PLAYER_HEIGHT * (look.scale ?? 1)) / height;

    model.scale.multiplyScalar(scale);
    model.position.y = -bounds.min.y * scale;

    /* Its own materials, recoloured, and matte: the source is dark and metallic. */
    model.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;

      const source = object.material as THREE.MeshStandardMaterial;
      const material = source.clone();
      const name = source.name.toLowerCase();
      /* The file shares one colour between the hoodie and the trainers; the mesh says which is which. */
      const feet = object.name.toLowerCase().includes("feet");

      material.metalness = 0;
      material.roughness = name === "eye" ? 0.2 : 0.72;
      if (feet && name === "purple") material.color.set(colours.shoes);
      else if (feet && name === "white") material.color.set(SOLE);
      else if (name === "purple") material.color.set(colours.top);
      else if (name === "lightblue") material.color.set(colours.trousers);
      else if (name === "skin") material.color.set(colours.skin);
      else if (name === "hair") material.color.set(colours.hair);
      else if (name === "eyebrows") material.color.set(colours.hair).multiplyScalar(0.7);
      else if (name === "white") material.color.set(0xf2f2f0);
      object.material = material;
      object.castShadow = player;
      object.receiveShadow = player;
      /* A skinned mesh's bounds are its bind pose; culling on them loses a running figure's limbs. */
      object.frustumCulled = false;
      if (look.layer !== undefined) object.layers.set(look.layer);
      disposables.push(material);
    });

    body.add(model);
    if (standIn) standIn.root.visible = false;

    mixer = new THREE.AnimationMixer(model);

    const action = (name: string, loop = true) => {
      const animation = clip(gltf, name);

      if (!animation || !mixer) return null;

      const created = mixer.clipAction(animation);

      created.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
      created.clampWhenFinished = false;

      return created;
    };

    idle = action("Idle_Neutral") ?? action("Idle");
    walk = action("Walk");
    run = action("Run");
    wave = action("Wave", false);
    hit = action("HitRecieve", false);

    for (const looping of [idle, walk, run]) {
      if (!looping) continue;
      looping.play();
      looping.setEffectiveWeight(0);
    }
    idle?.setEffectiveWeight(1);
    /* Out of step with one another, so a street of people does not march. */
    if (!player) mixer.setTime(Math.random() * 2);
  };

  if (loaded) attach(loaded);
  else void loadHeroModel().then((gltf) => gltf && attach(gltf));

  let easedSpeed = 0;
  let lastFacing: number | null = null;
  let turnLean = 0;
  let reaction: THREE.AnimationAction | null = null;
  let reactionTime = 0;

  return {
    root,
    effects,
    react: (next: AvatarReaction) => {
      standIn?.react(next);

      const chosen = next === "cheer" ? wave : hit;

      if (!chosen) return;
      reaction?.stop();
      reaction = chosen;
      reactionTime = 0;
      chosen.reset();
      chosen.setEffectiveWeight(0);
      chosen.play();
    },
    update: (speed, airborne, delta) => {
      standIn?.update(speed, airborne, delta);
      if (!mixer) return;

      easedSpeed += (speed - easedSpeed) * (1 - Math.exp(-delta * 10));

      /* How fast the controller is turning the body, for leaning into it. */
      const facing = root.rotation.y;

      if (lastFacing !== null && delta > 0) {
        const change = Math.atan2(Math.sin(facing - lastFacing), Math.cos(facing - lastFacing));

        turnLean += (Math.max(-0.18, Math.min(0.18, (-change / delta) * 0.025 * Math.min(1, easedSpeed / 4))) - turnLean) *
          (1 - Math.exp(-delta * 8));
      }
      lastFacing = facing;
      body.rotation.z = turnLean;

      /* The acting after a stop fades in over the gait and out again. */
      let acting = 0;

      if (reaction) {
        reactionTime += delta;

        const length = reaction.getClip().duration;

        acting = Math.max(0, Math.min(1, reactionTime / 0.15, (length - reactionTime) / 0.3));
        reaction.setEffectiveWeight(acting);
        if (reactionTime >= length) {
          reaction.stop();
          reaction = null;
          acting = 0;
        }
      }

      const moving = Math.min(1, easedSpeed / 1.2);
      const running = Math.max(0, Math.min(1, (easedSpeed - 2.5) / 3));
      const rest = 1 - acting;

      idle?.setEffectiveWeight((1 - moving) * rest);
      walk?.setEffectiveWeight(moving * (1 - running) * rest);
      run?.setEffectiveWeight(moving * running * rest);
      /* Playback paced to the ground speed, so the feet grip the pavement. */
      walk?.setEffectiveTimeScale(Math.max(0.6, Math.min(1.8, easedSpeed / WALK_CLIP_SPEED)));
      run?.setEffectiveTimeScale(Math.max(0.7, Math.min(2, easedSpeed / RUN_CLIP_SPEED)));

      mixer.update(delta);
    },
    dispose: () => {
      disposed = true;
      mixer?.stopAllAction();
      standIn?.dispose();
      disposables.forEach((item) => item.dispose());
      root.clear();
    },
  };
}
