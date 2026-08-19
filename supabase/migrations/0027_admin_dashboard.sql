-- Admin dashboard: access control, UGC creator tracking, and site analytics.
--
-- Every table here is service-role only. Row level security is enabled with no
-- policies, so the anon and authenticated roles are denied by default and all
-- reads and writes must go through the server after an explicit admin check in
-- `src/lib/admin/auth.ts`.

-- ---------------------------------------------------------------------------
-- Admin access control
-- ---------------------------------------------------------------------------

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  label text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  created_by text,
  last_seen_at timestamptz
);

-- Emails are matched case-insensitively, so store and index the lowered form.
create unique index if not exists admin_users_email_unique
  on public.admin_users (lower(email));

drop trigger if exists admin_users_set_updated_at on public.admin_users;
create trigger admin_users_set_updated_at
before update on public.admin_users
for each row execute procedure public.set_updated_at();

alter table public.admin_users enable row level security;

-- The owner account. `owner` cannot be removed through the dashboard UI, which
-- keeps the dashboard from locking everyone out.
insert into public.admin_users (email, role, label, created_by)
values ('nace.valencic@gmail.com', 'owner', 'Nace', 'migration:0027')
on conflict (lower(email)) do update
  set role = 'owner';

-- ---------------------------------------------------------------------------
-- UGC creators
-- ---------------------------------------------------------------------------

create table if not exists public.ugc_creators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  contact_email text,
  notes text,
  -- Stripe promotion codes owned by this creator (for example {'EMA50'}). These
  -- attribute real checkout revenue back to the creator who drove it.
  promo_codes text[] not null default '{}',
  -- Optional commercial terms, used for cost per view / per video reporting.
  rate_amount numeric(12, 2),
  rate_currency text not null default 'eur',
  rate_kind text check (rate_kind in ('per_video', 'per_month', 'per_1k_views', 'revenue_share')),
  started_at date,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  created_by text
);

create unique index if not exists ugc_creators_slug_unique
  on public.ugc_creators (slug);

create index if not exists ugc_creators_status_idx
  on public.ugc_creators (status, name);

drop trigger if exists ugc_creators_set_updated_at on public.ugc_creators;
create trigger ugc_creators_set_updated_at
before update on public.ugc_creators
for each row execute procedure public.set_updated_at();

alter table public.ugc_creators enable row level security;

-- A creator can own more than one account (a dedicated Memo AI account plus a
-- personal one, or TikTok plus Instagram), so accounts live in their own table.
create table if not exists public.ugc_creator_accounts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.ugc_creators (id) on delete cascade,
  platform text not null default 'tiktok'
    check (platform in ('tiktok', 'instagram', 'youtube')),
  handle text not null,
  profile_url text not null,
  -- 'dedicated'  every post is Memo AI content
  -- 'mixed'      a personal account that sometimes posts Memo AI content
  -- 'personal'   tracked for context only; nothing counts toward campaign totals
  content_mode text not null default 'mixed'
    check (content_mode in ('dedicated', 'mixed', 'personal')),
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  display_name text,
  avatar_url text,
  bio text,
  platform_account_id text,
  -- TikTok's internal secUid, needed by most collectors to page a user's posts.
  sec_uid text,
  follower_count integer,
  following_count integer,
  total_likes bigint,
  video_count integer,
  last_synced_at timestamptz,
  last_sync_status text check (last_sync_status in ('ok', 'error', 'pending')),
  last_sync_error text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists ugc_creator_accounts_platform_handle_unique
  on public.ugc_creator_accounts (platform, lower(handle));

create index if not exists ugc_creator_accounts_creator_idx
  on public.ugc_creator_accounts (creator_id);

create index if not exists ugc_creator_accounts_sync_idx
  on public.ugc_creator_accounts (status, last_synced_at nulls first);

drop trigger if exists ugc_creator_accounts_set_updated_at on public.ugc_creator_accounts;
create trigger ugc_creator_accounts_set_updated_at
before update on public.ugc_creator_accounts
for each row execute procedure public.set_updated_at();

alter table public.ugc_creator_accounts enable row level security;

-- ---------------------------------------------------------------------------
-- Videos and their daily metric snapshots
-- ---------------------------------------------------------------------------

