/**
 * A Supabase read that loses its connection is tried once more.
 *
 * On 2026-09-24 the socket between a function and Supabase was reset twice in half
 * an hour (`read ECONNRESET`). One of those resets hit the reads behind GET /app, and
 * the whole page failed to render for somebody who had done nothing but open the app.
 * A second attempt a moment later would have succeeded.
 *
 * Only reads are retried: GET and HEAD against PostgREST (`/rest/v1/`). A write that
 * died mid-flight may already have landed, so repeating it is not ours to decide
 * here, and auth and storage keep their own behaviour.
 *
 * The body is read inside the retry. Undici resolves `fetch` as soon as the headers
 * arrive, so a reset mid-response surfaces later, as `TypeError: terminated` while
 * the body is read — after a plain fetch wrapper has already returned. PostgREST
 * responses are read whole by the client anyway, so buffering costs nothing extra.
 *
 * A gateway answer is the same failure one hop further out. On 2026-10-16 Supabase's
 * Cloudflare edge answered a read behind POST /api/lectures/[id]/tts/chunks with its
 * own `502 Bad Gateway` page: the request never reached PostgREST, the client turned
 * the HTML into an error, and the route threw a 500 at somebody pressing play. A 502,
 * 503 or 504 on a read is tried once more after a short pause; if the second answer
 * is a gateway error too, it is handed back exactly as before.
 */

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);
const GATEWAY_STATUSES = new Set([502, 503, 504]);
const GATEWAY_RETRY_DELAY_MS = 250;

function describe(input: RequestInfo | URL, init?: RequestInit) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    // A relative or malformed URL is not a PostgREST call we know how to retry.
  }
  return { method, path };
}

export function isRetryableSupabaseRead(input: RequestInfo | URL, init?: RequestInit) {
  const { method, path } = describe(input, init);
  return (method === "GET" || method === "HEAD") && path.startsWith("/rest/v1/");
}

export function withSupabaseReadRetry(fetchImpl?: typeof fetch): typeof fetch {
  return async (input, init) => {
    const send = fetchImpl ?? globalThis.fetch;

    if (!isRetryableSupabaseRead(input, init)) {
      return send(input, init);
    }

    const headOnly = describe(input, init).method === "HEAD";

    for (let attempt = 0; ; attempt += 1) {
      try {
        const response = await send(input, init);

        if (attempt < 1 && GATEWAY_STATUSES.has(response.status) && !init?.signal?.aborted) {
          await response.body?.cancel().catch(() => undefined);
          await new Promise((resolve) => setTimeout(resolve, GATEWAY_RETRY_DELAY_MS));
          continue;
        }

        const body = headOnly || NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
        return new Response(body, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (error) {
        // Transport failures are TypeErrors ("fetch failed", "terminated"). An abort
        // is a DOMException and means the caller gave up; honour that.
        if (attempt >= 1 || !(error instanceof TypeError) || init?.signal?.aborted) {
          throw error;
        }
      }
    }
  };
}
