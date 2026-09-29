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
  /**
   * The obstacle's vertical extent, when it has one. Left out, a collider is a
   * wall from the ground to the sky. With a `top`, you can step onto it from
   * within `STEP_UP` of that height (a stair); with a `bottom`, you can walk
   * underneath it (a gallery rail).
   */
  bottom?: number;
  top?: number;
};

/** Something to stand on above the ground: a stair tread, an upper floor. */
export type Surface = {
  x: number;
  z: number;
  width: number;
  depth: number;
  /** The height of its top. */
  y: number;
};

export const WALK_SPEED = 7.37;
export const SPRINT_SPEED = 12.21;
export const JUMP_VELOCITY = 9.4;
export const GRAVITY = 26;
export const CHARACTER_RADIUS = 0.55;
/**
 * How high a step the walker takes without noticing. Three stair risers: a
 * stride on a staircase spans more than one tread, and a smaller reach had the
 * walker bumping into the step after next.
 */
export const STEP_UP = 0.6;
/** How tall the walker is, for what it can pass under. */
export const CHARACTER_HEIGHT = 1.7;
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
  surfaces = [],
  bounds,
  delta,
}: {
  state: CharacterState;
  input: CharacterInput;
  /** Where the camera is looking; movement is relative to it. */
  cameraYaw: number;
  colliders: readonly Collider[];
  /** Stairs and upper floors; the ground is always there at 0. */
  surfaces?: readonly Surface[];
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

  /*
   * Collision runs only against what is nearby: a city has a few hundred boxes
   * in it and all but a handful are irrelevant every frame.
   */
  let position = { x, z };
  /* Judged from where the feet are about to be, so a stair is climbed, not bumped. */
  const feet = Math.max(state.y, floorHeight(position, state.y, surfaces));

  for (const collider of colliders) {
    if (Math.abs(collider.x - position.x) > collider.width / 2 + 4) continue;
    if (Math.abs(collider.z - position.z) > collider.depth / 2 + 4) continue;
    if (!colliderApplies(collider, feet)) continue;

    position = resolveCollision(position, collider, CHARACTER_RADIUS);
  }

  const limit = bounds - 1;

  position = {
    x: Math.max(-limit, Math.min(limit, position.x)),
    z: Math.max(-limit, Math.min(limit, position.z)),
  };

  /*
   * Height. On the ground and walking, the feet follow the floor up a step and
   * down one, so stairs are climbed rather than fallen down; anything further
   * below — the edge of a floor — is a fall, with gravity.
   */
  const floor = floorHeight(position, state.y, surfaces);
  let velocityY = state.velocityY;
  let y = state.y;
  let grounded: boolean;

  if (input.jump && state.grounded) {
    velocityY = JUMP_VELOCITY;
  }

  if (state.grounded && velocityY <= 0 && floor >= state.y - STEP_UP) {
    y = floor;
    velocityY = 0;
    grounded = true;
  } else {
    velocityY -= GRAVITY * delta;
    y += velocityY * delta;
    grounded = y <= floor;

    if (grounded) {
      y = floor;
      velocityY = 0;
    }
  }

  return {
    x: position.x,
    y,
    z: position.z,
    velocityY,
    facing,
    speed,
    grounded,
  };
}

/** Whether an obstacle is in the way of a walker whose feet are at `feet`. */
export function colliderApplies(collider: Collider, feet: number) {
  return (
    (collider.top === undefined || feet + STEP_UP < collider.top) &&
    (collider.bottom === undefined || feet + CHARACTER_HEIGHT > collider.bottom)
  );
}

/**
 * The highest thing to stand on under a point that is not above the walker's
 * reach: the ground, a tread one step up, the floor they are already on.
 */
export function floorHeight(
  point: { x: number; z: number },
  feet: number,
  surfaces: readonly Surface[],
) {
  let floor = 0;

  for (const surface of surfaces) {
    if (surface.y > feet + STEP_UP || surface.y <= floor) continue;
    if (Math.abs(point.x - surface.x) > surface.width / 2) continue;
    if (Math.abs(point.z - surface.z) > surface.depth / 2) continue;

    floor = surface.y;
  }

  return floor;
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
  minDistance = 3,
  ceiling = Number.POSITIVE_INFINITY,
}: {
  target: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  maxDistance: number;
  colliders: readonly Collider[];
  /**
   * Never closer than this, or the camera ends up inside the character's
   * head. Indoors it is allowed nearer: a corner of a small room is closer
   * than that, and the alternative is a camera outside the wall.
   */
  minDistance?: number;
  /** How high the camera may go here (indoors, under a floor); obstacles are judged at that height. */
  ceiling?: number;
}) {
  const step = 0.25;
  let allowed = minDistance;

  for (let distance = allowed; distance <= maxDistance; distance += step) {
    const probe = cameraPosition({ target, yaw, pitch, distance });
    /*
     * Judged at the height the camera will actually be: a staircase or a
     * bookcase blocks a camera below its top, a gallery rail one at its own
     * height, and nothing blocks a camera that clears it.
     */
    const height = Math.min(probe.y, ceiling);
    const blocked = colliders.some(
      (collider) =>
        (collider.top === undefined || height < collider.top + 0.2) &&
        (collider.bottom === undefined || height > collider.bottom) &&
        Math.abs(probe.x - collider.x) < collider.width / 2 + 0.5 &&
        Math.abs(probe.z - collider.z) < collider.depth / 2 + 0.5,
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

/** The station you are close enough to read, or none — on your own floor. */
export function nearestStation<Station extends { x: number; z: number; y?: number; id: string }>(
  position: { x: number; z: number; y?: number },
  stations: readonly Station[],
  reach: number,
) {
  let best: Station | null = null;
  let bestDistance = reach;

  for (const station of stations) {
    if (Math.abs((station.y ?? 0) - (position.y ?? 0)) > 1.2) continue;

    const distance = Math.hypot(station.x - position.x, station.z - position.z);

    if (distance < bestDistance) {
      best = station;
      bestDistance = distance;
    }
  }

  return best;
}
