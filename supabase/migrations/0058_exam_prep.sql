-- Claimed after checking open PR heads on 2026-10-08: the only open PR stops at
-- 0041, and main is at 0057.
--
-- ---------------------------------------------------------------------------
-- Exam prep: a dated goal, the notes it covers, and the evidence to judge it
-- ---------------------------------------------------------------------------
--
-- A learner names an exam, its date, its type and the grade they want, and
-- picks the notes it covers. The day-by-day journey is *not* stored: it is
-- recomputed from the learner's real study evidence every time it is opened
-- (src/lib/exam-prep/journey.ts), so a missed day rebalances the plan rather
-- than leaving a backlog behind. What is stored is the goal and the evidence.
--
-- The evidence the app had before this migration was a single confidence
-- bucket per flashcard and nothing at all for quiz answers. A memory model
-- needs the history of reviews, not the last one, so `study_events` is an
-- append-only review log. See docs/exam-prep.md.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- The goal
-- ---------------------------------------------------------------------------
create table public.exam_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  exam_date date not null,
  exam_type text not null default 'mixed',
  -- The scale the target was chosen on, so the plan can talk in the learner's
  -- grades. The percentage is stored separately because grade thresholds vary
  -- by school and faculty, and the learner can correct ours.
  grade_scale text not null default 'ten_point',
  target_grade text not null check (char_length(target_grade) between 1 and 16),
  target_percent numeric(5,2) not null check (target_percent > 0 and target_percent <= 100),
  daily_minutes smallint not null default 30 check (daily_minutes between 10 and 240),
  -- Days of the week the learner does not study: bit 0 = Monday … bit 6 = Sunday.
  rest_days smallint not null default 0 check (rest_days between 0 and 126),
  -- Day boundaries are the learner's, not the server's.
  time_zone text not null default 'Europe/Ljubljana' check (char_length(time_zone) between 1 and 64),
  status text not null default 'active',
  -- The real result, asked for after the exam. It is what the forecast will be
  -- calibrated against; nothing else can tell us whether it was honest.
  result_percent numeric(5,2) check (result_percent is null or (result_percent >= 0 and result_percent <= 100)),
  result_grade text check (result_grade is null or char_length(result_grade) between 1 and 16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exam_plans_exam_type_check
    check (exam_type in ('multiple_choice', 'written', 'oral', 'problem_solving', 'mixed')),
  constraint exam_plans_grade_scale_check
    check (grade_scale in ('ten_point', 'five_point', 'letter', 'percent', 'pass_fail')),
  constraint exam_plans_status_check check (status in ('active', 'archived'))
);

create index exam_plans_user_date_idx on public.exam_plans (user_id, exam_date);

drop trigger if exists exam_plans_set_updated_at on public.exam_plans;
create trigger exam_plans_set_updated_at before update on public.exam_plans
for each row execute procedure public.set_updated_at();

alter table public.exam_plans enable row level security;

create policy "exam_plans_select_own" on public.exam_plans
  for select using (auth.uid() = user_id);
create policy "exam_plans_insert_own" on public.exam_plans
  for insert with check (auth.uid() = user_id);
create policy "exam_plans_update_own" on public.exam_plans
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exam_plans_delete_own" on public.exam_plans
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- The notes the exam covers
-- ---------------------------------------------------------------------------
create table public.exam_plan_lectures (
  plan_id uuid not null references public.exam_plans(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, lecture_id)
);

create index exam_plan_lectures_lecture_idx on public.exam_plan_lectures (lecture_id);

alter table public.exam_plan_lectures enable row level security;

create policy "exam_plan_lectures_select_own" on public.exam_plan_lectures
  for select using (auth.uid() = user_id);
create policy "exam_plan_lectures_insert_own" on public.exam_plan_lectures
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exam_plans
      where exam_plans.id = exam_plan_lectures.plan_id and exam_plans.user_id = auth.uid()
    )
    and exists (
      select 1 from public.lectures
      where lectures.id = exam_plan_lectures.lecture_id and lectures.user_id = auth.uid()
    )
  );
create policy "exam_plan_lectures_delete_own" on public.exam_plan_lectures
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Tasks the app cannot see being done
-- ---------------------------------------------------------------------------
--
-- Most of a day's tasks complete themselves from the review log. Explaining a
-- topic aloud or the night-before wind-down leave no trace, so the learner
-- ticks those off; this is where the tick lives.
create table public.exam_plan_task_checks (
  plan_id uuid not null references public.exam_plans(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  task_key text not null check (char_length(task_key) between 1 and 120),
  created_at timestamptz not null default now(),
  primary key (plan_id, day, task_key)
);

alter table public.exam_plan_task_checks enable row level security;

create policy "exam_plan_task_checks_select_own" on public.exam_plan_task_checks
  for select using (auth.uid() = user_id);
create policy "exam_plan_task_checks_insert_own" on public.exam_plan_task_checks
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exam_plans
      where exam_plans.id = exam_plan_task_checks.plan_id and exam_plans.user_id = auth.uid()
    )
  );
create policy "exam_plan_task_checks_delete_own" on public.exam_plan_task_checks
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- The review log
-- ---------------------------------------------------------------------------
--
-- One row per answer: a flashcard graded, a quiz question answered. Outcome
-- uses the FSRS grade scale (1 again/wrong, 3 good/right, 4 easy), so the
-- memory model can replay the history as it happened. Practice tests are not
-- logged here: their graded answers already live in practice_test_attempt_answers.
--
-- `item_id` is not a foreign key on purpose. Cards and questions are deleted
-- and regenerated; the history of having studied a note should not vanish
-- with them, and a row that points at nothing is simply ignored.
create table public.study_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  item_kind text not null,
  item_id uuid not null,
  outcome smallint not null,
  created_at timestamptz not null default now(),
  constraint study_events_item_kind_check check (item_kind in ('flashcard', 'quiz')),
  constraint study_events_outcome_check check (outcome between 1 and 4)
);

create index study_events_user_lecture_created_idx
  on public.study_events (user_id, lecture_id, created_at);

alter table public.study_events enable row level security;

create policy "study_events_select_own" on public.study_events
  for select using (auth.uid() = user_id);
create policy "study_events_insert_own" on public.study_events
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.lectures
      where lectures.id = study_events.lecture_id and lectures.user_id = auth.uid()
    )
  );
