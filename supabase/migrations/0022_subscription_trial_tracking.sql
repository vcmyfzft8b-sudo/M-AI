alter table public.profiles
  add column if not exists subscription_trial_started_at timestamptz;
