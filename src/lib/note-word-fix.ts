// The rules for "fix a word": what counts as the word a learner meant, how its case is kept, and
// where highlights land once the note's words have changed. Relative imports and no
// "server-only", so the same matcher counts matches live in the sheet and does the replacing on
// the server, and the tests can load it directly.
import type { NoteAnnotation } from "./note-doc.ts";

/** A name or a short phrase; a sentence is an edit, not a fix. */
export const NOTE_WORD_FIX_MAX_LENGTH = 80;

export type NoteWordFixInputError = "empty" | "too_long" | "multiline" | "unchanged";

/**
 * NFC, single spaces, trimmed. Typed and pasted text arrives decomposed often enough on iOS
 * (č as c + U+030C), and the note tokenizer only counts precomposed letters as part of a word, so
 * a decomposed fix would split one word into two.
 */
export function normalizeNoteWordFixInput(value: string) {
  return value.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function validateNoteWordFix(find: string, replace: string): NoteWordFixInputError | null {
  const from = normalizeNoteWordFixInput(find);
  const to = normalizeNoteWordFixInput(replace);

  if (!/[\p{L}\p{N}]/u.test(from) || !/[\p{L}\p{N}]/u.test(to)) {
    return "empty";
  }

  if (from.length > NOTE_WORD_FIX_MAX_LENGTH || to.length > NOTE_WORD_FIX_MAX_LENGTH) {
    return "too_long";
  }

  if (/[\r\n]/.test(find) || /[\r\n]/.test(replace)) {
    return "multiline";
  }

  // A case-only fix ("krka" -> "Krka") is a real fix; only the identical string is not.
  if (from === to) {
    return "unchanged";
  }

  return null;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whole words only, any case: "Steljnice" must not match inside "Steljnicema", and a learner who
 * types the name in lower case still means the one at the start of a sentence. A run of spaces
 * in the phrase matches any run of whitespace in the note.
 */
function buildNoteWordMatcher(find: string) {
  const pattern = normalizeNoteWordFixInput(find).split(" ").map(escapeRegExp).join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, "giu");
}

function isUpper(character: string) {
  return character !== character.toLocaleLowerCase() && character === character.toLocaleUpperCase();
}

function withFirstCase(value: string, upper: boolean) {
  const first = value.charAt(0);
  return (upper ? first.toLocaleUpperCase() : first.toLocaleLowerCase()) + value.slice(1);
}

/**
 * The fix in the case each occurrence used. ALLCAPS stays ALLCAPS (headings, acronyms). When the
 * learner changed the capital themselves ("krka" -> "Krka") their spelling is the point and is
 * kept everywhere. Otherwise the capital follows the occurrence: the sheet prefills the word as
 * selected, often capitalised at the start of a sentence, and that capital must not spread to the
 * same word in the middle of other sentences.
 */
export function matchNoteWordCase(matched: string, replacement: string, find: string) {
  const letters = matched.replace(/[^\p{L}]/gu, "");

  if (letters.length > 1 && letters === letters.toLocaleUpperCase() && letters !== letters.toLocaleLowerCase()) {
    return replacement.toLocaleUpperCase();
  }

  const typedFind = find.replace(/[^\p{L}]/gu, "").charAt(0);
  const typedReplace = replacement.replace(/[^\p{L}]/gu, "").charAt(0);

  if (typedFind && typedReplace && isUpper(typedFind) !== isUpper(typedReplace)) {
    return replacement;
  }

  return withFirstCase(replacement, isUpper(matched.charAt(0)));
}

// Link targets are addresses, not words the learner reads; rewriting one would break the link.
const LINK_TARGET = /\]\([^)\s]*\)/g;

export type NoteWordFixResult = { text: string; count: number };

/** Replaces every whole-word occurrence of `find` in `text`. */
export function replaceNoteWord(text: string, find: string, replace: string): NoteWordFixResult {
  const to = normalizeNoteWordFixInput(replace);
  const from = normalizeNoteWordFixInput(find);
  const matcher = buildNoteWordMatcher(find);
  let count = 0;
  let output = "";
  let cursor = 0;

  // Walk the text between link targets so only readable prose is touched.
  for (const link of text.matchAll(LINK_TARGET)) {
    const start = link.index ?? 0;
    output += text.slice(cursor, start).replace(matcher, (matched) => {
      count += 1;
      return matchNoteWordCase(matched, to, from);
    });
    output += link[0];
    cursor = start + link[0].length;
  }

  output += text.slice(cursor).replace(matcher, (matched) => {
    count += 1;
    return matchNoteWordCase(matched, to, from);
  });

  return { text: count > 0 ? output : text, count };
}

export function countNoteWord(text: string, find: string) {
  if (!normalizeNoteWordFixInput(find)) {
    return 0;
  }

  return replaceNoteWord(text, find, "x").count;
}

// Values that are codes, not prose: ids and positions, a language ("en" is also Slovene for
// "one"), a podcast voice ("a"/"b"), enum fields and timestamps. Rewriting one breaks the reader.
const NON_TEXT_KEY = /^(id|language|speaker|kind|status|type|version|voice|model|difficulty)$|(Id|_id|_at|_key|_kind|_type)$/;

