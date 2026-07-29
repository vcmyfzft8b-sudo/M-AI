import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";

import { handleMobileRequest } from "../../../../../ios/Memo/MobileBackend/src/handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Bridges the standalone Node HTTP mobile backend (ios/Memo/MobileBackend) into
// the Next.js App Router so `/api/mobile/*` is served from the same deployment
// as the web app. The native iOS client talks to this via bearer auth.

// The backend reads unprefixed env names; map the web app's NEXT_PUBLIC_* values.
function ensureEnv(requestOrigin: string) {
  process.env.SUPABASE_URL ||= process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  process.env.SUPABASE_ANON_KEY ||= process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  // The mobile adapter starts the shared web processing routes on this same
  // deployment. Derive that origin from the incoming request instead of
  // NEXT_PUBLIC_SITE_URL so local builds, Vercel previews, and production all
  // enqueue work on the server that received the native request.
  process.env.MEMO_SITE_URL = requestOrigin;
  if (!process.env.MEMO_APP_STORE_JWS_VERIFICATION_MODE) {
    process.env.MEMO_APP_STORE_JWS_VERIFICATION_MODE = "decode-only";
  }
}

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  ensureEnv(url.origin);
  const bodyBuffer = ["GET", "HEAD"].includes(request.method)
    ? Buffer.alloc(0)
    : Buffer.from(await request.arrayBuffer());

  const nodeReq = Readable.from(bodyBuffer.length ? [bodyBuffer] : []) as unknown as IncomingMessage;
  nodeReq.method = request.method;
  nodeReq.url = url.pathname + url.search;
  nodeReq.headers = Object.fromEntries(request.headers.entries());

  return await new Promise<Response>((resolve) => {
    const chunks: Buffer[] = [];
    const headers = new Headers();
    let statusCode = 200;

    const nodeRes = {
      get statusCode() {
        return statusCode;
      },
      set statusCode(value: number) {
        statusCode = value;
      },
      setHeader(name: string, value: string) {
        headers.set(name, value);
      },
      getHeader(name: string) {
        return headers.get(name) ?? undefined;
      },
      writeHead(code: number, headerMap?: Record<string, string>) {
        statusCode = code;
        if (headerMap) {
          for (const [key, value] of Object.entries(headerMap)) {
            headers.set(key, value);
          }
        }
      },
      end(data?: string | Buffer) {
        if (data) {
          chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
        }
        resolve(new Response(chunks.length ? Buffer.concat(chunks) : null, { status: statusCode, headers }));
      },
      write(data: string | Buffer) {
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(String(data)));
        return true;
      },
    } as unknown as ServerResponse;

    handleMobileRequest(nodeReq, nodeRes).catch((error) => {
      resolve(
        new Response(JSON.stringify({ error: (error as Error)?.message ?? "Internal error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
  });
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
