/** Prepares a possible reply silently; only an exact confirmed question can claim it. */
export class PreparedTutorReply<T> {
  private pending: {
    key: string;
    controller: AbortController;
    timer: ReturnType<typeof setTimeout> | null;
    result: Promise<T | null> | null;
  } | null = null;
  private attempts = 0;

  update(key: string, prepare: (signal: AbortSignal) => Promise<T>) {
    if (this.pending?.key === key) return;
    this.cancelPending();
    // Bound extra model work for a long or repeatedly revised utterance.
    if (this.attempts >= 2) return;
    const pending = { key, controller: new AbortController(), timer: null as ReturnType<typeof setTimeout> | null, result: null as Promise<T | null> | null };
    this.pending = pending;
    pending.timer = setTimeout(() => {
      pending.timer = null;
      this.attempts += 1;
      // A rejected/aborted rehearsal must never surface as an unhandled error.
      pending.result = Promise.resolve().then(() => {
        pending.controller.signal.throwIfAborted();
        return prepare(pending.controller.signal);
      }).catch(() => null);
    }, 300);
  }

  take(key: string): { controller: AbortController; result: Promise<T | null> } | null {
    const pending = this.pending;
    if (pending?.key === key && pending.result && !pending.controller.signal.aborted) {
      this.pending = null;
      this.attempts = 0;
      return { controller: pending.controller, result: pending.result };
    }
    this.clear();
    return null;
  }

  discard() {
    this.cancelPending();
  }

  clear() {
    this.cancelPending();
    this.attempts = 0;
  }

  private cancelPending() {
    if (this.pending?.timer !== null && this.pending?.timer !== undefined) clearTimeout(this.pending.timer);
    this.pending?.controller.abort();
    this.pending = null;
  }
}

/** Casing and final punctuation may be revised at endpointing; words must match exactly. */
export function preparedReplyKey(kind: string, topic: number, question: string) {
  const text = question.trim().toLocaleLowerCase().replace(/[.!?…]+$/u, "").replace(/\s+/gu, " ").trim();
  return JSON.stringify([kind, topic, text]);
}
