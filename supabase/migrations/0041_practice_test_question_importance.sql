-- A practice test is a random draw from the question bank, and the draw has to be able to prefer
-- the material a learner is most likely to be examined on. The bank is generated from knowledge
-- items that already carry a 1-5 importance rating; until now that rating was thrown away at the
-- point the question was stored, so every question in the bank looked equally central.
alter table public.practice_test_questions
  add column if not exists importance smallint;

alter table public.practice_test_questions
  drop constraint if exists practice_test_questions_importance_check;

alter table public.practice_test_questions
  add constraint practice_test_questions_importance_check
  check (importance is null or importance between 1 and 5);
