-- The voice tutor's running order, worked out once when the note is written rather than
-- every time somebody starts a session.
--
-- GLM takes 19 to 51 seconds over this (measured 2026-09-04) and no setting changes that: it
-- writes about 1,100 tokens at 20-60 tokens a second, and it is kept on the job because it
-- covers 23 of the fixture's 23 key facts where the fast alternative covers 9. Generated at
-- session start, those seconds sit behind the opening greeting and only just fit — a slow run
-- lands with a few seconds to spare, and a slower one does not.
--
-- Stored beside the note it was planned from, with a hash of that note. A plan whose hash no
-- longer matches is a plan for a note the learner has since edited, and it is thrown away
-- rather than taught from. That is the same guard `editable_notes_doc` already uses.
alter table public.lecture_artifacts
  add column if not exists tutor_plan jsonb,
  add column if not exists tutor_plan_notes_hash text,
  add column if not exists tutor_plan_generated_at timestamptz;
