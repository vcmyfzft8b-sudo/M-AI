import * as THREE from "three";

import type { PalaceHouse, PalaceLayout, PalaceProp, PalaceStation } from "@/lib/palace/layout";
import type { Collider } from "@/lib/palace/movement";

/**
 * The town, in geometry.
 *
 * Nothing here is downloaded: a bought low-poly town would look richer and cost
 * tens of megabytes in front of a student on a phone plan, and this screen has
 * to open in a second from a note. So every house is assembled out of boxes,
 * prisms, pyramids and domes from the plan the layout drew, and the whole town
 * goes out in about eight instanced draw calls.
 *
 * The variety is the feature, not decoration. A memory palace only works if the
 * places are worth remembering, so no two houses on a street are alike: roofs
 * differ, storeys differ, and the ones with something waiting outside them are
 * built as landmarks — taller, a spire or a dome, a flag on top.
 */

/** Memo's mascot, already served for the app icon, reused as the pickup. */
const MASCOT_TEXTURE_SRC = "/memo-mascot.png";
const MASCOT_ASPECT = 320 / 288;

const GRASS_COLOR = 0x62a447;
const ROAD_COLOR = 0x9a9aa2;
const PAVEMENT_COLOR = 0xd8d8dc;
const WINDOW_COLOR = 0x2f4a66;

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
  return new THREE.Color().setHSL(((((hue % 360) + 360) % 360) / 360) % 1, saturation, lightness);
}

function boxMatrix({
  x,
  y,
  z,
  width,
  height,
  depth,
  rotation = 0,
}: {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
  depth: number;
  rotation?: number;
}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
    new THREE.Vector3(width, height, depth),
  );
}

function flatMatrix({ x, z, width, depth, y }: { x: number; z: number; width: number; depth: number; y: number }) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
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
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(instances.length, 1));

  mesh.castShadow = shadows;
  mesh.receiveShadow = shadows;

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
 * A gable roof: a triangular prism whose ridge runs along X, so a house with
 * its front to +Z gets the slope facing the street rather than a wall of it.
 */
function gableGeometry() {
  const geometry = new THREE.BufferGeometry();
  const left = -0.5;
  const right = 0.5;
  const back = -0.5;
  const front = 0.5;
  const positions = [
    /* Two ends. */
    left, 0, back, left, 0, front, left, 1, 0,
    right, 0, front, right, 0, back, right, 1, 0,
    /* Front slope. */
    left, 0, front, right, 0, front, right, 1, 0,
    left, 0, front, right, 1, 0, left, 1, 0,
    /* Back slope. */
    right, 0, back, left, 0, back, left, 1, 0,
    right, 0, back, left, 1, 0, right, 1, 0,
    /* Underside, so the roof is not hollow when seen from a hill. */
    left, 0, back, right, 0, back, right, 0, front,
    left, 0, back, right, 0, front, left, 0, front,
  ];

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  return geometry;
}

/**
 * A sky with some depth in it: a two-stop gradient painted into a strip and
 * wrapped round the scene, which costs one small texture and reads far better
 * than the flat blue a single background colour gives.
 */
