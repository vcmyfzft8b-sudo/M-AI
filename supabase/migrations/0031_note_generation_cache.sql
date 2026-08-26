-- Checkpoint store for the note-generation pipeline.
--
-- The pipeline runs inside a single Inngest step with a ~5-minute budget. A large source takes
-- longer than that, so the step fails on the budget and Inngest retries it — and before this
-- table every retry re-bought the whole two-pass knowledge extraction (~200 Gemini calls) from
-- scratch. On 2026-08-25 that multiplied one day's extraction spend by ~10x. Each extraction
-- window and each outline result is keyed by a hash of its exact input, so a retry re-uses every
-- result the previous attempt already paid for and only runs what is missing.
--
-- Rows are only ever read and written with the service-role key; RLS with no policies keeps the
-- anon and authenticated roles out entirely. Rows die with their lecture via the cascade.

create table if not exists public.note_generation_cache (
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  stage text not null,
  cache_key text not null,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (lecture_id, stage, cache_key)
);

create index if not exists note_generation_cache_created_at_idx
  on public.note_generation_cache (created_at desc);

alter table public.note_generation_cache enable row level security;
