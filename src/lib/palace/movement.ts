/**
 * The character controller, kept away from three.js so the feel of the thing
 * can be tuned — and tested — without a canvas.
 *
 * Third person: the stick (or WASD) steers relative to where the camera is
 * looking, the body turns to face where it is going, and the camera trails
 * behind. Gravity is deliberately snappier than life; a floaty jump reads as
 * lag on a phone.
 */

export type CharacterState = {
  x: number;
  y: number;
  z: number;
  /* Horizontal velocity is derived from input each frame; only the fall is integrated. */
  velocityY: number;
  /**
   * Which way the body faces, radians. The heading it walks along is
   * `(sin facing, cos facing)`, so 0 is towards +Z — and anything drawn for the
   * character has to be built facing +Z to match, which is the bug that had the
   * avatar walking the whole town backwards.
   */
  facing: number;
  /** How fast it is actually moving on the ground, for the walk cycle. */
  speed: number;
  grounded: boolean;
};

export type CharacterInput = {
  /** -1 back .. 1 forward. */
  forward: number;
  /** -1 left .. 1 right. */
  right: number;
  jump: boolean;
  sprint: boolean;
};

export type Collider = {
  x: number;
  z: number;
  width: number;
  depth: number;
};

export const WALK_SPEED = 7.37;
export const SPRINT_SPEED = 12.21;
export const JUMP_VELOCITY = 9.4;
export const GRAVITY = 26;
export const CHARACTER_RADIUS = 0.55;
/** Radians per second the body swings round towards its heading. */
const TURN_RATE = 12;

export function createCharacter(x: number, z: number, facing: number): CharacterState {
  return { x, y: 0, z, velocityY: 0, facing, speed: 0, grounded: true };
}

/** Shortest way round the circle, so turning never takes the long way. */
export function turnTowards(current: number, target: number, maxDelta: number) {
  let difference = (target - current) % (Math.PI * 2);

  if (difference > Math.PI) difference -= Math.PI * 2;
  if (difference < -Math.PI) difference += Math.PI * 2;

  return current + Math.max(-maxDelta, Math.min(maxDelta, difference));
}

/**
 * Push a circle out of a box along whichever axis it is least deep into, which
 * is what lets you slide along a wall instead of sticking to it.
 */
export function resolveCollision(
  point: { x: number; z: number },
  collider: Collider,
  radius: number,
) {
  const halfWidth = collider.width / 2 + radius;
  const halfDepth = collider.depth / 2 + radius;
  const dx = point.x - collider.x;
  const dz = point.z - collider.z;
  const overlapX = halfWidth - Math.abs(dx);
  const overlapZ = halfDepth - Math.abs(dz);

  if (overlapX <= 0 || overlapZ <= 0) {
    return point;
  }

  if (overlapX < overlapZ) {
    return { x: collider.x + Math.sign(dx || 1) * halfWidth, z: point.z };
  }

  return { x: point.x, z: collider.z + Math.sign(dz || 1) * halfDepth };
}

export function stepCharacter({
  state,
  input,
  cameraYaw,
  colliders,
  bounds,
  delta,
}: {
  state: CharacterState;
  input: CharacterInput;
  /** Where the camera is looking; movement is relative to it. */
  cameraYaw: number;
  colliders: readonly Collider[];
  bounds: number;
  /** Seconds since the last frame, already clamped by the caller. */
  delta: number;
}): CharacterState {
  const magnitude = Math.min(1, Math.hypot(input.forward, input.right));
  let facing = state.facing;
  let speed = 0;
  let x = state.x;
  let z = state.z;

  if (magnitude > 0.02) {
    /*
     * Camera-relative: pushing up walks away from the camera whichever way it
     * has been swung round, which is the only scheme that survives a player
     * spinning the camera mid-run.
     *
     * The sideways axis is negated on the way in. Headings here run clockwise
     * — `direction = (sin h, cos h)` — while the walker's right hand, with the
     * camera looking along `(sin yaw, cos yaw)`, is `(-cos yaw, sin yaw)`. Feed
     * the stick in unnegated and "right" walks left.
     */
    const inputAngle = Math.atan2(-input.right, input.forward);
    const heading = cameraYaw + inputAngle;

    speed = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * magnitude;
    facing = turnTowards(state.facing, heading, TURN_RATE * delta);
    x += Math.sin(heading) * speed * delta;
    z += Math.cos(heading) * speed * delta;
  }

  let velocityY = state.velocityY;
  let y = state.y;

  if (input.jump && state.grounded) {
    velocityY = JUMP_VELOCITY;
  }

  velocityY -= GRAVITY * delta;
  y += velocityY * delta;

  const grounded = y <= 0;

  if (grounded) {
    y = 0;
    velocityY = 0;
  }

  /*
   * Collision runs only against what is nearby: a city has a few hundred boxes
   * in it and all but a handful are irrelevant every frame.
   */
  let position = { x, z };

  for (const collider of colliders) {
    if (Math.abs(collider.x - position.x) > collider.width / 2 + 4) continue;
    if (Math.abs(collider.z - position.z) > collider.depth / 2 + 4) continue;

    position = resolveCollision(position, collider, CHARACTER_RADIUS);
  }

  const limit = bounds - 1;

  return {
    x: Math.max(-limit, Math.min(limit, position.x)),
    y,
    z: Math.max(-limit, Math.min(limit, position.z)),
    velocityY,
    facing,
    speed,
    grounded,
  };
}

/**
 * Where the camera sits: behind the head at a fixed distance, pulled in when a
 * building would otherwise come between it and the character.
 */
export function cameraPosition({
  target,
  yaw,
  pitch,
  distance,
}: {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  distance: number;
}) {
  const horizontal = Math.cos(pitch) * distance;

  return {
    x: target.x - Math.sin(yaw) * horizontal,
    y: target.y + 1.5 + Math.sin(pitch) * distance,
    z: target.z - Math.cos(yaw) * horizontal,
  };
}

/**
 * How far behind the character the camera can actually sit: it is pulled in
 * until nothing solid is between the two, which is what stops a wall filling
 * the screen every time you back up against a building.
 */
export function clampCameraDistance({
  target,
  yaw,
  pitch,
  maxDistance,
  colliders,
}: {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  maxDistance: number;
  colliders: readonly Collider[];
}) {
  const step = 0.5;
  /* Never closer than this, or the camera ends up inside the character's head. */
  let allowed = 3;

  for (let distance = allowed; distance <= maxDistance; distance += step) {
    const probe = cameraPosition({ target, yaw, pitch, distance });
    const blocked = colliders.some(
      (collider) =>
        Math.abs(probe.x - collider.x) < collider.width / 2 + 0.4 &&
        Math.abs(probe.z - collider.z) < collider.depth / 2 + 0.4,
    );

    if (blocked) {
      return allowed;
    }

    allowed = distance;
  }

  return maxDistance;
}

/** The pitch stays inside a range where the camera is neither underground nor overhead. */
export const MIN_PITCH = -0.4;
export const MAX_PITCH = 0.85;

export function clampPitch(pitch: number) {
  return Math.max(MIN_PITCH, Math.min(MAX_PITCH, pitch));
}

/** The station you are close enough to read, or none. */
export function nearestStation<Station extends { x: number; z: number; id: string }>(
  position: { x: number; z: number },
  stations: readonly Station[],
  reach: number,
) {
  let best: Station | null = null;
  let bestDistance = reach;

  for (const station of stations) {
    const distance = Math.hypot(station.x - position.x, station.z - position.z);

    if (distance < bestDistance) {
      best = station;
      bestDistance = distance;
    }
  }

  return best;
}
