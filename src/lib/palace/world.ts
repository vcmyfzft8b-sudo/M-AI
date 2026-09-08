import * as THREE from "three";
import {
  carBodyGeometry,
  carCabinGeometry,
  carRoofGeometry,
  carFrameGeometry,
  palmFrondGeometry,
} from "./scenery";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  cityBuilding,
  buildingProfile,
  LOBBY_HEIGHT,
  ENTRY_HEIGHT,
  type CityPart,
} from "./architecture";
import { pyramidRoofGeometry } from "./roof-geometry";
import { marinaBarriers } from "./landmarks";
import { terrainHeight } from "./terrain";
import {
  roomIdentity,
  roomPoint,
  roomWalls,
  roomFurniture,
  outdoorFurniture,
  ROOM_DOOR_WIDTH,
} from "./rooms";
import { createSurfaceMaterial } from "./materials";

import {
  STATION_HUE,
  type PalaceHouse,
  type PalaceLayout,
  type PalaceProp,
  type PalaceStation,
} from "@/lib/palace/layout";
import type { Collider } from "@/lib/palace/movement";

/**
 * The town, in geometry.
 *
 * Houses and landmarks use instanced geometry and one shared surface atlas.
 * Every house is assembled from the deterministic layout, keeping the town
 * repeatable and the rendering cost bounded on phones.
 *
 * The variety is the feature, not decoration. A memory palace only works if the
 * places are worth remembering, so no two houses on a street are alike: roofs
 * differ, storeys differ, and the ones with something waiting outside them are
 * built as landmarks — taller, a spire or a dome, a flag on top.
 */

/** Memo's mascot, already served for the app icon, reused as the pickup. */
const MASCOT_TEXTURE_SRC = "/memo-mascot.png";
const MASCOT_ASPECT = 320 / 288;

const GRASS_COLOR = 0x77b64b;
const ROAD_COLOR = 0x535d64;
const PAVEMENT_COLOR = 0xd3d5cd;

type Instance = { matrix: THREE.Matrix4; color?: THREE.Color };

export type StationVisual = {
  station: PalaceStation;
  token: THREE.Sprite;
  ring: THREE.Mesh;
  collected: boolean;
};

export type CityBuild = {
  group: THREE.Group;
  colliders: Collider[];
  stations: StationVisual[];
  dispose: () => void;
};

function hsl(hue: number, saturation: number, lightness: number) {
  return new THREE.Color().setHSL(
    ((((hue % 360) + 360) % 360) / 360) % 1,
    saturation,
    lightness,
  );
}

function boxMatrix({
  x,
  y,
  z,
  width,
  height,
  depth,
  rotation = 0,
  tiltX = 0,
  tiltZ = 0,
}: {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotation?: number;
  tiltX?: number;
  tiltZ?: number;
}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(tiltX, rotation, tiltZ, "YXZ"),
    ),
    new THREE.Vector3(width, height, depth),
  );
}

function flatMatrix({
  x,
  z,
  width,
  depth,
  y,
}: {
  x: number;
  z: number;
  width: number;
  depth: number;
  y: number;
}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0),
      -Math.PI / 2,
    ),
    new THREE.Vector3(width, depth, 1),
  );
}

/** One mesh for many copies of a shape — the whole town is a handful of these. */
function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: Instance[],
  { shadows = true }: { shadows?: boolean } = {},
) {
  const mesh = new THREE.InstancedMesh(
    geometry,
    material,
    Math.max(instances.length, 1),
  );

  mesh.castShadow = shadows;
  mesh.receiveShadow = true;

  instances.forEach((instance, index) => {
    mesh.setMatrixAt(index, instance.matrix);

    if (instance.color) {
      mesh.setColorAt(index, instance.color);
    }
  });

  mesh.count = instances.length;
  mesh.instanceMatrix.needsUpdate = true;

  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  mesh.frustumCulled = false;

  return mesh;
}

/**
 * A sky with some depth in it: a two-stop gradient painted into a strip and
 * wrapped round the scene, which costs one small texture and reads far better
 * than the flat blue a single background colour gives.
 */
function ribbonGeometry() {
  const positions: number[] = [];
  const point = (t: number, phase: number, side: number) => {
    const angle = t * Math.PI * 2.6 * (phase === 0 ? 1 : -1) + phase;
    return [Math.cos(angle) * 0.5, t + side * 0.018, Math.sin(angle) * 0.5];
  };
  for (const phase of [0, Math.PI])
    for (let i = 0; i < 64; i++) {
      const a = point(i / 64, phase, -1),
        b = point(i / 64, phase, 1);
      const c = point((i + 1) / 64, phase, -1),
        d = point((i + 1) / 64, phase, 1);
      positions.push(...a, ...b, ...c, ...b, ...d, ...c);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

function skyTexture() {
  const canvas = document.createElement("canvas");

  canvas.width = 8;
  canvas.height = 256;

  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);

    gradient.addColorStop(0, "#7daebf");
    gradient.addColorStop(0.45, "#a9ccd1");
    gradient.addColorStop(0.62, "#c3dadd");
    gradient.addColorStop(1, "#d4e2e1");
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }

  const texture = new THREE.CanvasTexture(canvas);

  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  return texture;
}

export type Lighting = {
  /** The sun follows the player: a shadow map only covers what is nearby. */
  follow: (x: number, z: number) => void;
  dispose: () => void;
};

