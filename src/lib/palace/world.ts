import * as THREE from "three";

import type { PalaceLayout, PalaceProp, PalaceStation } from "@/lib/palace/layout";
import type { Collider } from "@/lib/palace/movement";
import { drawCardScreen, drawNumberScreen } from "@/lib/palace/text-texture";

/**
 * The city, in geometry.
 *
 * Every shape here is generated: there is not a single downloaded model in the
 * feature. That is a deliberate trade — a bought low-poly town would look
 * richer, but it would also be tens of megabytes in front of a student on a
 * phone data plan, and this screen has to open in a second from a note.
 *
 * The rules that keep it cheap: instanced meshes for anything there are many of
 * (one draw call for every building in the city), unlit materials for the
 * boards so text stays crisp, no shadow maps at all — the soft blobs under
 * things are painted circles.
 */

/** Memo's mascot, already served for the app icon, reused as the pickup. */
const MASCOT_TEXTURE_SRC = "/memo-mascot.png";
const MASCOT_ASPECT = 320 / 288;

const SKY_COLOR = 0x9fd8ff;
const GRASS_COLOR = 0x62a447;
const ROAD_COLOR = 0x9a9aa2;
const PAVEMENT_COLOR = 0xd8d8dc;

export type StationVisual = {
  station: PalaceStation;
  collectible: THREE.Object3D;
  /** The floating token; hidden once the card is collected, unlike its ring. */
  token: THREE.Object3D;
  ring: THREE.Object3D;
  screen: THREE.Mesh;
  texture: THREE.CanvasTexture;
  canvas: HTMLCanvasElement;
  /** Whether the board currently shows the card's words or just its number. */
  readable: boolean;
  collected: boolean;
};

export type CityBuild = {
  group: THREE.Group;
  colliders: Collider[];
  stations: StationVisual[];
  /** Repaint one board: the card's words up close, its number from across the city. */
  applyScreen: (visual: StationVisual, readable: boolean) => void;
  dispose: () => void;
};

function hsl(hue: number, saturation: number, lightness: number) {
  return new THREE.Color().setHSL(((hue % 360) + 360) / 360 % 1, saturation, lightness);
}

/** One mesh for many copies of the same shape — the whole city is a handful of these. */
function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  instances: { matrix: THREE.Matrix4; color?: THREE.Color }[],
) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(instances.length, 1));

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

export function createLighting(scene: THREE.Scene) {
  scene.background = new THREE.Color(SKY_COLOR);
  /* Fog hides the edge of the world and saves the far half of the city. */
  scene.fog = new THREE.Fog(SKY_COLOR, 90, 260);

  const sky = new THREE.HemisphereLight(0xffffff, 0x8fbf76, 2.1);
  const sun = new THREE.DirectionalLight(0xfff3d8, 1.35);

  sun.position.set(60, 120, 40);
  scene.add(sky, sun);

  return () => {
    scene.remove(sky, sun);
    sky.dispose();
    sun.dispose();
  };
}

