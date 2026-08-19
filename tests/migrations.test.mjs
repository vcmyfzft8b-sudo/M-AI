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

  const visit = (sessionKey, userId, pathValue, referrer, countPageView) =>
    query(
      `select public.record_site_visit($1,$2,$3,$4,null,null,null,'SI',null,null,'desktop','Chrome','macOS',false,$5)`,
      [sessionKey, userId, pathValue, referrer, countPageView],
    );

  await visit("sess-1", null, "/", "google.com", true);
  await visit("sess-1", user.id, "/app", null, true);
  await visit("sess-1", null, "/app", null, false);

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

  await query(
    `select public.record_site_visit('human',null,'/',null,null,null,null,'SI',null,null,'desktop','Chrome','macOS',false,true)`,
  );
  await query(
    `select public.record_site_visit('crawler',null,'/',null,null,null,null,'US',null,null,'bot','','',true,true)`,
  );

  const [today] = await query(
    `select visitors, page_views from public.site_traffic_daily(
       (timezone('Europe/Ljubljana', now()))::date,
       (timezone('Europe/Ljubljana', now()))::date)`,
  );

  assert.equal(Number(today.visitors), 1, "the bot session must not be counted");
  assert.equal(Number(today.page_views), 1);
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
