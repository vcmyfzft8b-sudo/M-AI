-- ---------------------------------------------------------------------------
-- One-shot discount wheel
-- ---------------------------------------------------------------------------
--
-- The redesigned home screen offers people without a subscription a single
-- spin of a prize wheel, and the prize is a Stripe coupon applied to their
-- next checkout. Two things have to survive a reload, a second device and a
-- re-install, so they live on the profile rather than in the browser:
--
--   discount_wheel_spun_at  — when the wheel was spun. Non-null means the
--                             offer is spent; the card stops being shown and
--                             /api/discount-wheel refuses a second spin.
--   discount_wheel_coupon   — the Stripe coupon id the spin awarded, e.g.
--                             `memo50-first-cycle`. Checkout reads it and
--                             attaches it to the session.
--   discount_wheel_redeemed_at — when a checkout actually consumed it, so a
--                             coupon is attached once and not to every later
--                             purchase.
--
-- Coupon ids are not validated here on purpose: they are Stripe's namespace,
-- and pinning the set in a check constraint would mean a migration every time
-- a promotion changes.

alter table public.profiles
  add column if not exists discount_wheel_spun_at timestamptz,
  add column if not exists discount_wheel_coupon text,
  add column if not exists discount_wheel_redeemed_at timestamptz;

-- The only query is "does this profile have an unredeemed prize?", run once
-- per checkout, so a partial index over the few rows that have one is enough.
create index if not exists profiles_discount_wheel_pending_idx
  on public.profiles (id)
  where discount_wheel_coupon is not null and discount_wheel_redeemed_at is null;
