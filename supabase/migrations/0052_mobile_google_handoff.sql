-- Claimed after checking the migration directory and every open PR on 2026-09-19:
-- 0051 is taken by the admin onboarding breakdown, so this is 0052.
--
-- Where the app's Google sign-in leaves its authorization code when the browser
-- sheet cannot hand it back.
--
-- The sheet returns to /auth/mobile-callback and that page tries to bounce into
-- the app's own URL scheme. On the account holder's iPhone that bounce does not
-- arrive: the page is reached every time and the app never posts the code, so
-- the sheet sits there and sign-in fails with nothing to show. The page now
-- also writes the answer here, and the page inside the app's web view collects
-- it. Whichever route works first wins.
--
-- The row is useless to anyone but that web view. The code is bound by PKCE to
-- a verifier cookie held only there, and collecting it also requires the
-- state cookie set when the flow began. Rows are single use and short lived.
create table public.mobile_oauth_handoffs (
  state text primary key,
  code text,
  error text,
  created_at timestamptz not null default now()
);
alter table public.mobile_oauth_handoffs enable row level security;
revoke all on public.mobile_oauth_handoffs from anon, authenticated;
grant all on public.mobile_oauth_handoffs to service_role;
create index mobile_oauth_handoffs_created_idx on public.mobile_oauth_handoffs(created_at);

-- Writing one sweeps the expired ones, so nothing accumulates and no code
-- outlives the sign-in it belongs to. Ten minutes is far longer than the round
-- trip and far shorter than the code's own life.
create function public.record_mobile_oauth_handoff(
  handoff_state text,
  handoff_code text,
  handoff_error text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.mobile_oauth_handoffs where created_at < now() - interval '10 minutes';
  insert into public.mobile_oauth_handoffs(state, code, error)
  values (handoff_state, handoff_code, handoff_error)
  on conflict (state) do update
    set code = excluded.code, error = excluded.error, created_at = now();
end;
$$;
revoke all on function public.record_mobile_oauth_handoff(text, text, text) from public, anon, authenticated;
grant execute on function public.record_mobile_oauth_handoff(text, text, text) to service_role;

-- Reading one spends it: a code is exchanged once, and a second reader gets
-- nothing rather than a second chance at the same session.
create function public.claim_mobile_oauth_handoff(handoff_state text)
returns table (code text, error text) language plpgsql security definer set search_path = '' as $$
begin
  return query
  delete from public.mobile_oauth_handoffs
  where state = handoff_state and created_at > now() - interval '10 minutes'
  returning mobile_oauth_handoffs.code, mobile_oauth_handoffs.error;
end;
$$;
revoke all on function public.claim_mobile_oauth_handoff(text) from public, anon, authenticated;
grant execute on function public.claim_mobile_oauth_handoff(text) to service_role;
