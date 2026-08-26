import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

/**
 * Replays `supabase/migrations` in an in-process Postgres and exercises the
 * functions the admin dashboard depends on.
 *
 * The project requires a migration to be replayed locally before it is merged,
 * and this machine has neither Docker nor a system Postgres. PGlite runs the
 * real Postgres engine compiled to WASM, so the DDL and the PL/pgSQL below are
 * genuinely executed rather than merely parsed.
 *
 * If PGlite is not installed the whole file skips rather than failing, so the
 * suite still runs on a machine that has not installed the optional dependency.
 */

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../supabase/migrations", import.meta.url),
);

let PGlite;

try {
  ({ PGlite } = await import("@electric-sql/pglite"));
} catch {
  PGlite = null;
}

/**
 * Supabase-managed objects that the migrations reference but do not create.
 * Enough of each for the real migrations to run unmodified.
 */
const SUPABASE_BOOTSTRAP = `
  -- PGlite inherits the host timezone, so a suite that passes on a UTC CI
  -- runner can fail on a local machine (or vice versa). Pin a deliberately
  -- non-UTC session so every migration and test runs under the hostile
  -- timezone that exposed the naive timezone('utc', now()) defaults fixed in
  -- migration 0034 — host-independent, and biased toward catching that class.
  set timezone = 'Etc/GMT-8';
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role; exception when duplicate_object then null; end $$;
  create schema if not exists storage;
  create table if not exists storage.buckets (
    id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table if not exists storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text, name text, owner uuid, metadata jsonb
  );
  create or replace function storage.foldername(name text) returns text[]
    language sql immutable as $$ select string_to_array(name, '/') $$;
`;

/**
 * pgvector is not bundled with PGlite. Embedding columns become plain text and
 * the similarity-search function is dropped; nothing the admin dashboard uses
 * touches either, and every table it does depend on is still created for real.
 */
function withoutPgvector(sql) {
  return sql
    .replace(/create extension if not exists vector[^;]*;/gi, "")
    .replace(/\bvector\(\d+\)/gi, "text")
    .replace(/create index[^;]*using\s+(ivfflat|hnsw)[^;]*;/gi, "")
    .replace(
      /create or replace function public\.match_transcript_segments[\s\S]*?\$\$;/gi,
      "",
    );
}

async function migratedDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_BOOTSTRAP);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = withoutPgvector(await readFile(path.join(MIGRATIONS_DIR, file), "utf8"));

    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }
  }

  return {
    db,
    fileCount: files.length,
    query: async (sql, params) => (await db.query(sql, params)).rows,
  };
}

const options = PGlite
  ? {}
  : { skip: "@electric-sql/pglite is not installed; run npm install to enable" };

/**
 * The visitor-beacon RPC with sensible fixture defaults; tests override only
 * what they care about instead of repeating the 15-argument call.
 */
function recordSiteVisit(query, overrides = {}) {
  const visit = {
    sessionKey: "visitor",
    userId: null,
    path: "/",
    referrer: null,
    country: "SI",
    deviceType: "desktop",
    browser: "Chrome",
    os: "macOS",
    isBot: false,
    countPageView: true,
    ...overrides,
  };
  return query(
    `select public.record_site_visit($1,$2,$3,$4,null,null,null,$5,null,null,$6,$7,$8,$9,$10)`,
    [
      visit.sessionKey,
      visit.userId,
      visit.path,
      visit.referrer,
      visit.country,
      visit.deviceType,
      visit.browser,
      visit.os,
      visit.isBot,
      visit.countPageView,
    ],
  );
}

test("every migration applies in order on an empty database", options, async () => {
  const { query, fileCount } = await migratedDatabase();

  assert.ok(fileCount >= 27, "expected the full migration history");

  const tables = (
    await query(`select table_name from information_schema.tables
      where table_schema = 'public'
        and (table_name like 'admin%' or table_name like 'ugc%' or table_name like 'site%')
      order by table_name`)
  ).map((row) => row.table_name);

  assert.deepEqual(tables, [
    "admin_users",
    "site_page_views",
    "site_sessions",
    "ugc_account_stats",
    "ugc_classification_rules",
    "ugc_creator_accounts",
    "ugc_creators",
    "ugc_sync_runs",
    "ugc_video_stats",
    "ugc_videos",
  ]);
});

