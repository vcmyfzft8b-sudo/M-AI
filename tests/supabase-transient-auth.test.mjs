import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createServerClient } from "@supabase/ssr";
import { AuthApiError } from "@supabase/supabase-js";

import { getUserWithRetry, isTransientAuthError } from "../src/lib/supabase/auth-user.ts";

// 2026-09-07: one POST /tutor/turn answered 401 "Nedovoljen dostop" mid-walkthrough while
// the report sent 30 ms later on the same cookies was let in. getUser() answers
// { user: null } for an Auth hiccup exactly as for a missing session.
const URL_ = "https://project.supabase.co";
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "qa@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const session = {
  access_token: "header.payload.signature", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: "refresh", user: USER,
};
const cookieValue = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");

/** A server client whose network answers /auth/v1/user from a script, one step per call. */
function clientWith(script, calls) {
  return createServerClient(URL_, "anon-key", {
    cookies: { getAll: () => [{ name: "sb-project-auth-token", value: cookieValue }], setAll() {} },
    global: {
      fetch: async (input) => {
        const url = String(input?.url ?? input);
        if (!url.includes("/auth/v1/user")) throw new Error("unexpected request " + url);
        const step = script[Math.min(calls.count, script.length - 1)];
        calls.count += 1;
        if (step instanceof Error) throw step;
        return new Response(JSON.stringify(step.body), { status: step.status, headers: { "content-type": "application/json" } });
      },
    },
  });
}

test("today: a dropped connection at Auth reads as signed out", async () => {
  const calls = { count: 0 };
  const { data } = await clientWith([new TypeError("fetch failed")], calls).auth.getUser();
  assert.equal(data.user, null);
});

test("a dropped connection at Auth is asked again, on a fresh client, and the learner is let in", async () => {
  const calls = { count: 0 };
  const script = [new TypeError("fetch failed"), { status: 200, body: USER }];
  const made = [];
  const lookup = await getUserWithRetry(() => { const c = clientWith(script, calls); made.push(c); return c; }, { retryDelayMs: 1 });
  assert.equal(lookup.user?.id, USER.id);
  assert.equal(lookup.unavailable, null);
  assert.equal(made.length, 2, "the retry uses a new client");
  assert.equal(lookup.client, made[1], "the route queries through the client that answered");
});

test("a 5xx from Auth twice is 'unavailable', not 'signed out'", async () => {
  const calls = { count: 0 };
  const script = [{ status: 503, body: { message: "upstream" } }];
  const lookup = await getUserWithRetry(() => clientWith(script, calls), { retryDelayMs: 1 });
  assert.equal(lookup.user, null);
  assert.ok(lookup.unavailable, "the route will answer 503");
  assert.equal(calls.count, 2);
});

test("a real 'no such session' answer is not retried", async () => {
  const calls = { count: 0 };
  const script = [{ status: 401, body: { message: "invalid JWT", code: "bad_jwt" } }];
  const lookup = await getUserWithRetry(() => clientWith(script, calls), { retryDelayMs: 1 });
  assert.equal(lookup.user, null);
  assert.equal(lookup.unavailable, null);
  assert.equal(calls.count, 1);
});

test("what counts as transient", () => {
  assert.equal(isTransientAuthError(new TypeError("fetch failed")), true);
  assert.equal(isTransientAuthError(new AuthApiError("rate", 429, "over_request_rate_limit")), true);
  assert.equal(isTransientAuthError(new AuthApiError("boom", 500, "unexpected_failure")), true);
  assert.equal(isTransientAuthError(new AuthApiError("nope", 401, "bad_jwt")), false);
  assert.equal(isTransientAuthError(null), false);
});

test("every tutor route authenticates through getRouteUser", () => {
  for (const name of ["turn", "plan", "report", "session", "usage"]) {
    const source = readFileSync(new URL(`../src/app/api/lectures/[id]/tutor/${name}/route.ts`, import.meta.url), "utf8");
    const handlers = source.split(/^export async function /m).length - 1;
    assert.equal(source.match(/await getRouteUser\(/g)?.length, handlers, name);
    assert.doesNotMatch(source, /auth\.getUser\(\)/, name);
  }
  const server = readFileSync(new URL("../src/lib/supabase/server.ts", import.meta.url), "utf8");
  assert.match(server, /status: 503, headers: \{ "Retry-After": "1", "x-memo-retry": "auth" \}/);
});

test("the tutor retries a turn once when Auth was briefly unavailable", () => {
  const tutor = readFileSync(new URL("../src/components/lecture-tutor.tsx", import.meta.url), "utf8");
  assert.match(tutor, /response\.headers\.get\("x-memo-retry"\) === "auth"/);
  assert.match(tutor, /if \(ready && !authBlip\(ready\)\) return ready;/);
  assert.match(tutor, /if \(attempt >= 1 \|\| !authBlip\(response\)\) \{\s*return response;/);
});
