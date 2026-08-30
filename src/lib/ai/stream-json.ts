/**
 * Reads the value of one top-level string field out of JSON that is still
 * arriving.
 *
 * The chat answer comes back as a structured object — `{ "answer": "...",
 * "citations": [...] }` — because the citations are worth having and a second
 * call to get them would double the bill. But a learner watching a blank panel
 * does not care that the prose is wrapped in JSON; they want to see it being
 * written. So the same single call is streamed, and this pulls the prose out of
 * the buffer as it grows.
 *
 * It is deliberately narrow: one named field, string-valued, at the top level.
 * Anything cleverer would be a JSON parser, and the schema here is fixed.
 */

type ScannerState =
  /** Still looking for `"<field>"` followed by a colon and an opening quote. */
  | "seeking"
  /** Inside the value; every character decoded is part of the answer. */
  | "reading"
  /** The closing quote has been seen; nothing further belongs to the field. */
  | "done";

export class JsonStringFieldScanner {
  private readonly fieldPattern: RegExp;
  private buffer = "";
  /** How much of `buffer` has been consumed — either skipped or emitted. */
  private cursor = 0;
  private state: ScannerState = "seeking";
  private value = "";

  constructor(field: string) {
    // The key, its colon and the opening quote, tolerating whitespace the way
    // JSON does. Escaping keeps a field name with regex characters harmless.
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    this.fieldPattern = new RegExp(`"${escaped}"\\s*:\\s*"`);
  }

  /** True once the field's closing quote has been read. */
  get isComplete() {
    return this.state === "done";
  }

  /** Everything decoded so far. */
  get text() {
    return this.value;
  }

  /**
   * Feeds the next piece of the response and returns whatever new text of the
   * field it revealed — "" when the chunk added nothing (still in the preamble,
   * or a half-written escape sequence waiting on its next character).
   */
  push(chunk: string): string {
    if (this.state === "done" || !chunk) {
      return "";
    }

    this.buffer += chunk;

    if (this.state === "seeking") {
      const match = this.fieldPattern.exec(this.buffer.slice(this.cursor));

      if (!match) {
        // Keep only enough of the tail to match a key split across chunks.
        const keep = 64;
        if (this.buffer.length - this.cursor > keep) {
          this.cursor = this.buffer.length - keep;
        }
        return "";
      }

      this.cursor += match.index + match[0].length;
      this.state = "reading";
    }

    return this.readValue();
  }

  /**
   * Decodes from the cursor to either the closing quote or the end of what has
   * arrived, stopping short of a trailing backslash whose escape is still in
   * flight.
   */
  private readValue(): string {
    let emitted = "";

    while (this.cursor < this.buffer.length) {
      const char = this.buffer[this.cursor];

      if (char === '"') {
        this.cursor += 1;
        this.state = "done";
        break;
      }

      if (char !== "\\") {
        emitted += char;
        this.cursor += 1;
        continue;
      }

      // An escape needs its payload, and \u needs four more digits after that.
      const escape = this.buffer[this.cursor + 1];

      if (escape === undefined) {
        break;
      }

      if (escape === "u") {
        const digits = this.buffer.slice(this.cursor + 2, this.cursor + 6);

        if (digits.length < 4) {
          break;
        }

        emitted += String.fromCharCode(Number.parseInt(digits, 16));
        this.cursor += 6;
        continue;
      }

      emitted += UNESCAPED[escape] ?? escape;
      this.cursor += 2;
    }

    this.value += emitted;
    return emitted;
  }
}

const UNESCAPED: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};
