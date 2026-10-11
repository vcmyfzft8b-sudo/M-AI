-- Contracts for creators already in the UGC program, and the signed text of every
-- contract.
--
-- New creators sign the Terms of Participation from their application
-- (`ugc_creator_applications`, campaign pay). Creators who were in the program
-- before it had applications each have their own deal, so the admin creates a
-- contract with its own pay: `pay` holds the deal (per TikTok / Instagram video,
-- per 1,000 views, code share, monthly fee, caps, an optional special clause; see
-- `src/lib/ugc/creator-pay.ts`) and the terms are rendered from it. Nothing is
-- emailed: the admin copies the signing link (`/ugc/join/<join_token>`) and sends
-- it to the creator themselves. The creator signs exactly like an applicant: typed
-- name, a parent or guardian's too when `minor`, version, time, IP and browser are
-- kept, and the exact text they accepted is stored in `terms_snapshot`.
--
-- A contract is never edited once created: a changed deal is a new contract, and
-- the old one is voided. Like every other admin table: RLS on, no policies.

create table if not exists public.ugc_creator_contracts (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid references public.ugc_creators (id) on delete set null,
  email text check (email is null or char_length(email) between 3 and 254),
  full_name text not null check (char_length(full_name) between 1 and 120),
  market text not null check (market in ('si', 'balkans')),
  locale text not null default 'sl' check (locale in ('sl', 'en', 'hr', 'bs', 'sr')),
  minor boolean not null default false,
  pay jsonb not null,
  status text not null default 'sent' check (status in ('sent', 'signed', 'void')),
  join_token uuid not null default gen_random_uuid(),
  terms_version text,
  signed_at timestamptz,
  signed_name text check (signed_name is null or char_length(signed_name) <= 120),
  guardian_name text check (guardian_name is null or char_length(guardian_name) <= 120),
  signed_ip text,
  signed_user_agent text,
  terms_snapshot text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text
);

create unique index if not exists ugc_creator_contracts_join_token_unique
  on public.ugc_creator_contracts (join_token);

create index if not exists ugc_creator_contracts_creator_idx
  on public.ugc_creator_contracts (creator_id, created_at desc);

drop trigger if exists ugc_creator_contracts_set_updated_at on public.ugc_creator_contracts;
create trigger ugc_creator_contracts_set_updated_at
before update on public.ugc_creator_contracts
for each row execute procedure public.set_updated_at();

alter table public.ugc_creator_contracts enable row level security;

-- Applicants' signatures keep the exact text too, so every signed contract (new
-- applicants and existing creators alike) can be shown word for word later.
alter table public.ugc_creator_applications
  add column if not exists terms_snapshot text;
