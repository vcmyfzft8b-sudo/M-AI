-- ---------------------------------------------------------------------------
-- Stored timestamps must not depend on the connection's timezone
-- ---------------------------------------------------------------------------
--
-- The boilerplate default `timezone('utc'::text, now())` returns a *naive*
-- timestamp (UTC wall time), which a timestamptz column re-interprets in the
-- connection's `TimeZone`. On Supabase every connection runs with
-- TimeZone=UTC, so the round trip happens to be a no-op — but any writer with
-- a different session timezone stores an instant skewed by that session's UTC
-- offset. `site_traffic_daily` buckets visit instants in Europe/Ljubljana, so
-- a skewed write lands on the previous Ljubljana day around midnight:
-- replaying the chain in a non-UTC session (tests/migrations.test.mjs under
-- PGlite, which inherits the host timezone) made visits recorded between
-- 22:00 and 24:00 UTC vanish from range queries for the day they belong to.
-- `now()` is already a timestamptz, so storing it directly is byte-identical
-- in production and correct in every session timezone.

-- The ALTERs below are metadata-only but each takes a brief ACCESS EXCLUSIVE
-- lock, all held until this file's transaction commits. Bound the wait so a
-- busy production session makes the push fail cleanly (and retryably) instead
-- of queueing every write to already-locked tables behind it. Outside a
-- transaction (the PGlite replay) SET LOCAL is a no-op warning, which is fine.
set local lock_timeout = '5s';

-- Every timestamptz default that stores naive UTC wall time becomes plain
-- `now()`. The catalog scan keeps the rewrite exact — it covers whatever the
-- earlier migrations actually left behind and touches nothing else. The
-- second spelling is what the Supabase Studio table editor emits, in case a
-- production column was ever authored there rather than in a migration.
do $$
declare
  r record;
begin
  for r in
    select c.relname as table_name, a.attname as column_name
    from pg_attrdef d
    join pg_class c on c.oid = d.adrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
    where n.nspname = 'public'
      and a.atttypid = 'timestamptz'::regtype
      and pg_get_expr(d.adbin, d.adrelid) in (
        'timezone(''utc''::text, now())',
        '(now() AT TIME ZONE ''utc''::text)'
      )
  loop
    execute format(
      'alter table public.%I alter column %I set default now()',
      r.table_name, r.column_name
    );
  end loop;
end;
$$;

-- The six functions whose current definitions assign the naive expression to
-- timestamptz columns or variables, recreated verbatim from their latest
-- definitions with `now()` substituted. `create or replace` keeps existing
-- grants and triggers intact; the revokes the originals paired with
-- `record_site_visit` and `prune_site_analytics` are restated so the
-- definitions here stay safe even if they are ever applied standalone. The
-- other functions never had explicit grants or revokes, so none are added.

