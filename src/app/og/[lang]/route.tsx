import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

import { BRAND_LOCKUP_SRC, SEO_BRAND_NAME } from "@/lib/brand";
import { LOCALES, parseLocale } from "@/lib/i18n/locales";
import { getTranslationsFor } from "@/lib/i18n/server";

/**
 * The picture every share of Memo shows — WhatsApp, Discord, X, Slack, iMessage.
 *
 * Until this existed the site declared no `og:image` at all, so a link posted
 * into a course group rendered as a bare grey row of text. For a product that
 * spreads student to student, that is the most expensive missing tag on the
 * site.
 *
 * A route rather than the `opengraph-image.tsx` file convention, because the
 * card is localized and the convention gives no way to ask for one language:
 * each landing page points at `/og/<its language>` itself. See
 * `openGraphImage()` in src/lib/seo.ts.
 *
 * All five are rendered at build time — `generateStaticParams` below — so no
 * share preview ever waits on the font fetch, and a scraper that ignores
 * `Cache-Control` still gets a file rather than a cold render.
 */
export const dynamic = "force-static";
export const revalidate = 86400;

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

const WIDTH = 1200;
const HEIGHT = 630;

/*
 * Inter Tight is the landing page's own display face, so the card is set in it
 * rather than in whatever `next/og` falls back to. Google serves the file from
 * a stable URL, but a share preview must never depend on that request
 * succeeding — a missing font degrades to the built-in sans, which is a
 * slightly plainer card rather than no card.
 */
const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Inter+Tight:wght@600;800&display=swap";

async function loadInterTight(): Promise<
  Array<{ name: string; data: ArrayBuffer; weight: 600 | 800; style: "normal" }>
> {
  try {
    /*
     * Deliberately no User-Agent. Google's stylesheet endpoint serves whatever
     * format the caller's browser claims to take, and Satori — which rasterises
     * the card — cannot read woff2: it fails the build with "Unsupported
     * OpenType signature wOF2". With no UA to go on, Google falls back to
     * unsubset TrueType, which Satori does read and which carries č, š and ž
     * without having to ask for the latin-ext subset by name.
     */
    const css = await fetch(FONT_CSS).then((response) =>
      response.ok ? response.text() : "",
    );

    const faces = [...css.matchAll(/font-weight:\s*(\d+);[^}]*?src:\s*url\((https:[^)]+\.ttf)\)/g)];

    const wanted: Array<600 | 800> = [600, 800];
    const loaded = await Promise.all(
      wanted.map(async (weight) => {
        const url = faces.find((face) => Number(face[1]) === weight)?.[2];

        if (!url) {
          return null;
        }

        const response = await fetch(url);

        if (!response.ok) {
          return null;
        }

        return {
          name: "Inter Tight",
          data: await response.arrayBuffer(),
          weight,
          style: "normal" as const,
        };
      }),
    );

    return loaded.filter((font) => font !== null);
  } catch {
    return [];
  }
}

/*
 * The lockup is read off disk and inlined rather than fetched over the network:
 * the card would otherwise depend on the deployment being able to reach its own
 * public URL, which is exactly the thing that is unreliable on a fresh deploy.
 */
async function lockupDataUri(): Promise<string | null> {
  try {
    const file = await readFile(path.join(process.cwd(), "public", BRAND_LOCKUP_SRC));
    return `data:image/png;base64,${file.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ lang: string }> }) {
  const locale = parseLocale((await params).lang);

  if (!locale) {
    return new Response("Not found", { status: 404 });
  }

  const t = getTranslationsFor(locale);

  const [fonts, lockup] = await Promise.all([loadInterTight(), lockupDataUri()]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "84px 88px",
          background: "#ebebef",
          // The landing page's mesh backdrop, flattened to what Satori can
          // draw: two soft blobs over the page grey.
          backgroundImage:
            "radial-gradient(58% 44% at 18% 8%, rgba(255,255,255,0.95) 0%, rgba(235,235,239,0) 68%)," +
            "radial-gradient(52% 48% at 88% 96%, rgba(163,163,186,0.45) 0%, rgba(235,235,239,0) 70%)",
          fontFamily: fonts.length ? "Inter Tight" : "sans-serif",
          color: "#000000",
        }}
      >
        {lockup ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={lockup} alt="" width={286} height={88} />
        ) : (
          <div style={{ display: "flex", fontSize: 52, fontWeight: 800, letterSpacing: "-0.04em" }}>
            {SEO_BRAND_NAME}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          <div
            style={{
              display: "flex",
              fontSize: 76,
              fontWeight: 800,
              letterSpacing: "-0.045em",
              lineHeight: 1.06,
              maxWidth: 940,
            }}
          >
            {t("meta.tagline")}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              lineHeight: 1.35,
              color: "#66666d",
              maxWidth: 900,
            }}
          >
            {t("meta.description")}
          </div>
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts,
      headers: {
        // A day, matching `revalidate`: the copy behind the card lives in the
        // message catalogues and can change with a deploy, and social scrapers
        // cache aggressively enough that a year here would outlive the tagline.
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
      },
    },
  );
}
