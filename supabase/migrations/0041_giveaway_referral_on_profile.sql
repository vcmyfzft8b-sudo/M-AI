-- ---------------------------------------------------------------------------
-- Giveaway: the friend's code sticks to the account
-- ---------------------------------------------------------------------------
--
-- The share link stores a friend's code in a cookie, which lives in one
-- browser. Somebody who opens the link on their phone, signs in there, and
-- buys a week later from a laptop would lose the friend the credit. So the
-- first time a signed-in account is seen with a friend's code — on the link
-- itself, on the paywall, at checkout — the code is written to the profile
-- and checkout falls back to it when the cookie is gone. First code wins.
--
--   giveaway_referral_code     — the friend's code, e.g. BTS-7K2XQ4. Not a
--                                foreign key on purpose: a code that is later
--                                deactivated in Stripe simply stops resolving.
--   giveaway_referral_seen_at  — when it was attached.

alter table public.profiles
  add column if not exists giveaway_referral_code text,
  add column if not exists giveaway_referral_seen_at timestamptz;
