-- ---------------------------------------------------------------------------
-- "Add to home screen" badge, per account
-- ---------------------------------------------------------------------------
--
-- The settings row that explains adding Memo to the home screen carries a red
-- dot until somebody opens it, and the gear on the home screen carries the
-- same dot so the row can be found. Whether it has been opened lived only in
-- `localStorage`, which made it a per-browser fact: the badge came back on a
-- second device and vanished for anyone whose storage was cleared.
--
-- `install_guide_seen_at` moves it onto the profile, where it belongs:
--
--   null      — never opened. Every account is here today, which is the point:
--               existing users get the badge once, new ones get it from their
--               first visit.
--   timestamp — when the guide was opened. The badge never comes back, on any
--               device.
--
-- Deliberately not backfilled. The column starting out null is what shows the
-- badge to the people who already have accounts.

alter table public.profiles
  add column if not exists install_guide_seen_at timestamptz;
