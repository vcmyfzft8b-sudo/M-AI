import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

import { UNOCCLUDED_LAYER } from "./atmosphere";

/**
 * The finishing pass, on screens with the GPU for it.
 *
 * Ambient occlusion is what a town made of boxes most lacks: without it every
 * corner, doorway and kerb is lit as if it stood in an open field, and the
 * buildings read as paper models. The pass darkens where surfaces meet, which is
 * what the eye takes as "solid". It runs at half resolution and is denoised,
 * which is invisible at this scale and halves its cost.
 *
 * After it, the tone mapping the renderer would otherwise have done, then a
 * light grade and a vignette that pull the eye to the middle of the frame, where
 * the walker is.
 *
 * Objects on `UNOCCLUDED_LAYER` — the sky, the beacons, the mascots — are drawn
 * normally but left out of the occlusion, which would otherwise treat a beam of
 * light as a wall and shade the pavement round it.
 */

const GradeShader = {
  name: "PalaceGrade",
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float luma = dot(color.rgb, vec3(0.2126, 0.7152, 0.0722));
      color.rgb = mix(vec3(luma), color.rgb, 1.08);
      vec2 offset = (vUv - 0.5) * vec2(1.0, 0.86);
      float vignette = smoothstep(0.82, 0.28, length(offset));
      color.rgb *= mix(0.8, 1.0, vignette);
      gl_FragColor = color;
    }
  `,
};

export type PostProcessing = {
  render: () => void;
  setSize: (width: number, height: number) => void;
  dispose: () => void;
};

export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
): PostProcessing {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  /* Multisampled, since the canvas's own antialiasing does not reach a render
     target, and half-float so the tone mapping at the end has range to map. */
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);

  /* The occlusion sees the town only; see `UNOCCLUDED_LAYER`. */
  const occlusionCamera = camera.clone();

  const ambientOcclusion = new GTAOPass(scene, occlusionCamera, size.x / 2, size.y / 2);

  ambientOcclusion.output = GTAOPass.OUTPUT.Default;
  ambientOcclusion.blendIntensity = 1;
  ambientOcclusion.updateGtaoMaterial({
    radius: 1.6,
    distanceExponent: 1.6,
    thickness: 3,
    scale: 1.25,
    samples: 12,
    distanceFallOff: 1,
  });
  ambientOcclusion.updatePdMaterial({
    lumaPhi: 10,
    depthPhi: 2,
    normalPhi: 3,
    radius: 5,
    radiusExponent: 1,
    rings: 2,
    samples: 12,
  });

  const fullSize = ambientOcclusion.setSize.bind(ambientOcclusion);

  ambientOcclusion.setSize = (width: number, height: number) =>
    fullSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));

  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(ambientOcclusion);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass(GradeShader));

  return {
    render: () => {
      occlusionCamera.copy(camera);
      occlusionCamera.layers.set(0);
      occlusionCamera.layers.disable(UNOCCLUDED_LAYER);
      composer.render();
    },
    setSize: (width, height) => {
      composer.setPixelRatio(renderer.getPixelRatio());
      composer.setSize(width, height);
    },
    dispose: () => {
      composer.passes.forEach((pass) => pass.dispose());
      composer.dispose();
      target.dispose();
    },
  };
}
