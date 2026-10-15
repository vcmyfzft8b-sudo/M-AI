-- Claimed after checking main (at 0061) and the open PRs on 2026-10-15; extends 0062, which is
-- not on production yet either.
--
-- ---------------------------------------------------------------------------
-- Exam prep: the tutor lesson, and practice that does not repeat itself
-- ---------------------------------------------------------------------------
--
-- * A topic's lessons gain the voice tutor ('tutor'), right after the summary: it explains the
--   topic a point at a time, asks about each and marks the answer.
-- * A finished lesson records which questions it showed (`item_ids`), so the next try of it draws
--   questions the learner has not seen and the mock exam leaves out the ones they practised.
-- * When a topic runs out of unseen questions, fresh ones are written for it and kept on the topic
--   (`exam_topics.extra`: `{ "quiz": [...], "written": [...] }`, the shape of `generated`).

set local lock_timeout = '5s';

alter table public.exam_lesson_results
  drop constraint if exists exam_lesson_results_lesson_kind_check;

alter table public.exam_lesson_results
  add constraint exam_lesson_results_lesson_kind_check
  check (lesson_kind in ('summary', 'tutor', 'flashcards', 'quiz', 'true_false', 'written'));

alter table public.exam_lesson_results
  add column if not exists item_ids text[] not null default '{}'
    check (cardinality(item_ids) <= 40);

alter table public.exam_topics
  add column if not exists extra jsonb;
