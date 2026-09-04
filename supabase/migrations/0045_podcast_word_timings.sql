-- Store what the synthesizer said and when, rather than how it was cut into captions.
--
-- 0044 stored the finished caption lines. That was the wrong artifact to keep: the cuts are a
-- judgement that gets revised, and while they were what was stored, revising them left every
-- episode that already existed showing the old cuts for ever — the segment cache is keyed on the
-- audio, so nothing short of re-synthesising paid-for audio could refresh them.
--
-- The word timings are the durable half: a fact about audio that was bought once and cannot
-- change. Captions are regrouped from them on every read, so the grouping is free to change.
--
-- `cues` is dropped rather than kept. It holds only values derived from timings this column now
-- carries, it is a day old, and leaving both would leave two answers to the same question.
alter table public.lecture_podcast_segments
  add column if not exists word_timings jsonb not null default '[]'::jsonb;

alter table public.lecture_podcast_segments
  drop column if exists cues;
