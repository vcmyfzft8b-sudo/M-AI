/** Terrain stays exactly level throughout the playable square. The transition
 * starts beyond it, so decorative hills never swallow roads or float houses. */
export function terrainHeight(x: number, z: number, bounds: number) {
  const distance = Math.max(Math.abs(x), Math.abs(z));
  const blend = Math.max(
    0,
    Math.min(1, (distance - bounds * 1.18) / (bounds * 0.6)),
  );
  if (blend === 0) return 0;
  const smooth = blend * blend * (3 - 2 * blend);
  const rolling =
    20 +
    Math.sin(x * 0.012 + 0.8) * 9 +
    Math.cos(z * 0.015) * 7 +
    Math.sin((x + z) * 0.009) * 8;
  return smooth * rolling;
}
