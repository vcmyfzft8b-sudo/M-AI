-- The generated podcast: a script, and one audio segment per spoken turn.
--
-- Two tables rather than one because the two halves are earned separately and cached separately.
-- The script is a single model call over the note and is voice-independent by construction (the
-- hosts never address each other by name), so re-voicing an episode costs only its audio. The
-- audio is one Soniox request per turn, made on demand as the listener reaches it, which is what
-- lets a ten-minute episode start playing seconds after its script lands instead of after every
-- minute of it has been synthesized.

create table if not exists public.lecture_podcasts (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  -- The note the script was written from. A note that is edited retires its podcasts the same
  -- way it retires read-aloud audio.
  content_hash text not null,
  format text not null,
  length_id text not null,
  language text not null,
  status text not null default 'generating',
  title text,
  -- [{ speaker: "a" | "b", text: string }], in running order.
  turns jsonb not null default '[]'::jsonb,
  model text,
  error_message text,
  -- When the row was claimed for generation, so a client that reloads mid-write waits for the
  -- call already running rather than paying for a second one — and so a generation killed with
  -- its invocation can be retried once it is plainly dead. Same reasoning as
  -- tts_generation_events, and the same shape.
  generation_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lecture_podcasts_variant_unique
  on public.lecture_podcasts (lecture_id, content_hash, format, length_id, language);

create index if not exists lecture_podcasts_lecture_idx
  on public.lecture_podcasts (lecture_id, updated_at desc);

drop trigger if exists lecture_podcasts_set_updated_at on public.lecture_podcasts;
create trigger lecture_podcasts_set_updated_at
before update on public.lecture_podcasts
for each row execute procedure public.set_updated_at();

alter table public.lecture_podcasts enable row level security;

create policy "lecture_podcasts_select_own"
  on public.lecture_podcasts
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = lecture_podcasts.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create table if not exists public.lecture_podcast_segments (
  id uuid primary key default gen_random_uuid(),
  podcast_id uuid not null references public.lecture_podcasts (id) on delete cascade,
  segment_index integer not null,
  speaker text not null,
  text text not null,
  language text not null,
  voice text not null,
  model text not null,
  audio_storage_path text not null,
  audio_mime_type text not null default 'audio/mpeg',
  duration_ms integer not null,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The voice is part of the key: switching a host's voice re-synthesizes that host's turns and
-- leaves the other half of the episode alone.
create unique index if not exists lecture_podcast_segments_cache_unique
  on public.lecture_podcast_segments (podcast_id, segment_index, voice, model);

create index if not exists lecture_podcast_segments_podcast_idx
  on public.lecture_podcast_segments (podcast_id, segment_index);

drop trigger if exists lecture_podcast_segments_set_updated_at on public.lecture_podcast_segments;
create trigger lecture_podcast_segments_set_updated_at
before update on public.lecture_podcast_segments
for each row execute procedure public.set_updated_at();

alter table public.lecture_podcast_segments enable row level security;

create policy "lecture_podcast_segments_select_own"
  on public.lecture_podcast_segments
  for select
  using (
    exists (
      select 1
      from public.lecture_podcasts
      join public.lectures on lectures.id = lecture_podcasts.lecture_id
      where lecture_podcasts.id = lecture_podcast_segments.podcast_id
        and lectures.user_id = auth.uid()
    )
  );
