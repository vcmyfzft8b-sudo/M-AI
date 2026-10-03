-- Record what each creator is paid, and where the money goes.
--
-- Until now a payout run lived in a phone note: someone counted the videos,
-- someone else added the code bonus from Stripe, and the account numbers sat
-- next to the amounts in the same note. Nothing in the dashboard said who had
-- been paid for which month, so "is Zala's August bonus still owed?" could only
-- be answered from memory.
--
-- `payout_details` is free text on purpose: creators are paid by Flik (a phone
-- number), by IBAN, or by a Revolut link, sometimes one person per line when a
-- creator row is a pair.
--
-- A payout is one line per payee per month. `payee` is empty for a creator paid
-- on their own and names the person when a row covers two (Martin & David,
-- Mija & Megi), so each half can be marked paid on its own.

alter table public.ugc_creators
  add column if not exists payout_details text;

create table if not exists public.ugc_creator_payouts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.ugc_creators (id) on delete cascade,
  -- First day of the month the payout is for.
  period date not null check (extract(day from period) = 1),
  payee text not null default '',
  -- Flat fee for the videos (or views) in the period, euros.
  base_amount numeric(12, 2) not null default 0 check (base_amount >= 0),
  -- Share of what their own code collected in the period, euros.
  bonus_amount numeric(12, 2) not null default 0 check (bonus_amount >= 0),
  -- How the amounts were arrived at, e.g. "16 videos × €5 · 20% of €65".
  note text,
  paid_at timestamptz,
  paid_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);

create unique index if not exists ugc_creator_payouts_unique
  on public.ugc_creator_payouts (creator_id, period, payee);

create index if not exists ugc_creator_payouts_period_idx
  on public.ugc_creator_payouts (period desc);

drop trigger if exists ugc_creator_payouts_set_updated_at on public.ugc_creator_payouts;
create trigger ugc_creator_payouts_set_updated_at
before update on public.ugc_creator_payouts
for each row execute procedure public.set_updated_at();

-- Service role only, like every other admin table: RLS on, no policies.
alter table public.ugc_creator_payouts enable row level security;