function skyTexture() {
  const canvas = document.createElement("canvas");

  canvas.width = 8;
  canvas.height = 256;

  const context = canvas.getContext("2d");

  if (context) {
    const gradient = context.createLinearGradient(0, 0, 0, canvas.height);

    gradient.addColorStop(0, "#3d8fe0");
    gradient.addColorStop(0.45, "#8ecdf7");
    gradient.addColorStop(0.62, "#d5eeff");
    gradient.addColorStop(1, "#eaf6ff");
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

export function createLighting(scene: THREE.Scene, shadowMapSize: number): Lighting {
  const sky = skyTexture();

  scene.background = sky;
  /* Fog hides the edge of the world and saves the far half of the town. */
  scene.fog = new THREE.Fog(0xcfe8fb, 100, 300);

  const ambient = new THREE.HemisphereLight(0xffffff, 0x8fbf76, 1.5);
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);

  sun.castShadow = true;
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.bias = -0.0006;
  /* Instanced boxes shadow-acne badly without this; it is cheaper than a bias
     large enough to hide it, which would detach every shadow from its wall. */
  sun.shadow.normalBias = 0.9;

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
      sun.position.set(x - 78, 96, z + 52);
      sun.target.position.set(x, 0, z);
      sun.target.updateMatrixWorld();
    },
    dispose: () => {
      scene.remove(ambient, sun, sun.target);
      scene.background = null;
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
  const cylinderGeometry = track(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
  const coneGeometry = track(new THREE.ConeGeometry(0.5, 1, 8));
  const pyramidGeometry = track(new THREE.ConeGeometry(0.72, 1, 4));
  const domeGeometry = track(new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2));
  const prismGeometry = track(gableGeometry());
  const sphereGeometry = track(new THREE.SphereGeometry(0.5, 12, 10));
  const solid = (color: number) => track(new THREE.MeshLambertMaterial({ color }));
  const tinted = () => track(new THREE.MeshLambertMaterial({ color: 0xffffff }));

  /* Everything box-shaped shares one mesh: walls, windows, cars, benches, bins. */
  const boxes: Instance[] = [];
  const prisms: Instance[] = [];
  const pyramids: Instance[] = [];
  const domes: Instance[] = [];
  const cones: Instance[] = [];
  const cylinders: Instance[] = [];
  const spheres: Instance[] = [];

  /* Ground, footpaths, tarmac, paint — flat planes, stacked in that order. */
  const ground = new THREE.Mesh(planeGeometry, solid(GRASS_COLOR));

  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(layout.bounds * 3, layout.bounds * 3, 1);
  ground.receiveShadow = true;
  group.add(ground);

  group.add(
    instanced(
      planeGeometry,
      solid(PAVEMENT_COLOR),
      layout.pavements.map((path) => ({ matrix: flatMatrix({ ...path, y: 0.015 }) })),
      { shadows: false },
    ),
  );
  group.add(
    instanced(
      planeGeometry,
      solid(ROAD_COLOR),
      layout.roads.map((road) => ({ matrix: flatMatrix({ ...road, y: 0.02 }) })),
      { shadows: false },
    ),
  );
  group.add(
    instanced(
      planeGeometry,
      solid(0xf2f2f4),
      layout.roadMarks.map((mark) => ({ matrix: flatMatrix({ ...mark, y: 0.03 }) })),
      { shadows: false },
    ),
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
    const wall = hsl(house.hue, house.saturation, house.lightness);
    const roofColor = hsl(
      house.roofHue,
      house.roofSaturation,
      house.roofLightness + (house.landmark ? 0.06 : 0),
    );
    const trim = hsl(house.hue, house.saturation * 0.7, house.lightness * 0.72);
    const body = house.depth;

    boxes.push({
      matrix: boxMatrix({
        x: house.x,
        y: house.height / 2,
        z: house.z,
        width: house.width,
        height: house.height,
        depth: house.depth,
        rotation: house.facing,
      }),
      color: wall,
    });

    colliders.push({
      x: house.x,
      z: house.z,
      width: Math.abs(out.x) > 0.5 ? house.depth : house.width,
      depth: Math.abs(out.x) > 0.5 ? house.width : house.depth,
    });

    /* The roof, which is most of what tells one house from the next. */
    const roofBase = house.height;

    if (house.roofKind === "gable") {
      prisms.push({
        matrix: boxMatrix({
          x: house.x,
          y: roofBase,
          z: house.z,
          width: house.width * 1.08,
          height: 2.6,
          depth: house.depth * 1.08,
          rotation: house.facing,
        }),
        color: roofColor,
      });
    } else if (house.roofKind === "hip" || house.roofKind === "spire") {
      pyramids.push({
        matrix: boxMatrix({
          x: house.x,
          y: roofBase,
          z: house.z,
          width: Math.max(house.width, house.depth) * 1.05,
          height: house.roofKind === "spire" ? 8 : 3,
          depth: Math.max(house.width, house.depth) * 1.05,
          rotation: house.facing + Math.PI / 4,
        }),
        color: roofColor,
      });
    } else if (house.roofKind === "dome") {
      domes.push({
        matrix: boxMatrix({
          x: house.x,
          y: roofBase,
          z: house.z,
          width: Math.min(house.width, house.depth) * 0.95,
          height: Math.min(house.width, house.depth) * 0.5,
          depth: Math.min(house.width, house.depth) * 0.95,
        }),
        color: roofColor,
      });
    } else {
      /* Flat: a parapet, so the top is a line rather than a bare edge. */
      boxes.push({
        matrix: boxMatrix({
          x: house.x,
          y: roofBase + 0.25,
          z: house.z,
          width: house.width + 0.5,
          height: 0.5,
          depth: house.depth + 0.5,
          rotation: house.facing,
        }),
        color: roofColor,
      });
    }

    /* Door, its frame and a step, and a window either side on every floor. */
    const doorAt = at(body / 2 + 0.05, 0);

    boxes.push({
      matrix: boxMatrix({
        x: doorAt.x,
        y: 1.2,
        z: doorAt.z,
        width: 1.8,
        height: 2.5,
        depth: 0.1,
        rotation: house.facing,
      }),
      color: hsl(house.hue, 0.08, 0.93),
    });
    boxes.push({
      matrix: boxMatrix({
        x: doorAt.x + out.x * 0.06,
        y: 1.1,
        z: doorAt.z + out.z * 0.06,
        width: 1.4,
        height: 2.2,
        depth: 0.12,
        rotation: house.facing,
      }),
      color: hsl(house.roofHue, house.roofSaturation + 0.2, 0.34),
    });

    const step = at(body / 2 + 0.55, 0);

    boxes.push({
      matrix: boxMatrix({
        x: step.x,
        y: 0.1,
        z: step.z,
        width: 2.2,
        height: 0.2,
        depth: 1.1,
        rotation: house.facing,
      }),
      color: hsl(0, 0, 0.86),
    });

    for (let storey = 0; storey < house.storeys; storey += 1) {
      const y = 1.7 + storey * 3.1;

      for (const side of [-1, 1]) {
        /* The ground floor keeps clear of the doorway. */
        const offset = side * house.width * (storey === 0 ? 0.31 : 0.24);
        const windowAt = at(body / 2 + 0.05, offset);

        /* Frame first, then the pane on top of it: two boxes, and the
           difference between a house and a box with dark patches. */
        boxes.push({
          matrix: boxMatrix({
            x: windowAt.x,
            y,
            z: windowAt.z,
            width: 1.7,
            height: 1.6,
            depth: 0.1,
            rotation: house.facing,
          }),
          color: hsl(house.hue, 0.1, 0.94),
        });
        boxes.push({
          matrix: boxMatrix({
            x: windowAt.x + out.x * 0.05,
            y,
            z: windowAt.z + out.z * 0.05,
            width: 1.4,
            height: 1.3,
            depth: 0.1,
            rotation: house.facing,
          }),
          color: new THREE.Color(WINDOW_COLOR),
        });
      }
    }

    const has = (feature: PalaceHouse["features"][number]) => house.features.includes(feature);

    if (has("chimney")) {
      const chimney = at(-body * 0.2, house.width * 0.28);

      boxes.push({
        matrix: boxMatrix({
          x: chimney.x,
          y: house.height + 1.6,
          z: chimney.z,
          width: 0.9,
          height: 3.2,
          depth: 0.9,
          rotation: house.facing,
        }),
        color: hsl(house.roofHue, house.roofSaturation, house.roofLightness * 0.9),
      });
    }

    if (has("porch")) {
      const canopy = at(body / 2 + 1, 0);

      boxes.push({
        matrix: boxMatrix({
          x: canopy.x,
          y: 2.6,
          z: canopy.z,
          width: house.width * 0.5,
          height: 0.22,
          depth: 2.1,
          rotation: house.facing,
        }),
        color: roofColor,
      });

      for (const side of [-1, 1]) {
        const post = at(body / 2 + 1.8, (side * house.width) / 5);

        cylinders.push({
          matrix: boxMatrix({
            x: post.x,
            y: 1.3,
            z: post.z,
            width: 0.22,
            height: 2.6,
            depth: 0.22,
          }),
          color: trim,
        });
      }
    }

    if (has("balcony") && house.storeys > 1) {
      const balcony = at(body / 2 + 0.7, 0);

      boxes.push({
        matrix: boxMatrix({
          x: balcony.x,
          y: 3.1,
          z: balcony.z,
          width: house.width * 0.6,
          height: 0.18,
          depth: 1.5,
          rotation: house.facing,
        }),
        color: trim,
      });
      boxes.push({
        matrix: boxMatrix({
          x: balcony.x + out.x * 0.7,
          y: 3.6,
          z: balcony.z + out.z * 0.7,
          width: house.width * 0.6,
          height: 0.8,
          depth: 0.12,
          rotation: house.facing,
        }),
        color: hsl(house.hue, 0.2, 0.85),
      });
    }

    if (has("garage")) {
      const garage = at(-1.5, (house.width / 2 + 2.4) * (house.width > 11 ? 1 : -1));

      boxes.push({
        matrix: boxMatrix({
          x: garage.x,
          y: 1.4,
          z: garage.z,
          width: 4.4,
          height: 2.8,
          depth: house.depth * 0.7,
          rotation: house.facing,
        }),
        color: hsl(house.hue, house.saturation * 0.8, house.lightness * 0.95),
      });

      const shutter = at(house.depth * 0.35 - 1.5, (house.width / 2 + 2.4) * (house.width > 11 ? 1 : -1));

      boxes.push({
        matrix: boxMatrix({
          x: shutter.x,
          y: 1.1,
          z: shutter.z,
          width: 3.4,
          height: 2.1,
          depth: 0.12,
          rotation: house.facing,
        }),
        color: hsl(210, 0.08, 0.42),
      });
    }

    if (has("dormer") && (house.roofKind === "gable" || house.roofKind === "hip")) {
      const dormer = at(body * 0.18, 0);

      boxes.push({
        matrix: boxMatrix({
          x: dormer.x,
          y: house.height + 1,
          z: dormer.z,
          width: 1.8,
          height: 1.6,
          depth: 1.8,
          rotation: house.facing,
        }),
        color: wall,
      });
      boxes.push({
        matrix: boxMatrix({
          x: dormer.x + out.x * 0.9,
          y: house.height + 1.1,
          z: dormer.z + out.z * 0.9,
          width: 1,
          height: 0.9,
          depth: 0.1,
          rotation: house.facing,
        }),
        color: hsl(210, 0.35, 0.3),
      });
    }

    if (has("shopfront")) {
      const awning = at(body / 2 + 0.8, 0);

      boxes.push({
        matrix: boxMatrix({
          x: awning.x,
          y: 3,
          z: awning.z,
          width: house.width * 0.8,
          height: 0.3,
          depth: 1.7,
          rotation: house.facing,
        }),
        color: hsl(house.hue + 180, 0.6, 0.55),
      });

      const glass = at(body / 2 + 0.05, 0);

      boxes.push({
        matrix: boxMatrix({
          x: glass.x,
          y: 1.5,
          z: glass.z,
          width: house.width * 0.72,
          height: 2,
          depth: 0.1,
          rotation: house.facing,
        }),
        color: hsl(198, 0.3, 0.62),
      });
    }

    if (has("sideTower")) {
      const tower = at(0, (house.width / 2 + 1.6) * -1);
      const towerHeight = house.height + 4.5;

      boxes.push({
        matrix: boxMatrix({
          x: tower.x,
          y: towerHeight / 2,
          z: tower.z,
          width: 3.2,
          height: towerHeight,
          depth: 3.2,
          rotation: house.facing,
        }),
        color: wall,
      });
      pyramids.push({
        matrix: boxMatrix({
          x: tower.x,
          y: towerHeight,
          z: tower.z,
          width: 4,
          height: 4.5,
          depth: 4,
          rotation: house.facing + Math.PI / 4,
        }),
        color: roofColor,
      });
    }

    if (has("flag")) {
      const top =
        house.roofKind === "spire"
          ? house.height + 8
          : house.roofKind === "dome"
            ? house.height + Math.min(house.width, house.depth) * 0.8
            : house.height + 3;

      cylinders.push({
        matrix: boxMatrix({ x: house.x, y: top + 1.4, z: house.z, width: 0.16, height: 2.8, depth: 0.16 }),
        color: hsl(0, 0, 0.85),
      });
      boxes.push({
        matrix: boxMatrix({
          x: house.x + along.x * 0.8,
          y: top + 2.3,
          z: house.z + along.z * 0.8,
          width: 1.5,
          height: 0.9,
          depth: 0.08,
          rotation: house.facing,
        }),
        color: hsl(house.hue + 40, 0.75, 0.55),
      });
    }

    /* Front garden: what you actually see from the pavement. */
    if (has("hedge")) {
      const hedge = at(body / 2 + 5.4, 0);

      boxes.push({
        matrix: boxMatrix({
          x: hedge.x,
          y: 0.6,
          z: hedge.z,
          width: house.width * 0.9,
          height: 1.2,
          depth: 0.9,
          rotation: house.facing,
        }),
        color: hsl(118, 0.4, 0.32),
      });
    }

    if (has("gardenTree")) {
      const tree = at(body / 2 + 3, house.width * 0.42);

      cylinders.push({
        matrix: boxMatrix({ x: tree.x, y: 1.1, z: tree.z, width: 0.45, height: 2.2, depth: 0.45 }),
        color: hsl(28, 0.4, 0.32),
      });
      cones.push({
        matrix: boxMatrix({ x: tree.x, y: 3.6, z: tree.z, width: 3, height: 3.8, depth: 3 }),
        color: hsl(115, 0.45, 0.38),
      });
    }
  };

  layout.houses.forEach(addHouse);

  /* Street furniture and scenery. */
  const addProp = (prop: PalaceProp) => {
    if (prop.kind === "tree") {
      const trunk = hsl(28, 0.4, 0.32);
      const leaf = hsl(prop.hue, 0.45, 0.4);

      cylinders.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 1.1 * prop.scale,
          z: prop.z,
          width: 0.5,
          height: 2.2 * prop.scale,
          depth: 0.5,
        }),
        color: trunk,
      });

      /* Conifers are two cones stacked; the round ones are a lumpy ball. The
         rotation the layout drew is reused as the coin toss between them. */
      if (Math.sin(prop.rotation * 7.3) > 0) {
        cones.push({
          matrix: boxMatrix({
            x: prop.x,
            y: 3.4 * prop.scale,
            z: prop.z,
            width: 3.6 * prop.scale,
            height: 3.4 * prop.scale,
            depth: 3.6 * prop.scale,
            rotation: prop.rotation,
          }),
          color: leaf,
        });
        cones.push({
          matrix: boxMatrix({
            x: prop.x,
            y: 5.1 * prop.scale,
            z: prop.z,
            width: 2.6 * prop.scale,
            height: 3 * prop.scale,
            depth: 2.6 * prop.scale,
            rotation: prop.rotation,
          }),
          color: hsl(prop.hue, 0.45, 0.45),
        });

        return;
      }

      spheres.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 4 * prop.scale,
          z: prop.z,
          width: 4.4 * prop.scale,
          height: 4 * prop.scale,
          depth: 4.4 * prop.scale,
          rotation: prop.rotation,
        }),
        color: leaf,
      });

      return;
    }

    if (prop.kind === "hill") {
      cones.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 0,
          z: prop.z,
          width: 78 * prop.scale,
          height: 24 * prop.scale,
          depth: 78 * prop.scale,
        }),
        color: hsl(prop.hue, 0.35, 0.42),
      });

      return;
    }

    if (prop.kind === "car") {
      boxes.push({
        matrix: boxMatrix({ x: prop.x, y: 0.6, z: prop.z, width: 4.4, height: 1.1, depth: 1.9, rotation: prop.rotation }),
        color: hsl(prop.hue, 0.6, 0.52),
      });
      boxes.push({
        matrix: boxMatrix({ x: prop.x, y: 1.45, z: prop.z, width: 2.4, height: 0.85, depth: 1.7, rotation: prop.rotation }),
        color: hsl(prop.hue, 0.35, 0.72),
      });

      return;
    }

    if (prop.kind === "lamp") {
      cylinders.push({
        matrix: boxMatrix({ x: prop.x, y: 2.4, z: prop.z, width: 0.2, height: 4.8, depth: 0.2 }),
        color: hsl(220, 0.1, 0.35),
      });
      boxes.push({
        matrix: boxMatrix({ x: prop.x, y: 4.9, z: prop.z, width: 0.9, height: 0.3, depth: 0.9 }),
        color: hsl(50, 0.6, 0.72),
      });

      return;
    }

    if (prop.kind === "bin") {
      cylinders.push({
        matrix: boxMatrix({ x: prop.x, y: 0.55, z: prop.z, width: 0.75, height: 1.1, depth: 0.75 }),
        color: hsl(210, 0.12, 0.36),
      });

      return;
    }

    if (prop.kind === "hydrant") {
      boxes.push({
        matrix: boxMatrix({ x: prop.x, y: 0.45, z: prop.z, width: 0.5, height: 0.9, depth: 0.5 }),
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

      return;
    }

    if (prop.kind === "bench") {
      const wood = hsl(30, 0.45, 0.45);
      const length = 2.4 * prop.scale;

      boxes.push({
        matrix: boxMatrix({ x: prop.x, y: 0.52, z: prop.z, width: length, height: 0.16, depth: 0.8, rotation: prop.rotation }),
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

  layout.props.forEach(addProp);

  group.add(instanced(boxGeometry, tinted(), boxes));
  group.add(instanced(prismGeometry, tinted(), prisms));
  group.add(instanced(pyramidGeometry, tinted(), pyramids));
  group.add(instanced(domeGeometry, tinted(), domes));
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
  const ringGeometry = track(new THREE.RingGeometry(1.05, 1.4, 24));
  const tokenMaterial = track(
    new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );

  disposables.push(
    new THREE.TextureLoader().load(MASCOT_TEXTURE_SRC, (loaded) => {
      loaded.colorSpace = THREE.SRGBColorSpace;
      tokenMaterial.map = loaded;
      tokenMaterial.opacity = 1;
      tokenMaterial.needsUpdate = true;
    }),
  );

  layout.stations.forEach((station) => {
    const token = new THREE.Sprite(tokenMaterial);
    const ring = new THREE.Mesh(
      ringGeometry,
      track(
        new THREE.MeshBasicMaterial({
          color: hsl(station.hue, 0.7, 0.55),
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
        }),
      ),
    );

    token.scale.set(1.7 * MASCOT_ASPECT, 1.7, 1);
    token.position.set(station.x, 2.3, station.z);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(station.x, 0.06, station.z);

    group.add(token, ring);
    stations.push({ station, token, ring, collected: false });
  });

  return {
    group,
    colliders,
    stations,
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      group.clear();
    },
  };
}
