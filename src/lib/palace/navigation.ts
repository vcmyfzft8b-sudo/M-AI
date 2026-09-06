/** North-up minimap positions. Distant rooms remain visible at the rim instead
 * of disappearing when there are no unvisited rooms in the current block. */
export function minimapMarker(
  position: { x: number; z: number },
  target: { x: number; z: number },
  size: number,
  range: number,
  inset: number,
) {
  const radius = size / 2;
  const dx = ((target.x - position.x) * radius) / range;
  const dy = ((target.z - position.z) * radius) / range;
  const distance = Math.hypot(dx, dy);
  const limit = Math.max(0, radius - inset);
  const ratio = distance > limit ? limit / distance : 1;
  return {
    x: radius + dx * ratio,
    y: radius + dy * ratio,
    pinned: distance > limit,
  };
}

/** Shared projection for the painted map and its interactive marker buttons. */
export function townMapPoint(
  point: { x: number; z: number },
  extent: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width, height) / (extent * 2);
  return { x: width / 2 + point.x * scale, y: height / 2 + point.z * scale };
}
