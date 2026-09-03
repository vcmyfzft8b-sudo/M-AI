-- Metering for the voice tutor.
--
-- The tutor's audio is made in the browser, talking to Soniox directly, so the server never
-- sees a second of it and cannot count what was spoken the way read-aloud does. What it can
-- do is control the door: it hands out a slice of time at a time, minting Soniox keys that
-- expire when the slice does, and the client has to come back for another. A slice is
-- recorded here when it is issued and settled to what was actually used when the client
-- reports back — so an unreported session costs at most one slice rather than the evening.

-- Time bought with money, in seconds. Spent only once the day's allowance is gone.
create table if not exists public.tutor_credit_balances (
  user_id uuid primary key references auth.users (id) on delete cascade,
  seconds_remaining integer not null default 0 check (seconds_remaining >= 0),
  seconds_purchased_total integer not null default 0,
  updated_at timestamptz not null default now()
);

-- The paid plan's daily allowance is spent against this.
create table if not exists public.tutor_daily_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  usage_date date not null,
  seconds_used integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

-- The free allowance is a lifetime one, not a daily one: a minute to hear what this is,
-- once, and then the paywall. So it needs a total that never resets.
create table if not exists public.tutor_usage_totals (
  user_id uuid primary key references auth.users (id) on delete cascade,
  lifetime_seconds integer not null default 0,
  updated_at timestamptz not null default now()
);

-- One row per slice handed out. `granted_seconds` is what the keys were minted for and what
-- is charged if the client never reports; `charged_seconds` is what it actually used.
create table if not exists public.tutor_usage_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lecture_id uuid references public.lectures (id) on delete set null,
  usage_date date not null,
  granted_seconds integer not null,
  charged_seconds integer not null default 0,
  -- Which allowance paid for it, so a refund or a report can tell them apart.
  source text not null check (source in ('free', 'daily', 'credit')),
  status text not null default 'open' check (status in ('open', 'settled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tutor_usage_grants_user_idx
  on public.tutor_usage_grants (user_id, created_at desc);

create index if not exists tutor_usage_grants_open_idx
  on public.tutor_usage_grants (user_id, status)
  where status = 'open';

drop trigger if exists tutor_credit_balances_set_updated_at on public.tutor_credit_balances;
create trigger tutor_credit_balances_set_updated_at
before update on public.tutor_credit_balances
for each row execute procedure public.set_updated_at();

drop trigger if exists tutor_daily_usage_set_updated_at on public.tutor_daily_usage;
create trigger tutor_daily_usage_set_updated_at
before update on public.tutor_daily_usage
for each row execute procedure public.set_updated_at();

drop trigger if exists tutor_usage_totals_set_updated_at on public.tutor_usage_totals;
create trigger tutor_usage_totals_set_updated_at
before update on public.tutor_usage_totals
for each row execute procedure public.set_updated_at();

drop trigger if exists tutor_usage_grants_set_updated_at on public.tutor_usage_grants;
create trigger tutor_usage_grants_set_updated_at
before update on public.tutor_usage_grants
for each row execute procedure public.set_updated_at();

alter table public.tutor_credit_balances enable row level security;
alter table public.tutor_daily_usage enable row level security;
alter table public.tutor_usage_totals enable row level security;
alter table public.tutor_usage_grants enable row level security;

-- Readable by their owner, written only by the service role: every change to a balance is a
-- consequence of a payment or of time actually spent, never of a client saying so.
create policy "tutor_credit_balances_select_own"
  on public.tutor_credit_balances for select using (auth.uid() = user_id);

create policy "tutor_daily_usage_select_own"
  on public.tutor_daily_usage for select using (auth.uid() = user_id);

create policy "tutor_usage_totals_select_own"
  on public.tutor_usage_totals for select using (auth.uid() = user_id);

create policy "tutor_usage_grants_select_own"
  on public.tutor_usage_grants for select using (auth.uid() = user_id);

-- Adds purchased time, creating the row on first purchase. Runs as the service role from the
-- Stripe webhook; kept as a function so the read-modify-write cannot race two webhooks.
create or replace function public.add_tutor_credit_seconds(
  target_user_id uuid,
  seconds integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance integer;
begin
  insert into public.tutor_credit_balances (user_id, seconds_remaining, seconds_purchased_total)
  values (target_user_id, seconds, seconds)
  on conflict (user_id) do update
    set seconds_remaining = public.tutor_credit_balances.seconds_remaining + excluded.seconds_remaining,
        seconds_purchased_total = public.tutor_credit_balances.seconds_purchased_total + excluded.seconds_purchased_total
  returning seconds_remaining into new_balance;

  return new_balance;
end;
$$;

-- Spends seconds against the day, the lifetime total and (only if asked) the credit balance,
-- in one statement so two tabs cannot both spend the last minute.
create or replace function public.record_tutor_usage(
  target_user_id uuid,
  usage_day date,
  seconds integer,
  from_credits integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tutor_daily_usage (user_id, usage_date, seconds_used)
  values (target_user_id, usage_day, seconds)
  on conflict (user_id, usage_date) do update
    set seconds_used = public.tutor_daily_usage.seconds_used + excluded.seconds_used;

  insert into public.tutor_usage_totals (user_id, lifetime_seconds)
  values (target_user_id, seconds)
  on conflict (user_id) do update
    set lifetime_seconds = public.tutor_usage_totals.lifetime_seconds + excluded.lifetime_seconds;

  if from_credits > 0 then
    update public.tutor_credit_balances
      set seconds_remaining = greatest(seconds_remaining - from_credits, 0)
      where user_id = target_user_id;
  end if;
end;
$$;

-- One row per completed top-up, keyed by the Stripe checkout session so a redelivered
-- webhook credits the hour once rather than every time Stripe retries.
create table if not exists public.tutor_credit_purchases (
  stripe_checkout_session_id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  seconds integer not null,
  amount_total integer not null default 0,
  currency text not null default 'eur',
  created_at timestamptz not null default now()
);

create index if not exists tutor_credit_purchases_user_idx
  on public.tutor_credit_purchases (user_id, created_at desc);

alter table public.tutor_credit_purchases enable row level security;

create policy "tutor_credit_purchases_select_own"
  on public.tutor_credit_purchases for select using (auth.uid() = user_id);
