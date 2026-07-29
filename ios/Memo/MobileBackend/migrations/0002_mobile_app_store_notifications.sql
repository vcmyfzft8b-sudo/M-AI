create table if not exists public.mobile_app_store_notifications (
  id uuid primary key default gen_random_uuid(),
  notification_uuid text not null unique,
  notification_type text not null,
  subtype text,
  environment text not null default 'production' check (environment in ('sandbox', 'production')),
  user_id uuid references auth.users (id) on delete set null,
  product_id text,
  transaction_id text,
  original_transaction_id text,
  processed_status text not null default 'recorded_unmatched' check (
    processed_status in ('processed', 'recorded_unmatched')
  ),
  signed_payload_jws text not null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists mobile_app_store_notifications_original_tx_idx
  on public.mobile_app_store_notifications (original_transaction_id, product_id, created_at desc);

create index if not exists mobile_app_store_notifications_user_idx
  on public.mobile_app_store_notifications (user_id, created_at desc);

alter table public.mobile_app_store_notifications enable row level security;
