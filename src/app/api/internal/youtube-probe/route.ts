/**
 * TEMPORARY diagnostic — delete before merging.
 *
 * YouTube caption import works from a residential IP and fails from Vercel, and the production
 * code collapses every cause into one message. This route runs the innertube handshake from the
 * deployed runtime with a battery of clients and reports exactly what YouTube answers, so the fix
 * is chosen from evidence instead of from folklore about datacenter IPs.
 */
import { NextResponse } from "next/server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const PROBE_TOKEN = "yt-probe-2026-08-23";
const TIMEOUT_MS = 15_000;

type ProbeClient = {
  name: string;
  userAgent: string;
  context: Record<string, unknown>;
};

const CLIENTS: ProbeClient[] = [
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
  {
    name: "ANDROID_VR",
    userAgent: "com.google.android.apps.youtube.vr.oculus/1.62.27 (Linux; U; Android 12) gzip",
    context: {
      client: {
        clientName: "ANDROID_VR",
        clientVersion: "1.62.27",
        deviceMake: "Oculus",
        deviceModel: "Quest 3",
        androidSdkVersion: 32,
        osName: "Android",
        osVersion: "12",
        hl: "en",
      },
    },
  },
  {
    name: "WEB_EMBEDDED_PLAYER",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    context: {
      client: {
        clientName: "WEB_EMBEDDED_PLAYER",
        clientVersion: "1.20250101.00.00",
        hl: "en",
      },
    },
  },
  {
    name: "MWEB",
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    context: { client: { clientName: "MWEB", clientVersion: "2.20250101.00.00", hl: "en" } },
  },
  {
    name: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
    userAgent:
      "Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version.master.0-.0 (unlike Gecko) v8/8.8.278.8-jit gles Starboard/13",
    context: {
      client: {
        clientName: "TVHTML5_SIMPLY_EMBEDDED_PLAYER",
        clientVersion: "2.0",
        hl: "en",
      },
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

async function probeClient(client: ProbeClient, videoId: string, visitorData: string | null) {
  const context = visitorData
    ? { ...client.context, client: { ...(client.context.client as object), visitorData } }
    : client.context;

  try {
    const response = await withTimeout("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": client.userAgent },
      body: JSON.stringify({ context, videoId }),
    });

    if (!response.ok) {
      return { client: client.name, httpStatus: response.status, body: (await response.text()).slice(0, 300) };
    }

    const payload = (await response.json()) as {
      playabilityStatus?: { status?: string; reason?: string };
      captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { baseUrl: string }[] } };
    };
    const tracks = payload.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
    const result: Record<string, unknown> = {
      client: client.name,
      httpStatus: response.status,
      playability: payload.playabilityStatus?.status,
      reason: payload.playabilityStatus?.reason,
      captionTracks: tracks.length,
    };

    // A caption URL that answers 200 with an empty body is the proof-of-origin wall, which looks
    // nothing like a blocked player call and needs a different fix.
    if (tracks[0]?.baseUrl) {
      try {
        const caption = await withTimeout(tracks[0].baseUrl, {
          headers: { "User-Agent": client.userAgent },
        });
        const text = await caption.text();
        result.captionHttpStatus = caption.status;
        result.captionBytes = text.length;
        result.captionHead = text.slice(0, 120);
      } catch (error) {
        result.captionError = error instanceof Error ? error.message : String(error);
      }
    }

    return result;
  } catch (error) {
    return { client: client.name, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("token") !== PROBE_TOKEN) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const videoId = url.searchParams.get("videoId") ?? "aircAruvnKk";
  let visitorData: string | null = null;

  if (url.searchParams.get("visitor") === "1") {
    try {
      const response = await withTimeout(
        "https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { client: { clientName: "WEB", clientVersion: "2.20250101.00.00", hl: "en" } },
          }),
        },
      );
      const payload = (await response.json()) as { responseContext?: { visitorData?: string } };
      visitorData = payload.responseContext?.visitorData ?? null;
    } catch {
      visitorData = null;
    }
  }

  const results = [];

  for (const client of CLIENTS) {
    results.push(await probeClient(client, videoId, visitorData));
  }

  return NextResponse.json({
    videoId,
    region: process.env.VERCEL_REGION ?? null,
    visitorData: visitorData ? `${visitorData.slice(0, 12)}…` : null,
    results,
  });
}
