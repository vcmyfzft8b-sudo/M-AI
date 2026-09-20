import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

import { isNativeUserAgent } from "../src/lib/mobile/runtime.ts";
import { onboardingSubmissionSchema } from "../src/lib/onboarding-submission.ts";

/**
 * The survey now runs in front of the sign-in wall, which means the answers
 * arrive before there is an account to hang them on. Two things have to hold:
 * a response is kept even when nobody ever signs up, and the account that does
 * appear afterwards gets the answers attached to it exactly once.
 */

const NATIVE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MemoAI-iOS/1.0";
const SAFARI_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

const VALID = {
  educationLevel: "high_school",
  currentAverageGrade: "3,5",
  targetGrade: "4,5",
  studyGoal: "Boljse ocene.",
  answers: { role: "high_school_student", feature: "quizzes" },
};

function transpile(path) {
  return ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

/** Loads the open onboarding route with its storage and rate limiter replaced. */
function loadRoute({ save = async () => "response-1", limited = null } = {}) {
  const stored = [];
  class NextResponse extends Response {
    constructor(body, init) { super(body, init); this.cookies = { jar: [], set(name, value, options) { this.jar.push({ name, value, options }); } }; }
    static json(data, init) { return new NextResponse(JSON.stringify(data), init); }
  }
  const modules = {
    zod: { z },
    "next/server": { NextResponse },
    "@/lib/i18n/server": { getLocale: async () => "sl", tr: async (key) => key },
    "@/lib/mobile/runtime": { isNativeUserAgent },
    "@/lib/onboarding-anonymous": {
      ONBOARDING_COOKIE_MAX_AGE: 2592000,
      ONBOARDING_RESPONSE_COOKIE: "memo-onboarding",
      ONBOARDING_SEEN_COOKIE: "memo-onboarded",
      saveAnonymousOnboarding: async (submission, context) => {
        stored.push({ submission, context });
        return save(submission, context);
      },
    },
    "@/lib/onboarding-submission": { ONBOARDING_MAX_BYTES: 8192, onboardingSubmissionSchema },
    "@/lib/rate-limit": { rateLimitPresets: { mutate: [] }, enforceRateLimit: async () => limited },
    "@/lib/request-validation": {
      parseJsonRequest: async (request, schema) => {
        const parsed = schema.safeParse(await request.json());
        return parsed.success
          ? { success: true, data: parsed.data }
          : { success: false, response: NextResponse.json({ error: "bad" }, { status: 400 }) };
      },
    },
  };
  const context = {
    exports: {}, Request, Response, URL, Date, JSON, Promise,
    require: (name) => { if (!(name in modules)) throw new Error(`Unstubbed import ${name}`); return modules[name]; },
  };
  vm.runInNewContext(transpile("app/api/onboarding/anonymous/route.ts"), context);

  const post = (body, { userAgent = SAFARI_UA, origin = "https://www.memoai.eu" } = {}) => {
    const request = new Request("https://www.memoai.eu/api/onboarding/anonymous", {
      method: "POST",
      headers: { "user-agent": userAgent, "content-type": "application/json", origin },
      body: JSON.stringify(body),
    });
    request.nextUrl = new URL("https://www.memoai.eu/api/onboarding/anonymous");
    return context.exports.POST(request);
  };
  return { post, stored };
}

test("a survey from someone with no account is stored", async () => {
  const route = loadRoute();
  const response = await route.post(VALID);

  assert.equal(response.status, 200);
  assert.equal(route.stored.length, 1);
  assert.equal(route.stored[0].submission.educationLevel, "high_school");
  assert.equal(route.stored[0].submission.answers.role, "high_school_student");
});

test("the response id goes back as an httpOnly cookie and never in the body", async () => {
  const route = loadRoute({ save: async () => "secret-response-id" });
  const response = await route.post(VALID);

  const body = await response.clone().json();
  assert.ok(!JSON.stringify(body).includes("secret-response-id"), "the id reached the page");

  const named = response.cookies.jar.find((cookie) => cookie.name === "memo-onboarding");
  assert.ok(named, "no cookie names the response");
  assert.equal(named.value, "secret-response-id");
  // It is a bearer for those answers; nothing in the page needs to read it.
  assert.equal(named.options.httpOnly, true);
  assert.equal(named.options.sameSite, "lax");
});

test("a second cookie remembers the browser has been asked, and is readable", async () => {
  const route = loadRoute();
  const response = await route.post(VALID);

  const seen = response.cookies.jar.find((cookie) => cookie.name === "memo-onboarded");
  assert.ok(seen, "nothing remembers the survey was answered");
  // This one carries no secret and exists so a returning visitor is offered
  // sign-in instead of the whole survey again.
  assert.equal(seen.options.httpOnly, false);
});

test("the app and the site are told apart, because their funnels are not comparable", async () => {
  const web = loadRoute();
  await web.post(VALID);
  assert.equal(web.stored[0].context.source, "web");

  const app = loadRoute();
  await app.post(VALID, { userAgent: NATIVE_UA });
  assert.equal(app.stored[0].context.source, "ios");
});

test("an off-origin post is refused before anything is stored", async () => {
  const route = loadRoute();
  const response = await route.post(VALID, { origin: "https://example.com" });
  assert.equal(response.status, 403);
  assert.deepEqual(route.stored, []);
});

test("a malformed survey is refused before anything is stored", async () => {
  for (const body of [
    {},
    { ...VALID, educationLevel: "phd" },
    { ...VALID, studyGoal: "" },
    { ...VALID, answers: { role: "not-a-role" } },
    { ...VALID, answers: { currentAverageGrade: 99 } },
  ]) {
    const route = loadRoute();
    const response = await route.post(body);
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.deepEqual(route.stored, [], JSON.stringify(body));
  }
});

test("a rate-limited caller is refused before anything is stored", async () => {
  const route = loadRoute({ limited: new Response(null, { status: 429 }) });
  const response = await route.post(VALID);
  assert.equal(response.status, 429);
  assert.deepEqual(route.stored, []);
});

test("storage failing is a 500, not a cookie pointing at nothing", async () => {
  const route = loadRoute({ save: async () => { throw new Error("database down"); } });
  const response = await route.post(VALID);
  assert.equal(response.status, 500);
  // A cookie naming a response that was never written would send the account
  // looking for answers that do not exist.
  assert.equal(response.cookies.jar.length, 0);
});

// ---------------------------------------------------------------------------
// The claim
// ---------------------------------------------------------------------------

const MIGRATION = readFileSync(new URL("../supabase/migrations/0054_anonymous_onboarding.sql", import.meta.url), "utf8");

test("a response can only be claimed once", () => {
  // The guard is the WHERE, not application code: the cookie outlives sign-out,
  // so two accounts on one phone can both present it and only the first may
  // have it.
  assert.match(MIGRATION, /update public\.onboarding_responses[\s\S]*?where id = response_id[\s\S]*?and claimed_by is null/);
  assert.match(MIGRATION, /if not found then\s*\n\s*return false;/);
});

test("claiming never overwrites a profile that has already been used", () => {
  // Every conflict branch keeps the profile's own value where it has one.
  const update = MIGRATION.slice(MIGRATION.indexOf("on conflict (id) do update set"));
  for (const column of [
    "education_level", "current_average_grade", "target_grade", "study_goal",
    "onboarding_role", "onboarding_feature", "onboarding_completed_at",
  ]) {
    assert.match(
      update,
      new RegExp(`${column} = coalesce\\(p\\.${column}, excluded\\.${column}\\)`),
      `${column} would overwrite what the profile already has`,
    );
  }
});

test("an unclaimed response stays, and is indexed as the funnel answer it is", () => {
  // The rows nobody ever claimed are the point of the table, not debris.
  assert.match(MIGRATION, /create index onboarding_responses_unclaimed_idx[\s\S]*?where claimed_by is null/);
  assert.doesNotMatch(MIGRATION, /delete from public\.onboarding_responses/);
});

test("the table is service-role only, like every other table holding survey answers", () => {
  assert.match(MIGRATION, /alter table public\.onboarding_responses enable row level security/);
  assert.match(MIGRATION, /revoke all on public\.onboarding_responses from anon, authenticated/);
  assert.match(MIGRATION, /revoke all on function public\.claim_onboarding_response\([^)]*\) from public, anon, authenticated/);
});

