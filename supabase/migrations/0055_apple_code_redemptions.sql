-- Claimed after checking every origin branch and open PR on 2026-09-23: none
-- goes past 0054.
--
-- ---------------------------------------------------------------------------
-- Crediting a creator's code when it is redeemed through Apple
-- ---------------------------------------------------------------------------
--
-- On the web a code is stamped on the Stripe invoice, and creator reporting
-- reads it from there. In the iOS app the same code only unlocks an Apple
-- offer: Apple's transaction never carries our code. So the server records the
-- code when it validates it (`validated_at`), and attaches the purchase that
-- follows (`transaction_id` onwards). Only an attached row is a sale; a row
-- that never gets a purchase is somebody who checked a code and walked away.
--
-- Mirrors the Stripe rule in `promoCodeStats`: the creator is credited with the
-- customer's first paid charge, not their renewals, so one row per purchase.
--
-- `user_id` is `on delete set null`: deleting an account erases who bought,
-- but a creator's earned commission does not disappear with it, exactly as the
-- Stripe invoice survives a deleted customer.
--
-- Service role only. RLS on with no policies, like the rest of the ledger.

set local lock_timeout = '5s';

create table public.apple_code_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  code text not null check (code = upper(code) and length(code) between 1 and 64),
  validated_at timestamptz not null default now(),
  environment text check (environment in ('production', 'sandbox')),
  original_transaction_id text,
  transaction_id text unique,
  product_id text,
  offer_type smallint,
  -- Apple's customer price for this charge, in minor units of `currency`
  -- (Apple reports milliunits). Gross of Apple's commission and VAT.
  price_minor integer check (price_minor >= 0),
  currency text,
  paid_at timestamptz,
  revoked_at timestamptz,
  check ((transaction_id is null) = (paid_at is null))
);

-- The attach step looks for this user's latest unattached validation.
create index apple_code_redemptions_pending_idx
  on public.apple_code_redemptions (user_id, validated_at desc)
  where transaction_id is null;

-- One credited purchase per Apple subscription, however many times it is
-- restored or re-notified.
create unique index apple_code_redemptions_original_idx
  on public.apple_code_redemptions (original_transaction_id)
  where original_transaction_id is not null;

create index apple_code_redemptions_paid_idx
  on public.apple_code_redemptions (paid_at)
  where paid_at is not null;

alter table public.apple_code_redemptions enable row level security;
revoke all on public.apple_code_redemptions from anon, authenticated;
