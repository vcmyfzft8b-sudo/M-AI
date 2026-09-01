/*
 * The arithmetic behind the phone library's swipe-to-reveal rows.
 *
 * It lives out here, away from the component, for one reason: a gesture is only
 * as good as it feels at speeds nobody thinks to try by hand — the 20 px/s
 * crawl, the 3 px/ms flick that is over in two pointer samples, the drag that
 * races across the row and then rests on the finger for half a second before
 * lifting. Those are cheap to assert on a pure function and near impossible to
 * reproduce reliably by dragging a simulator, so the rules are written here and
 * the component is left holding nothing but nodes and listeners.
 */

/** How far the row slides left when the actions are out. */
export const SWIPE_REVEAL_PX = 144;

/**
 * How far a finger travels before the gesture stops counting as a tap. It is
 * handed back to the row the moment the swipe commits, so nothing is actually
 * lost to it — see `commitDebt`.
 */
export const SWIPE_TAP_SLOP_PX = 4;

/**
 * How far it travels before that gesture's *direction* is read. Reading it at
 * the tap slop above meant deciding on 4px, where the direction is mostly the
 * jerk the hand starts with — a quick, arcing flick was handed to the scroller
 * and the row never moved, while the same swipe done slowly worked. Roughly
 * where the browser makes up its own mind about a pan.
 */
export const SWIPE_DIRECTION_PX = 8;

/**
 * How much more vertical than horizontal a gesture must be before it belongs
 * to the list rather than to the row. Merely "more y than x" is not an answer
 * at this distance. Over-claiming is the safe side: `touch-action: pan-y`
 * leaves the browser its veto, and a pan it takes arrives as a pointercancel
 * that settles the row back.
 */
export const SWIPE_AXIS_BIAS = 1.5;

/** px/ms. A flick this quick decides the row on its own, however far it went. */
export const SWIPE_FLICK_VELOCITY = 0.35;

/**
 * Release speed is read over a window rather than smoothed, because a smoothed
 * average has no idea how old the movement in it is. 55ms is long enough to
 * hold a two-sample flick and short enough that a flick at the end of a slow
 * drag is not averaged back down into one.
 */
export const SWIPE_VELOCITY_WINDOW_MS = 55;

/**
 * ...and if nothing moved in this long, the finger has stopped. Without this,
 * a swipe that raced left and then rested on the row before lifting flung it
 * open on speed it no longer had.
 */
export const SWIPE_VELOCITY_STALE_MS = 90;

/**
 * Past either end the row keeps following the finger, but never further than
 * this. Kept tight: everything past the end is bare list showing through, and
 * a band that let a determined pull open a finger's width of it read as the
 * row coming loose rather than resisting.
 */
export const SWIPE_RUBBER_BAND_PX = 64;

/** How much of the finger's distance the row still gets at the very edge. */
export const SWIPE_RUBBER_BAND_GIVE = 0.55;

/**
 * How small the action buttons start out, so they grow into the gap the row
 * opens rather than sitting there fully formed waiting for it.
 *
 * A scale and not an offset: the buttons are already right-aligned against the
 * row's trailing edge, so anything that moves them further right is clipped
 * against it, and a half-cut delete button reads as a bug rather than motion.
 * Scaling about that same edge can only ever move them inwards.
 */
export const SWIPE_ACTIONS_SCALE_FROM = 0.92;

/** How far a settle is allowed to carry past its target before it is clipped. */
export const SWIPE_OVERSHOOT_PX = 10;

/** The most of the gesture's opening step the row is allowed to ease into. */
export const SWIPE_MAX_COMMIT_DEBT_PX = 6;

/**
 * The settle spring. Just past critical damping (ratio ≈ 1.06): a hard flick
 * lands without the wobble that would show bare list background beyond the
 * buttons, and a gentle release still eases rather than steps.
 */
export const SWIPE_SPRING_STIFFNESS = 340;
export const SWIPE_SPRING_DAMPING = 2 * Math.sqrt(SWIPE_SPRING_STIFFNESS) * 1.06;

/** Sampled at 120Hz, so a ProMotion display gets a fresh value every frame. */
const SPRING_SAMPLE_MS = 1000 / 120;
const SPRING_MAX_DURATION_MS = 700;

