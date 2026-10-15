-- Claimed as 0067 after checking main (at 0064) and the open PRs on 2026-10-16: PR #590
-- (exam prep) holds 0065 and 0066 and has applied them to staging. First written as 0065,
-- which no database ever recorded.
--
-- Every creator contract can be edited from the admin (`/admin/contracts/<id>/edit`):
-- the contracts created for creators already in the program (`ugc_creator_contracts`)
-- and the terms accepted applicants signed (`ugc_creator_applications`).
--
-- This replaces 0059's "a contract is never edited" rule. An edit is saved in place and
-- the signing link stays the same. A signed contract stays signed and its stored text
-- (`terms_snapshot`) becomes the edited text: the Terms of Participation let Memo AI
-- change them, so no new signature is asked for. The signature record itself (typed
-- name, guardian, time, IP, browser) is never edited.
--
-- `terms_override` is text the admin wrote by hand; null means the text is generated
-- from the pay, as before. On applications, `contract_pay` gives an applicant their own
-- deal instead of the campaign's pay (null keeps the campaign's), and `contract_minor`
-- overrides what their age says about a guardian signing (null keeps the age).
-- `*edited_at` / `*edited_by` say who last changed it. Admin tables: RLS on, no policies.

alter table public.ugc_creator_contracts
  add column if not exists terms_override text check (terms_override is null or char_length(terms_override) <= 100000),
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by text;

alter table public.ugc_creator_applications
  add column if not exists contract_pay jsonb,
  add column if not exists contract_minor boolean,
  add column if not exists terms_override text check (terms_override is null or char_length(terms_override) <= 100000),
  add column if not exists terms_edited_at timestamptz,
  add column if not exists terms_edited_by text;
