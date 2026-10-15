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

/** The stick is dead in the middle, so a resting thumb is not a slow walk. */
export const STICK_DEADZONE = 6;
/** How far the knob travels from where the thumb landed, in CSS pixels. */
export const STICK_RADIUS = 46;
/*
 * A thumb dragged this far past the rim runs. A phone has no Shift key, and
 * walking a sixty-stop town end to end is a minute; anything short of the rim
 * still walks, and slowly near the middle, for doorways.
 */
export const STICK_RUN_DISTANCE = STICK_RADIUS * 1.25;

/**
 * A thumb's drag from where it landed, as the walk it asks for: `forward` and
 * `right` in [-1, 1] (up the screen is forward), whether it runs, and where the
 * knob is drawn relative to the landing point.
 */
export function stickInput(dx: number, dy: number) {
  const distance = Math.hypot(dx, dy);

  if (distance < STICK_DEADZONE) {
    return { forward: 0, right: 0, running: false, knobX: 0, knobY: 0 };
  }

  const clamped = Math.min(1, distance / STICK_RADIUS);
  const nx = (dx / distance) * clamped;
  const ny = (dy / distance) * clamped;

  return {
    forward: -ny,
    right: nx,
    running: distance >= STICK_RUN_DISTANCE,
    knobX: nx * STICK_RADIUS,
    knobY: ny * STICK_RADIUS,
  };
}

/**
 * The stop to head for, and which way it lies on screen: the one picked on
 * the town map if it is still waiting, otherwise the nearest. `angle` is in
 * degrees clockwise from straight up the screen, for the camera looking along
 * `(sin yaw, cos yaw)`.
 */
export function nextStop<Station extends { id: string; x: number; z: number }>(
  position: { x: number; z: number; cameraYaw: number },
  stations: readonly Station[],
  collected: ReadonlySet<string>,
  selectedId: string | null = null,
) {
  let target: Station | null = null;
  let best = Number.POSITIVE_INFINITY;

  for (const entry of stations) {
    if (collected.has(entry.id)) continue;

    const distance = Math.hypot(entry.x - position.x, entry.z - position.z);

    if (entry.id === selectedId) {
      target = entry;
      best = distance;
      break;
    }
    if (distance < best) {
      target = entry;
      best = distance;
    }
  }

  if (!target) return null;

  /*
   * Headings run clockwise from +z (see `stepCharacter`), and the camera's
   * right hand is -x when it looks along +z, so a stop to the walker's right
   * has a smaller heading than the view: the screen angle is the negative.
   */
  const relative = Math.atan2(target.x - position.x, target.z - position.z) - position.cameraYaw;
  const wrapped = Math.atan2(Math.sin(relative), Math.cos(relative));

  return { station: target, distance: best, angle: (-wrapped * 180) / Math.PI };
}
