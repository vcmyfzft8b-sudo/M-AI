create table if not exists public.library_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.library_folder_lectures (
  folder_id uuid not null references public.library_folders (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default timezone('utc'::text, now()),
  primary key (folder_id, lecture_id)
);

create index if not exists library_folders_user_created_idx
  on public.library_folders (user_id, created_at asc);

create index if not exists library_folder_lectures_user_folder_idx
  on public.library_folder_lectures (user_id, folder_id);

create index if not exists library_folder_lectures_lecture_idx
  on public.library_folder_lectures (lecture_id);

drop trigger if exists library_folders_set_updated_at on public.library_folders;
create trigger library_folders_set_updated_at
before update on public.library_folders
for each row execute procedure public.set_updated_at();

alter table public.library_folders enable row level security;
alter table public.library_folder_lectures enable row level security;

create policy "library_folders_select_own"
  on public.library_folders
  for select
  using (auth.uid() = user_id);

create policy "library_folders_insert_own"
  on public.library_folders
  for insert
  with check (auth.uid() = user_id);

create policy "library_folders_update_own"
  on public.library_folders
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "library_folders_delete_own"
  on public.library_folders
  for delete
  using (auth.uid() = user_id);

create policy "library_folder_lectures_select_own"
  on public.library_folder_lectures
  for select
  using (auth.uid() = user_id);

create policy "library_folder_lectures_insert_own"
  on public.library_folder_lectures
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.library_folders
      where library_folders.id = library_folder_lectures.folder_id
        and library_folders.user_id = auth.uid()
    )
    and exists (
      select 1
      from public.lectures
      where lectures.id = library_folder_lectures.lecture_id
        and lectures.user_id = auth.uid()
    )
  );

create policy "library_folder_lectures_delete_own"
  on public.library_folder_lectures
  for delete
  using (auth.uid() = user_id);