export function createLighting(
  scene: THREE.Scene,
  shadowMapSize: number,
): Lighting {
  const sky = skyTexture();

  scene.background = sky;
  scene.environment = sky;
  scene.environmentIntensity = 0.45;
  /* Fog hides the edge of the world and saves the far half of the town. */
  scene.fog = new THREE.Fog(0xb9d1d5, 160, 520);

  const ambient = new THREE.HemisphereLight(0xd5eaff, 0x9daf90, 1.6);
  const sun = new THREE.DirectionalLight(0xfff5e2, 2.4);

  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.bias = -0.0006;
  /* Instanced boxes shadow-acne badly without this; it is cheaper than a bias
     large enough to hide it, which would detach every shadow from its wall. */
  sun.shadow.normalBias = 0.15;

  const shadowCamera = sun.shadow.camera;

  shadowCamera.left = -70;
  shadowCamera.right = 70;
  shadowCamera.top = 70;
  shadowCamera.bottom = -70;
  shadowCamera.near = 20;
  shadowCamera.far = 260;
  shadowCamera.updateProjectionMatrix();

  scene.add(ambient, sun, sun.target);

  return {
    follow: (x, z) => {
      /* Low in the west, so the shadows are long and the town has some relief. */
      sun.position.set(x - 78, 70, z + 52);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld();
    },
    dispose: () => {
      scene.remove(ambient, sun, sun.target);
      scene.background = null;
      scene.environment = null;
      sky.dispose();
      ambient.dispose();
      sun.dispose();
    },
  };
}

