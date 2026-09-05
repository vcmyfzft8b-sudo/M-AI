/**
 * The city has to be the same city every time.
 *
 * A learner's memory of "the yellow tower on the left" is the whole point of a
 * memory palace, so nothing about the layout may come from `Math.random()`: the
 * seed is the note's own id, and every placement decision is drawn from it in a
 * fixed order. Same note, same city, on any device.
 */
export function seedFromString(value: string) {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

export type Random = {
  /** A float in [0, 1). */
  next: () => number;
  /** A float in [min, max). */
  range: (min: number, max: number) => number;
  /** An integer in [min, max]. */
  int: (min: number, max: number) => number;
  /** One of the entries, never called with an empty list. */
  pick: <Item>(items: readonly Item[]) => Item;
  /** True with the given probability. */
  chance: (probability: number) => boolean;
};

/** mulberry32 — small, fast, and good enough for scattering trees. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const range = (min: number, max: number) => min + next() * (max - min);

  return {
    next,
    range,
    int: (min: number, max: number) => Math.floor(range(min, max + 1)),
    pick: <Item,>(items: readonly Item[]) => items[Math.floor(next() * items.length) % items.length],
    chance: (probability: number) => next() < probability,
  };
}
