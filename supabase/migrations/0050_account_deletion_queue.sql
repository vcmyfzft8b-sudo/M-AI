-- Claimed after checking all 410 remote PR heads on 2026-09-15: none uses 0050.
-- Service-only, durable erasure jobs. Keep the owner/prefixes until storage cleanup
-- and auth deletion both succeed; never lose them through an auth FK cascade.
-- Native Apple authorization is retained encrypted, only for token revocation.
-- It is never exposed in profiles, auth metadata/JWTs, or browser-readable rows.
create table public.apple_auth_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  apple_subject text not null,
  refresh_token_encrypted text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);
alter table public.apple_auth_grants enable row level security;
revoke all on public.apple_auth_grants from anon, authenticated;
grant all on public.apple_auth_grants to service_role;

create table public.account_deletion_requests (
  user_id uuid primary key,
  requested_at timestamptz not null default now(),
  cleanup_after timestamptz not null default now() + interval '3 hours',
  failure_lecture_ids uuid[] not null default '{}'
);
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from anon, authenticated;
grant all on public.account_deletion_requests to service_role;
create index account_deletion_requests_due_idx on public.account_deletion_requests(cleanup_after);

create function public.request_account_deletion(target_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- This marker is server-controlled. Browser user_metadata cannot clear it.
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb)
    || jsonb_build_object('memo_deletion_requested_at', now())
  where id = target_user_id;
  if not found then raise exception 'Account not found'; end if;
  insert into public.account_deletion_requests(user_id)
  values(target_user_id) on conflict (user_id) do nothing;
end;
$$;
revoke all on function public.request_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.request_account_deletion(uuid) to service_role;

-- Previously issued browser JWTs must not regain storage access when the queue
-- row is eventually removed. Check auth.users as well as the erasure queue.
create function public.account_can_use_storage()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.users where id = auth.uid())
    and not exists(select 1 from public.account_deletion_requests where user_id = auth.uid());
$$;
revoke all on function public.account_can_use_storage() from public, anon;
grant execute on function public.account_can_use_storage() to authenticated, service_role;
create policy account_deletion_storage_guard on storage.objects
  as restrictive for all to authenticated
  using (public.account_can_use_storage())
  with check (public.account_can_use_storage());

-- Signed upload tokens last two hours and are not individually revocable.
-- The three-hour drain also covers in-flight server requests (at most 300s).
-- Server storage writers check the deletion marker before every upload/copy.
-- The hourly worker must finish erasure before deleting the queue row.
