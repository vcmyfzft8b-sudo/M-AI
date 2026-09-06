-- Where a listener got to in an episode.
--
-- On the episode row rather than in the browser, because the whole point of the number is that a
-- revising student picks the episode up where they left it — and they leave it on the bus and
-- come back to it at a desk. localStorage would have made "še 2:34" a fact about a device.
--
-- Three columns rather than one. The position alone cannot say whether an episode is finished:
-- an episode played to the end reports a position at its end, which is indistinguishable from
-- one abandoned three seconds before it. `finished_at` is set when playback actually runs out,
-- and it is what the library reads to draw `replay` instead of `play_arrow`.
--
-- `duration_ms` is the length as it was actually heard rather than as it was estimated. The
-- library has only the estimate (turn text over a words-per-second rate) until every segment has
-- been synthesized, and remaining time computed against an estimate that is out by a fifth reads
-- as a bug. Written by the player, which knows.

alter table public.lecture_podcasts
  add column if not exists position_ms integer not null default 0,
  add column if not exists duration_ms integer,
  add column if not exists finished_at timestamptz;

-- Writes go through the service role in /api/lectures/[id]/podcast/progress, which checks the
-- lecture's owner first — the same shape every other write to this table already uses. The
-- select policy from 0043 is what a client reads through, and it is unchanged.
