/**
 * The quiz, in the parts both screens need.
 *
 * The deck screen and the memory palace ask the same questions, so they shuffle
 * the options the same way, letter them the same way, and let a right answer
 * sit for the same beat before moving on.
 */

function randomInt(maxExclusive: number) {
  if (maxExclusive <= 1) {
    return 0;
  }

  if (!globalThis.crypto?.getRandomValues) {
    return Math.floor(Math.random() * maxExclusive);
  }

  const maxUint32 = 0x1_0000_0000;
  const biasSafeLimit = maxUint32 - (maxUint32 % maxExclusive);
  const buffer = new Uint32Array(1);
  let randomValue = 0;

  do {
    globalThis.crypto.getRandomValues(buffer);
    randomValue = buffer[0] ?? 0;
  } while (randomValue >= biasSafeLimit);

  return randomValue % maxExclusive;
}

/** A Fisher-Yates shuffle of 0..length-1, for the order options are shown in. */
export function shuffleIndices(length: number) {
  const indices = Array.from({ length }, (_, index) => index);

  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const currentValue = indices[index];
    indices[index] = indices[swapIndex] ?? index;
    indices[swapIndex] = currentValue ?? swapIndex;
  }

  return indices;
}

/**
 * How long a right answer is left on screen before the next question. Long
 * enough to register as right, short enough not to feel like a wait.
 */
export const QUIZ_CORRECT_PAUSE_MS = 780;

/**
 * The letter shown against an option: its place in the shuffled order, not its
 * index in the stored question.
 */
export function quizOptionLetter(order: readonly number[], optionIndex: number) {
  return String.fromCharCode(65 + Math.max(0, order.indexOf(optionIndex)));
}
