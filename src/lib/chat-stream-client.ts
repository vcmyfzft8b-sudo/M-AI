/*
 * The client half of the chat wire format described in `chat-stream.ts`.
 *
 * Shared by both chats — the one inside a note and the one across the library —
 * because they answer over the same frames and a second reader would only be a
 * second thing to get subtly wrong.
 */

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
  onDelta: (updater: (current: string) => string) => void,
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
        onDelta((current) => current + text);
      }
      return;
    }

    if (event === "done") {
      result = parsed as TResult;
      return;
    }

    if (event === "error") {
      throw new Error(
        (parsed as { error?: string }).error ?? "Odgovora ni bilo mogoče ustvariti.",
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
