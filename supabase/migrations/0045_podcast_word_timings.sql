-- Per-word timings for a generated episode's audio, used to caption it.
--
-- Self-contained on purpose. An earlier migration in this series added a `cues` column holding
-- finished caption lines, was applied to production, and was never recorded in the migration
-- history — leaving a local file that sorts before the last remote version, which blocks every
-- later push. Since this migration already supersedes it in full, that file is gone and this one
-- both adds what replaced it and clears it away, so a fresh database and production end at the
-- same schema by the same recorded path.
alter table public.lecture_podcast_segments
  add column if not exists word_timings jsonb not null default '[]'::jsonb;

alter table public.lecture_podcast_segments
  drop column if exists cues;
