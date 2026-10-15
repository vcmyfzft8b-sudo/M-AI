import * as THREE from "three";

import { SUN_DIRECTION as SUN } from "./sun.ts";

/**
 * The air the town stands in: sky, sun, haze and the light they throw.
 *
 * The sky is one shader on a dome rather than a picture, so the sun can sit in
 * it where the shadows say it is, the clouds can drift, and the horizon can be
 * the exact colour the distance fades into. That last part is most of what
 * makes the town read as deep rather than as a set: a far street goes the
 * colour of the sky behind it, the way a real one does.
 *
 * The same sky, rendered once into a prefiltered environment map, is what the
 * glass towers and the cars reflect — so their highlights are this sky's
 * clouds and this sky's sun rather than a flat tint.
 */

/**
 * Drawn, but left out of the ambient occlusion (see `post.ts`): the sky, the
 * beacons and the mascots are light and signage, not surfaces.
 */
export const UNOCCLUDED_LAYER = 1;

const SUN_DIRECTION = new THREE.Vector3(SUN.x, SUN.y, SUN.z);

/* Linear colours, before tone mapping. */
const ZENITH = new THREE.Color(0.07, 0.25, 0.72);
const HORIZON = new THREE.Color(0.55, 0.74, 0.93);
/** What the distance fades into; the sky's horizon, a touch warmer. */
export const HAZE_COLOR = new THREE.Color(0.62, 0.77, 0.92);

const SKY_RADIUS = 640;

/*
 * three's PCF shadow turns its five taps by a per-pixel noise meant to be
 * averaged away by a temporal pass, which this renderer does not have. The
 * noise is fixed to the screen, so walking slid every shadow edge through a
 * still grain: the edges crawled. A fixed turn gives the same soft edge, the
 * same cost, and an edge that moves with the world. If a three upgrade changes
 * the chunk the replace finds nothing and the stock filter stays.
 */
const NOISY_SHADOW_TURN = "interleavedGradientNoise( gl_FragCoord.xy ) * PI2";

THREE.ShaderChunk.shadowmap_pars_fragment = THREE.ShaderChunk.shadowmap_pars_fragment
  .split(NOISY_SHADOW_TURN)
  .join("0.7853981");

/** The sun's side of the shadow camera: its right and up, as `lookAt` builds them. */
const SHADOW_RIGHT = new THREE.Vector3(0, 1, 0).cross(SUN_DIRECTION).normalize();
const SHADOW_UP = SUN_DIRECTION.clone().cross(SHADOW_RIGHT).normalize();
/** Half the width of ground the sun's shadow map covers, in metres. */
const SHADOW_HALF_SPAN = 70;
/** How far ahead of the walker the shadowed square is centred. */
const SHADOW_LEAD = 30;

const skyVertex = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = normalize(position);
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    /* Pinned to the far plane, so the dome never clips the town. */
    gl_Position.z = gl_Position.w;
  }
