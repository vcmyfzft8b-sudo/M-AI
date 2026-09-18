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
  -- migration 0035 — host-independent, and biased toward catching that class.
  set timezone = 'Etc/GMT-8';
  create schema if not exists auth;
  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_app_meta_data jsonb default '{}'::jsonb,
    raw_user_meta_data jsonb default '{}'::jsonb
  );
  create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  do $$ begin create role anon; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role bypassrls; exception when duplicate_object then null; end $$;
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
    "admin_impersonation_events",
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

test("every existing account starts owed the home screen guide", options, async () => {
  const { query } = await migratedDatabase();

  const [user] = await query(
    `insert into auth.users (email) values ('installer@memo.app') returning id`,
  );

  // Null is what draws the red dot, and migration 0038 deliberately does not
  // backfill: an account that predates the column is an account that has never
  // been shown the guide.
  const [before] = await query(`select install_guide_seen_at from public.profiles where id = $1`, [
    user.id,
  ]);
  assert.equal(before.install_guide_seen_at, null);

  // The write the API route makes, including its "first one wins" guard.
  const mark = async (at) =>
    query(
      `update public.profiles set install_guide_seen_at = $2
        where id = $1 and install_guide_seen_at is null
        returning install_guide_seen_at`,
      [user.id, at],
    );

  const first = await mark("2026-08-31T10:00:00Z");
  assert.equal(first.length, 1, "opening the guide records the moment");

  const second = await mark("2026-09-05T10:00:00Z");
  assert.deepEqual(second, [], "a second open must not move the recorded moment");

  const [after] = await query(`select install_guide_seen_at from public.profiles where id = $1`, [
    user.id,
  ]);
  assert.equal(after.install_guide_seen_at.toISOString(), "2026-08-31T10:00:00.000Z");
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

test("the onboarding survey is pivoted per question and windowed by completion", options, async () => {
  const { query } = await migratedDatabase();

  // Three accounts inside the window: two full survey answers on the
  // five-point scale, one from before the survey (only the derived summary).
  // A fourth finished onboarding before the window and must not count.
  await query(
    `with people as (
       insert into auth.users (email)
       values ('a@example.com'), ('b@example.com'), ('c@example.com'), ('d@example.com')
       returning id, email
     ),
     answers (email, completed_at, education_level, role, heard_from, scale, current_grade, target_grade, age_range) as (
       values
         ('a@example.com', '2026-09-10 10:00+00'::timestamptz, 'high_school',
          'high_school_student', 'tiktok', 5, 3.4, 4.5, null),
         ('b@example.com', '2026-09-11 10:00+00', 'high_school',
          'high_school_student', 'instagram_reels', 5, 3.6, 3.6, null),
         ('c@example.com', '2026-09-12 10:00+00', 'university',
          null, null, null, null, null, '19_22'),
         ('d@example.com', '2026-08-01 10:00+00', 'university',
          'university_student', 'chatgpt', 10, 7.2, 9, null)
     )
     insert into public.profiles
       (id, email, onboarding_completed_at, education_level,
        onboarding_role, onboarding_heard_from, onboarding_grade_scale,
        onboarding_current_average_grade, onboarding_target_grade, age_range)
     select p.id, a.email, a.completed_at, a.education_level, a.role, a.heard_from,
            a.scale, a.current_grade, a.target_grade, a.age_range
     from answers a join people p on p.email = a.email`,
  );

  const rows = await query(
    `select question, answer, respondents
     from public.admin_onboarding_breakdown('2026-09-01', '2026-10-01')
     order by question, answer`,
  );

  const counts = Object.fromEntries(
    rows.map((row) => [`${row.question}:${row.answer}`, Number(row.respondents)]),
  );

  assert.deepEqual(counts, {
    "age_range:19_22": 1,
    // Rounded to the nearest half mark on the five-point scale: 3.4 → 3.5,
    // 3.6 → 3.5, and both targets keep their own buckets.
    "current_grade_5:3.5": 2,
    "target_grade_5:3.5": 1,
    "target_grade_5:4.5": 1,
    "education_level:high_school": 2,
    "education_level:university": 1,
    "grade_scale:5": 2,
    "heard_from:instagram_reels": 1,
    "heard_from:tiktok": 1,
    "role:high_school_student": 2,
    // The account that finished before the survey existed still counts as
    // having finished, so the completion figure is honest.
    "survey:answered": 2,
    "survey:none": 1,
  });

  const grades = await query(
    `select grade_scale, respondents, average_current, average_target, aiming_higher
     from public.admin_onboarding_grades('2026-09-01', '2026-10-01')`,
  );

  assert.deepEqual(
    grades.map((row) => ({
      scale: Number(row.grade_scale),
      respondents: Number(row.respondents),
      current: Number(row.average_current),
      target: Number(row.average_target),
      aimingHigher: Number(row.aiming_higher),
    })),
    [{ scale: 5, respondents: 2, current: 3.5, target: 4.05, aimingHigher: 1 }],
    "the ten-point account finished before the window and is left out",
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

/*
 * The split allowance, exercised as SQL rather than as arithmetic.
 *
 * tests/tutor-allowance.test.mjs already asserts the rules; what it cannot see is whether the
 * TABLES can hold two allowances at once. Before 0047 they could not: one row per user per day
 * was the primary key, so the podcast's seconds and the tutor's were the same number by
 * construction, and no amount of correct arithmetic on top would have separated them.
 */
async function seedUser(query, email = "split@example.test") {
  const [{ id }] = await query(
    `insert into auth.users (email) values ($1) returning id`,
    [email],
  );

  return id;
}

test("the day and the lifetime are counted per feature", options, async () => {
  const { query } = await migratedDatabase();
  const userId = await seedUser(query);

  await query(`select public.record_tutor_usage($1, current_date, 600, 0, 'tutor')`, [userId]);
  await query(`select public.record_tutor_usage($1, current_date, 900, 0, 'podcast')`, [userId]);

  const daily = await query(
    `select feature, seconds_used from public.tutor_daily_usage
      where user_id = $1 order by feature`,
    [userId],
  );
  const totals = await query(
    `select feature, lifetime_seconds from public.tutor_usage_totals
      where user_id = $1 order by feature`,
    [userId],
  );

  assert.deepEqual(daily, [
    { feature: "podcast", seconds_used: 900 },
    { feature: "tutor", seconds_used: 600 },
  ]);
  assert.deepEqual(totals, [
    { feature: "podcast", lifetime_seconds: 900 },
    { feature: "tutor", lifetime_seconds: 600 },
  ]);
});

test("spending one feature twice adds up without touching the other", options, async () => {
  const { query } = await migratedDatabase();
  const userId = await seedUser(query, "adds-up@example.test");

  await query(`select public.record_tutor_usage($1, current_date, 60, 0, 'podcast')`, [userId]);
  await query(`select public.record_tutor_usage($1, current_date, 90, 0, 'podcast')`, [userId]);

  const [podcast] = await query(
    `select seconds_used from public.tutor_daily_usage
      where user_id = $1 and feature = 'podcast'`,
    [userId],
  );
  const tutor = await query(
    `select seconds_used from public.tutor_daily_usage
      where user_id = $1 and feature = 'tutor'`,
    [userId],
  );

  assert.equal(podcast.seconds_used, 150);
  assert.deepEqual(tutor, []);
});

test("a bought hour is one balance, drawn down by whichever feature spends it", options, async () => {
  const { query } = await migratedDatabase();
  const userId = await seedUser(query, "credits@example.test");

  await query(`select public.add_tutor_credit_seconds($1, 3600)`, [userId]);
  await query(`select public.record_tutor_usage($1, current_date, 600, 600, 'tutor')`, [userId]);
  await query(`select public.record_tutor_usage($1, current_date, 300, 300, 'podcast')`, [userId]);

  const [balance] = await query(
    `select seconds_remaining from public.tutor_credit_balances where user_id = $1`,
    [userId],
  );

  // 3600 - 600 - 300. The split is of the daily allowance, not of what was paid for.
  assert.equal(balance.seconds_remaining, 2700);
});

test("the four-argument form still works, and still means the tutor", options, async () => {
  // Kept so that the minutes of a deploy where the database is ahead of the code do not throw.
  const { query } = await migratedDatabase();
  const userId = await seedUser(query, "legacy@example.test");

  await query(`select public.record_tutor_usage($1, current_date, 120, 0)`, [userId]);

  const rows = await query(
    `select feature, seconds_used from public.tutor_daily_usage where user_id = $1`,
    [userId],
  );

  assert.deepEqual(rows, [{ feature: "tutor", seconds_used: 120 }]);
});

test("a grant records which allowance it came out of", options, async () => {
  const { query } = await migratedDatabase();
  const userId = await seedUser(query, "grants@example.test");

  await query(
    `insert into public.tutor_usage_grants (user_id, usage_date, granted_seconds, source, feature)
     values ($1, current_date, 1800, 'daily', 'podcast')`,
    [userId],
  );

  const [grant] = await query(
    `select feature, source from public.tutor_usage_grants where user_id = $1`,
    [userId],
  );

  assert.equal(grant.feature, "podcast");
  assert.equal(grant.source, "daily");

  // And nothing else is allowed in that column, so a typo cannot open a third allowance.
  await assert.rejects(
    query(
      `insert into public.tutor_usage_grants (user_id, usage_date, granted_seconds, source, feature)
       values ($1, current_date, 60, 'daily', 'quiz')`,
      [userId],
    ),
  );
});

/*
 * The free note is spent when a note succeeds, and at no other moment (migration 0048).
 *
 * These run against the real trigger in a real Postgres, because the rule they encode is one
 * the application cannot see: `ready` is written from three different modules today, so the
 * invariant lives next to the data and has to be tested there.
 */

/** A learner with one note, with the trial pointed at it. Returns both ids. */
async function learnerWithTrialNote(query, { status = "uploading" } = {}) {
  const [user] = await query(
    `insert into auth.users (email) values ('trial@example.com') returning id`,
  );
  await query(
    `insert into public.profiles (id, email) values ($1, 'trial@example.com')
     on conflict (id) do nothing`,
    [user.id],
  );
  const [lecture] = await query(
    `insert into public.lectures (user_id, status, access_tier, source_type)
     values ($1, $2, 'trial', 'text') returning id`,
    [user.id, status],
  );
  await query(`update public.profiles set trial_lecture_id = $2 where id = $1`, [
    user.id,
    lecture.id,
  ]);
  return { userId: user.id, lectureId: lecture.id };
}

const consumedAt = async (query, userId) => {
  const [row] = await query(`select trial_consumed_at from public.profiles where id = $1`, [userId]);
  return row.trial_consumed_at;
};

test("the free note is spent only once a note reaches ready", options, async () => {
  const { query } = await migratedDatabase();
  const { userId, lectureId } = await learnerWithTrialNote(query);

  assert.equal(await consumedAt(query, userId), null, "creating a note must not spend it");

  await query(`update public.lectures set status = 'transcribing' where id = $1`, [lectureId]);
  assert.equal(await consumedAt(query, userId), null, "nor must working on it");

  await query(`update public.lectures set status = 'ready' where id = $1`, [lectureId]);
  assert.notEqual(await consumedAt(query, userId), null, "finishing it spends the free note");
});

test("a note that fails costs the learner nothing", options, async () => {
  const { query } = await migratedDatabase();
  const { userId, lectureId } = await learnerWithTrialNote(query);

  await query(`update public.lectures set status = 'failed' where id = $1`, [lectureId]);

  assert.equal(await consumedAt(query, userId), null);
});

test("deleting a finished note does not hand the free note back", options, async () => {
  const { query } = await migratedDatabase();
  const { userId, lectureId } = await learnerWithTrialNote(query);

  await query(`update public.lectures set status = 'ready' where id = $1`, [lectureId]);
  const spentAt = await consumedAt(query, userId);
  await query(`delete from public.lectures where id = $1`, [lectureId]);

  // The pointer goes with the row (on delete set null); the stamp is what outlives it.
  const [profile] = await query(
    `select trial_lecture_id, trial_consumed_at from public.profiles where id = $1`,
    [userId],
  );
  assert.equal(profile.trial_lecture_id, null);
  assert.deepEqual(profile.trial_consumed_at, spentAt, "the free note stays spent");
});

test("deleting a note that never finished leaves the free note unspent", options, async () => {
  const { query } = await migratedDatabase();
  const { userId, lectureId } = await learnerWithTrialNote(query);

  await query(`update public.lectures set status = 'failed' where id = $1`, [lectureId]);
  await query(`delete from public.lectures where id = $1`, [lectureId]);

  assert.equal(await consumedAt(query, userId), null, "they may still make their free note");
});

test("someone else's note finishing does not spend this learner's free note", options, async () => {
  const { query } = await migratedDatabase();
  const { userId } = await learnerWithTrialNote(query);
  const other = await learnerWithTrialNote(query);

  await query(`update public.lectures set status = 'ready' where id = $1`, [other.lectureId]);

  assert.equal(await consumedAt(query, userId), null);
  assert.notEqual(await consumedAt(query, other.userId), null);
});

test("a second note finishing does not re-stamp an already spent trial", options, async () => {
  const { query } = await migratedDatabase();
  const { userId, lectureId } = await learnerWithTrialNote(query);

  await query(`update public.lectures set status = 'ready' where id = $1`, [lectureId]);
  const first = await consumedAt(query, userId);

  // A note the trial does not point at, finishing later.
  const [second] = await query(
    `insert into public.lectures (user_id, status, access_tier, source_type)
     values ($1, 'uploading', 'paid', 'text') returning id`,
    [userId],
  );
  await query(`update public.lectures set status = 'ready' where id = $1`, [second.id]);

  assert.deepEqual(await consumedAt(query, userId), first, "the first stamp stands");
});

test("the backfill frees only the learners who never received a note", options, async () => {
  const { query } = await migratedDatabase();

  // The migration has already run, so re-create each shape and re-run its statement.
  const mk = async (email) => {
    const [u] = await query(`insert into auth.users (email) values ($1) returning id`, [email]);
    await query(
      `insert into public.profiles (id, email, trial_consumed_at) values ($1, $2, now())
       on conflict (id) do update set trial_consumed_at = now()`,
      [u.id, email],
    );
    return u.id;
  };
  const neverGotOne = await mk('never@example.com');
  const hasOne = await mk('has@example.com');
  const deletedTheirs = await mk('deleted@example.com');

  await query(
    `insert into public.lectures (user_id, status, access_tier, source_type)
     values ($1, 'ready', 'trial', 'text')`,
    [hasOne],
  );
  // No lecture left, but the pipeline is on record as having written them one.
  await query(
    `insert into public.ai_usage_events (user_id, provider, model, stage, success)
     values ($1, 'openrouter', 'glm', 'note_write', true)`,
    [deletedTheirs],
  );

  await query(`
    update public.profiles as p
    set trial_consumed_at = null
    where p.trial_consumed_at is not null
      and not exists (select 1 from public.lectures as l where l.user_id = p.id and l.status = 'ready')
      and not exists (
        select 1 from public.ai_usage_events as e
        where e.user_id = p.id and e.stage = 'note_write' and e.success
      )
  `);

  assert.equal(await consumedAt(query, neverGotOne), null, "gets their free note back");
  assert.notEqual(await consumedAt(query, hasOne), null, "still has the note, still spent");
  assert.notEqual(await consumedAt(query, deletedTheirs), null, "had one and deleted it, still spent");
});


test("account erasure blocks stale storage tokens and survives auth deletion", options, async () => {
  const { db, query } = await migratedDatabase();
  try {
    const owner = "11111111-1111-4111-8111-111111111111";
    const other = "22222222-2222-4222-8222-222222222222";
    await query("insert into auth.users(id) values ($1), ($2)", [owner, other]);
    await db.exec(`
      create or replace function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema storage, auth to authenticated;
      grant all on storage.objects to authenticated;
      alter table storage.objects enable row level security;
      create policy erasure_test_baseline on storage.objects for all to authenticated
        using (owner = auth.uid()) with check (owner = auth.uid());
    `);
    await query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec("set role authenticated");
    await query("insert into storage.objects(name, owner) values ('before', $1)", [owner]);
    await assert.rejects(query("select public.request_account_deletion($1)", [owner]), /permission denied/);
    await assert.rejects(query("select * from public.account_deletion_requests"), /permission denied/);
    await assert.rejects(query("select * from public.apple_auth_grants"), /permission denied/);
    await assert.rejects(query("insert into public.apple_auth_grants(user_id,client_id,apple_subject,refresh_token_encrypted) values ($1,'memo','subject','synthetic')", [owner]), /permission denied/);
    await db.exec("reset role; set role service_role");
    await query("insert into public.apple_auth_grants(user_id,client_id,apple_subject,refresh_token_encrypted) values ($1,'memo','owner','encrypted-synthetic'),($2,'memo','other','encrypted-synthetic')", [owner, other]);
    await query("select public.request_account_deletion($1)", [owner]);
    await db.exec("reset role");
    const [job] = await query("select *, extract(epoch from cleanup_after-requested_at) as drain from public.account_deletion_requests");
    assert.equal(Number(job.drain), 10800);
    assert.equal((await query("select raw_app_meta_data ? 'memo_deletion_requested_at' as blocked from auth.users where id=$1", [owner]))[0].blocked, true);
    await query("select public.request_account_deletion($1)", [owner]);
    assert.deepEqual((await query("select cleanup_after from public.account_deletion_requests"))[0].cleanup_after, job.cleanup_after);
    await db.exec("set role authenticated");
    assert.deepEqual(await query("select name from storage.objects"), []);
    await assert.rejects(query("insert into storage.objects(name, owner) values ('late', $1)", [owner]), /row-level security/);
    await query("select set_config('request.jwt.claim.sub', $1, false)", [other]);
    await query("insert into storage.objects(name, owner) values ('other', $1)", [other]);
    assert.equal((await query("select name from storage.objects"))[0].name, "other");
    await db.exec("reset role");
    await query("delete from auth.users where id=$1", [owner]);
    assert.deepEqual(await query("select user_id from public.apple_auth_grants"), [{ user_id: other }]);
    assert.equal((await query("select count(*)::int as count from public.account_deletion_requests"))[0].count, 1);
    await query("delete from public.account_deletion_requests where user_id=$1", [owner]);
    await query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    await db.exec("set role authenticated");
    await assert.rejects(query("insert into storage.objects(name, owner) values ('after', $1)", [owner]), /row-level security/);
  } finally { await db.close(); }
});