export function buildCity(layout: PalaceLayout): CityBuild {
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const disposables: { dispose: () => void }[] = [];
  const track = <Item extends { dispose: () => void }>(item: Item) => {
    disposables.push(item);

    return item;
  };

  const boxGeometry = track(new THREE.BoxGeometry(1, 1, 1));
  const planeGeometry = track(new THREE.PlaneGeometry(1, 1));
  const cylinderGeometry = track(new THREE.CylinderGeometry(0.5, 0.5, 1, 24));
  const coneGeometry = track(new THREE.ConeGeometry(0.5, 1, 8));
  const sphereGeometry = track(new THREE.SphereGeometry(0.5, 12, 10));
  const solid = (color: number) =>
    track(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
  const tinted = () => solid(0xffffff);
  const surface = (
    kind: Parameters<typeof createSurfaceMaterial>[0],
    color: number,
  ) => {
    const created = createSurfaceMaterial(kind, color);
    disposables.push(created);
    return created.material;
  };

  /* Everything box-shaped shares one mesh: walls, windows, cars, benches, bins. */
  const boxes: Instance[] = [];
  const walls: Instance[] = [];
  const woodwork: Instance[] = [];
  const glass: Instance[] = [];
  const cones: Instance[] = [];
  const cylinders: Instance[] = [];
  const spheres: Instance[] = [];
  const glassCylinders: Instance[] = [];
  const ribbons: Instance[] = [];
  const gables: Instance[] = [], pyramids: Instance[] = [], bows: Instance[] = [], domes: Instance[] = [], sails: Instance[] = [], water: Instance[] = [];
  const rings: Instance[] = [];
  const palmLeaves: Instance[] = [];
  const carBodies: Instance[] = [],
    carCabins: Instance[] = [],
    carRoofs: Instance[] = [];
  const roundedBuildings: Instance[] = [],
    roundedGlazing: Instance[] = [];
  const carTrim: Instance[] = [],
    tyres: Instance[] = [];
  const autoBody = track(carBodyGeometry()),
    autoCabin = track(carCabinGeometry()),
    autoRoof = track(carRoofGeometry()),
    autoFrame = track(carFrameGeometry());
  const roundedGeometry = track(new RoundedBoxGeometry(1, 1, 1, 2, 0.16));
  const cityRibbonGeometry = track(ribbonGeometry());
  const cityRingGeometry = track(
    new THREE.CylinderGeometry(0.5, 0.5, 1, 32, 1, true),
  );
  const cityLeafGeometry = track(palmFrondGeometry());
  const triangle = new THREE.Shape();
  triangle.moveTo(-.5,-.5); triangle.lineTo(.5,-.5); triangle.lineTo(0,.5); triangle.closePath();
  const gableGeometry = track(new THREE.ExtrudeGeometry(triangle,{depth:1,bevelEnabled:false}));
  gableGeometry.translate(0,0,-.5);
  const pyramidGeometry = track(pyramidRoofGeometry());
  const sailTriangle = new THREE.Shape();
  sailTriangle.moveTo(-.5,-.5); sailTriangle.lineTo(.5,-.5); sailTriangle.lineTo(-.5,.5); sailTriangle.closePath();
  const sailGeometry = track(new THREE.ExtrudeGeometry(sailTriangle,{depth:1,bevelEnabled:false}));
  sailGeometry.translate(0,0,-.5);
  const bowGeometry = track(gableGeometry.clone());
  bowGeometry.rotateX(-Math.PI/2);
  const domeGeometry = track(new THREE.SphereGeometry(.5,24,12,0,Math.PI*2,0,Math.PI/2));
  domeGeometry.scale(1,2,1);
  const addCityPart = (part: CityPart, house: PalaceHouse) => {
    const position = roomPoint(house, part.x, part.z);
    const entries = part.surface === "wood" ? woodwork
      : part.surface === "stone" ? walls
      : part.surface === "water" ? water
      : part.shape === "gable" ? gables
      : part.shape === "pyramid" ? pyramids
      : part.shape === "bow" ? bows
      : part.shape === "dome" ? domes
      : part.shape === "sail" ? sails
      : part.shape === "cone" ? cones
      : part.shape === "rounded" ? (part.glass ? roundedGlazing : roundedBuildings)
      : part.shape === "ribbon" ? ribbons
      : part.shape === "ring" ? rings
      : part.shape === "sphere" ? spheres
      : part.shape === "cylinder" ? (part.glass ? glassCylinders : cylinders)
      : part.glass ? glass : boxes;
    entries.push({
      matrix: boxMatrix({
        ...part,
        ...position,
        rotation: house.facing + (part.rotation ?? 0),
      }),
      color: new THREE.Color(part.color),
    });
  };

  /* Ground, footpaths, tarmac, paint — flat planes, stacked in that order. */
  const terrainGeometry = track(
    new THREE.PlaneGeometry(layout.bounds * 8, layout.bounds * 8, 96, 96),
  );
  const terrainPositions = terrainGeometry.getAttribute("position");
  const terrainColors: number[] = [];
  for (let vertex = 0; vertex < terrainPositions.count; vertex++) {
    const x = terrainPositions.getX(vertex),
      z = -terrainPositions.getY(vertex);
    const height = terrainHeight(x, z, layout.bounds);
    terrainPositions.setZ(vertex, height);
    const shade = new THREE.Color().setHSL(
      0.26,
      0.16,
      0.84 - Math.min(0.14, height * 0.003),
    );
    terrainColors.push(shade.r, shade.g, shade.b);
  }
  terrainGeometry.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(terrainColors, 3),
  );
  terrainGeometry.computeVertexNormals();
  const terrainMaterial = surface("grass", GRASS_COLOR);
  terrainMaterial.vertexColors = true;
  const ground = new THREE.Mesh(terrainGeometry, terrainMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  group.add(
    instanced(
      planeGeometry,
      surface("stone", PAVEMENT_COLOR),
      layout.pavements.map((path) => ({
        matrix: flatMatrix({ ...path, y: 0.015 }),
      })),
      { shadows: false },
    ),
  );
  group.add(
    instanced(
      planeGeometry,
      surface("asphalt", ROAD_COLOR),
      layout.roads.map((road) => ({
        matrix: flatMatrix({ ...road, y: 0.02 }),
      })),
      { shadows: false },
    ),
  );
  group.add(
    instanced(
      planeGeometry,
      solid(0xf2f2f4),
      layout.roadMarks.map((mark) => ({
        matrix: flatMatrix({ ...mark, y: 0.03 }),
      })),
      { shadows: false },
    ),
  );

  const streetLines = [
    ...new Set(
      layout.roads
        .filter((road) => road.width > road.depth)
        .map((road) => road.z),
    ),
  ].sort((a, b) => a - b);
  const plazas: Instance[] = [];
  const greens: Instance[] = [];
  const plazaCenters: { x: number; z: number }[] = [];
  for (let row = 0; row < streetLines.length - 1; row++)
    for (let column = 0; column < streetLines.length - 1; column++) {
      const center = {
        x: (streetLines[column] + streetLines[column + 1]) / 2,
        z: (streetLines[row] + streetLines[row + 1]) / 2,
      };
      plazaCenters.push(center);
      plazas.push({
        matrix: flatMatrix({
          ...center,
          y: 0.025,
          width: streetLines[column + 1] - streetLines[column] - 11,
          depth: streetLines[row + 1] - streetLines[row] - 11,
        }),
      });
      for (const x of [-6, 6])
        for (const z of [-6, 6])
          greens.push({
            matrix: flatMatrix({
              x: center.x + x,
              z: center.z + z,
              y: 0.032,
              width: 4.5,
              depth: 4.5,
            }),
          });
    }
  group.add(
    instanced(planeGeometry, surface("stone", PAVEMENT_COLOR), plazas, {
      shadows: false,
    }),
  );
  group.add(
    instanced(planeGeometry, solid(GRASS_COLOR), greens, { shadows: false }),
  );

  layout.kerbs.forEach((kerb) => {
    boxes.push({
      matrix: boxMatrix({
        x: kerb.x,
        y: kerb.height / 2,
        z: kerb.z,
        width: kerb.width,
        height: kerb.height,
        depth: kerb.depth,
      }),
      color: hsl(0, 0, 0.82),
    });
  });

  /**
   * One house. `out` points at the street, `along` runs across the front, so
   * everything hung on the building is placed in the house's own terms rather
   * than the world's.
   */
  const addHouse = (house: PalaceHouse) => {
    const out = { x: Math.sin(house.facing), z: Math.cos(house.facing) };
    const along = { x: Math.cos(house.facing), z: -Math.sin(house.facing) };
    const at = (forward: number, sideways: number) => ({
      x: house.x + out.x * forward + along.x * sideways,
      z: house.z + out.z * forward + along.z * sideways,
    });
    const profile = buildingProfile(house, layout.houses.indexOf(house));
    const wall = new THREE.Color(profile.wall);
    const body = house.depth;

    const room = roomIdentity(
      house.landmark
        ? house.landmarkIndex
        : layout.stations.length + layout.houses.indexOf(house),
    );
    const addWall = (x: number, z: number, width: number, depth: number) => {
      const position = roomPoint(house, x, z);
      walls.push({
        matrix: boxMatrix({
          ...position,
          y: LOBBY_HEIGHT / 2,
          width,
          height: LOBBY_HEIGHT,
          depth,
          rotation: house.facing,
        }),
        color: wall,
      });
      const sideways = Math.abs(out.x) > 0.5;
      colliders.push({
        ...position,
        width: sideways ? depth : width,
        depth: sideways ? width : depth,
      });
    };
    if (room) {
      roomWalls(house).forEach((part) =>
        addWall(part.x, part.z, part.width, part.depth),
      );
      // Lintel above an open doorway; no ground collider across the opening.
      const lintel = at(body / 2, 0);
      walls.push({
        matrix: boxMatrix({
          ...lintel,
          y: (LOBBY_HEIGHT + ENTRY_HEIGHT) / 2,
          width: ROOM_DOOR_WIDTH,
          height: LOBBY_HEIGHT - ENTRY_HEIGHT,
          depth: 0.24,
          rotation: house.facing,
        }),
        color: wall,
      });
      woodwork.push({
        matrix: boxMatrix({
          x: house.x,
          y: 0.035,
          z: house.z,
          width: house.width,
          height: 0.07,
          depth: body,
          rotation: house.facing,
        }),
        color: hsl(32, 0.26, 0.56),
      });
      // A colored back wall and rug link the exterior address to the room.
      const accent = at(-body / 2 + 0.16, 0);
      boxes.push({
        matrix: boxMatrix({
          ...accent,
          y: (LOBBY_HEIGHT - 0.3) / 2,
          width: house.width - 0.3,
          height: LOBBY_HEIGHT - 0.3,
          depth: 0.07,
          rotation: house.facing,
        }),
        color: hsl(room.hue, room.color === "ivory" ? 0.1 : 0.32, 0.52),
      });
      const rug = at(room.anchorZ, room.anchorX);
      boxes.push({
        matrix: boxMatrix({
          ...rug,
          y: 0.085,
          width: 3.8,
          height: 0.015,
          depth: 3.4,
          rotation: house.facing,
        }),
        color: hsl(room.hue, 0.36, 0.33),
      });
      for (const side of [-1, 1]) {
        const edge = at(room.anchorZ + side * 1.5, room.anchorX);
        boxes.push({
          matrix: boxMatrix({
            ...edge,
            y: 0.095,
            width: 3.5,
            height: 0.01,
            depth: 0.055,
            rotation: house.facing,
          }),
          color: hsl(40, 0.35, 0.7),
        });
      }
      // Ceiling and trim give a real enclosed ground floor, lit by skylight ambience.
      boxes.push({
        matrix: boxMatrix({
          x: house.x,
          y: LOBBY_HEIGHT - 0.22,
          z: house.z,
          width: house.width - 0.15,
          height: 0.12,
          depth: body - 0.15,
          rotation: house.facing,
        }),
        color: hsl(38, 0.12, 0.82),
      });
      for (const part of roomFurniture(
        house,
        room,
        house.landmark &&
          layout.stations[house.landmarkIndex]?.placement === "inside",
      )) {
        const position = roomPoint(house, part.x, part.z);
        const bucket =
          part.shape === "sphere"
            ? spheres
            : part.shape === "cylinder"
              ? cylinders
              : part.shape === "cone"
                ? cones
                : part.color === 0x684837
                  ? woodwork
                  : boxes;
        bucket.push({
          matrix: boxMatrix({
            ...position,
            y: part.y,
            width: part.width,
            height: part.height,
            depth: part.depth,
            rotation: house.facing,
          }),
          color: new THREE.Color(part.color),
        });
        if (part.solid)
          colliders.push({
            ...position,
            width: Math.abs(out.x) > 0.5 ? part.depth : part.width,
            depth: Math.abs(out.x) > 0.5 ? part.width : part.depth,
          });
      }
    } else {
      addWall(0, 0, house.width, body);
    }
    if(profile.kind === "houseboat") {
      marinaBarriers(house).forEach((part) => {
        const sideways = Math.abs(Math.sin(house.facing)) > .5;
        colliders.push({...roomPoint(house,part.x,part.z),width:sideways?part.depth:part.width,depth:sideways?part.width:part.depth});
      });
    }
    cityBuilding(house, layout.houses.indexOf(house)).forEach((part) =>
      addCityPart(part, house),
    );
  };

  layout.houses.forEach(addHouse);

  /*
   * Street furniture and scenery. Anything with a trunk or a body gets a
   * collider: walking through a parked car is the sort of thing that tells you
   * a town is a backdrop rather than a place.
   */
  const solidProp = (x: number, z: number, width: number, depth: number) => {
    colliders.push({ x, z, width, depth });
  };

  const marinas = layout.houses.filter((house,index)=>buildingProfile(house,index).kind === "houseboat");
  const addProp = (prop: PalaceProp) => {
    // Keep the mooring clear of garden props originally placed on the dry plot.
    if(prop.kind !== "cloud" && prop.kind !== "hill" && marinas.some(house=>{
      const dx=prop.x-house.x,dz=prop.z-house.z;
      return Math.abs(dx*Math.cos(house.facing)-dz*Math.sin(house.facing))<house.width/2+2.4 && Math.abs(dx*Math.sin(house.facing)+dz*Math.cos(house.facing))<house.depth/2+3.5;
    })) return;
    if (prop.kind === "tree") {
      const height = (10.5 + Math.sin(prop.rotation) * 0.7) * prop.scale;
      // A tapered, gently leaning trunk with a dense crown of drooping fronds.
      const bend = 0.45 * prop.scale;
      for (let segment = 0; segment < 8; segment++) {
        const t = (segment + 0.5) / 8,
          radius = (0.38 - t * 0.16) * prop.scale;
        cylinders.push({
          matrix: boxMatrix({
            x: prop.x + bend * t * t,
            y: height * t,
            z: prop.z,
            width: radius,
            height: height / 8 + 0.035,
            depth: radius,
            tiltZ: -Math.atan2(2 * bend * t, height),
          }),
          color: hsl(29, 0.25, 0.37 + (segment % 2) * 0.04),
        });
        rings.push({
          matrix: boxMatrix({
            x: prop.x + bend * t * t,
            y: height * t,
            z: prop.z,
            width: radius + 0.025,
            height: 0.05,
            depth: radius + 0.025,
          }),
          color: hsl(29, 0.24, 0.27),
        });
      }
      const crown = { x: prop.x + bend, y: height, z: prop.z };
      for (let leaf = 0; leaf < 13; leaf++) {
        const upper = leaf >= 9,
          length = (upper ? 2.65 : 3.7 + (leaf % 3) * 0.22) * prop.scale;
        palmLeaves.push({
          matrix: boxMatrix({
            ...crown,
            width: length,
            height: length,
            depth: length,
            rotation: prop.rotation + leaf * 2.399,
            tiltZ: upper ? 0.65 : 0.05 + (leaf % 3) * 0.08,
          }),
          color: hsl(96 + (leaf % 3) * 7, 0.5, 0.31 + (leaf % 4) * 0.045),
        });
      }
      spheres.push({
        matrix: boxMatrix({
          ...crown,
          width: 0.55 * prop.scale,
          height: 0.9 * prop.scale,
          depth: 0.55 * prop.scale,
        }),
        color: hsl(88, 0.4, 0.35),
      });
      for (let nut = 0; nut < 3; nut++)
        spheres.push({
          matrix: boxMatrix({
            x: crown.x + Math.cos(nut * 2.1) * 0.22,
            y: height - 0.2,
            z: prop.z + Math.sin(nut * 2.1) * 0.22,
            width: 0.23,
            height: 0.3,
            depth: 0.23,
          }),
          color: hsl(35, 0.35, 0.28),
        });
      solidProp(prop.x + bend / 2, prop.z, 1 * prop.scale, 0.65 * prop.scale);
      return;
    }

    if (prop.kind === "car") {
      const paint = new THREE.Color(
        [0xb9ccce, 0xe2e6df, 0x4f626b, 0xe77743, 0xe6be53, 0x4798b7, 0xc1523d][
          Math.floor((prop.hue / 360) * 7) % 7
        ],
      );
      const matrix = boxMatrix({
        x: prop.x,
        y: 0,
        z: prop.z,
        width: 1,
        height: 1,
        depth: 1,
        rotation: prop.rotation,
      });
      carBodies.push({ matrix, color: paint });
      carCabins.push({ matrix, color: new THREE.Color(0x24a9d0) });
      carRoofs.push({ matrix, color: paint });
      const carAt = (x: number, z: number) => ({
        x: prop.x + Math.cos(prop.rotation) * x + Math.sin(prop.rotation) * z,
        z: prop.z - Math.sin(prop.rotation) * x + Math.cos(prop.rotation) * z,
      });
      const trim = (
        x: number,
        y: number,
        z: number,
        width: number,
        height: number,
        depth: number,
        color: THREE.Color,
        tiltZ = 0,
      ) =>
        carTrim.push({
          matrix: boxMatrix({
            ...carAt(x, z),
            y,
            width,
            height,
            depth,
            rotation: prop.rotation,
            tiltZ,
          }),
          color,
        });
      for (const axle of [-1.38, 1.35])
        for (const side of [-1, 1]) {
          const wheel = carAt(axle, side * 0.93);
          tyres.push({
            matrix: boxMatrix({
              ...wheel,
              y: 0.43,
              width: 0.83,
              height: 0.25,
              depth: 0.83,
              rotation: prop.rotation,
              tiltX: Math.PI / 2,
            }),
            color: new THREE.Color(0x202629),
          });
          const hub = carAt(axle, side * 1.065);
          cylinders.push({
            matrix: boxMatrix({
              ...hub,
              y: 0.43,
              width: 0.56,
              height: 0.035,
              depth: 0.56,
              rotation: prop.rotation,
              tiltX: Math.PI / 2,
            }),
            color: new THREE.Color(0xc6d1d1),
          });
          cylinders.push({
            matrix: boxMatrix({
              ...carAt(axle, side * 1.09),
              y: 0.43,
              width: 0.17,
              height: 0.04,
              depth: 0.17,
              rotation: prop.rotation,
              tiltX: Math.PI / 2,
            }),
            color: new THREE.Color(0x677780),
          });
          for (let spoke = 0; spoke < 5; spoke++)
            trim(
              axle,
              0.43,
              side * 1.09,
              0.46,
              0.035,
              0.025,
              new THREE.Color(0x53616a),
              (spoke * Math.PI) / 5,
            );
        }
      for (const side of [-1, 1]) {
        // Sloped pillars, a narrow door pillar and mirror pods frame the glass.
        trim(0.7, 1.2, side * 0.93, 0.3, 0.17, 0.25, paint);
        trim(
          -0.48,
          1.04,
          side * 0.94,
          0.24,
          0.045,
          0.035,
          new THREE.Color(0xd1dcdd),
        );
        trim(
          0.48,
          1.04,
          side * 0.94,
          0.24,
          0.045,
          0.035,
          new THREE.Color(0xd1dcdd),
        );
      }
      for (const end of [-1, 1]) {
        trim(end * 2.09, 0.53, 0, 0.1, 0.15, 1.35, new THREE.Color(0x56656c));
        trim(end * 2.19, 0.69, 0, 0.025, 0.19, 0.55, new THREE.Color(0xd4e0df));
        if (end === 1)
          trim(2.16, 0.83, 0, 0.05, 0.13, 0.7, new THREE.Color(0x2d3a40));
        for (const side of [-1, 1]) {
          spheres.push({
            matrix: boxMatrix({
              ...carAt(end * 2.035, side * 0.65),
              y: 0.86,
              width: 0.17,
              height: 0.29,
              depth: 0.32,
              rotation: prop.rotation,
            }),
            color: new THREE.Color(end === 1 ? 0xf4faf5 : 0xeb453e),
          });
        }
      }

      const acrossX = Math.abs(Math.cos(prop.rotation)) > 0.5;

      solidProp(prop.x, prop.z, acrossX ? 4.4 : 1.9, acrossX ? 1.9 : 4.4);

      return;
    }

    if (prop.kind === "lamp") {
      cylinders.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 3.2,
          z: prop.z,
          width: 0.13,
          height: 6.4,
          depth: 0.13,
        }),
        color: hsl(210, 0.05, 0.48),
      });
      boxes.push({
        matrix: boxMatrix({
          x: prop.x + 0.6,
          y: 6.45,
          z: prop.z,
          width: 1.35,
          height: 0.14,
          depth: 0.16,
        }),
        color: hsl(210, 0.05, 0.48),
      });
      boxes.push({
        matrix: boxMatrix({
          x: prop.x + 1.1,
          y: 6.36,
          z: prop.z,
          width: 0.75,
          height: 0.08,
          depth: 0.35,
        }),
        color: new THREE.Color(0xf3edce),
      });
      solidProp(prop.x, prop.z, 0.4, 0.4);
      return;
    }

    if (prop.kind === "bin") {
      cylinders.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 0.55,
          z: prop.z,
          width: 0.75,
          height: 1.1,
          depth: 0.75,
        }),
        color: hsl(210, 0.12, 0.36),
      });
      solidProp(prop.x, prop.z, 0.8, 0.8);

      return;
    }

    if (prop.kind === "hydrant") {
      boxes.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 0.45,
          z: prop.z,
          width: 0.5,
          height: 0.9,
          depth: 0.5,
        }),
        color: hsl(2, 0.7, 0.5),
      });

      return;
    }

    if (prop.kind === "hedge") {
      boxes.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 0.7 * prop.scale,
          z: prop.z,
          width: 4.6 * prop.scale,
          height: 1.4 * prop.scale,
          depth: 1.1 * prop.scale,
          rotation: prop.rotation,
        }),
        color: hsl(prop.hue, 0.45, 0.34),
      });

      const lengthwise = Math.abs(Math.cos(prop.rotation)) > 0.5;

      solidProp(
        prop.x,
        prop.z,
        lengthwise ? 4.6 * prop.scale : 1.1 * prop.scale,
        lengthwise ? 1.1 * prop.scale : 4.6 * prop.scale,
      );

      return;
    }

    if (prop.kind === "bench") {
      const wood = hsl(30, 0.45, 0.45);
      const length = 2.4 * prop.scale;

      boxes.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 0.52,
          z: prop.z,
          width: length,
          height: 0.16,
          depth: 0.8,
          rotation: prop.rotation,
        }),
        color: wood,
      });
      boxes.push({
        matrix: boxMatrix({
          x: prop.x - Math.sin(prop.rotation) * 0.36,
          y: 0.92,
          z: prop.z - Math.cos(prop.rotation) * 0.36,
          width: length,
          height: 0.62,
          depth: 0.14,
          rotation: prop.rotation,
        }),
        color: wood,
      });
      solidProp(prop.x, prop.z, length, 1);

      return;
    }

    if (prop.kind === "balloon") {
      spheres.push({
        matrix: boxMatrix({
          x: prop.x,
          y: prop.y,
          z: prop.z,
          width: 8 * prop.scale,
          height: 9.5 * prop.scale,
          depth: 8 * prop.scale,
        }),
        color: hsl(prop.hue, 0.68, 0.56),
      });
      boxes.push({
        matrix: boxMatrix({
          x: prop.x,
          y: prop.y - 5.6 * prop.scale,
          z: prop.z,
          width: 1.6 * prop.scale,
          height: 1.5 * prop.scale,
          depth: 1.6 * prop.scale,
        }),
        color: hsl(30, 0.5, 0.42),
      });

      return;
    }

    /* Clouds: three overlapping lumps, which is all a cloud needs to be. */
    for (let lump = 0; lump < 3; lump += 1) {
      spheres.push({
        matrix: boxMatrix({
          x: prop.x + (lump - 1) * 4 * prop.scale,
          y: prop.y + (lump === 1 ? 1.4 : 0) * prop.scale,
          z: prop.z + (lump === 1 ? 1 : 0) * prop.scale,
          width: (7 - Math.abs(lump - 1) * 2) * prop.scale,
          height: 5 * prop.scale,
          depth: 6 * prop.scale,
        }),
        color: new THREE.Color(0xffffff),
      });
    }
  };

  layout.props
    .filter(
      (prop) =>
        prop.kind !== "cloud" &&
        prop.kind !== "hill" &&
        prop.kind !== "balloon",
    )
    .forEach(addProp);

  for (const station of layout.stations.filter(
    (entry) => entry.placement === "outside",
  )) {
    const identity = roomIdentity(station.index);
    for (const part of outdoorFurniture(station.index)) {
      const entries =
        part.shape === "sphere"
          ? spheres
          : part.shape === "cylinder"
            ? cylinders
            : part.shape === "cone"
              ? cones
              : boxes;
      entries.push({
        matrix: boxMatrix({
          ...part,
          x: station.x + part.x,
          z: station.z + part.z,
        }),
        color:
          part.color === 0xb58b43 || part.color === 0x684837
            ? hsl(identity.hue, 0.45, 0.55)
            : new THREE.Color(part.color),
      });
    }
    solidProp(station.x, station.z, 1.1, 1.1);
  }

  // Palm squares, fountains and seating make the block centres memorable.
  for (const center of plazaCenters) {
    for (const side of [-1, 1])
      for (const end of [-1, 1]) {
        const x = center.x + side * 6,
          z = center.z + end * 6;
        if (
          layout.stations.every(
            (station) => Math.hypot(station.x - x, station.z - z) > 3.5,
          )
        )
          addProp({
            kind: "tree",
            x,
            z,
            y: 0,
            rotation: side + end,
            scale: 1.15,
            hue: 105,
          });
      }
    if (
      layout.stations.some(
        (station) => Math.hypot(station.x - center.x, station.z - center.z) < 6,
      )
    )
      continue;
    cylinders.push({
      matrix: boxMatrix({
        ...center,
        y: 0.35,
        width: 5.4,
        height: 0.7,
        depth: 5.4,
      }),
      color: new THREE.Color(0xd8ae58),
    });
    cylinders.push({
      matrix: boxMatrix({
        ...center,
        y: 0.72,
        width: 4.8,
        height: 0.12,
        depth: 4.8,
      }),
      color: new THREE.Color(0x32bde0),
    });
    for (let tier = 0; tier < 3; tier++) {
      cylinders.push({
        matrix: boxMatrix({
          ...center,
          y: 1 + tier * 0.7,
          width: 0.4,
          height: 0.9,
          depth: 0.4,
        }),
        color: new THREE.Color(0xb89045),
      });
      cylinders.push({
        matrix: boxMatrix({
          ...center,
          y: 1.4 + tier * 0.7,
          width: 2.8 - tier * 0.7,
          height: 0.2,
          depth: 2.8 - tier * 0.7,
        }),
        color: new THREE.Color(0xcfa34c),
      });
      cylinders.push({
        matrix: boxMatrix({
          ...center,
          y: 1.52 + tier * 0.7,
          width: 2.5 - tier * 0.7,
          height: 0.035,
          depth: 2.5 - tier * 0.7,
        }),
        color: new THREE.Color(0x35c5df),
      });
    }
    spheres.push({
      matrix: boxMatrix({
        ...center,
        y: 3.3,
        width: 0.45,
        height: 0.6,
        depth: 0.45,
      }),
      color: new THREE.Color(0xe6ba57),
    });
    solidProp(center.x, center.z, 5.4, 5.4);
    for (const side of [-1, 1])
      if (
        layout.stations.every(
          (station) =>
            Math.hypot(station.x - center.x - side * 7, station.z - center.z) >
            3.5,
        )
      )
        addProp({
          kind: "bench",
          x: center.x + side * 7,
          z: center.z,
          y: 0,
          rotation: Math.PI / 2,
          scale: 1,
          hue: 30,
        });
  }
  // Signals stand on pavement corners, clear of the crossings themselves.
  for (const x of streetLines)
    for (const z of streetLines) {
      const px = x + 7,
        pz = z + 7;
      if (
        layout.stations.some(
          (station) => Math.hypot(station.x - px, station.z - pz) < 3,
        )
      )
        continue;
      cylinders.push({
        matrix: boxMatrix({
          x: px,
          y: 2.6,
          z: pz,
          width: 0.14,
          height: 5.2,
          depth: 0.14,
        }),
        color: new THREE.Color(0x455258),
      });
      boxes.push({
        matrix: boxMatrix({
          x: px,
          y: 4.7,
          z: pz,
          width: 0.42,
          height: 1.1,
          depth: 0.35,
        }),
        color: new THREE.Color(0x29373b),
      });
      for (let light = 0; light < 3; light++)
        spheres.push({
          matrix: boxMatrix({
            x: px,
            y: 5 - light * 0.3,
            z: pz - 0.2,
            width: 0.23,
            height: 0.23,
            depth: 0.08,
          }),
          color: new THREE.Color([0xe65746, 0xe9bb4c, 0x70c075][light]),
        });
      solidProp(px, pz, 0.4, 0.4);
    }

  const glazingCanvas = document.createElement("canvas");
  glazingCanvas.width = 128;
  glazingCanvas.height = 256;
  const glazingContext = glazingCanvas.getContext("2d")!;
  const glazingGradient = glazingContext.createLinearGradient(0, 256, 80, 0);
  glazingGradient.addColorStop(0, "#a7c9db");
  glazingGradient.addColorStop(0.45, "#d5eaf0");
  glazingGradient.addColorStop(0.62, "#f4fcff");
  glazingGradient.addColorStop(1, "#c3e1eb");
  glazingContext.fillStyle = glazingGradient;
  glazingContext.fillRect(0, 0, 128, 256);
  for (let panel = 0; panel < 8; panel++) {
    glazingContext.fillStyle =
      panel % 3 === 0 ? "rgba(255,255,255,.23)" : "rgba(32,89,119,.09)";
    glazingContext.fillRect(panel * 16, 0, 2, 256);
  }
  const glazingTexture = track(new THREE.CanvasTexture(glazingCanvas));
  glazingTexture.colorSpace = THREE.SRGBColorSpace;
  const cityGlassMaterial = track(
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: glazingTexture,
      roughness: 0.2,
      metalness: 0.12,
      clearcoat: 0.5,
      clearcoatRoughness: 0.18,
      envMapIntensity: 1.3,
    }),
  );
  const carPaint = track(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.26,
      metalness: 0.38,
      envMapIntensity: 1.3,
    }),
  );
  group.add(instanced(gableGeometry, tinted(), gables));
  group.add(instanced(pyramidGeometry, tinted(), pyramids));
  group.add(instanced(sailGeometry, tinted(), sails));
  group.add(instanced(bowGeometry, tinted(), bows));
  group.add(instanced(domeGeometry, track(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.38,metalness:.35})), domes));
  group.add(instanced(boxGeometry, track(new THREE.MeshStandardMaterial({color:0xffffff,roughness:.16,metalness:.3,envMapIntensity:1.4})), water, {shadows:false}));
  group.add(instanced(roundedGeometry, tinted(), roundedBuildings));
  group.add(instanced(roundedGeometry, cityGlassMaterial, roundedGlazing));
  group.add(instanced(autoBody, carPaint, carBodies));
  group.add(instanced(autoRoof, carPaint, carRoofs));
  group.add(
    instanced(
      autoFrame,
      track(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.3,
          metalness: 0.25,
          side: THREE.DoubleSide,
        }),
      ),
      carRoofs,
    ),
  );
  group.add(instanced(autoCabin, cityGlassMaterial, carCabins));
  group.add(instanced(roundedGeometry, carPaint, carTrim));
  group.add(instanced(cylinderGeometry, solid(0xffffff), tyres));
  group.add(instanced(cylinderGeometry, cityGlassMaterial, glassCylinders));
  group.add(
    instanced(
      cityRibbonGeometry,
      track(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.55,
          side: THREE.DoubleSide,
        }),
      ),
      ribbons,
    ),
  );
  group.add(
    instanced(
      cityRingGeometry,
      track(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.55,
          side: THREE.DoubleSide,
        }),
      ),
      rings,
    ),
  );
  group.add(
    instanced(
      cityLeafGeometry,
      track(
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          roughness: 0.9,
          side: THREE.DoubleSide,
        }),
      ),
      palmLeaves,
    ),
  );
  group.add(instanced(boxGeometry, tinted(), boxes));
  group.add(instanced(boxGeometry, surface("plaster", 0xffffff), walls));
  group.add(instanced(boxGeometry, surface("wood", 0xffffff), woodwork));
  group.add(instanced(boxGeometry, cityGlassMaterial, glass));
  group.add(instanced(coneGeometry, tinted(), cones));
  group.add(instanced(cylinderGeometry, tinted(), cylinders));
  group.add(instanced(sphereGeometry, tinted(), spheres));

  /*
   * The stations: Memo's own mascot on the path outside its house, over a ring
   * painted on the ground. It is a sprite, so it faces you from wherever you
   * come up the street and the notepad never reads back to front. It starts
   * invisible and fades in when the file arrives, rather than flashing white.
   */
  const stations: StationVisual[] = [];
  const ringGeometry = track(new THREE.RingGeometry(0.7, 0.86, 32));
  const tokenMaterial = track(
    new THREE.SpriteMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );

  disposables.push(
    new THREE.TextureLoader().load(MASCOT_TEXTURE_SRC, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      tokenMaterial.map = loaded;
      tokenMaterial.opacity = 1;
      tokenMaterial.needsUpdate = true;
    }),
  );

  const addressCanvas = document.createElement("canvas");
  addressCanvas.width = addressCanvas.height = 512;
  const addressContext = addressCanvas.getContext("2d")!;
  addressContext.fillStyle = "#263836";
  addressContext.fillRect(0, 0, 512, 512);
  addressContext.font = "bold 30px Georgia";
  addressContext.textAlign = "center";
  addressContext.textBaseline = "middle";
  addressContext.fillStyle = "#efdfb8";
  for (let number = 0; number < 64; number++)
    addressContext.fillText(
      String(number + 1).padStart(2, "0"),
      (number % 8) * 64 + 32,
      Math.floor(number / 8) * 64 + 32,
    );
  const addressTexture = track(new THREE.CanvasTexture(addressCanvas));
  addressTexture.colorSpace = THREE.SRGBColorSpace;
  const addressMaterial = track(
    new THREE.MeshBasicMaterial({ map: addressTexture }),
  );

  layout.stations.forEach((station) => {
    const house = layout.houses[station.houseIndex];
    const plaqueGeometry = track(new THREE.PlaneGeometry(0.65, 0.65));
    const uv = plaqueGeometry.getAttribute("uv");
    for (let vertex = 0; vertex < uv.count; vertex++)
      uv.setXY(
        vertex,
        ((station.index % 8) + uv.getX(vertex)) / 8,
        1 - (Math.floor(station.index / 8) + 1 - uv.getY(vertex)) / 8,
      );
    const plaque = new THREE.Mesh(plaqueGeometry, addressMaterial);
    const addressPosition =
      station.placement === "inside"
        ? roomPoint(house, -1.9, house.depth / 2 + 0.15)
        : { x: station.x, z: station.z + 0.61 };
    plaque.position.set(
      addressPosition.x,
      station.placement === "inside" ? 2.15 : 0.4,
      addressPosition.z,
    );
    plaque.rotation.y = station.placement === "inside" ? house.facing : 0;
    group.add(plaque);
    const token = new THREE.Sprite(tokenMaterial);
    const ring = new THREE.Mesh(
      ringGeometry,
      track(
        new THREE.MeshBasicMaterial({
          /* The ring says which of the three is waiting here. */
          color: hsl(STATION_HUE[station.kind], 0.7, 0.55),
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
        }),
      ),
    );

    token.scale.set(1.15 * MASCOT_ASPECT, 1.15, 1);
    token.position.set(station.x, 1.65, station.z);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(station.x, 0.11, station.z);

    group.add(token, ring);
    stations.push({ station, token, ring, collected: false });
  });

  return {
    group,
    colliders,
    stations,
    dispose: () => {
      group.traverse((object) => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      disposables.forEach((item) => item.dispose());
      group.clear();
    },
  };
}
