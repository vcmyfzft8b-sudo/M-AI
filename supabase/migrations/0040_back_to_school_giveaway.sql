-- ---------------------------------------------------------------------------
-- Back-to-school giveaway
-- ---------------------------------------------------------------------------
--
-- Every account gets its own Stripe promotion code (50 % off the first billing
-- period, the existing `memo50-first-cycle` coupon). A friend who subscribes
-- with that code is a referral, and the first account whose referrals reach
-- the campaign goal wins the prize.
--
--   giveaway_codes      — one row per account per campaign: the code the
--                         learner shares and the Stripe promotion code behind
--                         it. Created lazily the first time the giveaway
--                         screen is opened.
--   giveaway_referrals  — one row per subscription bought with a giveaway
--                         code. `pending` while the subscription has not yet
--                         collected money (a trial), `qualified` once Stripe
--                         reports it active, `reversed` if a purchase is later
--                         disqualified by hand (refund, abuse).
--
-- Both tables are written by the server only (checkout, the Stripe webhook,
-- the giveaway screen), so RLS is on with no policies: nothing reaches them
-- through PostgREST as anon or authenticated.

create table if not exists public.giveaway_codes (
  user_id uuid not null references auth.users (id) on delete cascade,
  campaign text not null,
  code text not null,
  stripe_promotion_code_id text not null,
  stripe_coupon_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, campaign),
  unique (code),
  unique (stripe_promotion_code_id)
);

alter table public.giveaway_codes enable row level security;

create table if not exists public.giveaway_referrals (
  id uuid primary key default gen_random_uuid(),
  campaign text not null,
  referrer_user_id uuid not null references auth.users (id) on delete cascade,
  -- Null when Stripe could not tell us who bought (no `userId` in the
  -- subscription metadata). Such a purchase still counts for the referrer.
  referred_user_id uuid references auth.users (id) on delete set null,
  stripe_subscription_id text not null unique,
  stripe_promotion_code_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'qualified', 'reversed')),
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.giveaway_referrals enable row level security;

-- A friend counts once per campaign, however many subscriptions they buy.
create unique index if not exists giveaway_referrals_referred_once_idx
  on public.giveaway_referrals (campaign, referred_user_id)
  where referred_user_id is not null;

create index if not exists giveaway_referrals_referrer_idx
  on public.giveaway_referrals (campaign, referrer_user_id, status);

drop trigger if exists giveaway_referrals_set_updated_at on public.giveaway_referrals;
create trigger giveaway_referrals_set_updated_at
before update on public.giveaway_referrals
for each row execute procedure public.set_updated_at();

-- ---------------------------------------------------------------------------
-- The leaderboard
-- ---------------------------------------------------------------------------
--
-- One row per referrer with at least one qualified referral. The order is the
-- campaign's rule written out:
--
--   1. whoever reached the goal first (the time their p_goal-th referral
--      qualified), so a later account with a bigger count cannot overtake
--      the winner after the fact;
--   2. then the count;
--   3. then whoever reached their current count first.
--
-- The name fields come back raw; the server masks them before anything is
-- sent to a browser. Service-role only.

create or replace function public.giveaway_leaderboard(
  p_campaign text,
  p_goal integer,
  p_limit integer default 10
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  qualified_count bigint,
  latest_qualified_at timestamptz,
  reached_goal_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select
      r.referrer_user_id,
      r.qualified_at,
      row_number() over (
        partition by r.referrer_user_id
        order by r.qualified_at, r.id
      ) as nth
    from public.giveaway_referrals r
    where r.campaign = p_campaign
      and r.status = 'qualified'
      and r.qualified_at is not null
  ),
  totals as (
    select
      referrer_user_id,
      count(*) as qualified_count,
      max(qualified_at) as latest_qualified_at,
      min(qualified_at) filter (where nth = p_goal) as reached_goal_at
    from ranked
    group by referrer_user_id
  )
  select
    t.referrer_user_id as user_id,
    p.full_name,
    p.email,
    t.qualified_count,
    t.latest_qualified_at,
    t.reached_goal_at
  from totals t
  left join public.profiles p on p.id = t.referrer_user_id
  order by
    t.reached_goal_at asc nulls last,
    t.qualified_count desc,
    t.latest_qualified_at asc,
    t.referrer_user_id
  limit greatest(p_limit, 1);
$$;

revoke all on function public.giveaway_leaderboard(text, integer, integer) from public;
revoke all on function public.giveaway_leaderboard(text, integer, integer) from anon;
revoke all on function public.giveaway_leaderboard(text, integer, integer) from authenticated;
grant execute on function public.giveaway_leaderboard(text, integer, integer) to service_role;
