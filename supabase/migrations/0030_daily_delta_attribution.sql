-- Attribute view deltas to the days they actually happened.
--
-- The original `ugc_daily_view_deltas` credited the whole delta between two
-- snapshots to the calendar day of the later snapshot. With one snapshot taken
-- at 23:50 every night that is almost exact, but the moment a night is missed
-- or a sync runs at an odd hour, everything since the previous snapshot lands
-- on the sync's day and the day before reads near zero. That is exactly what
-- happened on 2026-08-19: the nightly collection was debounced away, so a
-- video that gained ~9,400 views that evening had them all booked to the
-- morning sync of the 20th, and "yesterday" showed 564.
--
-- Each delta is now spread across the calendar days between the two snapshots,
-- in proportion to how much of that time falls in each day (in the reporting
-- timezone). A video's first snapshot starts accruing at its `posted_at`, so a
-- fresh post's views stay on the day it was posted. It cannot recover the true
-- hour-by-hour curve after a missed night — nothing can — but a gap now leaks
-- proportionally into the days it covers instead of falling entirely on the
-- wrong one, and with the normal nightly cadence it reduces to the old
-- behaviour.

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
  with snaps as (
    select
      s.video_id,
      s.creator_id,
      s.captured_on,
      s.views,
      s.likes,
      s.comments,
      s.shares,
      v.posted_at,
      -- A snapshot describes views up to the end of the day it is stamped
      -- with. Backfill-seeded rows carry the `captured_at` of the sync that
      -- seeded them — a later day entirely — so the timestamp is clamped to
      -- its own day's end before it is used for attribution.
      least(
        s.captured_at,
        ((s.captured_on + 1)::timestamp at time zone 'Europe/Ljubljana')
      ) as eff_at
    from public.ugc_video_stats s
    join public.ugc_videos v on v.id = s.video_id
    where (not p_only_memo or v.classification = 'memo')
  ),
  ordered as (
    select
      snaps.*,
      lag(views) over w as prev_views,
      lag(likes) over w as prev_likes,
      lag(comments) over w as prev_comments,
      lag(shares) over w as prev_shares,
      lag(eff_at) over w as prev_at
    from snaps
    window w as (partition by video_id order by captured_on)
  ),
  spans as (
    select
      creator_id,
      greatest(views - coalesce(prev_views, 0), 0)::numeric as views,
      greatest(likes - coalesce(prev_likes, 0), 0)::numeric as likes,
      greatest(comments - coalesce(prev_comments, 0), 0)::numeric as comments,
      greatest(shares - coalesce(prev_shares, 0), 0)::numeric as shares,
      eff_at as span_end,
      -- The first snapshot of a video covers everything since it was posted.
      -- The clamp keeps a span from ever being empty or inverted, which would
      -- divide by zero below.
      least(
        coalesce(prev_at, posted_at, eff_at - interval '1 day'),
        eff_at - interval '1 second'
      ) as span_start
    from ordered
  ),
  pieces as (
    select
      sp.creator_id,
      (d)::date as day,
      -- The fraction of this span that falls inside this reporting-zone day.
      (
        extract(epoch from
          least(
            sp.span_end,
            (((d)::date + 1)::timestamp at time zone 'Europe/Ljubljana')
          )
          - greatest(
            sp.span_start,
            ((d)::date::timestamp at time zone 'Europe/Ljubljana')
          )
        )
        / extract(epoch from sp.span_end - sp.span_start)
      ) as weight,
      sp.views,
      sp.likes,
      sp.comments,
      sp.shares
    from spans sp
    cross join lateral generate_series(
      (sp.span_start at time zone 'Europe/Ljubljana')::date,
      (sp.span_end at time zone 'Europe/Ljubljana')::date,
      interval '1 day'
    ) as d
  ),
  deltas as (
    select
      pieces.day,
      pieces.creator_id,
      round(sum(views * weight))::bigint as views,
      round(sum(likes * weight))::bigint as likes,
      round(sum(comments * weight))::bigint as comments,
      round(sum(shares * weight))::bigint as shares
    from pieces
    where weight > 0
    group by 1, 2
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
    coalesce(d.day, p.day) as day,
    coalesce(d.creator_id, p.creator_id) as creator_id,
    coalesce(d.views, 0)::bigint as views,
    coalesce(d.likes, 0)::bigint as likes,
    coalesce(d.comments, 0)::bigint as comments,
    coalesce(d.shares, 0)::bigint as shares,
    coalesce(p.videos_posted, 0)::integer as videos_posted
  from (
    select * from deltas where deltas.day between p_from and p_to
  ) d
  full outer join posted p
    on p.day = d.day and p.creator_id = d.creator_id
  order by 1, 2;
$$;

revoke all on function public.ugc_daily_view_deltas(date, date, boolean)
  from public, anon, authenticated;
