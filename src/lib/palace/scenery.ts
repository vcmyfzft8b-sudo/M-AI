import * as THREE from "three";

// Longitudinal sections: position, half-width, bottom, top. These shared
// surfaces give every car curved shoulders and a sloped windscreen.
type Section = readonly [number, number, number, number];
const BODY: Section[] = [
  [-2.2, 0.53, 0.48, 0.83],
  [-2.06, 0.83, 0.36, 1.02],
  [-1.65, 0.94, 0.32, 1.12],
  [-0.85, 0.96, 0.32, 1.13],
  [0.55, 0.95, 0.32, 1.1],
  [1.45, 0.91, 0.36, 1.02],
  [2.02, 0.77, 0.43, 0.88],
  [2.2, 0.49, 0.5, 0.76],
];
const CABIN: Section[] = [
  [-1.55, 0.71, 0.91, 1.05],
  [-1.27, 0.76, 0.97, 1.38],
  [-0.79, 0.74, 1.01, 1.76],
  [-0.4, 0.73, 1.01, 1.83],
  [0.3, 0.72, 1.01, 1.8],
  [0.62, 0.73, 1.0, 1.6],
  [1.13, 0.75, 0.95, 1.09],
];

function shell(
  sections: Section[],
  from = -Math.PI,
  to = Math.PI,
  cabin = false,
) {
  const points: number[] = [],
    uvs: number[] = [],
    indices: number[] = [];
  const segments = 24;
  sections.forEach(([x, width, bottom, top], sectionIndex) => {
    for (let i = 0; i <= segments; i++) {
      const angle = from + ((to - from) * i) / segments;
      const cosine = Math.cos(angle),
        sine = Math.sin(angle);
      // The cabin meets the body along a wide sill. An elliptical full shell
      // pinched it to a point underneath and made the windows look detached.
      const y = cabin
        ? bottom + Math.pow(Math.max(0, cosine), 0.4) * (top - bottom)
        : (top + bottom) / 2 +
          (Math.sign(cosine) *
            Math.pow(Math.abs(cosine), 0.45) *
            (top - bottom)) /
            2;
      const z = cabin
        ? sine * width
        : Math.sign(sine) * Math.pow(Math.abs(sine), 0.55) * width;
      points.push(x, y, z);
      uvs.push(sectionIndex / (sections.length - 1), i / segments);
    }
  });
  for (let s = 0; s < sections.length - 1; s++)
    for (let i = 0; i < segments; i++) {
      const a = s * (segments + 1) + i,
        b = a + segments + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  if (to - from > 6) {
    for (const end of [0, sections.length - 1]) {
      const [x, , bottom, top] = sections[end];
      const center = points.length / 3;
      points.push(x, (bottom + top) / 2, 0);
      uvs.push(0.5, 0.5);
      for (let i = 0; i < segments; i++) {
        const a = end * (segments + 1) + i;
        if (end === 0) indices.push(center, a + 1, a);
        else indices.push(center, a, a + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function carBodyGeometry() {
  return shell(BODY);
}
export function carCabinGeometry() {
  return shell(CABIN, -Math.PI / 2, Math.PI / 2, true);
}
export function carRoofGeometry() {
  return shell(
    [
      [-1.0, 0.7496, 0.9925, 1.59375],
      ...CABIN.slice(2, 5),
      [0.48, 0.725625, 1.004375, 1.6875],
    ].map(([x, w, b, t]) => [x, w + 0.015, b, t + 0.025]),
    -1.02,
    1.02,
    true,
  );
}

/** A curved central rib and paired tapered leaflets, rather than flat blades. */
export function palmFrondGeometry() {
  const vertices: number[] = [];
  const height = (t: number) => Math.sin(t * Math.PI) * 0.22 - t * t * 0.34;
  const triangle = (...points: number[][]) => vertices.push(...points.flat());
  for (let i = 0; i < 18; i++) {
    const t = i / 18,
      next = (i + 1) / 18;
    triangle(
      [t, height(t), -0.014],
      [t, height(t), 0.014],
      [next, height(next), 0],
    );
    if (i < 2) continue;
    const span = Math.sin(t * Math.PI) * 0.19;
    for (const side of [-1, 1]) {
      triangle(
        [t - 0.035, height(t), 0],
        [t + 0.13, height(t) - 0.075, side * span],
        [t + 0.055, height(t + 0.055), 0],
      );
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}

/** Window frames follow the same curved surface as the cabin. */
export function carFrameGeometry() {
  const positions: number[] = [];
  const sectionAt = (x: number) => {
    const next = CABIN.findIndex((section) => section[0] >= x);
    const a = CABIN[Math.max(0, next - 1)],
      b = CABIN[Math.max(0, next)];
    const t = a === b ? 0 : (x - a[0]) / (b[0] - a[0]);
    return [
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t,
      a[3] + (b[3] - a[3]) * t,
    ];
  };
  for (const [topX, bottomX] of [
    [-0.8, -1.4],
    [-0.2, -0.2],
    [0.38, 1.04],
  ])
    for (const side of [-1, 1]) {
      const point = (t: number, edge: number) => {
        const angle = 0.5 + t * (Math.PI / 2 - 0.5);
        const x = topX + (bottomX - topX) * t + edge * 0.034;
        const [width, bottom, top] = sectionAt(x);
        return [
          x,
          bottom +
            Math.pow(Math.max(0, Math.cos(angle)), 0.4) * (top - bottom) +
            0.018,
          side * (Math.sin(angle) * width + 0.012),
        ];
      };
      for (let step = 0; step < 16; step++) {
        const a = point(step / 16, -1),
          b = point(step / 16, 1),
          c = point((step + 1) / 16, -1),
          d = point((step + 1) / 16, 1);
        positions.push(...a, ...b, ...c, ...b, ...d, ...c);
      }
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}
