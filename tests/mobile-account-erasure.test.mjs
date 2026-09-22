import assert from "node:assert/strict";
import { test } from "node:test";
import { eraseDueAccountsWith } from "../src/lib/mobile/account-erasure-engine.ts";

function fixture() {
  const tables = {
    account_deletion_requests: [{ user_id: "owner", cleanup_after: "2026-09-15T13:00:00Z", failure_lecture_ids: [] }],
    lectures: [{ id: "lecture", user_id: "owner" }],
    generation_failure_captures: [{ lecture_id: "retained", user_id: "owner" }],
    ai_usage_events: [{ user_id: "owner" }],
    site_sessions: [{ id: "visit", user_id: "owner" }, { id: "other-visit", user_id: "other" }],
    site_page_views: [
      { session_id: "visit", user_id: "owner" },
      { session_id: "visit", user_id: null },
      { session_id: "other-visit", user_id: "other" },
    ],
    profiles: [{ id: "owner", stripe_customer_id: "customer" }],
  };
  const objects = new Set(["owner/audio.wav", "tts/owner/speech.wav", "podcast/owner/show.wav", "failure-captures/retained/input.pdf", "other/keep.pdf"]);
  const state = { tables, objects, authExists: true, failStorage: false, failCompletion: false, failAnalytics: false, cancelled: 0 };
  const service = {
    from(table) {
      let action = "select", updates, single = false, filters = [], start = 0, end = Infinity;
      const q = {
        select() { return q; }, order() { return q; },
        limit(n) { end = n - 1; return q; },
        range(a, b) { start = a; end = b; return q; },
        eq(k, v) { filters.push(r => r[k] === v); return q; },
        lte(k, v) { filters.push(r => new Date(r[k]) <= new Date(v)); return q; },
        update(value) { action = "update"; updates = value; return q; },
        delete() { action = "delete"; return q; },
        maybeSingle() { single = true; return q; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            const rows = tables[table].filter(r => filters.every(f => f(r))).slice(start, end + 1);
            if (action === "update") rows.forEach(r => Object.assign(r, updates));
            if (action === "delete") {
              if (table === "account_deletion_requests" && state.failCompletion) return { error: new Error("connection lost after auth deletion") };
              if (table === "site_sessions" && state.failAnalytics) return { error: new Error("analytics unavailable") };
              if (table === "site_sessions") tables.site_page_views = tables.site_page_views.filter(v => !rows.some(s => s.id === v.session_id));
              tables[table] = tables[table].filter(r => !rows.includes(r));
            }
            return { data: single ? rows[0] ?? null : structuredClone(rows), error: null };
          }).then(resolve, reject);
        },
      };
      return q;
    },
    storage: { from() { return {
      async list(prefix, { limit }) {
        if (state.failStorage) return { data: null, error: new Error("storage unavailable") };
        const names = [...new Set([...objects].filter(p => p.startsWith(`${prefix}/`)).map(p => p.slice(prefix.length + 1).split("/")[0]))].slice(0, limit);
        return { data: names.map(name => ({ name, id: objects.has(`${prefix}/${name}`) ? name : null })), error: null };
      },
      async remove(paths) { paths.forEach(p => objects.delete(p)); return { error: null }; },
    }; } },
    auth: { admin: { async deleteUser() {
      if (!state.authExists) return { error: { status: 404 } };
      state.authExists = false;
      tables.lectures = []; tables.profiles = [];
      for (const table of ["site_sessions", "site_page_views"]) {
        tables[table].forEach(row => { if (row.user_id === "owner") row.user_id = null; });
      }
      return { error: null };
    } } },
  };
  state.run = (time = "2026-09-15T14:00:00Z", revoke = async () => {}) => eraseDueAccountsWith(service, async () => { state.cancelled++; }, new Date(time), revoke);
  return state;
}

test("erasure waits for upload tokens to drain and preserves other accounts", async () => {
  const f = fixture();
  assert.deepEqual(await f.run("2026-09-15T12:59:59Z"), { deleted: 0, failed: 0 });
  assert.equal(f.objects.size, 5);
  assert.deepEqual(await f.run(), { deleted: 1, failed: 0 });
  assert.deepEqual([...f.objects], ["other/keep.pdf"]);
  assert.equal(f.cancelled, 1);
  assert.equal(f.tables.account_deletion_requests.length, 0);
  assert.deepEqual(f.tables.site_sessions, [{ id: "other-visit", user_id: "other" }]);
  assert.deepEqual(f.tables.site_page_views, [{ session_id: "other-visit", user_id: "other" }]);
});

test("analytics cleanup failure keeps ownership and the durable job for retry", async () => {
  const f = fixture(); f.failAnalytics = true;
  assert.deepEqual(await f.run(), { deleted: 0, failed: 1 });
  assert.equal(f.authExists, true);
  assert.equal(f.tables.site_sessions[0].user_id, "owner");
  assert.equal(f.tables.account_deletion_requests.length, 1);
  f.failAnalytics = false;
  assert.deepEqual(await f.run(), { deleted: 1, failed: 0 });
  assert.deepEqual(f.tables.site_sessions, [{ id: "other-visit", user_id: "other" }]);
  assert.deepEqual(f.tables.site_page_views, [{ session_id: "other-visit", user_id: "other" }]);
});

test("Apple revocation failure retains the account and job until a retry succeeds", async () => {
  const f = fixture();
  assert.deepEqual(await f.run(undefined, async () => { throw new Error("Apple offline"); }), { deleted: 0, failed: 1 });
  assert.equal(f.authExists, true);
  assert.equal(f.tables.account_deletion_requests.length, 1);
  let revoked = false;
  assert.deepEqual(await f.run(undefined, async id => { assert.equal(id, "owner"); revoked = true; }), { deleted: 1, failed: 0 });
  assert.equal(revoked, true);
  assert.equal(f.authExists, false);
});

test("storage failure retains both auth and durable cleanup inventory for retry", async () => {
  const f = fixture(); f.failStorage = true;
  assert.deepEqual(await f.run(), { deleted: 0, failed: 1 });
  assert.equal(f.authExists, true);
  assert.deepEqual(f.tables.account_deletion_requests[0].failure_lecture_ids, ["lecture", "retained"]);
  f.failStorage = false;
  assert.deepEqual(await f.run(), { deleted: 1, failed: 0 });
});

test("retry after auth deletion still knows the orphaned prefixes", async () => {
  const f = fixture(); f.failCompletion = true;
  assert.deepEqual(await f.run(), { deleted: 0, failed: 1 });
  assert.equal(f.authExists, false);
  assert.equal(f.tables.account_deletion_requests.length, 1);
  f.objects.add("failure-captures/retained/retry.pdf");
  f.failCompletion = false;
  assert.deepEqual(await f.run(), { deleted: 1, failed: 0 });
  assert.deepEqual([...f.objects], ["other/keep.pdf"]);
});