-- From 0001_init.sql: the shared updated_at trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- From 0016_durable_trial_consumption.sql.
create or replace function public.claim_trial_lecture(p_user_id uuid, p_lecture_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_has_paid_access boolean;
begin
  select *
  into v_profile
  from public.profiles
  where id = p_user_id
  for update;

  if not found then
    return jsonb_build_object(
      'allowed', false,
      'code', 'profile_not_found'
    );
  end if;

  select exists (
    select 1
    from public.billing_subscriptions
    where user_id = p_user_id
      and status in ('active', 'trialing', 'past_due')
  )
  into v_has_paid_access;

  if v_has_paid_access then
    return jsonb_build_object(
      'allowed', true,
      'mode', 'paid'
    );
  end if;

  if v_profile.trial_lecture_id = p_lecture_id then
    update public.profiles
    set
      trial_started_at = coalesce(trial_started_at, now()),
      trial_consumed_at = coalesce(trial_consumed_at, now())
    where id = p_user_id;

    return jsonb_build_object(
      'allowed', true,
      'mode', 'trial'
    );
  end if;

  if v_profile.trial_consumed_at is not null then
    return jsonb_build_object(
      'allowed', false,
      'code', 'trial_exhausted'
    );
  end if;

  if v_profile.trial_lecture_id is null then
    update public.profiles
    set
      trial_lecture_id = p_lecture_id,
      trial_started_at = coalesce(trial_started_at, now()),
      trial_consumed_at = coalesce(trial_consumed_at, now())
    where id = p_user_id;

    return jsonb_build_object(
      'allowed', true,
      'mode', 'trial'
    );
  end if;

  return jsonb_build_object(
    'allowed', false,
    'code', 'trial_exhausted'
  );
end;
$$;

-- From 0019_rate_limit_retention.sql.
create or replace function public.consume_rate_limit(
  p_rate_key text,
  p_route text,
  p_window_seconds integer,
  p_max_requests integer
)
returns table (
  allowed boolean,
  remaining integer,
  retry_after_seconds integer,
  limit_count integer,
  window_seconds integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_window_seconds integer := greatest(p_window_seconds, 1);
  v_max_requests integer := greatest(p_max_requests, 1);
  v_bucket_epoch bigint;
  v_bucket_start timestamptz;
  v_request_count integer;
  v_retry_after integer;
begin
  v_bucket_epoch :=
    floor(extract(epoch from v_now) / v_window_seconds)::bigint * v_window_seconds;
  v_bucket_start := to_timestamp(v_bucket_epoch);

  insert into public.api_rate_limits (
    rate_key,
    route,
    window_seconds,
    bucket_start,
    request_count,
    updated_at
  )
  values (
    p_rate_key,
    p_route,
    v_window_seconds,
    v_bucket_start,
    1,
    v_now
  )
  on conflict on constraint api_rate_limits_pkey
  do update
    set request_count = public.api_rate_limits.request_count + 1,
        updated_at = v_now
  returning public.api_rate_limits.request_count
  into v_request_count;

  if random() < 0.01 then
    delete from public.api_rate_limits
    where updated_at < v_now - interval '2 hours';
  end if;

  v_retry_after := greatest(
    ceil(
      extract(
        epoch from ((v_bucket_start + make_interval(secs => v_window_seconds)) - v_now)
      )
    )::integer,
    1
  );

  return query
  select
    v_request_count <= v_max_requests,
    greatest(v_max_requests - v_request_count, 0),
    v_retry_after,
    v_max_requests,
    v_window_seconds;
end;
$$;

-- From 0018_note_tts.sql.
create or replace function public.consume_tts_daily_quota(
  p_user_id uuid,
  p_lecture_id uuid,
  p_session_id text,
  p_content_hash text,
  p_chunk_index integer,
  p_usage_date date,
  p_seconds integer,
  p_limit_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_usage public.tts_daily_usage%rowtype;
  v_existing_event public.tts_play_events%rowtype;
  v_remaining integer;
begin
  if p_seconds <= 0 or p_limit_seconds <= 0 then
    return jsonb_build_object(
      'allowed', false,
      'secondsUsed', 0,
      'remainingSeconds', 0,
      'limitSeconds', greatest(p_limit_seconds, 0),
      'code', 'invalid_quota_request'
    );
  end if;

  insert into public.tts_daily_usage (
    user_id,
    usage_date,
    seconds_used,
    limit_seconds
  )
  values (
    p_user_id,
    p_usage_date,
    0,
    p_limit_seconds
  )
  on conflict (user_id, usage_date) do update
  set limit_seconds = excluded.limit_seconds,
      updated_at = now();

  select *
  into v_usage
  from public.tts_daily_usage
  where user_id = p_user_id
    and usage_date = p_usage_date
  for update;

  select *
  into v_existing_event
  from public.tts_play_events
  where user_id = p_user_id
    and session_id = p_session_id
    and content_hash = p_content_hash
    and chunk_index = p_chunk_index;

  if found and v_existing_event.id is not null then
    v_remaining := greatest(v_usage.limit_seconds - v_usage.seconds_used, 0);
    return jsonb_build_object(
      'allowed', true,
      'alreadyConsumed', true,
      'secondsUsed', v_usage.seconds_used,
      'remainingSeconds', v_remaining,
      'limitSeconds', v_usage.limit_seconds,
      'chargedSeconds', v_existing_event.charged_seconds
    );
  end if;

  if v_usage.seconds_used + p_seconds > p_limit_seconds then
    v_remaining := greatest(p_limit_seconds - v_usage.seconds_used, 0);
    return jsonb_build_object(
      'allowed', false,
      'secondsUsed', v_usage.seconds_used,
      'remainingSeconds', v_remaining,
      'limitSeconds', p_limit_seconds,
      'code', 'tts_daily_limit_reached'
    );
  end if;

  insert into public.tts_play_events (
    user_id,
    lecture_id,
    session_id,
    content_hash,
    chunk_index,
    usage_date,
    charged_seconds
  )
  values (
    p_user_id,
    p_lecture_id,
    p_session_id,
    p_content_hash,
    p_chunk_index,
    p_usage_date,
    p_seconds
  )
  on conflict (user_id, session_id, content_hash, chunk_index) do nothing;

  update public.tts_daily_usage
  set seconds_used = seconds_used + p_seconds,
      limit_seconds = p_limit_seconds,
      updated_at = now()
  where user_id = p_user_id
    and usage_date = p_usage_date
  returning *
  into v_usage;

  v_remaining := greatest(v_usage.limit_seconds - v_usage.seconds_used, 0);
  return jsonb_build_object(
    'allowed', true,
    'alreadyConsumed', false,
    'secondsUsed', v_usage.seconds_used,
    'remainingSeconds', v_remaining,
    'limitSeconds', v_usage.limit_seconds,
    'chargedSeconds', p_seconds
  );
end;
$$;

-- From 0027_admin_dashboard.sql.
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
    last_seen_at = now(),
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

-- From 0027_admin_dashboard.sql.
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
  where created_at < now() - make_interval(days => p_days);

  get diagnostics v_deleted = row_count;

  delete from public.site_sessions
  where last_seen_at < now() - make_interval(days => p_days);

  return v_deleted;
end;
$$;

revoke all on function public.prune_site_analytics(integer)
  from public, anon, authenticated;
