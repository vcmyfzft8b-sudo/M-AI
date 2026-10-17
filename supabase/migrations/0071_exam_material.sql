-- Claimed after checking main (at 0067) and the open PRs on 2026-10-17. Extends 0068 (the exam
-- tables); none of 0068-0071 is on production yet.
--
-- ---------------------------------------------------------------------------
-- Exam prep: material uploaded for a prep belongs to the prep
-- ---------------------------------------------------------------------------
--
-- Material uploaded in an exam prep's setup is made into a note underneath (the lessons are built
-- from it), but to the learner it is the prep's material, not a note: `material` marks those
-- modules, and the notes library leaves their notes out. Notes the learner picked from the library
-- keep `material = false` and stay in it. Deleting the prep deletes its modules, and the notes
-- show in the library again rather than being lost.

set local lock_timeout = '5s';

alter table public.exam_modules
  add column if not exists material boolean not null default false;
