import * as THREE from "three";

import { insideHouse, roomPoint, UPPER_FLOOR_Y } from "./rooms";
import { alongPath, guidePath } from "./guide";
import { createStationLabel } from "./labels";
import { buildingProfile, LOBBY_HEIGHT } from "./architecture";
import { createAvatar } from "@/lib/palace/avatar";
import { STATION_HUE, type PalaceLayout } from "@/lib/palace/layout";
import {
  cameraPosition,
  clampCameraDistance,
  clampPitch,
  createCharacter,
  nearestStation,
  resolveCollision,
  stepCharacter,
  CHARACTER_RADIUS,
  type CharacterState,
} from "@/lib/palace/movement";
import { createLighting, UNOCCLUDED_LAYER } from "@/lib/palace/atmosphere";
import { createPostProcessing, type PostProcessing } from "@/lib/palace/post";
import { buildCity, type StationVisual } from "@/lib/palace/world";
import { createTraffic } from "@/lib/palace/traffic";
import { createCrowd } from "@/lib/palace/crowd";

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
  /** A right answer: the stop is done, and `label` (its question) goes on a sign over it. */
  markCollected: (stationId: string, label?: string) => void;
  /** Where the trail on the pavement leads: a stop picked on the map, or null for the next in route order. */
  setGuideTarget: (stationId: string | null) => void;
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
  labels = {},
  onNearStation,
  onFrame,
  onContextLost,
}: {
  canvas: HTMLCanvasElement;
  layout: PalaceLayout;
  collectedIds: readonly string[];
  /** The question stored at each collected stop, for the sign over it. */
  labels?: Readonly<Record<string, string>>;
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
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(64, 1, 0.5, 720);
  camera.layers.enable(UNOCCLUDED_LAYER);
  const lighting = createLighting(scene, renderer, onAPhone ? 1024 : 2048);
  const city = buildCity(layout);
  const avatar = createAvatar();

  /*
   * The town's life: cars on the streets and people on the pavements. Fewer
   * of each on a phone, where every figure is another few dozen draws.
   */
  const traffic = createTraffic(layout, onAPhone ? 5 : 9);
  const crowd = createCrowd(layout, onAPhone ? 4 : 10);

  scene.add(city.group, avatar.root, avatar.effects, traffic.group, crowd.group);
  /* Passers-by cast no shadow and are left out of the occlusion pass: they move, and they are many. */
  crowd.group.traverse((object) => object.layers.set(UNOCCLUDED_LAYER));
  lighting.follow(layout.spawn.x, layout.spawn.z);

  /*
   * The finishing pass (occlusion, grade) is for screens with a GPU to spare. A
   * phone draws straight to the canvas; so does a desktop that turns out not to
   * keep up — see `watchFrameRate` below.
   */
  let post: PostProcessing | null = null;

  if (!onAPhone) {
    try {
      post = createPostProcessing(renderer, scene, camera);
    } catch {
      post = null;
    }
  }

  const draw = () => {
    if (post) post.render();
    else renderer.render(scene, camera);
  };

  /*
   * A laptop on battery can take the post pass and still drop to twenty frames
   * a second, and a walk that stutters is worse than one without shading in
   * the corners. So the frame time is watched for the first stretch of play and
   * the pass is dropped for good if it is not keeping up.
   */
  const frameTimes: number[] = [];
  const watchFrameRate = (milliseconds: number) => {
    if (!post || milliseconds <= 0 || milliseconds > 250) return;
    frameTimes.push(milliseconds);
    if (frameTimes.length < 90) return;
    const average = frameTimes.reduce((sum, value) => sum + value, 0) / frameTimes.length;
    frameTimes.length = 0;
    if (average > 26) {
      post.dispose();
      post = null;
    }
  };

  const collected = new Set(collectedIds);
  /* Stops answered wrongly since they opened: a relocation is a miss. */
  const missedStationIds = new Set<string>();
  const collectionPulses = new Map<string, number>();

  /*
   * A collected station keeps its ring, faded: the marks on the ground are the
   * route through the neighbourhood, and rubbing them out as you go would take
   * the walk with them.
   */
  const signs = new Map<string, ReturnType<typeof createStationLabel>>();
  const markVisualCollected = (visual: StationVisual, label?: string) => {
    visual.collected = true;
    visual.token.visible = false;
    visual.beacon.visible = false;

    const ringMaterial = (visual.ring as THREE.Mesh).material as THREE.MeshBasicMaterial;

    ringMaterial.opacity = 0.18;

    if (label && !signs.has(visual.station.id)) {
      const sign = createStationLabel(label, STATION_HUE[visual.station.kind]);

      sign.sprite.position.set(visual.station.x, (visual.station.y ?? 0) + 2.1, visual.station.z);
      sign.sprite.layers.set(UNOCCLUDED_LAYER);
      sign.sprite.visible = false;
      scene.add(sign.sprite);
      signs.set(visual.station.id, sign);
    }
  };

  city.stations.forEach((visual) => {
    if (collected.has(visual.station.id)) {
      markVisualCollected(visual, labels[visual.station.id]);
    }
  });

  /*
   * The trail: chevrons on the pavement leading to the next stop, flowing the
   * way to go. The next stop is the one picked on the map, or else the lowest
   * number not yet collected — a memory palace is walked in order.
   */
  const chevronShape = new THREE.Shape();

  chevronShape.moveTo(0, 0.42);
  chevronShape.lineTo(0.42, -0.1);
  chevronShape.lineTo(0.24, -0.1);
  chevronShape.lineTo(0, 0.18);
  chevronShape.lineTo(-0.24, -0.1);
  chevronShape.lineTo(-0.42, -0.1);
  chevronShape.closePath();

  const chevronGeometry = new THREE.ShapeGeometry(chevronShape);

  /* Lying flat, pointing along +z. */
  chevronGeometry.rotateX(Math.PI / 2);

  const chevronMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const GUIDE_MARKS = 36;
  const GUIDE_SPACING = 1.7;
  const trail = new THREE.InstancedMesh(chevronGeometry, chevronMaterial, GUIDE_MARKS);

  trail.frustumCulled = false;
  trail.renderOrder = 3;
  trail.count = 0;
  trail.layers.set(UNOCCLUDED_LAYER);
  scene.add(trail);

  let guideTargetId: string | null = null;
  let guidePathPoints: { x: number; z: number }[] = [];
  let guideRefreshAt = 0;
  const trailMatrix = new THREE.Matrix4();
  const trailQuaternion = new THREE.Quaternion();
  const trailScale = new THREE.Vector3();
  const trailPosition = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);

  const guideTarget = () => {
    const picked = guideTargetId ? city.stations.find((visual) => visual.station.id === guideTargetId && !visual.collected) : undefined;

    if (picked) return picked;

    return city.stations
      .filter((visual) => !visual.collected)
      .reduce<StationVisual | undefined>((first, visual) => (!first || visual.station.index < first.station.index ? visual : first), undefined);
  };

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
    post?.setSize(width, height);
    /*
     * Draw immediately rather than waiting for the loop: a canvas that was
     * measured at zero — mounted mid-transition, or in a tab the browser is not
     * animating — would otherwise stay blank until something else moved.
     */
    draw();
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
  lighting.update(0, camera);
  draw();

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

    if (lastTime) watchFrameRate(time - lastTime);

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
      surfaces: city.surfaces,
      bounds: layout.bounds,
      delta,
    });

    /* The moving things: the cars stop for people, the people wait for the player. */
    const view = { x: Math.sin(cameraYaw), z: Math.cos(cameraYaw) };

    crowd.update(delta, character, view);
    traffic.update(delta, [character, ...crowd.colliders], view);
    if (character.y < 0.5) {
      let position = { x: character.x, z: character.z };

      for (const moving of [...traffic.colliders, ...crowd.colliders]) position = resolveCollision(position, moving, CHARACTER_RADIUS);
      character = { ...character, ...position };
    }

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
      minDistance: indoors ? 0.7 : 3,
      colliders: city.colliders,
    });
    const desired = cameraPosition({ target: eye, yaw: cameraYaw, pitch: activePitch, distance });

    /* The camera trails rather than tracks, which is what makes running feel fast. */
    /*
     * Indoors the camera stays under the ceiling of the floor you are on — the
     * gallery's underside downstairs, the room's ceiling upstairs — blending
     * between the two as you climb, so it never looks down through a floor.
     */
    const climbed = Math.max(0, Math.min(1, character.y / UPPER_FLOOR_Y));
    const ceiling = indoors
      ? UPPER_FLOOR_Y - 0.35 + climbed * (LOBBY_HEIGHT - 0.6 - (UPPER_FLOOR_Y - 0.35))
      : Number.POSITIVE_INFINITY;

    cameraTarget.set(desired.x, Math.min(ceiling, Math.max(desired.y, character.y + 1.2)), desired.z);

    /*
     * Indoors the camera can sit a hand's breadth from a wall, and a near plane
     * sized for streets would slice through it and show the pavement outside.
     * Outdoors it goes back out, where depth precision on the road paint matters.
     */
    const near = indoors ? 0.12 : 0.5;

    if (camera.near !== near) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    // A wall can move closer faster than an eased camera; snap inward to avoid
    // crossing its face while keeping the character visible in third person.
    camera.position.lerp(cameraTarget, indoors || reducedMotion ? 1 : 1 - Math.pow(0.0025, delta));
    camera.lookAt(eye.x, eye.y + 0.7 + (indoors ? 0 : Math.max(0, -activePitch) * 8), eye.z);

    const seconds = time / 1000;

    lighting.update(reducedMotion ? 0 : seconds, camera);
    city.update(reducedMotion ? 0 : seconds);

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
      visual.token.position.y = (visual.station.y ?? 0) + 1.65 + (reducedMotion ? 0 : Math.sin(seconds * 2 + visual.station.index) * 0.1);
      /* The ring breathes with it, so a waiting stop reads as live. */
      visual.ring.scale.setScalar(reducedMotion ? 1 : 1 + Math.sin(seconds * 2.4 + visual.station.index) * 0.06);
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

    /* The trail, re-routed a few times a second and flowing every frame. */
    if (time > guideRefreshAt) {
      guideRefreshAt = time + 300;

      const target = guideTarget();

      if (!target || interacting || indoors || character.y > 0.5) {
        guidePathPoints = [];
      } else {
        const station = target.station;
        const house = layout.houses[station.houseIndex];
        /* For a stop indoors, the way to its door. */
        const goal = station.placement === "inside" && house
          ? roomPoint(house, 0, house.depth / 2 + 2.5)
          : { x: station.x, z: station.z };

        guidePathPoints = Math.hypot(goal.x - character.x, goal.z - character.z) < 7 ? [] : guidePath(layout, character, goal);
        chevronMaterial.color.setHSL(STATION_HUE[station.kind] / 360, 0.95, 0.5);
      }
    }

    if (guidePathPoints.length > 1) {
      const flow = reducedMotion ? 0 : (seconds * 2.2) % GUIDE_SPACING;
      const marks = alongPath(guidePathPoints, GUIDE_SPACING, 1.6 + flow, GUIDE_MARKS);

      marks.forEach((mark, index) => {
        const fade = 1.5 * Math.max(0.4, 1 - index / GUIDE_MARKS);

        trailQuaternion.setFromAxisAngle(up, mark.heading);
        trailScale.setScalar(fade);
        trailPosition.set(mark.x, 0.07, mark.z);
        trailMatrix.compose(trailPosition, trailQuaternion, trailScale);
        trail.setMatrixAt(index, trailMatrix);
      });
      trail.count = marks.length;
      trail.instanceMatrix.needsUpdate = true;
    } else {
      trail.count = 0;
    }

    /* Signs show up close, where they can be read. */
    signs.forEach((sign) => {
      sign.sprite.visible =
        Math.abs(sign.sprite.position.y - 2.1 - character.y) < 1.5 &&
        Math.hypot(sign.sprite.position.x - character.x, sign.sprite.position.z - character.z) < 26;
    });

    onFrame(snapshot());

    draw();
  };

  const snapshot = (): PalaceSnapshot => ({
    x: character.x, z: character.z, facing: character.facing, cameraYaw, districtIndex, nearStationId,
  });

  frame = requestAnimationFrame(tick);

  /*
   * Local QA only: a way to stand anywhere in the town from the console or a
   * screenshot script, since walking to the far side of a sixty-stop town is
   * two minutes a check. Never present in a production build.
   */
  const debugWindow = window as unknown as { __memoPalace?: unknown };

  if (process.env.NODE_ENV === "development") {
    debugWindow.__memoPalace = {
      layout,
      /* Draws and triangles in the last frame, for comparing the cost of a change. */
      stats: () => ({ ...renderer.info.render, post: Boolean(post) }),
      scene,
      people: () => crowd.colliders.map(({ x, z }) => ({ x, z })),
      cars: () => traffic.colliders.map(({ x, z }) => ({ x, z })),
      houses: layout.houses.map((house, index) => ({ ...house, kind: buildingProfile(house, index).kind })),
      teleport: (x: number, z: number, yaw: number, pitch?: number) => {
        character = createCharacter(x, z, yaw);
        cameraYaw = yaw;
        if (pitch !== undefined) cameraPitch = clampPitch(pitch);
        camera.position.set(x - Math.sin(yaw) * 8, 5, z - Math.cos(yaw) * 8);
      },
    };
  }

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
    markCollected: (stationId, label) => {
      const visual = findVisual(stationId);

      if (!visual || visual.collected) return;

      collected.add(stationId);
      markVisualCollected(visual, label);
      guideRefreshAt = 0;
    },
    setGuideTarget: (stationId) => {
      guideTargetId = stationId;
      guideRefreshAt = 0;
    },
    relocateStation: (station) => {
      const visual = findVisual(station.id);
      if (!visual || visual.collected) return;
      missedStationIds.add(station.id);
      visual.station = station;
      visual.token.position.set(station.x, (station.y ?? 0) + 1.65, station.z);
      visual.ring.position.set(station.x, (station.y ?? 0) + 0.11, station.z);
      visual.plaque.position.set(station.x, 0.4, station.z + 0.61);
      visual.plaque.rotation.y = 0;
      visual.beacon.position.set(station.x, station.y ?? 0, station.z);
    },
    releaseStation: () => {
      if (nearStationId && collected.has(nearStationId) && !reducedMotion) {
        collectionPulses.set(nearStationId, performance.now());
      }
      /* The walker acts out how it went, as the card goes: a cheer or a shrug. */
      if (nearStationId && !reducedMotion) {
        if (collected.has(nearStationId)) avatar.react("cheer");
        else if (missedStationIds.has(nearStationId)) avatar.react("miss");
      }
      if (nearStationId) missedStationIds.delete(nearStationId);
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
      delete debugWindow.__memoPalace;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      canvas.removeEventListener("webglcontextlost", onWebglContextLost);
      window.removeEventListener("blur", clearInput);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      post?.dispose();
      signs.forEach((sign) => sign.dispose());
      chevronGeometry.dispose();
      chevronMaterial.dispose();
      trail.dispose();
      traffic.dispose();
      crowd.dispose();
      lighting.dispose();
      avatar.dispose();
      city.dispose();
      scene.clear();
      renderer.dispose();
    },
  };
}