/**
 * The same fix applied to every prose string inside a JSON value (a mind map, a tutor plan,
 * podcast turns, a fact list). Keys are left alone, and so are code-like values (NON_TEXT_KEY).
 */
export function replaceNoteWordInJson<T>(value: T, find: string, replace: string): { value: T; count: number } {
  let count = 0;

  const walk = (node: unknown, key: string | null): unknown => {
    if (typeof node === "string") {
      if (key !== null && NON_TEXT_KEY.test(key)) {
        return node;
      }

      const result = replaceNoteWord(node, find, replace);
      count += result.count;
      return result.text;
    }

    if (Array.isArray(node)) {
      return node.map((item) => walk(item, null));
    }

    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([entryKey, entry]) => [entryKey, walk(entry, entryKey)]));
    }

    return node;
  };

  const next = walk(value, null) as T;
  return { value: count > 0 ? next : value, count };
}

/**
 * For each word of the old note, the word it became in the new one, as matched pairs from a
 * shortest edit script (Myers). Only the fixed words differ, so the script is tiny even on a
 * long note. Returns null when the notes differ too much to align cheaply, which a word fix never
 * produces.
 */
function alignWords(oldWords: readonly string[], newWords: readonly string[], maxEdits = 4000) {
  const n = oldWords.length;
  const m = newWords.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= Math.min(max, maxEdits); d += 1) {
    // Only diagonals -d-1..d+1 are read when walking back, so keep just those: memory grows with
    // the number of edits squared, not with the note's length times the edits.
    trace.push(v.slice(offset - d - 1, offset + d + 2));

    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;

      while (x < n && y < m && oldWords[x] === newWords[y]) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        // Walk the trace back to collect the matched (old, new) pairs.
        const pairs: Array<[number, number]> = [];
        let cx = n;
        let cy = m;

        for (let step = d; step > 0; step -= 1) {
          const prev = trace[step];
          // prev[i] holds diagonal i - step - 1.
          const at = (diagonal: number) => prev[diagonal + step + 1];
          const ck = cx - cy;
          const prevK = ck === -step || (ck !== step && at(ck - 1) < at(ck + 1)) ? ck + 1 : ck - 1;
          const prevX = at(prevK);
          const prevY = prevX - prevK;

          while (cx > prevX && cy > prevY) {
            cx -= 1;
            cy -= 1;
            pairs.push([cx, cy]);
          }

          cx = prevX;
          cy = prevY;
        }

        while (cx > 0 && cy > 0) {
          cx -= 1;
          cy -= 1;
          pairs.push([cx, cy]);
        }

        return pairs.reverse();
      }
    }
  }

  return null;
}

/**
 * Moves highlights and underlines onto the corrected note. Annotations store word positions, so
 * a fix that changes the number of words ("Novo mesto" -> "Ljubljana") would otherwise shift
 * every highlight after it. A highlight that covered a fixed word now covers its replacement; one
 * whose words are all gone is dropped.
 */
export function remapNoteAnnotations(
  annotations: readonly NoteAnnotation[],
  oldWords: readonly string[],
  newWords: readonly string[],
): NoteAnnotation[] {
  if (oldWords.length === newWords.length && oldWords.every((word, index) => word === newWords[index])) {
    return [...annotations];
  }

  const pairs = alignWords(oldWords, newWords);

  if (!pairs) {
    return oldWords.length === newWords.length ? [...annotations] : [];
  }

  // For each old word: the new word it is, or for a changed word the new span between its
  // matched neighbours.
  const matchedNew = new Int32Array(oldWords.length).fill(-1);
  for (const [oldIndex, newIndex] of pairs) {
    matchedNew[oldIndex] = newIndex;
  }

  const previousMatch = new Int32Array(oldWords.length);
  let last = -1;
  for (let index = 0; index < oldWords.length; index += 1) {
    if (matchedNew[index] >= 0) last = matchedNew[index];
    previousMatch[index] = last;
  }

  const nextMatch = new Int32Array(oldWords.length);
  let following = newWords.length;
  for (let index = oldWords.length - 1; index >= 0; index -= 1) {
    if (matchedNew[index] >= 0) following = matchedNew[index];
    nextMatch[index] = following;
  }

  const startOf = (index: number) => (matchedNew[index] >= 0 ? matchedNew[index] : previousMatch[index] + 1);
  const endOf = (index: number) => (matchedNew[index] >= 0 ? matchedNew[index] : nextMatch[index] - 1);

  const remapped: NoteAnnotation[] = [];

  for (const annotation of annotations) {
    if (annotation.startWordIndex >= oldWords.length) {
      continue;
    }

    const start = startOf(annotation.startWordIndex);
    const end = endOf(Math.min(annotation.endWordIndex, oldWords.length - 1));

    if (start <= end && start >= 0 && end < newWords.length) {
      remapped.push({ ...annotation, startWordIndex: start, endWordIndex: end });
    }
  }

  return remapped;
}