test("admin tables are service-role only", options, async () => {
  const { query } = await migratedDatabase();

  // RLS on with no policies means anon and authenticated are denied outright,
  // which is what keeps revenue and the user list off the public API.
  const unprotected = await query(`select relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (relname like 'admin%' or relname like 'ugc%' or relname like 'site%')
      and c.relrowsecurity = false`);

  assert.deepEqual(unprotected, [], "every admin table must have RLS enabled");

  const policies = await query(`select tablename, policyname from pg_policies
    where schemaname = 'public'
      and (tablename like 'admin%' or tablename like 'ugc%' or tablename like 'site%')`);

  assert.deepEqual(policies, [], "no policy may grant a non-service role access");
});

test("the owner is seeded and the allowlist is case-insensitive", options, async () => {
  const { db, query } = await migratedDatabase();

  assert.deepEqual(await query(`select email, role from public.admin_users`), [
    { email: "nace.valencic@gmail.com", role: "owner" },
  ]);

  await assert.rejects(
    () => db.query(`insert into public.admin_users (email) values ('NACE.VALENCIC@GMAIL.COM')`),
    /duplicate key/,
    "a differently-cased duplicate must not create a second row",
  );
});

test("daily view deltas turn cumulative counters into per-day gains", options, async () => {
  const { query } = await migratedDatabase();

  const [creator] = await query(
    `insert into public.ugc_creators (name, slug) values ('Ema','ema') returning id`,
  );
  const [account] = await query(
    `insert into public.ugc_creator_accounts (creator_id, platform, handle, profile_url)
     values ($1,'tiktok','eemadilema','https://x') returning id`,
    [creator.id],
  );

  const addVideo = async (platformId, classification, postedAt) =>
    (
      await query(
        `insert into public.ugc_videos
           (account_id, creator_id, platform, platform_video_id, url, classification, posted_at)
         values ($1,$2,'tiktok',$3,'https://x',$4,$5) returning id`,
        [account.id, creator.id, platformId, classification, postedAt],
      )
    )[0].id;

  const snapshot = (videoId, day, views) =>
    query(
      `insert into public.ugc_video_stats (video_id, account_id, creator_id, captured_on, views)
       values ($1,$2,$3,$4::date,$5)`,
      [videoId, account.id, creator.id, day, views],
    );

  // Midday Ljubljana time, so the post date is unambiguous.
  const memo = await addVideo("v-memo", "memo", "2026-08-10T10:00:00Z");
  const personal = await addVideo("v-personal", "personal", "2026-08-10T10:00:00Z");

  await snapshot(memo, "2026-08-10", 1000);
  await snapshot(memo, "2026-08-11", 2500);
  await snapshot(memo, "2026-08-12", 3000);
  await snapshot(personal, "2026-08-11", 9999);

  const rows = await query(
    `select day::text as day, views, videos_posted
     from public.ugc_daily_view_deltas('2026-08-10','2026-08-12', true) order by day`,
  );

  // The first snapshot counts in full; after that only the increase counts.
  assert.deepEqual(
    rows.map((row) => [row.day, Number(row.views)]),
    [
      ["2026-08-10", 1000],
      ["2026-08-11", 1500],
      ["2026-08-12", 500],
    ],
  );

  assert.equal(Number(rows[0].videos_posted), 1);

  // The personal post must not leak into campaign totals.
  assert.equal(
    rows.reduce((sum, row) => sum + Number(row.views), 0),
    3000,
  );

  const [all] = await query(
    `select coalesce(sum(views),0)::bigint as total
     from public.ugc_daily_view_deltas('2026-08-10','2026-08-12', false)`,
  );
  assert.equal(Number(all.total), 12999);
});

