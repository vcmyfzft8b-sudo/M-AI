import { connect, constants, type ClientHttp2Session } from "node:http2";
import { importPKCS8, SignJWT } from "jose";

/**
 * Apple Push Notification service.
 *
 * APNs speaks HTTP/2 and only HTTP/2, which is why this does not use `fetch`:
 * undici negotiates HTTP/1.1 and Apple closes the connection. `node:http2` is
 * in the standard library, so the alternative to these ~120 lines is a
 * dependency that would do the same thing.
 */

const HOSTS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

export type PushEnvironment = keyof typeof HOSTS;

export function applePushConfigured() {
  return process.env.APPLE_PUSH_ENABLED === "true" && Boolean(
    process.env.APPLE_PUSH_KEY_ID
    && (process.env.APPLE_PUSH_TEAM_ID || process.env.APPLE_SIGN_IN_TEAM_ID)
    && process.env.APPLE_PUSH_PRIVATE_KEY,
  );
}

function pushTopic() {
  return process.env.APPLE_BUNDLE_ID || "eu.memoai.memo";
}

/**
 * Apple rejects a provider token refreshed more than once every 20 minutes and
 * expires one older than an hour, so the window has to sit strictly inside
 * both bounds. Thirty minutes is the middle of that range.
 */
const TOKEN_TTL_MS = 30 * 60 * 1000;
let cachedToken: { value: string; expiresAt: number } | null = null;

async function providerToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  const key = await importPKCS8((process.env.APPLE_PUSH_PRIVATE_KEY || "").replace(/\\n/g, "\n"), "ES256");
  const value = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: process.env.APPLE_PUSH_KEY_ID })
    .setIssuer(process.env.APPLE_PUSH_TEAM_ID || process.env.APPLE_SIGN_IN_TEAM_ID!)
    .setIssuedAt()
    .sign(key);
  cachedToken = { value, expiresAt: Date.now() + TOKEN_TTL_MS };
  return value;
}

/** Only for tests, which must not inherit a token signed with another key. */
export function resetApnsProviderToken() {
  cachedToken = null;
}

export type ApnsAlert = {
  title: string;
  body: string;
  /** Delivered alongside the alert so a tap can open the right note. */
  data?: Record<string, string>;
  /** Replaces an undelivered notification carrying the same id. */
  collapseId?: string;
};

export type ApnsOutcome =
  /** Delivered. */
  | { status: "sent" }
  /** The token is dead — Apple will never accept it again. Stop using it. */
  | { status: "gone"; reason: string }
  /** The token belongs to the other APNs environment. Retry there. */
  | { status: "wrongEnvironment" }
  /** Anything else: a transport error, a 429, a 500. Worth another attempt. */
  | { status: "failed"; reason: string };

type Http2Response = { status: number; body: string };

function post(session: ClientHttp2Session, path: string, headers: Record<string, string>, body: string) {
  return new Promise<Http2Response>((resolve, reject) => {
    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: path,
      ...headers,
    });
    request.setEncoding("utf8");
    request.setTimeout(10_000, () => request.destroy(new Error("APNs request timed out")));
    let status = 0;
    let received = "";
    request.on("response", (responseHeaders) => { status = Number(responseHeaders[constants.HTTP2_HEADER_STATUS]) || 0; });
    request.on("data", (chunk: string) => { received += chunk; });
    request.on("end", () => resolve({ status, body: received }));
    request.on("error", reject);
    request.end(body);
  });
}

function outcomeFor(response: Http2Response): ApnsOutcome {
  if (response.status === 200) return { status: "sent" };
  let reason = "";
  try { reason = (JSON.parse(response.body) as { reason?: string }).reason ?? ""; } catch { /* Apple sent no JSON. */ }
  // 410 is Apple saying the app is gone from that device. A 400 BadDeviceToken
  // is the same finality when the environment is already right, but it is also
  // exactly what a production token sent to sandbox looks like — so the caller
  // gets to retry on the other host before writing the device off.
  if (response.status === 410 || reason === "Unregistered") return { status: "gone", reason: reason || "Unregistered" };
  if (reason === "BadDeviceToken") return { status: "wrongEnvironment" };
  if (response.status === 403 || reason === "TopicDisallowed" || reason === "DeviceTokenNotForTopic") {
    return { status: "gone", reason: reason || "Forbidden" };
  }
  return { status: "failed", reason: reason || `HTTP ${response.status}` };
}

/**
 * Sends to one device, trying the other APNs environment once if the token
 * turns out to belong there. The environment that actually worked comes back
 * so the caller can correct the stored row and not pay for the hop again.
 */
export async function sendApplePush(
  token: string,
  environment: PushEnvironment,
  alert: ApnsAlert,
): Promise<ApnsOutcome & { environment: PushEnvironment }> {
  const authorization = await providerToken();
  const payload = JSON.stringify({
    aps: {
      alert: { title: alert.title, body: alert.body },
      sound: "default",
      "interruption-level": "active",
    },
    ...alert.data,
  });
  const headers: Record<string, string> = {
    authorization: `bearer ${authorization}`,
    "apns-topic": pushTopic(),
    "apns-push-type": "alert",
    "apns-priority": "10",
    "content-type": "application/json",
    ...(alert.collapseId ? { "apns-collapse-id": alert.collapseId.slice(0, 64) } : {}),
  };

  const order: PushEnvironment[] = environment === "production" ? ["production", "sandbox"] : ["sandbox", "production"];
  let last: ApnsOutcome = { status: "failed", reason: "not attempted" };
  for (const host of order) {
    let session: ClientHttp2Session | null = null;
    try {
      session = connect(HOSTS[host]);
      const response = await post(session, `/3/device/${token}`, headers, payload);
      last = outcomeFor(response);
    } catch (error) {
      last = { status: "failed", reason: error instanceof Error ? error.message : "transport error" };
    } finally {
      session?.close();
    }
    // Only a token that is valid *somewhere* is worth asking the other host
    // about. Everything else is already its final answer.
    if (last.status !== "wrongEnvironment") return { ...last, environment: host };
  }
  // Both hosts called it a bad token, so it is simply not a live token.
  return { status: "gone", reason: "BadDeviceToken", environment };
}
