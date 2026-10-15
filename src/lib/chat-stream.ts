import "server-only";

import type { ChatStudyKind } from "@/lib/chat-study-set";

/**
 * The wire format both chats answer over.
 *
 * An answer is streamed so the learner watches it being written rather than
 * waiting at a blank panel. Each piece of prose arrives as a `delta` frame; the
 * closing `done` frame carries the finished result, which the client swaps in
 * for the text it has been painting — that is the one with ids, citations and
 * sources. `error` carries a failure the server has already logged. `study`
 * says the prose is finished and a study set of that kind is now being written
 * (see chat-study-generation.ts), so the client can hold a place for it rather
 * than sit on a finished-looking answer for the seconds the set takes.
 *
 * Refusals — a rate limit, a missing subscription, a note still processing —
 * are ordinary JSON responses sent before any of this begins, so a client has
 * to handle both shapes. That is deliberate: a 402 is not something to discover
 * halfway through a stream.
 */
export function createChatEventStream<TResult>(params: {
  /** Logged prefix for a failure, e.g. "[chat]". */
  label: string;
  /** Safe, already-localised sentence sent when the stream fails. */
  errorMessage: string;
  run: (send: {
    delta: (text: string) => void;
    study: (kind: ChatStudyKind) => void;
  }) => Promise<TResult>;
}) {
  const encoder = new TextEncoder();
  /*
   * Set once the learner's connection is gone: a locked phone, a closed tab. From then on
   * frames go nowhere, quietly. Enqueueing on a cancelled stream throws, and a throw from a
   * frame would abandon the run itself, so a turn the learner stopped watching (a study set
   * takes the better part of a minute to write) would never reach the database. The answer
   * is paid for either way; this keeps it saved for when they come back.
   */
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      closed = true;
    },
    async start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };

      try {
        const result = await params.run({
          delta: (text) => send("delta", { text }),
          study: (kind) => send("study", { kind }),
        });

        send("done", result);
      } catch (error) {
        /*
         * The learner is told the same thing whatever broke. What actually
         * failed here is a Postgres error, a gateway timeout or a schema
         * mismatch — none of it is theirs to read, and an error frame is not
         * the place to hand a raw database message to a browser.
         */
        console.error(`${params.label} stream failed`, error);
        send("error", { error: params.errorMessage });
      } finally {
        if (!closed) {
          try {
            controller.close();
          } catch {
            // Already closed from the other side; nothing left to tell anyone.
          }
        }
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