test("a downward platform correction cannot produce a negative day", options, async () => {
  const { query } = await migratedDatabase();

  const [creator] = await query(
    `insert into public.ugc_creators (name, slug) values ('Ema','ema') returning id`,
  );
  const [account] = await query(
    `insert into public.ugc_creator_accounts (creator_id, platform, handle, profile_url)
     values ($1,'tiktok','h','https://x') returning id`,
    [creator.id],
  );
  const [video] = await query(
    `insert into public.ugc_videos (account_id, creator_id, platform, platform_video_id, url, classification)
     values ($1,$2,'tiktok','v','https://x','memo') returning id`,
    [account.id, creator.id],
  );

  for (const [day, views] of [
    ["2026-08-11", 5000],
    ["2026-08-12", 4000],
  ]) {
    await query(
      `insert into public.ugc_video_stats (video_id, account_id, creator_id, captured_on, views)
       values ($1,$2,$3,$4::date,$5)`,
      [video.id, account.id, creator.id, day, views],
    );
  }

  const [row] = await query(
    `select views from public.ugc_daily_view_deltas('2026-08-12','2026-08-12', true)`,
  );

  assert.equal(Number(row.views), 0, "a lost-views correction reads as zero, not negative");
});

test("post dates are bucketed in the reporting timezone, not UTC", options, async () => {
  const { query } = await migratedDatabase();

  const [creator] = await query(
    `insert into public.ugc_creators (name, slug) values ('Ema','ema') returning id`,
  );
  const [account] = await query(
    `insert into public.ugc_creator_accounts (creator_id, platform, handle, profile_url)
     values ($1,'tiktok','h','https://x') returning id`,
    [creator.id],
  );

  // 22:30 UTC on the 18th is 00:30 on the 19th in Ljubljana. Bucketing by UTC
  // would credit this post to the previous day and put the chart a day out of
  // step with the snapshots written from the app.
  await query(
    `insert into public.ugc_videos
       (account_id, creator_id, platform, platform_video_id, url, classification, posted_at)
     values ($1,$2,'tiktok','v-late','https://x','memo','2026-08-18T22:30:00Z')`,
    [account.id, creator.id],
  );

  const rows = await query(
    `select day::text as day, videos_posted
     from public.ugc_daily_view_deltas('2026-08-17','2026-08-20', true)
     where videos_posted > 0`,
  );

  assert.deepEqual(
    rows.map((row) => row.day),
    ["2026-08-19"],
  );
});

test("the visitor beacon separates page views from heartbeats", options, async () => {
  const { query } = await migratedDatabase();

  const [user] = await query(
    `insert into auth.users (email) values ('a@b.c') returning id`,
  );

  await recordSiteVisit(query, { sessionKey: "sess-1", referrer: "google.com" });
  await recordSiteVisit(query, { sessionKey: "sess-1", userId: user.id, path: "/app" });
  await recordSiteVisit(query, { sessionKey: "sess-1", path: "/app", countPageView: false });

  const [session] = await query(
    `select * from public.site_sessions where session_key = 'sess-1'`,
  );

  assert.equal(session.page_views, 2, "a heartbeat must not count as a page view");
  assert.equal(session.user_id, user.id, "signing in mid-session attaches the user");
  assert.equal(session.entry_path, "/", "first-touch entry path is kept");
  assert.equal(session.referrer_host, "google.com", "first-touch referrer is kept");

  const [{ count }] = await query(
    `select count(*)::int as count from public.site_page_views`,
  );
  assert.equal(count, 2);

  const [{ sessions }] = await query(
    `select count(*)::int as sessions from public.site_sessions`,
  );
  assert.equal(sessions, 1, "repeat visits reuse one session row");
});

test("traffic aggregates exclude bots", options, async () => {
  const { query } = await migratedDatabase();

  await recordSiteVisit(query, { sessionKey: "human" });
  await recordSiteVisit(query, {
    sessionKey: "crawler",
    country: "US",
    deviceType: "bot",
    browser: "",
    os: "",
    isBot: true,
  });

  const [today] = await query(
    `select visitors, page_views from public.site_traffic_daily(
       (timezone('Europe/Ljubljana', now()))::date,
       (timezone('Europe/Ljubljana', now()))::date)`,
  );

  assert.equal(Number(today.visitors), 1, "the bot session must not be counted");
  assert.equal(Number(today.page_views), 1);
});