create table if not exists public.ugc_videos (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ugc_creator_accounts (id) on delete cascade,
  creator_id uuid not null references public.ugc_creators (id) on delete cascade,
  platform text not null default 'tiktok',
  platform_video_id text not null,
  url text not null,
  caption text,
  hashtags text[] not null default '{}',
  mentions text[] not null default '{}',
  cover_url text,
  duration_seconds integer,
  posted_at timestamptz,

  -- Latest known cumulative counters, denormalised from ugc_video_stats so the
  -- creator tables can be rendered without a join per row.
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,

  -- Memo AI attribution.
  classification text not null default 'unknown'
    check (classification in ('memo', 'personal', 'unknown')),
  classification_source text not null default 'rule'
    check (classification_source in ('manual', 'account_default', 'rule', 'ai')),
  classification_confidence numeric(4, 3),
  classification_reason text,
  classified_at timestamptz,
  -- When an admin sets the classification by hand it must never be overwritten
  -- by a later automatic pass.
  classification_locked boolean not null default false,

  first_seen_at timestamptz not null default timezone('utc'::text, now()),
  last_synced_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists ugc_videos_platform_video_unique
  on public.ugc_videos (platform, platform_video_id);

create index if not exists ugc_videos_account_posted_idx
  on public.ugc_videos (account_id, posted_at desc nulls last);

create index if not exists ugc_videos_creator_posted_idx
  on public.ugc_videos (creator_id, posted_at desc nulls last);

create index if not exists ugc_videos_classification_idx
  on public.ugc_videos (classification, posted_at desc nulls last);

-- Supports the "needs review" queue on the creators page.
create index if not exists ugc_videos_unclassified_idx
  on public.ugc_videos (posted_at desc nulls last)
  where classification = 'unknown';

drop trigger if exists ugc_videos_set_updated_at on public.ugc_videos;
create trigger ugc_videos_set_updated_at
before update on public.ugc_videos
for each row execute procedure public.set_updated_at();

alter table public.ugc_videos enable row level security;

-- One row per video per day. Platform counters are cumulative, so day-over-day
-- deltas of this table are what produce "views gained on a given day".
create table if not exists public.ugc_video_stats (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.ugc_videos (id) on delete cascade,
  account_id uuid not null references public.ugc_creator_accounts (id) on delete cascade,
  creator_id uuid not null references public.ugc_creators (id) on delete cascade,
  captured_on date not null,
  views bigint not null default 0,
  likes bigint not null default 0,
  comments bigint not null default 0,
  shares bigint not null default 0,
  saves bigint not null default 0,
  captured_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists ugc_video_stats_video_day_unique
  on public.ugc_video_stats (video_id, captured_on);

create index if not exists ugc_video_stats_creator_day_idx
  on public.ugc_video_stats (creator_id, captured_on);

create index if not exists ugc_video_stats_day_idx
  on public.ugc_video_stats (captured_on);

alter table public.ugc_video_stats enable row level security;

-- Account-level follower history, which the profile page exposes for free.
create table if not exists public.ugc_account_stats (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.ugc_creator_accounts (id) on delete cascade,
  creator_id uuid not null references public.ugc_creators (id) on delete cascade,
  captured_on date not null,
  follower_count integer,
  total_likes bigint,
  video_count integer,
  captured_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists ugc_account_stats_account_day_unique
  on public.ugc_account_stats (account_id, captured_on);

alter table public.ugc_account_stats enable row level security;

-- ---------------------------------------------------------------------------
-- Classification rules
-- ---------------------------------------------------------------------------

create table if not exists public.ugc_classification_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('keyword', 'hashtag', 'mention', 'link')),
  pattern text not null,
  weight numeric(4, 3) not null default 0.5,
  active boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists ugc_classification_rules_unique
  on public.ugc_classification_rules (kind, lower(pattern));

drop trigger if exists ugc_classification_rules_set_updated_at on public.ugc_classification_rules;
create trigger ugc_classification_rules_set_updated_at
before update on public.ugc_classification_rules
for each row execute procedure public.set_updated_at();

alter table public.ugc_classification_rules enable row level security;

-- Weights are additive; a video scoring >= 1.0 is classified as Memo AI. A
-- single unambiguous signal (a memoai.eu link, an @memo mention, #memoai) is
-- therefore enough on its own, while a bare "memo" only contributes partially.
insert into public.ugc_classification_rules (kind, pattern, weight) values
  ('link', 'memoai.eu', 1),
  ('mention', 'memo_ai', 1),
  ('mention', 'memoai', 1),
  ('mention', 'memo.ai', 1),
  ('hashtag', 'memoai', 1),
  ('hashtag', 'memo', 1),
  ('hashtag', 'memoaiapp', 1),
  ('keyword', 'memo ai', 1),
  ('keyword', 'memoai', 1),
  ('keyword', 'memo.ai', 1),
  ('keyword', 'memo app', 1),
  ('keyword', 'memo', 0.5),
  ('keyword', 'zapiski', 0.25),
  ('keyword', 'aplikacija za učenje', 0.5)
on conflict (kind, lower(pattern)) do nothing;

-- ---------------------------------------------------------------------------
-- Sync runs
-- ---------------------------------------------------------------------------

create table if not exists public.ugc_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('apify', 'manual', 'push', 'profile')),
  trigger text not null default 'manual' check (trigger in ('manual', 'cron', 'push')),
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error')),
  accounts_total integer not null default 0,
  accounts_synced integer not null default 0,
  videos_seen integer not null default 0,
  videos_created integer not null default 0,
  videos_updated integer not null default 0,
  error text,
  detail jsonb,
  started_at timestamptz not null default timezone('utc'::text, now()),
  finished_at timestamptz,
  started_by text
);

create index if not exists ugc_sync_runs_started_idx
  on public.ugc_sync_runs (started_at desc);

alter table public.ugc_sync_runs enable row level security;

-- ---------------------------------------------------------------------------
-- Site analytics
-- ---------------------------------------------------------------------------

-- One row per visitor session. `last_seen_at` drives the "online now" panel.
create table if not exists public.site_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key text not null,
  user_id uuid references auth.users (id) on delete set null,
  first_seen_at timestamptz not null default timezone('utc'::text, now()),
  last_seen_at timestamptz not null default timezone('utc'::text, now()),
  page_views integer not null default 0,
  entry_path text,
  last_path text,
  referrer_host text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  country text,
  region text,
  city text,
  device_type text check (device_type in ('mobile', 'tablet', 'desktop', 'bot', 'unknown')),
  browser text,
  os text,
  is_bot boolean not null default false
);