/**
 * A flick harder than this is treated as this hard. Real fingers report up to
 * ~6px/ms on a fast display and the extra speed buys nothing but overshoot.
 */
const SPRING_MAX_VELOCITY = 2.5;

export function clamp(value: number, min: number, max: number) {
  // Math.min/Math.max rather than comparisons, because they are the pair that
  // knows +0 from -0: `clamp(-0, 0, 1)` has to be 0, or the actions get handed
  // a negative zero and every progress comparison downstream gets interesting.
  return Math.min(Math.max(value, min), max);
}

/**
 * Past either end the row still follows the finger, at a share of the distance
 * that keeps shrinking. The linear fraction this replaced was fine for the
 * first centimetre and then let a determined drag pull the row halfway across
 * the screen; this one approaches `limit` and stops, so the end of the travel
 * always feels like an end.
 */
export function rubberBand(
  offset: number,
  reveal = SWIPE_REVEAL_PX,
  limit = SWIPE_RUBBER_BAND_PX,
  give = SWIPE_RUBBER_BAND_GIVE,
) {
  const resist = (distance: number) => (distance * give * limit) / (limit + distance * give);

  if (offset > 0) {
    return resist(offset);
  }

  if (offset < -reveal) {
    return -reveal - resist(-reveal - offset);
  }

  return offset;
}

/** 0 while the row is shut, 1 once the actions are fully out. */
export function actionsProgress(offset: number, reveal = SWIPE_REVEAL_PX) {
  return clamp(-offset / reveal, 0, 1);
}

export type SwipeAxis = "pending" | "x" | "y";

/**
 * Whose gesture is this — the row's, the list's, or too early to say?
 */
export function resolveAxis(
  deltaX: number,
  deltaY: number,
  directionPx = SWIPE_DIRECTION_PX,
  bias = SWIPE_AXIS_BIAS,
): SwipeAxis {
  const travelX = Math.abs(deltaX);
  const travelY = Math.abs(deltaY);

  if (Math.max(travelX, travelY) < directionPx) {
    return "pending";
  }

  return travelY > travelX * bias ? "y" : "x";
}

type VelocitySample = { x: number; time: number };

/**
 * Release speed, measured over the last few milliseconds of the drag.
 *
 * Every pointer sample goes in, including the coalesced ones a fast swipe
 * carries, so the speed is the finger's and not the display's.
 */
export function createVelocityTracker(
  windowMs = SWIPE_VELOCITY_WINDOW_MS,
  staleMs = SWIPE_VELOCITY_STALE_MS,
) {
  let samples: VelocitySample[] = [];

  return {
    reset(x: number, time: number) {
      samples = [{ x, time }];
    },
    push(x: number, time: number) {
      samples.push({ x, time });

      // Keep one sample older than the window so a slow drag, which may only
      // produce a couple of events in it, still has a pair to measure across.
      let firstInsideWindow = samples.length - 1;
      while (firstInsideWindow > 0 && samples[firstInsideWindow].time > time - windowMs) {
        firstInsideWindow -= 1;
      }

      if (firstInsideWindow > 0) {
        samples = samples.slice(firstInsideWindow);
      }
    },
    /** px/ms, negative when the finger is heading left. 0 once it has stopped. */
    read(now: number) {
      const last = samples[samples.length - 1];

      if (!last || samples.length < 2 || now - last.time > staleMs) {
        return 0;
      }

      let oldest = samples.find((sample) => sample.time >= last.time - windowMs) ?? last;

      // A gesture short enough to fit in a single frame has nothing inside the
      // window but its own last sample. Measure it across the pair it has.
      if (oldest === last) {
        oldest = samples[samples.length - 2];
      }

      const elapsed = last.time - oldest.time;

      return elapsed > 0 ? (last.x - oldest.x) / elapsed : 0;
    },
  };
}

export type SwipeTracker = ReturnType<typeof createVelocityTracker>;

/**
 * Where the row belongs once the finger is off it. A flick decides it whatever
 * distance it covered; anything slower lands on whichever end it was nearer.
 */
