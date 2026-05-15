alter table public.lecture_artifacts
  add column if not exists editable_notes_doc jsonb,
  add column if not exists editable_notes_md text,
  add column if not exists editable_notes_plain text,
  add column if not exists editable_notes_revision integer not null default 0,
  add column if not exists editable_notes_updated_at timestamptz;

create table if not exists public.lecture_note_media (
  id uuid primary key default gen_random_uuid(),
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null,
  byte_size integer not null check (byte_size > 0),
  original_file_name text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists lecture_note_media_lecture_created_idx
  on public.lecture_note_media (lecture_id, created_at desc);

alter table public.lecture_note_media enable row level security;

create policy "lecture_note_media_select_own"
  on public.lecture_note_media
  for select
  using (auth.uid() = user_id);

create policy "lecture_note_media_insert_own"
  on public.lecture_note_media
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.lectures
      where lectures.id = lecture_note_media.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "lecture_note_media_delete_own"
  on public.lecture_note_media
  for delete
  using (auth.uid() = user_id);
