-- Audit trail for admin impersonation.
--
-- Opening a learner's account is the most powerful thing an admin can do in this product, so it
-- leaves a record: one row per start, written service-side by the admin-gated route. There is no
-- end-time column on purpose — an impersonation ends by cookie swap, browser close or token
-- expiry, and a column that is usually wrong is worse than no column.
--
-- Rows name a user, so they are service-role only: RLS on with no policies. `target_user_id` is
-- intentionally *not* a foreign key — the audit record must survive the account being deleted.

create table if not exists public.admin_impersonation_events (
  id uuid primary key default gen_random_uuid(),
  admin_email text,
  target_user_id uuid not null,
  target_email text,
  user_agent text,
  started_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists admin_impersonation_events_started_at_idx
  on public.admin_impersonation_events (started_at desc);

create index if not exists admin_impersonation_events_target_idx
  on public.admin_impersonation_events (target_user_id, started_at desc);

alter table public.admin_impersonation_events enable row level security;
