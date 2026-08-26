-- Snapshot of the exact source material a failed lecture was generated from.
--
-- The error-triage automation's weakest reproduce path is "reasoned from stack trace, because
-- the trigger needs data we do not have — a specific upload". This table closes that: every time
-- markLecturePipelineFailed records a failure, it also snapshots the lecture's source input
-- (manual-import text and blocks, or the joined transcript), so the bot can replay the exact
-- material that broke and prove the fix against it.
--
-- One row per lecture — the latest failure wins, which is the one the bot investigates. Rows are
-- user content: service-role only (RLS with no policies), they die with the lecture via the
-- cascade, and the capture writer prunes rows older than 30 days so the table only ever holds
-- recent, actionable failures.

create table if not exists public.generation_failure_captures (
  lecture_id uuid primary key references public.lectures (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  source_type text,
  error_message text,
  language_hint text,
  source_text text,
  source_blocks jsonb,
  processing_metadata jsonb,
  source_char_count integer not null default 0,
  captured_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists generation_failure_captures_captured_at_idx
  on public.generation_failure_captures (captured_at desc);

alter table public.generation_failure_captures enable row level security;