export function buildCity(
  layout: PalaceLayout,
  cardText: Map<string, { title: string; body: string }>,
): CityBuild {
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
  const sphereGeometry = track(new THREE.SphereGeometry(0.5, 12, 10));
  const solid = (color: number) => track(new THREE.MeshLambertMaterial({ color }));
  const tinted = () => track(new THREE.MeshLambertMaterial({ color: 0xffffff }));

  /* Ground, roads and the pavement ring each plaza sits on. */
  const ground = new THREE.Mesh(planeGeometry, solid(GRASS_COLOR));

  ground.rotation.x = -Math.PI / 2;
  ground.scale.set(layout.bounds * 2.6, layout.bounds * 2.6, 1);
  group.add(ground);

  const roadInstances = layout.roads.map((road) =>
    ({
      matrix: new THREE.Matrix4().compose(
        new THREE.Vector3(road.x, 0.02, road.z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
        new THREE.Vector3(road.width, road.depth, 1),
      ),
    }),
  );

  /* Footpaths first, then the tarmac over them, so the two never z-fight. */
  group.add(
    instanced(
      planeGeometry,
      solid(PAVEMENT_COLOR),
      layout.pavements.map((path) => ({
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(path.x, 0.015, path.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
          new THREE.Vector3(path.width, path.depth, 1),
        ),
      })),
    ),
  );
  group.add(instanced(planeGeometry, solid(ROAD_COLOR), roadInstances));

  /* Paint on the tarmac: centre lines and zebra crossings. */
  group.add(
    instanced(
      planeGeometry,
      solid(0xf2f2f4),
      layout.roadMarks.map((mark) => ({
        matrix: new THREE.Matrix4().compose(
          new THREE.Vector3(mark.x, 0.03, mark.z),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
          new THREE.Vector3(mark.width, mark.depth, 1),
        ),
      })),
    ),
  );

  /* The kerb: the step between road and pavement, and the town's straight lines. */
  group.add(
    instanced(
      boxGeometry,
      solid(PAVEMENT_COLOR),
      layout.kerbs.map((kerb) => ({
        matrix: boxMatrix({
          x: kerb.x,
          y: kerb.height / 2,
          z: kerb.z,
          width: kerb.width,
          height: kerb.height,
          depth: kerb.depth,
        }),
      })),
    ),
  );

  layout.districts.forEach((district) => {
    const plaza = new THREE.Mesh(
      track(new THREE.CircleGeometry(district.radius + 6, 36)),
      solid(PAVEMENT_COLOR),
    );

    plaza.rotation.x = -Math.PI / 2;
    plaza.position.set(district.center.x, 0.04, district.center.z);
    group.add(plaza);
  });

  /* Buildings: one instanced box for the walls, one for the window bands. */
  const buildingInstances = layout.buildings.map((building) => ({
    matrix: boxMatrix({
      x: building.x,
      y: building.height / 2,
      z: building.z,
      width: building.width,
      height: building.height,
      depth: building.depth,
    }),
    /* Enough colour that a district reads as a place, not a beige industrial estate. */
    color: hsl(
      building.hue,
      building.kind === "shop" ? 0.55 : 0.38,
      building.kind === "tower" ? 0.6 : 0.68,
    ),
  }));

  group.add(instanced(boxGeometry, tinted(), buildingInstances));

  const windowInstances = layout.buildings.flatMap((building) => {
    const bands = Math.min(building.floors, 9);

    return Array.from({ length: bands }, (_, floor) => ({
      matrix: boxMatrix({
        x: building.x,
        y: ((floor + 1) / (bands + 1)) * building.height,
        z: building.z,
        width: building.width + 0.12,
        height: Math.min(1.5, building.height / (bands * 2.4)),
        depth: building.depth + 0.12,
      }),
      color: hsl(215, 0.5, 0.32),
    }));
  });

  group.add(instanced(boxGeometry, tinted(), windowInstances));

  /*
   * Shopfronts: an awning and a door on the side the building faces, which is
   * the street for the town's houses and the plaza for the ones a card hangs
   * on. It is two boxes, and it is the difference between a row of blocks and
   * a row of shops.
   */
  const shopParts = layout.buildings
    .filter((building) => building.kind === "shop")
    .flatMap((building) => {
      const outX = Math.sin(building.facing);
      const outZ = Math.cos(building.facing);
      const sideways = Math.abs(outX) > 0.5;
      const half = (sideways ? building.width : building.depth) / 2;
      const across = sideways ? building.depth : building.width;

      return [
        {
          matrix: boxMatrix({
            x: building.x + outX * (half + 0.75),
            y: Math.min(building.height - 1.4, 3.5),
            z: building.z + outZ * (half + 0.75),
            width: across * 0.78,
            height: 0.28,
            depth: 1.9,
            rotation: building.facing,
          }),
          color: hsl(building.hue + 180, 0.6, 0.55),
        },
        {
          matrix: boxMatrix({
            x: building.x + outX * (half + 0.12),
            y: 1.15,
            z: building.z + outZ * (half + 0.12),
            width: 1.5,
            height: 2.3,
            depth: 0.2,
            rotation: building.facing,
          }),
          color: hsl(building.hue, 0.35, 0.28),
        },
      ];
    });

  group.add(instanced(boxGeometry, tinted(), shopParts));

  layout.buildings.forEach((building) => {
    colliders.push({
      x: building.x,
      z: building.z,
      width: building.width,
      depth: building.depth,
    });
  });

  /* Street furniture, batched by the shape it is made of. */
  const trunks: { matrix: THREE.Matrix4; color?: THREE.Color }[] = [];
  const crowns: { matrix: THREE.Matrix4; color?: THREE.Color }[] = [];
  const blocks: { matrix: THREE.Matrix4; color?: THREE.Color }[] = [];
  const spheres: { matrix: THREE.Matrix4; color?: THREE.Color }[] = [];

  const addProp = (prop: PalaceProp) => {
    if (prop.kind === "tree") {
      trunks.push({
        matrix: boxMatrix({ x: prop.x, y: 1.1 * prop.scale, z: prop.z, width: 0.5, height: 2.2 * prop.scale, depth: 0.5 }),
        color: hsl(28, 0.4, 0.32),
      });
      crowns.push({
        matrix: boxMatrix({
          x: prop.x,
          y: (2.2 + 1.6) * prop.scale,
          z: prop.z,
          width: 3.4 * prop.scale,
          height: 4 * prop.scale,
          depth: 3.4 * prop.scale,
          rotation: prop.rotation,
        }),
        color: hsl(prop.hue, 0.45, 0.4),
      });

      return;
    }

    if (prop.kind === "car") {
      blocks.push({
        matrix: boxMatrix({ x: prop.x, y: 0.6, z: prop.z, width: 4.4, height: 1.1, depth: 1.9, rotation: prop.rotation }),
        color: hsl(prop.hue, 0.6, 0.52),
      });
      blocks.push({
        matrix: boxMatrix({ x: prop.x, y: 1.45, z: prop.z, width: 2.4, height: 0.85, depth: 1.7, rotation: prop.rotation }),
        color: hsl(prop.hue, 0.35, 0.72),
      });

      return;
    }

    if (prop.kind === "lamp") {
      blocks.push({
        matrix: boxMatrix({ x: prop.x, y: 2.4, z: prop.z, width: 0.22, height: 4.8, depth: 0.22 }),
        color: hsl(220, 0.1, 0.35),
      });
      blocks.push({
        matrix: boxMatrix({ x: prop.x, y: 4.9, z: prop.z, width: 0.9, height: 0.3, depth: 0.9 }),
        color: hsl(50, 0.6, 0.72),
      });

      return;
    }

    if (prop.kind === "hill") {
      /* Scenery only: hills sit past the edge of the walkable town. */
      crowns.push({
        matrix: boxMatrix({
          x: prop.x,
          y: 9 * prop.scale,
          z: prop.z,
          width: 74 * prop.scale,
          height: 22 * prop.scale,
          depth: 74 * prop.scale,
          rotation: prop.rotation,
        }),
        color: hsl(prop.hue, 0.35, 0.42),
      });

      return;
    }

    if (prop.kind === "hedge") {
      blocks.push({
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

    if (prop.kind === "bin") {
      trunks.push({
        matrix: boxMatrix({ x: prop.x, y: 0.55, z: prop.z, width: 0.75, height: 1.1, depth: 0.75 }),
        color: hsl(210, 0.12, 0.36),
      });

      return;
    }

    if (prop.kind === "bench") {
      const wood = hsl(30, 0.45, 0.45);
      const length = 2.4 * prop.scale;

      /* Seat, back and two legs — a plank on the ground reads as litter. */
      blocks.push({
        matrix: boxMatrix({ x: prop.x, y: 0.52, z: prop.z, width: length, height: 0.16, depth: 0.8, rotation: prop.rotation }),
        color: wood,
      });
      blocks.push({
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

      for (const side of [-1, 1]) {
        blocks.push({
          matrix: boxMatrix({
            x: prop.x + Math.cos(prop.rotation) * side * (length / 2 - 0.2),
            y: 0.24,
            z: prop.z - Math.sin(prop.rotation) * side * (length / 2 - 0.2),
            width: 0.16,
            height: 0.48,
            depth: 0.7,
            rotation: prop.rotation,
          }),
          color: hsl(220, 0.1, 0.32),
        });
      }

      return;
    }

    if (prop.kind === "hydrant") {
      blocks.push({
        matrix: boxMatrix({ x: prop.x, y: 0.45, z: prop.z, width: 0.5, height: 0.9, depth: 0.5 }),
        color: hsl(2, 0.7, 0.5),
      });

      return;
    }

    if (prop.kind === "balloon") {
      spheres.push({
        matrix: boxMatrix({
          x: prop.x,
          y: prop.y,
          z: prop.z,
          width: 7 * prop.scale,
          height: 8.4 * prop.scale,
          depth: 7 * prop.scale,
        }),
        color: hsl(prop.hue, 0.68, 0.56),
      });
      blocks.push({
        matrix: boxMatrix({
          x: prop.x,
          y: prop.y - 5 * prop.scale,
          z: prop.z,
          width: 1.5 * prop.scale,
          height: 1.4 * prop.scale,
          depth: 1.5 * prop.scale,
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

  group.add(instanced(cylinderGeometry, tinted(), trunks));
  group.add(instanced(coneGeometry, tinted(), crowns));
  group.add(instanced(boxGeometry, tinted(), blocks));
  group.add(instanced(sphereGeometry, tinted(), spheres));

  /* The stations themselves: a board on the wall and a token in front of it. */
  const stations: StationVisual[] = [];
  const ringGeometry = track(new THREE.RingGeometry(1.05, 1.4, 24));
  /*
   * The thing you collect is Memo's own brain — the mascot from the app's icon,
   * hung in the air as a sprite so it faces you from wherever you approach and
   * the notepad in its hand never reads back to front. It starts invisible and
   * fades in when the file arrives, rather than flashing as a white square.
   */
  const tokenMaterial = track(
    new THREE.SpriteMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  const tokenTexture = new THREE.TextureLoader().load(MASCOT_TEXTURE_SRC, (loaded) => {
    loaded.colorSpace = THREE.SRGBColorSpace;
    tokenMaterial.map = loaded;
    tokenMaterial.opacity = 1;
    tokenMaterial.needsUpdate = true;
  });

  disposables.push(tokenTexture);

  layout.stations.forEach((station, index) => {
    const canvas = document.createElement("canvas");

    canvas.width = 512;
    canvas.height = 320;
    drawNumberScreen({ canvas, label: String(index + 1), hue: station.hue, collected: false });

    const texture = new THREE.CanvasTexture(canvas);

    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;

    const screenMaterial = track(new THREE.MeshBasicMaterial({ map: texture }));
    const screen = new THREE.Mesh(planeGeometry, screenMaterial);

    /*
     * The board stands clear of both the wall behind it and the frame around
     * it: at 0.3 out with a frame only 0.2 deep sitting on the wall, nothing
     * can swallow the picture or fight it for the same pixels.
     */
    const outX = Math.sin(station.screen.facing);
    const outZ = Math.cos(station.screen.facing);

    screen.scale.set(station.screen.width, station.screen.height, 1);
    screen.position.set(
      station.screen.x + outX * 0.3,
      station.screen.y,
      station.screen.z + outZ * 0.3,
    );
    screen.rotation.y = station.screen.facing;

    const frame = new THREE.Mesh(boxGeometry, solid(0x2a2733));

    frame.scale.set(station.screen.width + 0.6, station.screen.height + 0.6, 0.2);
    frame.position.set(
      station.screen.x + outX * 0.1,
      station.screen.y,
      station.screen.z + outZ * 0.1,
    );
    frame.rotation.y = station.screen.facing;

    const collectible = new THREE.Group();
    const token = new THREE.Sprite(tokenMaterial);

    /* The mascot is a touch wider than it is tall; keep it that way. */
    token.scale.set(1.7 * MASCOT_ASPECT, 1.7, 1);
    const ring = new THREE.Mesh(
      ringGeometry,
      track(new THREE.MeshBasicMaterial({ color: hsl(station.hue, 0.7, 0.55), transparent: true, opacity: 0.55, side: THREE.DoubleSide })),
    );

    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    /*
     * The mascot hangs between the standing ring and the board — `out` points
     * from the board into the plaza, so the token goes the other way. Over the
     * ring itself it would sit in the camera's lap the moment you arrived.
     */
    token.position.set(-outX * 2.4, 2.45, -outZ * 2.4);
    collectible.add(token, ring);
    collectible.position.set(station.x, 0, station.z);

    group.add(frame, screen, collectible);

    stations.push({
      station,
      collectible,
      token,
      ring,
      screen,
      texture,
      canvas,
      readable: false,
      collected: false,
    });
  });

  const applyScreen = (visual: StationVisual, readable: boolean) => {
    const text = cardText.get(visual.station.id);

    if (readable && text) {
      drawCardScreen({
        canvas: visual.canvas,
        title: text.title,
        body: text.body,
        hue: visual.station.hue,
        collected: visual.collected,
      });
    } else {
      drawNumberScreen({
        canvas: visual.canvas,
        label: String(visual.station.index + 1),
        hue: visual.station.hue,
        collected: visual.collected,
      });
    }

    visual.readable = readable;
    visual.texture.needsUpdate = true;
  };

  return {
    group,
    colliders,
    stations,
    applyScreen,
    dispose: () => {
      disposables.forEach((item) => item.dispose());
      stations.forEach((visual) => visual.texture.dispose());
      group.clear();
    },
  };
}
