-- Claimed after checking main (at 0060) and the open PRs on 2026-10-15. First written as 0061 and
-- applied to staging only; PR #579 claimed 0061 too, so this file moved to 0062 and staging's 0061
-- record was reverted (its tables dropped) before re-applying it here. It was never on production.
--
-- ---------------------------------------------------------------------------
-- Exam prep ("Priprava na izpit")
-- ---------------------------------------------------------------------------
--
-- A learner names an exam, gives its date and picks the notes it covers. As in Astra, the path is
-- made of topics: each note is split into a few topics when the exam is set up, and each topic is a
-- module, a fixed chain of short lessons (summary, flashcards, quiz, true/false, a written answer).
-- A topic from the learner's material draws its questions from the note's own `flashcards`,
-- `quiz_questions` and `practice_test_questions` (assigned to topics the first time they are
-- needed); a topic the learner added, or one the AI added when allowed, carries its own.

set local lock_timeout = '5s';

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  exam_date date not null,
  -- The mastery the learner is aiming for, as a percentage (Astra's 75 / 90 / 100 dial).
  target_mastery smallint not null default 90 check (target_mastery between 50 and 100),
  daily_minutes smallint not null default 30 check (daily_minutes between 5 and 240),
  exam_format text not null default 'written'
    check (exam_format in ('written', 'oral', 'both')),
  exam_kind text not null default 'exam'
    check (exam_kind in ('midterm', 'exam', 'matura')),
  grading_scale text not null default 'uni_5_10'
    check (grading_scale in ('uni_5_10', 'school_1_5', 'percent')),
  pass_percentage smallint not null default 50 check (pass_percentage between 1 and 100),
  -- The grade the learner reports after sitting the exam; free text because scales differ.
  actual_grade text check (actual_grade is null or char_length(actual_grade) <= 12),
  -- The setup's school step (onboarding's values), so topics and questions fit the level.
  school_level text check (school_level is null or char_length(school_level) <= 40),
  school_year text check (school_year is null or char_length(school_year) <= 40),
  -- Astra's "let AI add topics beyond your material" switch; off is the recommended default.
  ai_expand boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index exams_user_date_idx on public.exams (user_id, exam_date);

create trigger exams_set_updated_at
before update on public.exams
for each row execute procedure public.set_updated_at();

-- One row per note in the exam. `position` is the module's number on the path.
create table public.exam_modules (
  exam_id uuid not null references public.exams (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null check (position >= 0),
  created_at timestamptz not null default now(),
  primary key (exam_id, lecture_id)
);

create index exam_modules_lecture_idx on public.exam_modules (lecture_id);

-- The modules on the path. `source` says where a topic came from: the learner's material, added by
-- the learner on the plan review, or added by the AI (only with `exams.ai_expand`). Every topic
-- belongs to one of the exam's notes, which is what access, grading and the mock exam go by.
create table public.exam_topics (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  position smallint not null check (position >= 0),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  source text not null default 'material' check (source in ('material', 'added', 'ai')),
  summary text not null default '',
  key_points jsonb not null default '[]'::jsonb,
  -- The note's own items that teach this topic, by kind, and which kinds have been assigned.
  flashcard_ids uuid[] not null default '{}',
  quiz_ids uuid[] not null default '{}',
  written_ids uuid[] not null default '{}',
  assigned_kinds text[] not null default '{}',
  -- Items written for a topic the material does not cover (source 'added' or 'ai').
  generated jsonb,
  created_at timestamptz not null default now()
);

create index exam_topics_exam_idx on public.exam_topics (exam_id, position);
create index exam_topics_lecture_idx on public.exam_topics (lecture_id);

-- Every finished lesson. Mastery, the daily count and the streak are all computed from these.
create table public.exam_lesson_results (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  lecture_id uuid not null references public.lectures (id) on delete cascade,
  topic_id uuid references public.exam_topics (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lesson_kind text not null
    check (lesson_kind in ('summary', 'flashcards', 'quiz', 'true_false', 'written')),
  correct smallint not null default 0 check (correct >= 0),
  total smallint not null default 0 check (total >= 0),
  score real not null default 0 check (score >= 0 and score <= 1),
  -- The learning-zone answer, 1 (too easy) to 5 (too hard); null when it was not asked.
  difficulty smallint check (difficulty is null or difficulty between 1 and 5),
  completed_at timestamptz not null default now()
);

create index exam_lesson_results_exam_idx
  on public.exam_lesson_results (exam_id, lecture_id, completed_at desc);
create index exam_lesson_results_user_idx
  on public.exam_lesson_results (user_id, completed_at desc);
create index exam_lesson_results_topic_idx
  on public.exam_lesson_results (topic_id, completed_at desc);

-- The mock exam ("Generalka"), written or oral: questions drawn across the exam's notes, answered
-- under a timer (written) or spoken to a voice examiner (oral), then graded. Questions and answers
-- are snapshotted so a regenerated question bank cannot rewrite a past result.
create table public.exam_mock_attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'graded', 'failed')),
  mode text not null default 'written' check (mode in ('written', 'oral')),
  -- The oral examiner's voice and manner ("strict", "friendly", ...); null for a written mock.
  voice text check (voice is null or char_length(voice) <= 40),
  vibe text check (vibe is null or char_length(vibe) <= 40),
  duration_minutes smallint not null check (duration_minutes between 5 and 240),
  questions jsonb not null default '[]'::jsonb,
  answers jsonb not null default '[]'::jsonb,
  total_score real,
  max_score real,
  percentage real,
  -- The examiner's verdict: strengths, weak points and recommendations.
  review jsonb,
  time_spent_seconds integer check (time_spent_seconds is null or time_spent_seconds >= 0),
  started_at timestamptz not null default now(),
  submitted_at timestamptz,
  graded_at timestamptz
);

