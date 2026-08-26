-- A failure capture must outlive its lecture.
--
-- The point of generation_failure_captures is that the triage automation can reproduce a failure
-- with the exact material that caused it — and the learner most likely to delete a lecture is
-- exactly the one whose lecture just failed. With the cascade, that delete destroyed the
-- evidence. The FK goes; the row now lives until the capture writer's 30-day prune, which is the
-- retention bound for this user content.
--
-- The capture writer also copies the original uploaded files (documents, scan photos, audio)
-- into the failure-captures/ prefix of the storage bucket at capture time, because lecture
-- deletion removes the originals; captured_files records those copies so the prune can remove
-- them with the row.

alter table public.generation_failure_captures
  drop constraint if exists generation_failure_captures_lecture_id_fkey;

alter table public.generation_failure_captures
  add column if not exists captured_files jsonb;