test("site_traffic_daily buckets the 22:00-24:00 UTC window on the Ljubljana day", options, async () => {
  const { query } = await migratedDatabase();

  // 2026-08-26 22:30 UTC is 2026-08-27 00:30 in Europe/Ljubljana (CEST): the
  // window in which a UTC day bucket and the dashboard's Ljubljana bucket
  // disagree, pinned instead of derived from now() so it is exercised at any
  // wall-clock time. Timestamps are inserted with explicit offsets, so this
  // pins the aggregate's bucketing convention (a "fix" that switched it to
  // UTC would fail here); the storage half of the midnight bug is pinned by
  // the session-timezone test below.
  const midnightVisit = "2026-08-26 22:30:00+00";

  await query(
    `with s as (
       insert into public.site_sessions
         (session_key, first_seen_at, last_seen_at, page_views, is_bot)
       values ('midnight', $1, $1, 1, false)
       returning id
     )
     insert into public.site_page_views (session_id, path, created_at)
     select id, '/', $1 from s`,
    [midnightVisit],
  );

  const days = await query(
    `select day::text as day, visitors, page_views, new_visitors
     from public.site_traffic_daily('2026-08-26', '2026-08-27')
     where visitors > 0 or new_visitors > 0`,
  );

  assert.deepEqual(
    days,
    [{ day: "2026-08-27", visitors: 1, page_views: 1, new_visitors: 1 }],
    "the visit belongs to the Ljubljana day it happened on, not its UTC day",
  );
});

test("stored instants do not depend on the session timezone", options, async () => {
  const { db, query } = await migratedDatabase();

  // The bootstrap already pins the replay to Etc/GMT-8; restate it here so
  // this guarantee survives even if that pin is ever removed. Before 0034 the
  // naive timezone('utc', now()) defaults re-interpreted UTC wall time in the
  // session timezone, so every stored instant would be 8 hours off. Probe the
  // write paths that keep their own clock: the visitor beacon and the rate
  // limiter.
  await db.exec(`set timezone = 'Etc/GMT-8'`);

  await recordSiteVisit(query, { sessionKey: "tz-probe" });
  const [decision] = await query(
    `select * from public.consume_rate_limit('tz-key', '/api/x', 60, 10)`,
  );
  assert.equal(decision.allowed, true);

  const skews = await query(
    `select 'site_sessions.first_seen_at' as target,
            abs(extract(epoch from (now() - first_seen_at))) as seconds
       from public.site_sessions where session_key = 'tz-probe'
     union all
     select 'site_sessions.last_seen_at',
            abs(extract(epoch from (now() - last_seen_at)))
       from public.site_sessions where session_key = 'tz-probe'
     union all
     select 'site_page_views.created_at',
            abs(extract(epoch from (now() - v.created_at)))
       from public.site_page_views v
       join public.site_sessions s on s.id = v.session_id
       where s.session_key = 'tz-probe'
     union all
     select 'api_rate_limits.updated_at',
            abs(extract(epoch from (now() - updated_at)))
       from public.api_rate_limits where rate_key = 'tz-key'`,
  );

  assert.equal(skews.length, 4, "every probed write must have produced a row");
  for (const { target, seconds } of skews) {
    assert.ok(
      Number(seconds) < 60,
      `${target} is ${seconds}s away from now(); the stored instant must not depend on the session timezone`,
    );
  }
});

