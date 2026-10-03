-- Running costs for the admin dashboard's Costs page.
--
-- Most costs are read live from the provider (Stripe, OpenRouter, Soniox) or
-- from our own call log. The rest are subscriptions no API will tell us about
-- — Supabase's plan, Apple's yearly fee, the domain — and those are kept here
-- so the monthly total is complete and can be edited from the dashboard.

create table if not exists public.admin_fixed_costs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null default 'eur' check (currency in ('eur', 'usd')),
  cadence text not null default 'monthly' check (cadence in ('monthly', 'yearly')),
  -- Set when a live reading can replace this estimate: the page counts the
  -- live figure instead whenever that source answers, never both.
  live_source text,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);

drop trigger if exists admin_fixed_costs_set_updated_at on public.admin_fixed_costs;
create trigger admin_fixed_costs_set_updated_at
before update on public.admin_fixed_costs
for each row execute procedure public.set_updated_at();

-- Service role only, like every other admin table: RLS on, no policies.
alter table public.admin_fixed_costs enable row level security;

-- Starting values, as measured for September 2026. Editable on the page.
insert into public.admin_fixed_costs (name, amount, currency, cadence, live_source, note, created_by)
select * from (values
  ('Supabase', 35.00, 'usd', 'monthly', null,
   'Pro plan $25 + the staging branch''s compute (~$10). Production''s Micro compute is covered by the plan credit.',
   'migration:0057'),
  ('Vercel', 20.00, 'usd', 'monthly', 'vercel',
   'Pro seat. Usage on top (~$10 in Sept 2026) is only readable with a billing token (VERCEL_BILLING_TOKEN).',
   'migration:0057'),
  ('Apple Developer Program', 99.00, 'eur', 'yearly', null,
   'Needed to publish the iOS app.',
   'migration:0057')
) as seed (name, amount, currency, cadence, live_source, note, created_by)
where not exists (select 1 from public.admin_fixed_costs);

-- What our own call log says each AI provider cost in a window.
--
-- OpenRouter-billed calls are logged with an `or/` model prefix whatever the
-- underlying vendor, so they are bucketed by that rather than by `provider`.
-- The log is an estimate (some models carry no price); the page prefers the
-- provider's own meter wherever one exists and uses this for the rest.
create or replace function public.admin_ai_cost_by_provider(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  bucket text,
  calls bigint,
  priced_calls bigint,
  cost_usd numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    case when model like 'or/%' then 'openrouter' else provider end as bucket,
    count(*) as calls,
    count(estimated_cost_usd) as priced_calls,
    coalesce(sum(estimated_cost_usd), 0) as cost_usd
  from public.ai_usage_events
  where created_at >= p_from
    and created_at < p_to
  group by 1
  order by 4 desc;
$$;

revoke all on function public.admin_ai_cost_by_provider(timestamptz, timestamptz)
  from public, anon, authenticated;
