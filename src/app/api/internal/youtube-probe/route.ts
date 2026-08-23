/**
 * TEMPORARY diagnostic — deleted again once measured.
 *
 * Second question for the deployed runtime: if YouTube refuses the caption tracks, does it still
 * hand over an audio stream we could transcribe instead? Captions and streams come out of the same
 * player response, so the answer decides whether a transcription provider is a way around the bot
 * wall or is simply downstream of it.
 */
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PROBE_TOKEN = "yt-probe-2026-08-23";
const TIMEOUT_MS = 15_000;

const CLIENTS = [
  {
    name: "ANDROID",
    userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip",
    context: {
      client: { clientName: "ANDROID", clientVersion: "20.10.38", androidSdkVersion: 30, hl: "en" },
    },
  },
  {
    name: "IOS",
    userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 17_5 like Mac OS X)",
    context: {
      client: { clientName: "IOS", clientVersion: "20.10.4", deviceModel: "iPhone16,2", hl: "en" },
    },
  },
];

async function withTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("token") !== PROBE_TOKEN) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const videoId = url.searchParams.get("videoId") ?? "aircAruvnKk";
  const results = [];

  for (const client of CLIENTS) {
    try {
      const response = await withTimeout(
        "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": client.userAgent },
          body: JSON.stringify({ context: client.context, videoId }),
        },
      );
      const payload = (await response.json()) as {
        playabilityStatus?: { status?: string; reason?: string };
        streamingData?: { adaptiveFormats?: { mimeType?: string; url?: string }[] };
        captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: unknown[] } };
      };
      const formats = payload.streamingData?.adaptiveFormats ?? [];
      const audio = formats.filter((format) => format.mimeType?.startsWith("audio/"));

      results.push({
        client: client.name,
        playability: payload.playabilityStatus?.status,
        reason: payload.playabilityStatus?.reason,
        captionTracks:
          payload.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length ?? 0,
        hasStreamingData: Boolean(payload.streamingData),
        adaptiveFormats: formats.length,
        audioFormats: audio.length,
        firstAudioUrlPresent: Boolean(audio[0]?.url),
      });
    } catch (error) {
      results.push({
        client: client.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // The unauthenticated watch page is the other place a stream url could come from.
  let watchPage: Record<string, unknown> = {};

  try {
    const response = await withTimeout(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    const html = await response.text();
    watchPage = {
      httpStatus: response.status,
      bytes: html.length,
      hasStreamingData: html.includes('"streamingData"'),
      hasCaptionTracks: html.includes('"captionTracks"'),
      botWall: html.includes("Sign in to confirm") || html.includes("consent.youtube.com"),
    };
  } catch (error) {
    watchPage = { error: error instanceof Error ? error.message : String(error) };
  }

  return NextResponse.json({
    videoId,
    region: process.env.VERCEL_REGION ?? null,
    player: results,
    watchPage,
  });
}
