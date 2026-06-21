create table if not exists public.tts_generation_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  content_hash text not null,
  chunk_index integer not null,
  language text not null,
  voice text not null,
  model text not null,
  usage_date date not null,
  reserved_seconds integer not null default 0,
  charged_seconds integer not null default 0,
  status text not null default 'reserved',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint tts_generation_events_status_check
    check (status in ('reserved', 'charged'))
);

create unique index if not exists tts_generation_events_chunk_unique
  on public.tts_generation_events (
    user_id,
    lecture_id,
    content_hash,
    chunk_index,
    language,
    voice,
    model
  );

create index if not exists tts_generation_events_user_date_idx
  on public.tts_generation_events (user_id, usage_date, created_at desc);

drop trigger if exists tts_generation_events_set_updated_at on public.tts_generation_events;
create trigger tts_generation_events_set_updated_at
before update on public.tts_generation_events
for each row execute procedure public.set_updated_at();

alter table public.tts_generation_events enable row level security;

create policy "tts_generation_events_select_own"
  on public.tts_generation_events
  for select
  using (auth.uid() = user_id);