`;

const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform float uTime;
  uniform float uSaturation;
  varying vec3 vDirection;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 5; octave++) {
      value += amplitude * noise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float height = direction.y;
    float up = max(height, 0.0);

    vec3 color = mix(uHorizon, uZenith, pow(up, 0.45));
    /* Below the horizon: the haze the hills fade into, never a hard edge. */
    color = mix(color, uHorizon * 0.96, smoothstep(0.0, -0.08, height));

    float toSun = max(dot(direction, uSun), 0.0);
    /* A warm band along the horizon on the sun's side. */
    color += vec3(1.0, 0.68, 0.38) * pow(toSun, 6.0) * 0.28 * (1.0 - up);
    color += vec3(1.0, 0.88, 0.7) * pow(toSun, 48.0) * 0.45;
    /* The disc itself, bright enough to bloom where bloom is on. */
    color += vec3(1.0, 0.95, 0.86) * smoothstep(0.9993, 0.9997, toSun) * 9.0;

    if (height > 0.0) {
      /* Clouds on a flat ceiling, so they shrink into the distance. */
      vec2 deck = direction.xz / (height + 0.08) * 0.55 + vec2(uTime * 0.006, uTime * 0.002);
      float shape = fbm(deck * 1.3);
      float cover = smoothstep(0.48, 0.72, shape) * smoothstep(0.02, 0.2, height);
      float shade = fbm(deck * 1.3 + uSun.xz * 0.12);
      vec3 cloud = mix(vec3(0.68, 0.76, 0.9), vec3(1.25, 1.2, 1.12), clamp(0.4 + (shape - shade) * 4.0, 0.0, 1.0));
      cloud += vec3(1.0, 0.8, 0.55) * pow(toSun, 10.0) * 0.4;
      color = mix(color, cloud, cover * 0.95);
    }

    color = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, uSaturation);
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function createSky() {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: ZENITH.clone() },
      uHorizon: { value: HORIZON.clone() },
      uSun: { value: SUN_DIRECTION.clone() },
      uTime: { value: 0 },
      uSaturation: { value: 1 },
    },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const geometry = new THREE.SphereGeometry(SKY_RADIUS, 48, 24);
  const mesh = new THREE.Mesh(geometry, material);

  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  mesh.layers.set(UNOCCLUDED_LAYER);

  return { mesh, material, geometry };
}

export type Lighting = {
  /**
   * The sun follows the player: a shadow map only covers what is nearby. Give
   * it the way the camera looks and the covered square leads the view.
   */
  follow: (x: number, z: number, viewX?: number, viewZ?: number) => void;
  /** Once a frame: the clouds drift and the dome stays centred on the camera. */
  update: (seconds: number, camera: THREE.Camera) => void;
  dispose: () => void;
};

export function createLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  shadowMapSize: number,
): Lighting {
  const sky = createSky();

  scene.add(sky.mesh);
  scene.background = HAZE_COLOR.clone();

  /*
   * The reflections: the sky, rendered once into a prefiltered cube. Done with
   * the dome on its own in a scene of its own, so nothing in the town ends up
   * mirrored in itself.
   */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(sky.geometry, sky.material);

  envScene.add(envSky);
  /*
   * Half the colour: the environment lights every shadow as well as filling
   * every reflection, and a full-strength blue sky turned the shade on the
   * pavement the colour of a swimming pool.
   */
  sky.material.uniforms.uSaturation.value = 0.45;

  const environment = pmrem.fromScene(envScene, 0.02, 1, SKY_RADIUS * 2);

  sky.material.uniforms.uSaturation.value = 1;
  envScene.remove(envSky);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.45;

  /*
   * Fog starts close and ends before the dome, so everything past a couple of
   * blocks takes on the colour of the air — which is the depth cue that makes
   * the far towers sit behind the near ones instead of beside them.
   */
  scene.fog = new THREE.Fog(HAZE_COLOR, 95, 560);

  const ambient = new THREE.HemisphereLight(0xd8e4f2, 0x7c7c58, 0.85);
  const sun = new THREE.DirectionalLight(0xffe2b8, 3.5);

  sun.castShadow = true;
  /*
   * The sun sees the unoccluded layer too, so the people on it — kept out of
   * the ambient occlusion — still cast their shadows on the street.
   */
  sun.shadow.camera.layers.enable(UNOCCLUDED_LAYER);
  sun.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  sun.shadow.bias = -0.0006;
  /* Instanced boxes shadow-acne badly without this; it is cheaper than a bias
     large enough to hide it, which would detach every shadow from its wall. */
  sun.shadow.normalBias = 0.15;
  /*
   * The soft edge, held to the same width on the ground whatever the map's
   * size. three's PCF spreads five noise-rotated taps across it, which reads as
   * stipple without a temporal pass to average it; at three texels of a phone's
   * 1024 map that was a 40 cm band of grain under every eave.
   */
  sun.shadow.radius = 3 * Math.min(1, shadowMapSize / 2048);

  const shadowCamera = sun.shadow.camera;

  shadowCamera.left = -SHADOW_HALF_SPAN;
  shadowCamera.right = SHADOW_HALF_SPAN;
  shadowCamera.top = SHADOW_HALF_SPAN;
  shadowCamera.bottom = -SHADOW_HALF_SPAN;
  shadowCamera.near = 20;
  shadowCamera.far = 260;
  shadowCamera.updateProjectionMatrix();

  scene.add(ambient, sun, sun.target);

  /* One texel of the shadow map, on the ground plane the sun looks at. */
  const texel = (SHADOW_HALF_SPAN * 2) / shadowMapSize;
  const centre = new THREE.Vector3();

  return {
    follow: (x, z, viewX = 0, viewZ = 0) => {
      /*
       * Centred ahead of the walker rather than on them: half the square used
       * to lie behind the camera, and the edge of the shadows ran across the
       * street in plain view. Led by 30 m it falls about where the haze begins.
       */
      centre.set(x + viewX * SHADOW_LEAD, 0, z + viewZ * SHADOW_LEAD);

      /*
       * Moved in whole texels of the map, measured across the sun's view. A
       * map that slides by fractions of a texel redraws every edge a little
       * differently each frame, and shadows shimmer as you walk.
       */
      const right = Math.round(centre.dot(SHADOW_RIGHT) / texel) * texel;
      const up = Math.round(centre.dot(SHADOW_UP) / texel) * texel;
      const along = centre.dot(SUN_DIRECTION);

      centre
        .copy(SHADOW_RIGHT).multiplyScalar(right)
        .addScaledVector(SHADOW_UP, up)
        .addScaledVector(SUN_DIRECTION, along);
      sun.position.copy(centre).addScaledVector(SUN_DIRECTION, 120);
      sun.target.position.copy(centre);
      sun.target.updateMatrixWorld();
    },
    update: (seconds, camera) => {
      sky.material.uniforms.uTime.value = seconds;
      sky.mesh.position.copy(camera.position);
    },
    dispose: () => {
      scene.remove(ambient, sun, sun.target, sky.mesh);
      scene.background = null;
      scene.environment = null;
      scene.fog = null;
      environment.dispose();
      sky.geometry.dispose();
      sky.material.dispose();
      ambient.dispose();
      sun.dispose();
    },
  };
}
