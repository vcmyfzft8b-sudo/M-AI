-- Claimed after checking both open PR heads and the unmerged push branch on
-- 2026-09-20: 0053 is note notifications, nothing else goes past 0042.
--
-- ---------------------------------------------------------------------------
-- Onboarding answers from someone who does not have an account yet
-- ---------------------------------------------------------------------------
--
-- The survey used to sit behind the sign-in wall, so the only people who ever
-- answered it were people who had already committed. Moving it in front means
-- the answers arrive before there is a `profiles` row to put them in — and
-- means most of them arrive from people who then never sign up at all.
--
-- Those are the interesting ones. A row here with `claimed_by` still null is a
-- complete picture of somebody who wanted Memo enough to answer twenty-odd
-- questions and then stopped, which is the single most useful thing the funnel
-- can tell us. So the table is written for both: it holds every response, and
-- `claimed_by` is the label saying which of them became accounts.

set local lock_timeout = '5s';

create table public.onboarding_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 'web' or 'ios'. The app and the site run the same survey and the funnels
  -- are not comparable without knowing which one a response came through.
  source text not null default 'web',
  locale text,
  education_level text,
  current_average_grade text,
  target_grade text,
  study_goal text,
  -- The per-question answers, in the same shape the authenticated route
  -- accepts, so one validator covers both and a new question does not need a
  -- column here as well as on `profiles`.
  answers jsonb not null default '{}'::jsonb,
  -- Null until an account claims these answers. Set once and never moved: a
  -- second account presenting the same cookie gets nothing.
  claimed_by uuid references auth.users(id) on delete set null,
  claimed_at timestamptz,
  constraint onboarding_responses_source_check check (source in ('web', 'ios'))
);

-- The funnel question — who answered and never signed up — is the one this
-- table exists to answer, so it is the one with an index.
create index onboarding_responses_unclaimed_idx
  on public.onboarding_responses(created_at)
  where claimed_by is null;

create index onboarding_responses_claimed_by_idx
  on public.onboarding_responses(claimed_by)
  where claimed_by is not null;

alter table public.onboarding_responses enable row level security;
revoke all on public.onboarding_responses from anon, authenticated;
grant all on public.onboarding_responses to service_role;

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------
--
-- One function rather than a read followed by a write in application code,
-- because the two have to be atomic: the browser cookie that names a response
-- survives sign-out, so two accounts on the same phone can both present it,
-- and only the first may have it. The `claimed_by is null` in the WHERE is
-- what makes the second a no-op.
--
-- Answers are copied onto the profile rather than referenced from it, so the
-- rest of the app keeps reading exactly the columns it already reads and
-- nothing downstream has to know this table exists.
create or replace function public.claim_onboarding_response(
  response_id uuid,
  claimant uuid,
  claimant_email text,
  claimant_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  response public.onboarding_responses;
begin
  update public.onboarding_responses
  set claimed_by = claimant, claimed_at = now()
  where id = response_id
    and claimed_by is null
  returning * into response;

  if not found then
    return false;
  end if;

  -- An account that has already onboarded keeps what it has: the claim is for
  -- the survey someone just walked through on their way in, not a way to
  -- overwrite a profile that has been in use.
  insert into public.profiles as p (
    id, email, full_name, education_level, current_average_grade, target_grade, study_goal,
    onboarding_heard_from, onboarding_audience, onboarding_role, onboarding_school_level,
    onboarding_school_year, onboarding_subject, onboarding_motivation, onboarding_feature,
    onboarding_class_focus, onboarding_daily_goal, onboarding_current_average_grade,
    onboarding_target_grade, onboarding_grade_scale, onboarding_completed_at
  )
  values (
    claimant, claimant_email, claimant_name,
    response.education_level, response.current_average_grade, response.target_grade, response.study_goal,
    response.answers ->> 'heardFrom', response.answers ->> 'audience', response.answers ->> 'role',
    response.answers ->> 'schoolLevel', response.answers ->> 'schoolYear', response.answers ->> 'subject',
    response.answers ->> 'motivation', response.answers ->> 'feature', response.answers ->> 'classFocus',
    response.answers ->> 'dailyGoal',
    -- `->>` rather than `->`, for both the null and the cast: a JSON null
    -- comes back as SQL NULL this way, where `(jsonb 'null')::numeric` raises.
    (response.answers ->> 'currentAverageGrade')::numeric,
    (response.answers ->> 'targetGrade')::numeric,
    (response.answers ->> 'gradeScale')::smallint,
    now()
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, p.email),
    full_name = coalesce(p.full_name, excluded.full_name),
    education_level = coalesce(p.education_level, excluded.education_level),
    current_average_grade = coalesce(p.current_average_grade, excluded.current_average_grade),
    target_grade = coalesce(p.target_grade, excluded.target_grade),
    study_goal = coalesce(p.study_goal, excluded.study_goal),
    onboarding_heard_from = coalesce(p.onboarding_heard_from, excluded.onboarding_heard_from),
    onboarding_audience = coalesce(p.onboarding_audience, excluded.onboarding_audience),
    onboarding_role = coalesce(p.onboarding_role, excluded.onboarding_role),
    onboarding_school_level = coalesce(p.onboarding_school_level, excluded.onboarding_school_level),
    onboarding_school_year = coalesce(p.onboarding_school_year, excluded.onboarding_school_year),
    onboarding_subject = coalesce(p.onboarding_subject, excluded.onboarding_subject),
    onboarding_motivation = coalesce(p.onboarding_motivation, excluded.onboarding_motivation),
    onboarding_feature = coalesce(p.onboarding_feature, excluded.onboarding_feature),
    onboarding_class_focus = coalesce(p.onboarding_class_focus, excluded.onboarding_class_focus),
    onboarding_daily_goal = coalesce(p.onboarding_daily_goal, excluded.onboarding_daily_goal),
    onboarding_current_average_grade = coalesce(p.onboarding_current_average_grade, excluded.onboarding_current_average_grade),
    onboarding_target_grade = coalesce(p.onboarding_target_grade, excluded.onboarding_target_grade),
    onboarding_grade_scale = coalesce(p.onboarding_grade_scale, excluded.onboarding_grade_scale),
    onboarding_completed_at = coalesce(p.onboarding_completed_at, excluded.onboarding_completed_at);

  return true;
end;
$$;

revoke all on function public.claim_onboarding_response(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_onboarding_response(uuid, uuid, text, text) to service_role;