create unique index if not exists site_sessions_key_unique
  on public.site_sessions (session_key);

create index if not exists site_sessions_last_seen_idx
  on public.site_sessions (last_seen_at desc);

create index if not exists site_sessions_first_seen_idx
  on public.site_sessions (first_seen_at desc);

create index if not exists site_sessions_user_idx
  on public.site_sessions (user_id, last_seen_at desc)
  where user_id is not null;

alter table public.site_sessions enable row level security;

create table if not exists public.site_page_views (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.site_sessions (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  path text not null,
  referrer_host text,
  country text,
  device_type text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists site_page_views_created_idx
  on public.site_page_views (created_at desc);

create index if not exists site_page_views_path_idx
  on public.site_page_views (path, created_at desc);

alter table public.site_page_views enable row level security;

-- ---------------------------------------------------------------------------
-- Atomic visitor tracking
-- ---------------------------------------------------------------------------

-- The beacon fires on every page view from every visitor, so the upsert has to
-- be a single round trip and must not lose a concurrent increment.
create or replace function public.record_site_visit(
  p_session_key text,
  p_user_id uuid,
  p_path text,
  p_referrer_host text,
  p_utm_source text,
  p_utm_medium text,
  p_utm_campaign text,
  p_country text,
  p_region text,
  p_city text,
  p_device_type text,
  p_browser text,
  p_os text,
  p_is_bot boolean,
  p_count_page_view boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  insert into public.site_sessions (
    session_key, user_id, entry_path, last_path, referrer_host,
    utm_source, utm_medium, utm_campaign,
    country, region, city, device_type, browser, os, is_bot,
    page_views
  )
  values (
    p_session_key, p_user_id, p_path, p_path, p_referrer_host,
    p_utm_source, p_utm_medium, p_utm_campaign,
    p_country, p_region, p_city, p_device_type, p_browser, p_os,
    coalesce(p_is_bot, false),
    case when p_count_page_view then 1 else 0 end
  )
  on conflict (session_key) do update
  set
    last_seen_at = timezone('utc'::text, now()),
    last_path = excluded.last_path,
    page_views = public.site_sessions.page_views
      + case when p_count_page_view then 1 else 0 end,
    -- A session can start signed out and sign in partway through.
    user_id = coalesce(excluded.user_id, public.site_sessions.user_id),
    country = coalesce(public.site_sessions.country, excluded.country),
    region = coalesce(public.site_sessions.region, excluded.region),
    city = coalesce(public.site_sessions.city, excluded.city),
    device_type = coalesce(public.site_sessions.device_type, excluded.device_type),
    browser = coalesce(public.site_sessions.browser, excluded.browser),
    os = coalesce(public.site_sessions.os, excluded.os),
    -- Attribution belongs to the first touch of the session.
    utm_source = coalesce(public.site_sessions.utm_source, excluded.utm_source),
    utm_medium = coalesce(public.site_sessions.utm_medium, excluded.utm_medium),
    utm_campaign = coalesce(public.site_sessions.utm_campaign, excluded.utm_campaign),
    referrer_host = coalesce(public.site_sessions.referrer_host, excluded.referrer_host)
  returning id into v_session_id;

  if p_count_page_view then
    insert into public.site_page_views (
      session_id, user_id, path, referrer_host, country, device_type
    )
    values (
      v_session_id, p_user_id, p_path, p_referrer_host, p_country, p_device_type
    );
  end if;

  return v_session_id;
end;
$$;

revoke all on function public.record_site_visit(
  text, uuid, text, text, text, text, text, text, text, text, text, text, text, boolean, boolean
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Daily view deltas for the UGC charts
-- ---------------------------------------------------------------------------

-- Cumulative platform counters turned into per-day gains. The first snapshot of
-- a video counts in full (the views it had when we discovered it); afterwards
-- only the increase over the previous snapshot counts. `greatest(..., 0)` keeps
-- an occasional platform correction from producing a negative day.
--
-- Post dates are bucketed in Europe/Ljubljana, matching `REPORT_TIME_ZONE` in
-- src/lib/admin/ranges.ts and site_traffic_daily above. Bucketing by UTC here
-- would credit anything posted after 22:00 UTC to the previous day and put the
-- chart a day out of step with the snapshot days written from the app.
create or replace function public.ugc_daily_view_deltas(
  p_from date,
  p_to date,
  p_only_memo boolean default true
)
returns table (
  day date,
  creator_id uuid,
  views bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  videos_posted integer
)
language sql
stable
security definer
set search_path = public
as $$
  with ordered as (
    select
      s.captured_on,
      s.creator_id,
      s.video_id,
      s.views,
      s.likes,
      s.comments,
      s.shares,
      lag(s.views) over w as prev_views,
      lag(s.likes) over w as prev_likes,
      lag(s.comments) over w as prev_comments,
      lag(s.shares) over w as prev_shares
    from public.ugc_video_stats s
    join public.ugc_videos v on v.id = s.video_id
    where (not p_only_memo or v.classification = 'memo')
    window w as (partition by s.video_id order by s.captured_on)
  ),
  deltas as (
    select
      captured_on,
      creator_id,
      greatest(views - coalesce(prev_views, 0), 0) as views,
      greatest(likes - coalesce(prev_likes, 0), 0) as likes,
      greatest(comments - coalesce(prev_comments, 0), 0) as comments,
      greatest(shares - coalesce(prev_shares, 0), 0) as shares
    from ordered
    where captured_on between p_from and p_to
  ),
  posted as (
    select
      (v.posted_at at time zone 'Europe/Ljubljana')::date as day,
      v.creator_id,
      count(*)::integer as videos_posted
    from public.ugc_videos v
    where v.posted_at is not null
      and (not p_only_memo or v.classification = 'memo')
      and (v.posted_at at time zone 'Europe/Ljubljana')::date between p_from and p_to
    group by 1, 2
  )
  select
    coalesce(d.captured_on, p.day) as day,
    coalesce(d.creator_id, p.creator_id) as creator_id,
    coalesce(sum(d.views), 0)::bigint as views,
    coalesce(sum(d.likes), 0)::bigint as likes,
    coalesce(sum(d.comments), 0)::bigint as comments,
    coalesce(sum(d.shares), 0)::bigint as shares,
    coalesce(max(p.videos_posted), 0)::integer as videos_posted
  from deltas d
  full outer join posted p
    on p.day = d.captured_on and p.creator_id = d.creator_id
  group by 1, 2
  order by 1, 2;
$$;

revoke all on function public.ugc_daily_view_deltas(date, date, boolean)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Traffic aggregates
-- ---------------------------------------------------------------------------

-- Daily visitor and page-view counts. Aggregating in Postgres keeps the
-- dashboard from pulling every page-view row into the request.
create or replace function public.site_traffic_daily(
  p_from date,
  p_to date
)
returns table (
  day date,
  visitors integer,
  page_views integer,
  signed_in_visitors integer,
  new_visitors integer
)
language sql
stable
security definer
set search_path = public
as $$
  with days as (
    select generate_series(p_from, p_to, interval '1 day')::date as day
  ),
  views as (
    select
      (v.created_at at time zone 'Europe/Ljubljana')::date as day,
      count(*)::integer as page_views,
      count(distinct v.session_id)::integer as visitors,
      count(distinct v.user_id) filter (where v.user_id is not null)::integer
        as signed_in_visitors
    from public.site_page_views v
    join public.site_sessions s on s.id = v.session_id
    where s.is_bot = false
      and (v.created_at at time zone 'Europe/Ljubljana')::date between p_from and p_to
    group by 1
  ),
  starts as (
    select
      (s.first_seen_at at time zone 'Europe/Ljubljana')::date as day,
      count(*)::integer as new_visitors
    from public.site_sessions s
    where s.is_bot = false
      and (s.first_seen_at at time zone 'Europe/Ljubljana')::date between p_from and p_to
    group by 1
  )
  select
    d.day,
    coalesce(v.visitors, 0),
    coalesce(v.page_views, 0),
    coalesce(v.signed_in_visitors, 0),
    coalesce(st.new_visitors, 0)
  from days d
  left join views v on v.day = d.day
  left join starts st on st.day = d.day
  order by d.day;
$$;

revoke all on function public.site_traffic_daily(date, date)
  from public, anon, authenticated;

-- Top paths, referrers and countries for a window, in one round trip.
create or replace function public.site_traffic_breakdown(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 10
)
returns table (
  dimension text,
  value text,
  hits integer
)
language sql
stable
security definer
set search_path = public
as $$
  (
    select 'path'::text, v.path, count(*)::integer as hits
    from public.site_page_views v
    join public.site_sessions s on s.id = v.session_id
    where s.is_bot = false and v.created_at >= p_from and v.created_at < p_to
    group by v.path
    order by hits desc
    limit p_limit
  )
  union all
  (
    select 'referrer'::text, coalesce(s.referrer_host, 'direct'), count(*)::integer as hits
    from public.site_sessions s
    where s.is_bot = false and s.first_seen_at >= p_from and s.first_seen_at < p_to
    group by 2
    order by hits desc
    limit p_limit
  )
  union all
  (
    select 'country'::text, coalesce(s.country, 'unknown'), count(*)::integer as hits
    from public.site_sessions s
    where s.is_bot = false and s.first_seen_at >= p_from and s.first_seen_at < p_to
    group by 2
    order by hits desc
    limit p_limit
  )
  union all
  (
    select 'device'::text, coalesce(s.device_type, 'unknown'), count(*)::integer as hits
    from public.site_sessions s
    where s.is_bot = false and s.first_seen_at >= p_from and s.first_seen_at < p_to
    group by 2
    order by hits desc
    limit p_limit
  );
$$;

revoke all on function public.site_traffic_breakdown(timestamptz, timestamptz, integer)
  from public, anon, authenticated;

-- Retention: page-view rows are the high-volume table and only the daily
-- aggregates matter after a few months.
create or replace function public.prune_site_analytics(p_days integer default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.site_page_views
  where created_at < timezone('utc'::text, now()) - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;

  delete from public.site_sessions
  where last_seen_at < timezone('utc'::text, now()) - make_interval(days => p_days);

  return v_deleted;
end;
$$;

revoke all on function public.prune_site_analytics(integer)
  from public, anon, authenticated;
