-- Applications to the UGC creator program, sent from the public page at /ugc.
--
-- Anyone can apply without an account, so the row is written by the server
-- (`/api/ugc/applications`) with the service role after validation and a rate
-- limit, and read only by the admin dashboard. Like every other admin table:
-- RLS on, no policies.
--
-- `market` decides which pay terms the applicant was shown and which campaign
-- (and Discord) an accepted creator joins: `si` (Slovenia) or `balkans`
-- (Croatia, Bosnia and Herzegovina, Serbia, Montenegro, North Macedonia). It is
-- derived from the country they picked, not trusted from the browser; `other`
-- is for anyone outside both, and the admin picks the campaign on acceptance.
--
-- Every application carries a sample video: an upload into the private
-- `ugc-application-videos` bucket (`sample_video_path`) or a link
-- (`sample_video_url`), or both.

create table if not exists public.ugc_creator_applications (
  id uuid primary key default gen_random_uuid(),
  -- Stored trimmed and lowercased, so one person applying twice is one row.
  email text not null check (char_length(email) between 3 and 254),
  full_name text not null check (char_length(full_name) between 1 and 120),
  country text not null check (char_length(country) = 2),
  market text not null check (market in ('si', 'balkans', 'other')),
  age smallint check (age between 13 and 99),
  phone text check (char_length(phone) <= 40),
  studies text check (char_length(studies) <= 160),
  tiktok_handle text check (char_length(tiktok_handle) <= 80),
  instagram_handle text check (char_length(instagram_handle) <= 80),
  sample_video_url text check (char_length(sample_video_url) <= 500),
  sample_video_path text check (char_length(sample_video_path) <= 200),
  message text check (char_length(message) <= 1000),
  referral_code text check (char_length(referral_code) <= 40),
  -- The page language the application was written in, and the `?ref=` the
  -- link was shared with, so a campaign can tell which post brought people.
  locale text not null default 'en',
  referrer text check (char_length(referrer) <= 80),
  status text not null default 'new'
    check (status in ('new', 'approved', 'rejected')),
  admin_notes text,
  reviewed_at timestamptz,
  reviewed_by text,
  -- The acceptance email (with the campaign's Discord invite). A failed send
  -- leaves `accepted_email_sent_at` empty and says why, so it can be retried.
  accepted_email_sent_at timestamptz,
  accepted_email_error text,
  -- The personal link in the acceptance email (/ugc/join/<token>). Opening it
  -- shows the Terms of Participation; accepting them is what joins the program
  -- and reveals the Discord invite. What was accepted, when, by whom and from
  -- where is kept as the record of the agreement.
  join_token uuid not null default gen_random_uuid(),
  terms_version text,
  terms_accepted_at timestamptz,
  terms_signed_name text check (char_length(terms_signed_name) <= 120),
  terms_guardian_name text check (char_length(terms_guardian_name) <= 120),
  terms_accepted_ip text check (char_length(terms_accepted_ip) <= 64),
  terms_accepted_user_agent text check (char_length(terms_accepted_user_agent) <= 400),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ugc_creator_applications_email_unique
  on public.ugc_creator_applications (email);

create unique index if not exists ugc_creator_applications_join_token_unique
  on public.ugc_creator_applications (join_token);

create index if not exists ugc_creator_applications_status_idx
  on public.ugc_creator_applications (status, created_at desc);

drop trigger if exists ugc_creator_applications_set_updated_at on public.ugc_creator_applications;
create trigger ugc_creator_applications_set_updated_at
before update on public.ugc_creator_applications
for each row execute procedure public.set_updated_at();

alter table public.ugc_creator_applications enable row level security;

-- The sample videos. Private: applicants upload through a signed upload URL the
-- server hands out, and the admin watches through short-lived signed URLs.
-- 200 MB covers a minute of 4K from a phone; the types are what phones record.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ugc-application-videos',
  'ugc-application-videos',
  false,
  209715200,
  array['video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
