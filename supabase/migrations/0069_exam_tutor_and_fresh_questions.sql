-- Claimed after checking main (at 0061) and the open PRs on 2026-10-15 as 0063; renumbered to 0066
-- once main shipped 0064, and to 0069 once main shipped 0067. Extends 0068 (the exam tables);
-- neither is on production yet.
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

-- ---------------------------------------------------------------------------
-- Updates keep a row inside the learner's own exam and notes
-- ---------------------------------------------------------------------------
--
-- 0068's update policies only checked `user_id`, so an update could move a module, topic or mock
-- attempt onto another exam or note than the insert policies allow. The app never changes those
-- columns (it updates a topic's items, lessons and fresh questions, and grades a mock), so the new
-- row must pass the same ownership checks as an insert. Dropped and recreated so this also applies
-- where 0068's policies already exist.

drop policy if exists "exam_modules_update_own" on public.exam_modules;
create policy "exam_modules_update_own" on public.exam_modules
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exams
      where exams.id = exam_modules.exam_id and exams.user_id = auth.uid()
    )
    and exists (
      select 1 from public.lectures
      where lectures.id = exam_modules.lecture_id and lectures.user_id = auth.uid()
    )
  );

drop policy if exists "exam_topics_update_own" on public.exam_topics;
create policy "exam_topics_update_own" on public.exam_topics
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exam_modules
      where exam_modules.exam_id = exam_topics.exam_id
        and exam_modules.lecture_id = exam_topics.lecture_id
        and exam_modules.user_id = auth.uid()
    )
  );

drop policy if exists "exam_mock_attempts_update_own" on public.exam_mock_attempts;
create policy "exam_mock_attempts_update_own" on public.exam_mock_attempts
  for update using (auth.uid() = user_id) with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exams
      where exams.id = exam_mock_attempts.exam_id and exams.user_id = auth.uid()
    )
  );
