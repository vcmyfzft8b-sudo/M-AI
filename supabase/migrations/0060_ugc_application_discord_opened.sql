-- When an accepted applicant, after signing the terms, opened their campaign's Discord
-- invite from the join page. The join page shows "you're in" from then on, and the
-- admin card shows it. It records the invite being opened, not Discord membership:
-- the site cannot see who is inside a Discord server.
alter table public.ugc_creator_applications
  add column if not exists discord_opened_at timestamptz;
