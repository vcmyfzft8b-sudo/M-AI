create table if not exists public.mobile_app_store_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  product_id text not null,
  transaction_id text not null unique,
  original_transaction_id text not null,
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'pending_verification')),
  purchased_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  signed_transaction_jws text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists mobile_app_store_entitlements_user_status_idx
  on public.mobile_app_store_entitlements (user_id, status, expires_at desc);

create unique index if not exists mobile_app_store_entitlements_original_product_unique
  on public.mobile_app_store_entitlements (original_transaction_id, product_id);

drop trigger if exists mobile_app_store_entitlements_set_updated_at
  on public.mobile_app_store_entitlements;

create trigger mobile_app_store_entitlements_set_updated_at
before update on public.mobile_app_store_entitlements
for each row execute procedure public.set_updated_at();

alter table public.mobile_app_store_entitlements enable row level security;

create policy "mobile_app_store_entitlements_select_own"
  on public.mobile_app_store_entitlements
  for select
  using (auth.uid() = user_id);