// ---------------------------------------------------------------------------
// The order of the funnel
// ---------------------------------------------------------------------------

const LAYOUT = readFileSync(new URL("../src/app/app/layout.tsx", import.meta.url), "utf8");
const PAGE = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
const NAV = readFileSync(new URL("../src/components/landing/landing-nav.tsx", import.meta.url), "utf8");
const FLOW = readFileSync(new URL("../src/components/onboarding-flow.tsx", import.meta.url), "utf8");
const CONFIG = readFileSync(new URL("../ios/MemoAI/AppConfiguration.swift", import.meta.url), "utf8");

test("the claim happens before anything reads the profile", () => {
  // `getViewerAppState` is memoised for the whole request, so a claim made
  // after it — anywhere — would be invisible to the render that has to decide
  // whether to ask the survey all over again.
  const claim = LAYOUT.indexOf("claimPendingOnboarding()");
  const read = LAYOUT.indexOf("getViewerAppState()");
  assert.ok(claim > 0, "the layout never claims");
  assert.ok(read > 0, "the layout never reads the state");
  assert.ok(claim < read, "the claim runs after the state it has to affect is read");
});

test("the landing page offers the survey, and sign-in stays sign-in", () => {
  for (const source of [PAGE, NAV]) {
    const tryLinks = [...source.matchAll(/href="([^"]+)"[^>]*>\s*\{t\("landing\.cta\.tryFree"\)/g)];
    assert.ok(tryLinks.length > 0, "no try-it link found");
    for (const [, href] of tryLinks) {
      assert.equal(href, "/onboarding", "the try-it button skips the survey");
    }
    const signIn = [...source.matchAll(/href="([^"]+)"[^>]*>\s*\{t\("landing\.cta\.signIn"\)/g)];
    for (const [, href] of signIn) {
      assert.equal(href, "/auth/continue", "sign-in no longer goes to sign-in");
    }
  }
});

test("the survey answered without an account ends at sign-in, not at the app", () => {
  assert.match(FLOW, /router\.push\(anonymous \? "\/auth\/continue" : mapAppHrefForClient\("\/app\/start"\)\)/);
  // And it saves to the open endpoint rather than the profile one, which would
  // 401 and lose the whole survey.
  assert.match(FLOW, /anonymous \? "\/api\/onboarding\/anonymous" : "\/api\/profile\/onboarding"/);
});

test("the app opens on the entry point that can sort all three arrivals", () => {
  // A resumed session, a fresh install and a signed-out return look identical
  // to the wrapper; only the page can tell them apart.
  assert.match(CONFIG, /static var startURL: URL \{ origin\.appendingPathComponent\("onboarding"\) \}/);
});
