-- Two allowances where there was one.
--
-- The tutor and the podcast were metered out of the same daily half hour, which was the right
-- thing while the podcast was new: it reused a ledger that already worked. It is the wrong
-- thing now that both are real features, because spending an evening on one silently took the
-- other away, and neither meter could say which had gone.
--
-- So the ledger gains a feature dimension. The tables keep their tutor_ names — they are the
-- same ledger, and renaming four tables in production to make a comment read better is not a
-- trade worth making — but every row in them now says which of the two spent it.
--
-- Everything already recorded is the tutor's. The podcast has never been metered separately
-- and, until this deploys, could not have been, so the column default backfills correctly on
-- its own.

alter table public.tutor_usage_grants
  add column if not exists feature text not null default 'tutor';

alter table public.tutor_daily_usage
  add column if not exists feature text not null default 'tutor';

alter table public.tutor_usage_totals
  add column if not exists feature text not null default 'tutor';

do $$
begin
  alter table public.tutor_usage_grants
    add constraint tutor_usage_grants_feature_check check (feature in ('tutor', 'podcast'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.tutor_daily_usage
    add constraint tutor_daily_usage_feature_check check (feature in ('tutor', 'podcast'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.tutor_usage_totals
    add constraint tutor_usage_totals_feature_check check (feature in ('tutor', 'podcast'));
exception
  when duplicate_object then null;
end
$$;

-- The day and the lifetime are now per feature, so both keys grow by a column. Dropped and
-- recreated rather than added alongside: two rows for one user and one day is exactly what
-- the old key forbade and the new one has to allow.
alter table public.tutor_daily_usage drop constraint if exists tutor_daily_usage_pkey;

/*
 * Only "it is already exactly this" is tolerated. `invalid_table_definition` here means the drop
 * above did not match the live constraint and the table still has its old two-column key —
 * swallowing that would report a successful migration and leave record_tutor_usage raising "no
 * unique or exclusion constraint matching the ON CONFLICT specification" on every call, which is
 * every second of usage going unrecorded, silently.
 */
do $$
begin
  alter table public.tutor_daily_usage
    add constraint tutor_daily_usage_pkey primary key (user_id, usage_date, feature);
exception
  when duplicate_table then null;
end
$$;

alter table public.tutor_usage_totals drop constraint if exists tutor_usage_totals_pkey;

do $$
begin
  alter table public.tutor_usage_totals
    add constraint tutor_usage_totals_pkey primary key (user_id, feature);
exception
  when duplicate_table then null;
end
$$;

-- Spending, told which allowance it comes out of.
--
-- Credits are deliberately NOT split: an hour is bought as voice time and can be spent on
-- either feature, so there is still one balance and it is still decremented here.
create or replace function public.record_tutor_usage(
  target_user_id uuid,
  usage_day date,
  seconds integer,
  from_credits integer,
  feature_key text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tutor_daily_usage (user_id, usage_date, feature, seconds_used)
  values (target_user_id, usage_day, feature_key, seconds)
  on conflict (user_id, usage_date, feature) do update
    set seconds_used = public.tutor_daily_usage.seconds_used + excluded.seconds_used;

  insert into public.tutor_usage_totals (user_id, feature, lifetime_seconds)
  values (target_user_id, feature_key, seconds)
  on conflict (user_id, feature) do update
    set lifetime_seconds = public.tutor_usage_totals.lifetime_seconds + excluded.lifetime_seconds;

  if from_credits > 0 then
    update public.tutor_credit_balances
      set seconds_remaining = greatest(seconds_remaining - from_credits, 0)
      where user_id = target_user_id;
  end if;
end;
$$;

-- The four-argument form is kept, delegating to the tutor, so that the minutes of a deploy in
-- which the database is ahead of the code do not throw. Nothing new calls it.
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
  perform public.record_tutor_usage(target_user_id, usage_day, seconds, from_credits, 'tutor');
end;
$$;
