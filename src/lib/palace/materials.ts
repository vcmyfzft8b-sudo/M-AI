import * as THREE from "three";
import { createRandom } from "./rng";

let atlasPromise: Promise<HTMLImageElement | null> | null = null;
function loadAtlas() {
  if (!atlasPromise)
    atlasPromise = new Promise((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => {
        atlasPromise = null;
        resolve(null);
      };
      image.src = "/palace/surface-atlas.png";
    });
  return atlasPromise;
}

/** Small, seeded surface maps. World-space UVs keep paving stones the same size
 * on a short path and a long avenue, including instanced and rotated buildings. */
export function createSurfaceMaterial(
  kind: "stone" | "plaster" | "roof" | "asphalt" | "grass" | "wood",
  color: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const random = createRandom(4817);
  ctx.fillStyle = "#d9d7d2";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 15000; i++) {
    const value = random.int(120, 255);
    ctx.fillStyle = `rgba(${value},${value},${value},${kind === "grass" ? 0.45 : 0.2})`;
    ctx.fillRect(
      random.int(0, 255),
      random.int(0, 255),
      random.int(1, 3),
      random.int(1, 3),
    );
  }
  if (kind === "stone" || kind === "roof") {
    const rows = kind === "roof" ? 8 : 4;
    const height = 256 / rows;
    ctx.strokeStyle = kind === "roof" ? "#8b8782" : "#b1ada5";
    ctx.lineWidth = kind === "roof" ? 2 : 1.5;
    for (let row = 0; row < rows; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * height);
      ctx.lineTo(256, row * height);
      for (let x = (row % 2) * 32; x <= 256; x += 64) {
        ctx.moveTo(x, row * height);
        ctx.lineTo(x, (row + 1) * height);
      }
      ctx.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  let disposed = false;
  const quadrant = {
    plaster: [0, 0],
    stone: [1, 0],
    roof: [0, 1],
    wood: [1, 1],
  }[kind as "plaster" | "stone" | "roof" | "wood"];
  if (quadrant)
    void loadAtlas().then((image) => {
      if (!image || disposed) return;
      const half = image.naturalWidth / 2;
      // Canvas slicing is part of texture upload; the source atlas stays intact.
      canvas.width = canvas.height = 512;
      ctx.drawImage(
        image,
        quadrant[0] * half,
        (quadrant[1] * image.naturalHeight) / 2,
        half,
        image.naturalHeight / 2,
        0,
        0,
        512,
        512,
      );
      texture.needsUpdate = true;
    });
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: kind === "wood" ? 0.65 : 0.9,
    map: texture,
    bumpMap: texture,
    bumpScale: 0.025,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vSurfacePosition;",
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <project_vertex>",
      `
      vec4 surfacePosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        surfacePosition = instanceMatrix * surfacePosition;
      #endif
      vSurfacePosition = (modelMatrix * surfacePosition).xyz;
      #include <project_vertex>
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <common>",
      "#include <common>\nvarying vec3 vSurfacePosition;",
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      vec3 surfaceNormal = abs(cross(dFdx(vSurfacePosition), dFdy(vSurfacePosition)));
      vec2 surfaceUv = surfaceNormal.y >= max(surfaceNormal.x, surfaceNormal.z)
        ? vSurfacePosition.xz : (surfaceNormal.x > surfaceNormal.z ? vSurfacePosition.zy : vSurfacePosition.xy);
      surfaceUv *= ${kind === "stone" || kind === "wood" ? "0.22" : kind === "roof" ? "0.35" : "0.7"};
      vec4 surfaceSample = texture2D(map, surfaceUv);
      diffuseColor *= mix(vec4(1.0), surfaceSample, ${kind === "stone" ? "0.55" : "0.3"});
      ${
        kind === "stone"
          ? `
        vec2 pavingCell = vSurfacePosition.xz / vec2(1.2, 0.8);
        pavingCell.x += mod(floor(pavingCell.y), 2.0) * 0.5;
        vec2 pavingEdge = min(fract(pavingCell), 1.0-fract(pavingCell));
        vec2 pavingAA = max(fwidth(pavingCell), vec2(0.002));
        vec2 pavingFill = smoothstep(vec2(0.009), vec2(0.009)+pavingAA, pavingEdge);
        diffuseColor.rgb *= mix(0.70, 1.0, min(pavingFill.x, pavingFill.y));
      `
          : ""
      }
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `
      float surfaceHeight = dot(surfaceSample.rgb, vec3(0.333)) * bumpScale;
      normal = perturbNormalArb(-vViewPosition, normal, vec2(dFdx(surfaceHeight), dFdy(surfaceHeight)), faceDirection);
    `,
    );
  };
  material.customProgramCacheKey = () => `palace-surface-${kind}`;
  return {
    material,
    dispose: () => {
      disposed = true;
      texture.dispose();
      material.dispose();
    },
  };
}
