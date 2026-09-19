/*
 * The client half of the chat wire format described in `chat-stream.ts`.
 *
 * Shared by both chats — the one inside a note and the one across the library —
 * because they answer over the same frames and a second reader would only be a
 * second thing to get subtly wrong.
 */
import type { MessageKey } from "@/lib/i18n/messages/keys";
import type { Translate } from "@/lib/i18n/translate";

/**
 * A failure the server reported in an `error` frame, as opposed to a dropped
 * connection or a browser that went to sleep.
 *
 * The distinction is what `requestChatAnswer` retries on. An error frame means
 * the server got as far as running its own three-tier model chain and every
 * tier failed, so asking again immediately buys another long wait and the same
 * answer; a connection that died on the way has nothing behind it and is worth
 * one more try.
 */
export class ChatStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatStreamError";
  }
}

/**
 * Reads the chat SSE stream, handing each token to `onDelta` as it lands and
 * returning the persisted message from the closing `done` frame.
 *
 * The frames are: `delta` for a piece of prose, `done` for the saved message,
 * `error` for a failure the server already logged. An `error` frame is thrown
 * so it lands in the caller's existing catch alongside a dropped connection.
 */
export async function readChatStream<TResult>(
  response: Response,
  /*
   * The piece of prose that just arrived, not the text so far. Callers painting
   * an answer into React state append it themselves; the voice tutor forwards it
   * straight to the speech socket, and an accumulated string would make it say
   * the whole turn again on every token.
   */
  onDelta: (text: string) => void,
  /*
   * The server writes the sentence in the reader's language and this only has
   * to cover the frame that arrives with none — but it runs outside React, so
   * the caller hands its translator down.
   */
  t: Translate<MessageKey>,
): Promise<TResult | null> {
  if (!response.body) {
    return null;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: TResult | null = null;

  const handleFrame = (frame: string) => {
    let event = "message";
    const data: string[] = [];

    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trim());
      }
    }

    if (data.length === 0) {
      return;
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(data.join("\n"));
    } catch {
      return;
    }

    if (event === "delta") {
      const text = (parsed as { text?: string }).text ?? "";
      if (text) {
        onDelta(text);
      }
      return;
    }

    if (event === "done") {
      result = parsed as TResult;
      return;
    }

    if (event === "error") {
      throw new ChatStreamError(
        (parsed as { error?: string }).error ?? t("chat.error.answerFailed"),
      );
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line; a partial one waits for more.
      let split = buffer.indexOf("\n\n");

      while (split !== -1) {
        handleFrame(buffer.slice(0, split));
        buffer = buffer.slice(split + 2);
        split = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }

  return result;
}

/** Attempts per question: the original, and one more if it never landed. */
const CHAT_ATTEMPTS = 2;

/**
 * Asks one of the two chats a question, and asks again if the first attempt
 * never reached the tutor at all.
 *
 * The rule the retry follows is "did anything come back?", not "did it work?".
 * A phone that changed cell, a socket iOS closed while the screen was locked, a
 * 502 from the edge, a stream that ended without its closing frame — none of
 * those produced an answer and all of them are worth one more try, which is the
 * difference between a tutor that always answers and one that answers most of
 * the time. What is deliberately not retried: a refusal (a rate limit, a
 * missing subscription, a note still processing), which will refuse again, an
 * `error` frame, which the server already exhausted its fallback chain to
 * produce, and any failure that arrives after the answer has started painting,
 * because by then the turn is very likely already saved and a second one would
 * duplicate it.
 */
export async function requestChatAnswer<TResult>(params: {
  url: string;
  body: unknown;
  /** A piece of prose from the stream. Same contract as `readChatStream`. */
  onDelta: (text: string) => void;
  /** Clears whatever a previous attempt painted, before the next one starts. */
  onAttemptStart: () => void;
  t: Translate<MessageKey>;
}): Promise<{ response: Response; payload: TResult | null }> {
  let lastError: unknown;

  for (let attempt = 0; attempt < CHAT_ATTEMPTS; attempt += 1) {
    const isLastAttempt = attempt + 1 >= CHAT_ATTEMPTS;
    let painted = false;

    params.onAttemptStart();

    try {
      const response = await fetch(params.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params.body),
      });

      // A 5xx is the platform or our own route falling over before the tutor was
      // reached; the body carries nothing worth reading.
      if (response.status >= 500 && !isLastAttempt) {
        continue;
      }

      /*
       * A refusal arrives as ordinary JSON before the stream begins, so both
       * shapes are handled: an event stream is read frame by frame, anything
       * else is parsed as it always was.
       */
      const payload = response.headers.get("Content-Type")?.includes("text/event-stream")
        ? await readChatStream<TResult>(
            response,
            (text) => {
              painted = true;
              params.onDelta(text);
            },
            params.t,
          )
        : ((await response.json().catch(() => null)) as TResult | null);

      // The stream closed without its `done` frame and without an `error` one —
      // a connection cut cleanly in half, which looks like success and is not.
      if (response.ok && payload === null && !painted && !isLastAttempt) {
        continue;
      }

      return { response, payload };
    } catch (error) {
      lastError = error;

      if (error instanceof ChatStreamError || painted || isLastAttempt) {
        throw error;
      }
    }
  }

  // Only reachable when the last attempt took a `continue` branch, which cannot
  // happen on the final pass; kept so the function has no implicit undefined.
  throw lastError ?? new ChatStreamError(params.t("chat.error.answerFailed"));
}
