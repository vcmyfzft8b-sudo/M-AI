-- The mindmap a note can be read as: one row per lecture, holding the whole tree.
--
-- The tree is stored as a single jsonb document rather than a node table on purpose. It is
-- always read whole and never queried into — no screen asks for "the depth-2 nodes of this
-- lecture" — and writing it as one row makes generation a single upsert that cannot leave a
-- half-built tree on screen if the invocation dies between statements.
create table if not exists public.lecture_mindmap_assets (
  lecture_id uuid primary key references public.lectures (id) on delete cascade,
  status text not null default 'queued' check (
    status in ('queued', 'generating', 'ready', 'failed')
  ),
  error_message text,
  -- The MindmapDoc of src/lib/mindmap-doc.ts. Empty until the first generation lands.
  map_json jsonb not null default '{}'::jsonb,
  -- Which note this map was drawn from, so an edited note can be spotted as stale rather
  -- than silently shown as the map of text that no longer exists.
  notes_hash text,
  model_metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists lecture_mindmap_assets_set_updated_at on public.lecture_mindmap_assets;
create trigger lecture_mindmap_assets_set_updated_at
before update on public.lecture_mindmap_assets
for each row execute procedure public.set_updated_at();

alter table public.lecture_mindmap_assets enable row level security;

create policy "lecture_mindmap_assets_select_own"
  on public.lecture_mindmap_assets
  for select
  using (
    exists (
      select 1
      from public.lectures
      where lectures.id = lecture_mindmap_assets.lecture_id
        and lectures.user_id = auth.uid()
    )
  );
