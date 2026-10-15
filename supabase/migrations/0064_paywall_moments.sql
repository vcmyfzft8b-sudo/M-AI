-- ---------------------------------------------------------------------------
-- Paywall discount ladder, per account
-- ---------------------------------------------------------------------------
--
-- Every paywall a free learner meets (a limit, or a browsing offer) moves
-- them a rung up a discount ladder: 20 %, then 30 %, then 40 % off the first
-- payment (`src/lib/paywall-ladder.ts`). The ladder first lived in a browser
-- cookie, which tied it to the device: a second account signed in on the same
-- phone inherited the first one's discount, and the same account on a new
-- device started again. It belongs to the account, like the wheel's prize.
--
--   paywall_moments — the moments recorded so far, oldest first: one entry
--                     per rung climbed, naming what opened that paywall
--                     (`chat`, `offer`, `listen`, ...). Only as many are kept
--                     as still lift the price, so it never holds more than
--                     three. Unknown names are ignored when read, so the set
--                     can grow without a migration.
--
-- Additive with a default: the app before this migration never reads it, and
-- the app after it reads a missing value as "no moments yet".

alter table public.profiles
  add column if not exists paywall_moments text[] not null default '{}';
