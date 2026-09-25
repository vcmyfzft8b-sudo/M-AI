import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function route({ user = { id: "synthetic-user" }, own = async () => ({ title: "Synthetic note", language_hint: "sl" }), access = async () => ({ allowed: true }) } = {}) {
  const calls = [];
  const modules = {
    zod: { z }, "next/server": { NextResponse: { json: (data, init) => Response.json(data, init) } },
    "@/lib/supabase/server": { getRouteUser: async () => user
      ? { supabase: {}, user, response: null }
      : { supabase: null, user: null, response: Response.json({ error: "api.unauthorized" }, { status: 401 }) } },
    "@/lib/rate-limit": { enforceRateLimit: async () => null, rateLimitPresets: { tutorTurn: [] } },
    "@/lib/request-validation": { parseJsonRequest: async () => ({ success: true, data: { kind: "answer", history: [] } }) },
    "@/lib/validation": { routeIdParamSchema: z.object({ id: z.string().uuid() }) },
    "@/lib/i18n/server": { tr: async key => key },
    "@/lib/lectures": { ensureUserOwnsLecture: async () => { calls.push("ownership"); return own(); } },
    "@/lib/billing": { canUseLectureFeatures: async () => { calls.push("billing"); return access(); }, createBillingRequiredResponse: () => Response.json({}, { status: 402 }) },
    "@/lib/tutor-voice": { loadTutorGrounding: async (_id, owned) => { calls.push(["grounding", owned]); return {}; }, speakTutorTurn: async () => ({ speech: "Answer" }) },
    "@/lib/chat-stream": { createChatEventStream: () => { calls.push("stream"); return new Response(); } },
  };
  const context = { exports: {}, require: name => modules[name], Response };
  const source = fs.readFileSync(new URL("../src/app/api/lectures/[id]/tutor/turn/route.ts", import.meta.url), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return { calls, run: () => context.exports.POST(new Request("https://synthetic.invalid"), { params: Promise.resolve({ id: "4a22161b-61ef-4486-8b92-13fb0ff8613f" }) }) };
}

test("turn ownership and billing overlap, then grounding reuses the owned metadata", async () => {
  const gate = deferred(); const h = route({ own: () => gate.promise });
  const result = h.run(); await settle();
  assert.deepEqual(h.calls, ["ownership", "billing"]);
  const owned = { title: "Synthetic", language_hint: "sl" }; gate.resolve(owned);
  assert.equal((await result).status, 200);
  assert.equal(h.calls[2][1], owned);
  assert.equal(h.calls.at(-1), "stream");
});

for (const [label, options, status] of [
  ["unauthenticated", { user: null }, 401],
  ["unowned", { own: async () => null }, 404],
  ["unentitled", { access: async () => ({ allowed: false, code: "trial_exhausted" }) }, 402],
]) {
  test(`${label} requests never read note contents or start generation`, async () => {
    const h = route(options); assert.equal((await h.run()).status, status);
    assert.equal(h.calls.some(c => Array.isArray(c) || c === "stream"), false);
  });
}