create index exam_mock_attempts_exam_idx
  on public.exam_mock_attempts (exam_id, started_at desc);

alter table public.exams enable row level security;
alter table public.exam_modules enable row level security;
alter table public.exam_topics enable row level security;
alter table public.exam_lesson_results enable row level security;
alter table public.exam_mock_attempts enable row level security;

create policy "exams_select_own" on public.exams
  for select using (auth.uid() = user_id);
create policy "exams_insert_own" on public.exams
  for insert with check (auth.uid() = user_id);
create policy "exams_update_own" on public.exams
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exams_delete_own" on public.exams
  for delete using (auth.uid() = user_id);

create policy "exam_modules_select_own" on public.exam_modules
  for select using (auth.uid() = user_id);
create policy "exam_modules_insert_own" on public.exam_modules
  for insert with check (
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
create policy "exam_modules_update_own" on public.exam_modules
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exam_modules_delete_own" on public.exam_modules
  for delete using (auth.uid() = user_id);

create policy "exam_topics_select_own" on public.exam_topics
  for select using (auth.uid() = user_id);
-- A topic can only belong to one of the exam's own notes.
create policy "exam_topics_insert_own" on public.exam_topics
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exam_modules
      where exam_modules.exam_id = exam_topics.exam_id
        and exam_modules.lecture_id = exam_topics.lecture_id
        and exam_modules.user_id = auth.uid()
    )
  );
create policy "exam_topics_update_own" on public.exam_topics
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exam_topics_delete_own" on public.exam_topics
  for delete using (auth.uid() = user_id);

create policy "exam_lesson_results_select_own" on public.exam_lesson_results
  for select using (auth.uid() = user_id);
create policy "exam_lesson_results_insert_own" on public.exam_lesson_results
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exam_modules
      where exam_modules.exam_id = exam_lesson_results.exam_id
        and exam_modules.lecture_id = exam_lesson_results.lecture_id
        and exam_modules.user_id = auth.uid()
    )
    and (
      exam_lesson_results.topic_id is null
      or exists (
        select 1 from public.exam_topics
        where exam_topics.id = exam_lesson_results.topic_id
          and exam_topics.exam_id = exam_lesson_results.exam_id
          and exam_topics.lecture_id = exam_lesson_results.lecture_id
          and exam_topics.user_id = auth.uid()
      )
    )
  );

create policy "exam_mock_attempts_select_own" on public.exam_mock_attempts
  for select using (auth.uid() = user_id);
create policy "exam_mock_attempts_insert_own" on public.exam_mock_attempts
  for insert with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.exams
      where exams.id = exam_mock_attempts.exam_id and exams.user_id = auth.uid()
    )
  );
create policy "exam_mock_attempts_update_own" on public.exam_mock_attempts
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
