import * as THREE from "three";

import { insideHouse } from "./rooms";
import { createAvatar } from "@/lib/palace/avatar";
import type { PalaceLayout } from "@/lib/palace/layout";
import {
  cameraPosition,
  clampCameraDistance,
  clampPitch,
  createCharacter,
  nearestStation,
  stepCharacter,
  type CharacterState,
} from "@/lib/palace/movement";
import { buildCity, createLighting, type StationVisual } from "@/lib/palace/world";

/**
 * The loop: input in, a frame out.
 *
 * React owns the HUD and everything that touches the database; this owns the
 * canvas and nothing else. They meet at two narrow places — the methods on the
 * returned game, and the callbacks it fires when the player walks up to a card
 * or crosses into another district. Keeping the boundary that thin is what
 * stops a re-render costing a dropped frame: nothing here re-renders anything.
 */

export type PalaceSnapshot = {
  x: number;
  z: number;
  facing: number;
  cameraYaw: number;
  districtIndex: number;
  nearStationId: string | null;
};

export type PalaceGame = {
  /** Stick or WASD, each axis in [-1, 1]. */
  setMove: (forward: number, right: number) => void;
  /** Drag or mouse look, in pixels. */
  look: (deltaX: number, deltaY: number) => void;
  markCollected: (stationId: string) => void;
  relocateStation: (station: PalaceLayout["stations"][number]) => void;
  /**
   * Done with the card that is open: the player can walk again, and this
   * station will not re-open until they have stepped away from it.
   */
  releaseStation: () => void;
  /** Freeze movement while an overlay is open or the page is hidden. */
  setPaused: (paused: boolean) => void;
  resize: () => void;
  snapshot: () => PalaceSnapshot;
  dispose: () => void;
};

/**
 * How close you have to stand for a station to open its study screen. Wide
 * enough that walking up to the front door counts as arriving, since that is
 * what a player aims at rather than the token on the path.
 */
export const STATION_REACH = 1.8;
const LOOK_SENSITIVITY = 0.0042;
/** How far behind the character the camera rides when nothing is in the way. */
const CAMERA_DISTANCE = 8.4;
/** Closer on a phone, where the same distance leaves the character tiny. */
const CAMERA_DISTANCE_PORTRAIT = 7;

