import "server-only";

/**
 * The wire format both chats answer over.
 *
 * An answer is streamed so the learner watches it being written rather than
 * waiting at a blank panel. Each piece of prose arrives as a `delta` frame; the
 * closing `done` frame carries the finished result, which the client swaps in
 * for the text it has been painting — that is the one with ids, citations and
 * sources. `error` carries a failure the server has already logged.
 *
 * Refusals — a rate limit, a missing subscription, a note still processing —
 * are ordinary JSON responses sent before any of this begins, so a client has
 * to handle both shapes. That is deliberate: a 402 is not something to discover
 * halfway through a stream.
 */
export function createChatEventStream<TResult>(params: {
  /** Logged prefix for a failure, e.g. "[chat]". */
  label: string;
  run: (send: { delta: (text: string) => void }) => Promise<TResult>;
}) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const result = await params.run({ delta: (text) => send("delta", { text }) });

        send("done", result);
      } catch (error) {
        console.error(`${params.label} stream failed`, error);
        send("error", {
          error: error instanceof Error ? error.message : "Odgovora ni bilo mogoče ustvariti.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Vercel buffers a proxied response without this, which would defeat the
      // entire point of streaming it.
      "X-Accel-Buffering": "no",
    },
  });
}
