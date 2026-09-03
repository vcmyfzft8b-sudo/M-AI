import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const pdfJsTraceIncludes = [
  "./node_modules/pdfjs-dist/package.json",
  "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  "./node_modules/@napi-rs/canvas/package.json",
  "./node_modules/@napi-rs/canvas/**/*",
  "./node_modules/@napi-rs/canvas-linux-x64-gnu/**/*",
  "./node_modules/@napi-rs/canvas-linux-x64-musl/**/*",
];

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: process.cwd(),
  serverExternalPackages: ["@napi-rs/canvas"],
  outputFileTracingIncludes: {
    "/api/internal/lectures/document": pdfJsTraceIncludes,
    "/api/lectures/pdf": pdfJsTraceIncludes,
  },
  images: {
    qualities: [75, 92],
  },
  /*
   * Launch assets are served from public/, which Vercel sends with
   * `max-age=0, must-revalidate` — a conditional request before the browser
   * may draw any of them. That is the wrong trade for the one picture the app
   * shows while it is still opening, and worst on the connection where it
   * matters: the mark cannot appear until a round trip finishes, and offline
   * it does not appear at all.
   *
   * A day, not a year: these filenames carry no content hash, so a regenerated
   * mark has to be able to reach people. `stale-while-revalidate` keeps the
   * launch itself off the network for a week either way.
   */
  async headers() {
    return [
      {
        source: "/:dir(splash|icons)/:file*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, stale-while-revalidate=604800",
          },
        ],
      },
    ];
  },
  experimental: {
    /*
     * Next's dynamic client-router cache defaults to zero seconds. That makes
     * a completed full prefetch disposable: the next tap still waits for a new
     * RSC request. Keep user-specific route payloads in this tab's memory for
     * one minute so ahead-of-click warming is actually reusable. Mutations and
     * router.refresh() still invalidate the entry immediately.
     */
    staleTimes: {
      dynamic: 60,
    },
  },
};

export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
  webpack: {
    treeshake: {
      removeDebugLogging: true,
      excludeReplayIframe: true,
      excludeReplayShadowDOM: true,
    },
  },
});
