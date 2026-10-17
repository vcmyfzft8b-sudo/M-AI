-- Claimed after checking main (at 0067) and the open PRs on 2026-10-16. Extends 0068/0069 (the exam
-- tables); none of the three is on production yet.
--
-- ---------------------------------------------------------------------------
-- Exam prep: knowledge gaps
-- ---------------------------------------------------------------------------
--
-- A finished lesson records which of the questions it showed the learner got wrong (`missed_ids`,
-- always a subset of `item_ids`). A question missed and not answered right since is an open
-- knowledge gap: the next quiz, true/false or written lesson of that topic asks it again first
-- (a quiz question may come back as a true/false statement and the other way round), and the path
-- closes a topic's gaps before it offers the mock exam.

set local lock_timeout = '5s';

alter table public.exam_lesson_results
  add column if not exists missed_ids text[] not null default '{}'
    check (cardinality(missed_ids) <= 40);