export function createPalaceGame({
  canvas,
  layout,
  collectedIds,
  onNearStation,
  onFrame,
  onContextLost,
}: {
  canvas: HTMLCanvasElement;
  layout: PalaceLayout;
  collectedIds: readonly string[];
  /** Fires when the card under the player's nose changes, id or null. */
  onNearStation: (stationId: string | null) => void;
  /** Once a frame, for the minimap and the district name. */
  onFrame: (snapshot: PalaceSnapshot) => void;
  /** The GPU took the context back; the canvas has to be rebuilt from scratch. */
  onContextLost: () => void;
}): PalaceGame {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });

  /*
   * A phone renders this at its own pixel ratio and then draws a shadow pass on
   * top of it. Two-times on a 3x screen is a lot of fragments for a town made
   * of flat colours, and the difference is invisible at that pixel density —
   * so phones get 1.5 and desktops keep 2.
   */
  const onAPhone = window.innerWidth < 900;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, onAPhone ? 1.5 : 2));
  /*
   * Shadows are most of what makes the town read as solid rather than as
   * coloured paper, so they are on everywhere — but the map is sized to the
   * device, because a phone drawing 2048² of shadow every frame is a phone
   * getting warm for no visible gain at that screen size.
   */
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, 1, 0.5, 720);
  const lighting = createLighting(scene, onAPhone ? 1024 : 2048);
  const city = buildCity(layout);
  const avatar = createAvatar();

  scene.add(city.group, avatar.root);
  lighting.follow(layout.spawn.x, layout.spawn.z);

  const collected = new Set(collectedIds);
  const collectionPulses = new Map<string, number>();

  /*
   * A collected station keeps its ring, faded: the marks on the ground are the
   * route through the neighbourhood, and rubbing them out as you go would take
   * the walk with them.
   */
  const markVisualCollected = (visual: StationVisual) => {
    visual.collected = true;
    visual.token.visible = false;

    const ringMaterial = (visual.ring as THREE.Mesh).material as THREE.MeshBasicMaterial;

    ringMaterial.opacity = 0.18;
  };

  city.stations.forEach((visual) => {
    if (collected.has(visual.station.id)) {
      markVisualCollected(visual);
    }
  });

  let character: CharacterState = createCharacter(layout.spawn.x, layout.spawn.z, layout.spawn.yaw);
  let cameraYaw = layout.spawn.yaw;
  /* A little above the eaves: low enough to feel like a street, high enough
     that the camera does not spend its life inside somebody's roof. */
  let cameraPitch = 0.3;
  const cameraTarget = new THREE.Vector3();
  const move = { forward: 0, right: 0 };
  let paused = false;
  let nearStationId: string | null = null;
  /*
   * Walking up to a card stops you: reading and steering at the same time is
   * how you end up reading the answer from inside a wall. The station stays
   * suppressed after you are done with it until you have walked out of its
   * reach, so it does not re-open under your feet.
   */
  let interacting = false;
  let suppressedStationId: string | null = null;
  let districtIndex = 0;
  let frame = 0;
  let lastTime = 0;
  let districtRefreshAt = 0;
  let portrait = false;

  const resize = () => {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;

    if (width === 0 || height === 0) return;

    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    /*
     * A phone held upright sees a tall, narrow slice of the world. Widening the
     * lens puts the street back on screen, but only so far: past about seventy
     * degrees the near half of the frame is all road, so the camera comes in
     * closer instead (see `cameraDistance`).
     */
    portrait = camera.aspect < 1;
    camera.fov = portrait ? 66 : 58;
    camera.updateProjectionMatrix();
    /*
     * Draw immediately rather than waiting for the loop: a canvas that was
     * measured at zero — mounted mid-transition, or in a tab the browser is not
     * animating — would otherwise stay blank until something else moved.
     */
    renderer.render(scene, camera);
  };

  resize();

  /*
   * The canvas changes size for reasons no `resize` event reports: the phone's
   * address bar sliding away, a rotation, the sheet above it opening.
   */
  const resizeObserver = new ResizeObserver(() => resize());

  resizeObserver.observe(canvas);

  /*
   * One frame straight away, before the loop starts: the city should be on
   * screen the moment the canvas is, rather than after a first animation frame
   * that a just-opened or briefly-hidden tab may be slow to hand out.
   */
  avatar.root.position.set(character.x, character.y, character.z);
  avatar.root.rotation.y = character.facing;

  const spawnCamera = cameraPosition({
    target: { x: character.x, y: character.y + 0.9, z: character.z },
    yaw: cameraYaw,
    pitch: cameraPitch,
    distance: clampCameraDistance({
      target: { x: character.x, y: character.y + 0.9, z: character.z },
      yaw: cameraYaw,
      pitch: cameraPitch,
      maxDistance: CAMERA_DISTANCE,
      colliders: city.colliders,
    }),
  });

  camera.position.set(spawnCamera.x, Math.max(spawnCamera.y, 1.2), spawnCamera.z);
  camera.lookAt(character.x, character.y + 1.6, character.z);
  renderer.render(scene, camera);

  const currentDistrict = () => {
    let closest = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    layout.districts.forEach((district) => {
      const distance = Math.hypot(district.center.x - character.x, district.center.z - character.z);

      if (distance < closestDistance) {
        closest = district.index;
        closestDistance = distance;
      }
    });

    return closest;
  };

  const keysDown = new Set<string>();

  const readKeyboard = () => {
    const forward = (keysDown.has("KeyW") || keysDown.has("ArrowUp") ? 1 : 0) -
      (keysDown.has("KeyS") || keysDown.has("ArrowDown") ? 1 : 0);
    const right = (keysDown.has("KeyD") || keysDown.has("ArrowRight") ? 1 : 0) -
      (keysDown.has("KeyA") || keysDown.has("ArrowLeft") ? 1 : 0);

    return { forward, right };
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (paused || interacting || (event.target instanceof HTMLElement &&
      (event.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)))) return;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) event.preventDefault();
    if (event.repeat) return;

    keysDown.add(event.code);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    keysDown.delete(event.code);
  };

  const clearInput = () => { keysDown.clear(); move.forward = 0; move.right = 0; };
  window.addEventListener("blur", clearInput);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  /*
   * A phone that backgrounds the app, or a laptop that switches GPU, can take
   * the drawing context away. Left alone that is a permanently blank canvas, so
   * the default is cancelled — which is what makes a restore possible at all —
   * and the owner is told to build a fresh one.
   */
  const onWebglContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(frame);
    onContextLost();
  };

  canvas.addEventListener("webglcontextlost", onWebglContextLost);

  const tick = (time: number) => {
    frame = requestAnimationFrame(tick);

    if (paused) {
      lastTime = time;

      return;
    }

    /* A tab that was in the background comes back with a huge gap; cap it. */
    const delta = Math.min(0.05, lastTime ? (time - lastTime) / 1000 : 0.016);

    lastTime = time;

    const keyboard = readKeyboard();
    const input = interacting
      ? { forward: 0, right: 0, jump: false, sprint: false }
      : {
          forward: Math.max(-1, Math.min(1, move.forward + keyboard.forward)),
          right: Math.max(-1, Math.min(1, move.right + keyboard.right)),
          /*
           * There is nothing in a town to jump onto, and a jump control is one
           * more thing to explain — so the walk is a walk. The controller still
           * integrates the fall, which is what keeps the character on the
           * ground over the kerbs.
           */
          jump: false,
          sprint: keysDown.has("ShiftLeft") || keysDown.has("ShiftRight"),
        };

    character = stepCharacter({
      state: character,
      input,
      cameraYaw,
      colliders: city.colliders,
      bounds: layout.bounds,
      delta,
    });

    avatar.root.position.set(character.x, character.y, character.z);
    avatar.root.rotation.y = character.facing;
    avatar.update(character.speed, !character.grounded, delta);
    lighting.follow(character.x, character.z);

    const eye = { x: character.x, y: character.y + 0.9, z: character.z };
    const indoors = layout.houses.some((house) => insideHouse(character, house));
    const activePitch = indoors ? Math.max(0.08, Math.min(cameraPitch, 0.42)) : cameraPitch;
    const distance = clampCameraDistance({
      target: eye,
      yaw: cameraYaw,
      pitch: activePitch,
      maxDistance: indoors ? 4 : portrait ? CAMERA_DISTANCE_PORTRAIT : CAMERA_DISTANCE,
      colliders: city.colliders,
    });
    const desired = cameraPosition({ target: eye, yaw: cameraYaw, pitch: activePitch, distance });

    /* The camera trails rather than tracks, which is what makes running feel fast. */
    cameraTarget.set(desired.x, Math.max(desired.y, 1.2), desired.z);
    // A wall can move closer faster than an eased camera; snap inward to avoid
    // crossing its face while keeping the character visible in third person.
    camera.position.lerp(cameraTarget, indoors || reducedMotion ? 1 : 1 - Math.pow(0.0025, delta));
    camera.lookAt(eye.x, eye.y + 0.7 + (indoors ? 0 : Math.max(0, -activePitch) * 8), eye.z);

    const seconds = time / 1000;

    city.stations.forEach((visual) => {
      if (visual.collected) {
        const started = collectionPulses.get(visual.station.id);
        if (started !== undefined) {
          const progress = Math.min(1, (time - started) / 550);
          visual.ring.scale.setScalar(1 + Math.sin(progress * Math.PI) * .7);
          (visual.ring.material as THREE.MeshBasicMaterial).opacity = .18 + (1 - progress) * .65;
          if (progress === 1) collectionPulses.delete(visual.station.id);
        }
        return;
      }

      /*
       * A sprite always faces the camera, so there is nothing to spin: the
       * mascot bobs instead, each one out of step with its neighbours so a
       * plaza does not pulse as one.
       */
      visual.token.position.y = 1.65 + (reducedMotion ? 0 : Math.sin(seconds * 2 + visual.station.index) * 0.1);
    });

    if (time > districtRefreshAt) {
      districtRefreshAt = time + 260;
      districtIndex = currentDistrict();
    }

    /*
     * While a station is open nothing else is looked for: the screen in front
     * of the learner stays until they close it. Collecting a card used to take
     * the panel with it, which meant a right answer's explanation was on screen
     * for exactly as long as it took to read the first word.
     */
    if (!interacting) {
      const near = nearestStation(
        character,
        city.stations
          .filter((visual) => !visual.collected && visual.station.id !== suppressedStationId &&
            (visual.station.placement === "outside" || insideHouse(character, layout.houses[visual.station.houseIndex])))
          .map((visual) => visual.station),
        STATION_REACH,
      );

      if (suppressedStationId) {
        const suppressed = city.stations.find(
          (visual) => visual.station.id === suppressedStationId,
        );

        if (
          !suppressed ||
          Math.hypot(suppressed.station.x - character.x, suppressed.station.z - character.z) >
            STATION_REACH + 1
        ) {
          suppressedStationId = null;
        }
      }

      if ((near?.id ?? null) !== nearStationId) {
        nearStationId = near?.id ?? null;
        interacting = nearStationId !== null;
        if (interacting) clearInput();
        onNearStation(nearStationId);
      }
    }

    onFrame(snapshot());

    renderer.render(scene, camera);
  };

  const snapshot = (): PalaceSnapshot => ({
    x: character.x, z: character.z, facing: character.facing, cameraYaw, districtIndex, nearStationId,
  });

  frame = requestAnimationFrame(tick);

  const findVisual = (stationId: string): StationVisual | undefined =>
    city.stations.find((visual) => visual.station.id === stationId);


  return {
    setMove: (forward, right) => {
      move.forward = forward;
      move.right = right;
    },
    look: (deltaX, deltaY) => {
      cameraYaw -= deltaX * LOOK_SENSITIVITY;
      cameraPitch = clampPitch(cameraPitch + deltaY * LOOK_SENSITIVITY);
    },
    markCollected: (stationId) => {
      const visual = findVisual(stationId);

      if (!visual || visual.collected) return;

      collected.add(stationId);
      markVisualCollected(visual);
    },
    relocateStation: (station) => {
      const visual = findVisual(station.id);
      if (!visual || visual.collected) return;
      visual.station = station;
      visual.token.position.set(station.x, 1.65, station.z);
      visual.ring.position.set(station.x, 0.11, station.z);
      visual.plaque.position.set(station.x, 0.4, station.z + 0.61);
      visual.plaque.rotation.y = 0;
    },
    releaseStation: () => {
      if (nearStationId && collected.has(nearStationId) && !reducedMotion) {
        collectionPulses.set(nearStationId, performance.now());
      }
      suppressedStationId = nearStationId ?? suppressedStationId;
      nearStationId = null;
      interacting = false;
      onNearStation(null);
    },
    setPaused: (value) => {
      paused = value;
      if (value) clearInput();

      if (!value) {
        lastTime = 0;
      }
    },
    resize,
    snapshot,
    dispose: () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onWebglContextLost);
      window.removeEventListener("blur", clearInput);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      lighting.dispose();
      avatar.dispose();
      city.dispose();
      scene.clear();
      renderer.dispose();
    },
  };
}
