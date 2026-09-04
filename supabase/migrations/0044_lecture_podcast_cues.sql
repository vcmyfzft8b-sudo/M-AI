-- Subtitles for a generated episode.
--
-- The synthesizer already reports when it said every character; read-aloud uses that to highlight
-- the word being spoken, and the podcast was throwing it away and keeping only the total length.
-- Grouped into subtitle-sized lines it is what lets somebody follow an episode on a loud bus, or
-- with the sound off entirely.
--
-- A column rather than a table: a cue has no life of its own, is written exactly once with the
-- audio it belongs to, and is only ever read all at once for one segment.
alter table public.lecture_podcast_segments
  add column if not exists cues jsonb not null default '[]'::jsonb;