test("no column default or function body stores naive UTC wall time", options, async () => {
  const { query } = await migratedDatabase();

  // timezone('utc', now()) — with or without ::text — and now() at time zone
  // 'utc' all yield a naive timestamp that a timestamptz column re-interprets
  // in the connection's TimeZone. Migration 0034 swept the pattern; this
  // fails the replay if any spelling of it comes back. Naive `timestamp`
  // columns are exempt from the default scan (there the expression is
  // correct), matching the sweep's own type filter.
  const naiveClock =
    "timezone\\(\\s*'utc'(::text)?\\s*,\\s*now\\(\\)\\s*\\)|now\\(\\)\\s+at\\s+time\\s+zone\\s+'utc'";

  const defaults = await query(
    `select c.relname || '.' || a.attname as target
     from pg_attrdef d
     join pg_class c on c.oid = d.adrelid
     join pg_namespace n on n.oid = c.relnamespace
     join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where n.nspname = 'public'
       and a.atttypid = 'timestamptz'::regtype
       and pg_get_expr(d.adbin, d.adrelid) ~* $1`,
    [naiveClock],
  );
  assert.deepEqual(
    defaults.map((row) => row.target),
    [],
    "timestamptz defaults must store now(), not a naive UTC wall time",
  );

  const functions = await query(
    `select p.proname
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosrc ~* $1`,
    [naiveClock],
  );
  assert.deepEqual(
    functions.map((row) => row.proname),
    [],
    "function bodies must not read the clock as naive UTC wall time",
  );
});

test("a creator's videos and history are removed with them", options, async () => {
  const { db, query } = await migratedDatabase();

  const [creator] = await query(
    `insert into public.ugc_creators (name, slug) values ('Ema','ema') returning id`,
  );
  const [account] = await query(
    `insert into public.ugc_creator_accounts (creator_id, platform, handle, profile_url)
     values ($1,'tiktok','eemadilema','https://x') returning id`,
    [creator.id],
  );
  const [video] = await query(
    `insert into public.ugc_videos (account_id, creator_id, platform, platform_video_id, url)
     values ($1,$2,'tiktok','v','https://x') returning id`,
    [account.id, creator.id],
  );
  await query(
    `insert into public.ugc_video_stats (video_id, account_id, creator_id, captured_on, views)
     values ($1,$2,$3,current_date,10)`,
    [video.id, account.id, creator.id],
  );

  // The same handle must not be tracked twice, even with different casing.
  await assert.rejects(
    () =>
      db.query(
        `insert into public.ugc_creator_accounts (creator_id, platform, handle, profile_url)
         values ($1,'tiktok','EEMADILEMA','https://x')`,
        [creator.id],
      ),
    /duplicate key/,
  );

  await query(`delete from public.ugc_creators where id = $1`, [creator.id]);

  const [{ videos }] = await query(
    `select count(*)::int as videos from public.ugc_videos`,
  );
  const [{ stats }] = await query(
    `select count(*)::int as stats from public.ugc_video_stats`,
  );

  assert.equal(videos, 0);
  assert.equal(stats, 0);
});

test("a bulk upsert of mixed-shape rows would null a not-null column", options, async () => {
  const { db, query } = await migratedDatabase();

  const [creator] = await query(
    `insert into public.ugc_creators (name, slug) values ('Ema','ema') returning id`,
  );
  const [account] = await query(
    `insert into public.ugc_creator_accounts (creator_id, platform, handle, profile_url)
     values ($1,'tiktok','h','https://x') returning id`,
    [creator.id],
  );

  // The shape ingestion writes: `classification` is not nullable, so a row that
  // omits it must still fall back to the column default rather than NULL. This
  // is what PostgREST does *not* do for a bulk insert with differing keys,
  // which is why the ingest builds uniformly-shaped rows.
  await assert.rejects(
    () =>
      db.query(
        `insert into public.ugc_videos
           (account_id, creator_id, platform, platform_video_id, url, classification)
         values ($1,$2,'tiktok','v1','https://x', null)`,
        [account.id, creator.id],
      ),
    /not-null constraint|null value/,
  );

  // Omitting it entirely is fine; the default applies.
  await query(
    `insert into public.ugc_videos (account_id, creator_id, platform, platform_video_id, url)
     values ($1,$2,'tiktok','v2','https://x')`,
    [account.id, creator.id],
  );

  const [row] = await query(
    `select classification from public.ugc_videos where platform_video_id = 'v2'`,
  );
  assert.equal(row.classification, "unknown");
});