export function shouldOpen(
  offset: number,
  velocity: number,
  reveal = SWIPE_REVEAL_PX,
  flick = SWIPE_FLICK_VELOCITY,
) {
  if (velocity <= -flick) {
    return true;
  }

  if (velocity >= flick) {
    return false;
  }

  return offset < -reveal / 2;
}

export type SpringFrames = {
  /** One offset per 120Hz frame, `from` first and `to` last. */
  offsets: number[];
  durationMs: number;
};

/**
 * The settle, sampled out as keyframes.
 *
 * A fixed-duration transition cannot help but break the gesture at the moment
 * it matters most: let go mid-flick and the row visibly stalls before starting
 * again on somebody else's curve. Handing the finger's speed to a spring and
 * playing the result through the Web Animations API keeps the motion
 * continuous through the release, and keeps it on the compositor after it.
 */
export function springFrames(
  from: number,
  to: number,
  velocity: number,
  {
    stiffness = SWIPE_SPRING_STIFFNESS,
    damping = SWIPE_SPRING_DAMPING,
    minOffset = -SWIPE_REVEAL_PX - SWIPE_OVERSHOOT_PX,
    maxOffset = SWIPE_OVERSHOOT_PX,
    sampleMs = SPRING_SAMPLE_MS,
    maxDurationMs = SPRING_MAX_DURATION_MS,
  } = {},
): SpringFrames {
  let displacement = from - to;
  // px/ms in, px/s for the integration below.
  let speed = clamp(velocity, -SPRING_MAX_VELOCITY, SPRING_MAX_VELOCITY) * 1000;

  if (Math.abs(displacement) < 0.5 && Math.abs(speed) < 30) {
    return { offsets: [to], durationMs: 0 };
  }

  // The clamp is there to stop the spring *carrying* the row somewhere it has
  // no business being, and it has to start from wherever the row already is:
  // let go of it deep in the rubber band and that is further out than any
  // overshoot allowance, and clamping the first frame would pop it inwards.
  const floor = Math.min(minOffset, from);
  const ceiling = Math.max(maxOffset, from);
  const step = sampleMs / 1000;
  const offsets: number[] = [];
  const frameBudget = Math.ceil(maxDurationMs / sampleMs);

  for (let frame = 0; frame < frameBudget; frame += 1) {
    offsets.push(clamp(to + displacement, floor, ceiling));

    const acceleration = -stiffness * displacement - damping * speed;
    speed += acceleration * step;
    displacement += speed * step;

    if (Math.abs(displacement) < 0.25 && Math.abs(speed) < 12) {
      break;
    }
  }

  offsets.push(to);

  return { offsets, durationMs: (offsets.length - 1) * sampleMs };
}

/**
 * How much of the drag to hold back at the moment it commits.
 *
 * The row is given everything the finger has covered bar the tap slop, and on
 * a slow drag that whole distance lands as one step the instant the gesture is
 * recognised. Returning it over the next few frames instead —
 * `decayCommitDebt` below — means the row picks the finger up rather than
 * snapping to it.
 *
 * Capped, because on a flick the first move event can arrive 60px in: that
 * distance is not a recognition artefact, it is where the finger actually is,
 * and easing into it would hand back as lag exactly what this exists to hide.
 */
export function commitDebt(deltaX: number, slop = SWIPE_TAP_SLOP_PX) {
  const signedSlop = deltaX < 0 ? -slop : slop;

  return clamp(deltaX - signedSlop, -SWIPE_MAX_COMMIT_DEBT_PX, SWIPE_MAX_COMMIT_DEBT_PX);
}

/**
 * The debt is repaid by time *and* by distance, because distance is when it can
 * be hidden: 20ms of half-life covers a slow drag, where the row is barely
 * moving and a step would show, while a flick clears the whole thing inside a
 * centimetre of travel, where anything left over would read as the row trailing the
 * finger. Under a quarter of a pixel it is simply dropped.
 */
export function decayCommitDebt(debt: number, elapsedMs: number, movedPx = 0) {
  if (debt === 0) {
    return 0;
  }

  const remaining =
    debt * Math.exp(-Math.max(elapsedMs, 0) / 28 - Math.abs(movedPx) / 10);

  return Math.abs(remaining) < 0.25 ? 0 : remaining;
}
