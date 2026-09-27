import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { createServerClient } from "@supabase/ssr";

// 2026-09-27 (Sentry 149777630, 149778206): mid-walkthrough, POST /tutor/turn answered 404
// "Ni najdeno." for a note the learner owned, and three minutes later the same session's
// token refresh was answered 429. API routes skip the proxy's session refresh, so a route
// holding an expired access-token cookie refreshes it itself. getRouteUser did that and
// verified the learner; ensureUserOwnsLecture then built a second client from the same
// cookies, which refreshed again. When that second refresh failed, supabase-js sent the
// ownership query with the anon key, RLS hid the row, and an owned note read as missing.
const URL_ = "https://project.supabase.co";
const ANON = "anon-key";
const USER = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "qa@example.com", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const expired = {
  access_token: "expired-access", token_type: "bearer", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) - 60, refresh_token: "refresh-1", user: USER,
};
const cookieValue = "base64-" + Buffer.from(JSON.stringify(expired)).toString("base64url");

/** Auth answers the first refresh and rate-limits the rest, as it did in production. */
function network() {
  const seen = { refreshes: 0, restAuth: [] };
  const fetch = async (input, init = {}) => {
    const url = String(input?.url ?? input);
    const headers = new Headers(init.headers ?? input?.headers);
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.includes("/auth/v1/token")) {
      seen.refreshes += 1;
      return seen.refreshes === 1
        ? json({ ...expired, access_token: "fresh-access", refresh_token: "refresh-2", expires_at: Math.floor(Date.now() / 1000) + 3600 })
        : json({ code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }, 429);
    }
    if (url.includes("/auth/v1/user")) return json(USER);
    if (url.includes("/rest/v1/lectures")) {
      const token = headers.get("authorization")?.replace(/^Bearer /, "");
      seen.restAuth.push(token);
      // RLS: only the learner's own token sees the row.
      return json(token === "fresh-access" ? { id: "lecture", user_id: USER.id } : null);
    }
    throw new Error("unexpected request " + url);
  };
  return { seen, fetch };
}

const client = fetch => createServerClient(URL_, ANON, {
  cookies: { getAll: () => [{ name: "sb-project-auth-token", value: cookieValue }], setAll() {} },
  global: { fetch },
});

const ownership = supabase => supabase.from("lectures").select("*").eq("id", "lecture").eq("user_id", USER.id).maybeSingle();

test("a second client from the same expired cookie refreshes again and queries as anon", async () => {
  const { seen, fetch } = network();
  const verified = await client(fetch).auth.getUser();
  assert.equal(verified.data.user?.id, USER.id);

  const { data } = await ownership(client(fetch));
  assert.equal(seen.refreshes, 2);
  assert.equal(seen.restAuth[0], ANON);
  assert.equal(data, null, "the learner's own note reads as not found");
});

test("the client that verified the learner queries with the token it refreshed", async () => {
  const { seen, fetch } = network();
  const supabase = client(fetch);
  assert.equal((await supabase.auth.getUser()).data.user?.id, USER.id);

  const { data } = await ownership(supabase);
  assert.equal(seen.refreshes, 1);
  assert.deepEqual(seen.restAuth, ["fresh-access"]);
  assert.equal(data?.id, "lecture");
});

function apiRoutes(dir = new URL("../src/app/api/", import.meta.url)) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
    return entry.isDirectory() ? apiRoutes(url) : entry.name === "route.ts" ? [url] : [];
  });
}

test("API routes check ownership on the client that verified the learner", () => {
  const root = new URL("../", import.meta.url).pathname;
  let checked = 0;
  for (const url of apiRoutes()) {
    const path = decodeURIComponent(url.pathname).slice(root.length);
    const source = fs.readFileSync(url, "utf8");
    for (const [call] of source.matchAll(/ensureUserOwnsLecture\(\{[^}]*\}\)/g)) {
      checked += 1;
      assert.match(call, /\bsupabase\b/, `${path}: ${call.replace(/\s+/g, " ")}`);
    }
  }
  assert.ok(checked >= 39, `expected every lecture route, checked ${checked}`);
});

test("tutor and chat routes pass the client getRouteUser verified", () => {
  for (const name of ["tutor/turn", "tutor/plan", "tutor/session", "chat", "chat/stream"]) {
    const source = fs.readFileSync(new URL(`../src/app/api/lectures/[id]/${name}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /ensureUserOwnsLecture\(\{\s*lectureId: id,\s*user,\s*supabase: auth\.supabase,?\s*\}\)/, name);
  }
});
