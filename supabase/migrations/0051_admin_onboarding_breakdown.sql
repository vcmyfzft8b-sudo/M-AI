-- The onboarding survey, aggregated for the admin dashboard.
--
-- Every answer is a column on profiles, so the natural query is thirteen
-- GROUP BYs or one round trip that fetches every profile. Neither is
-- acceptable from a page render (PostgREST also caps a plain select at a
-- thousand rows, which would silently under-count), so the pivot happens
-- here: one row per question and answer, counted in Postgres.
--
-- The window is by onboarding_completed_at, which is when the answers were
-- given. The legacy columns age_range and education_level are included: an
-- older revision of the survey asked for an age, and education_level is the
-- derived summary every profile carries even from before the survey existed.
create or replace function public.admin_onboarding_breakdown(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  question text,
  answer text,
  respondents integer
)
language sql
stable
security definer
set search_path = public
as $$
  select q.question, q.answer, count(*)::integer as respondents
  from public.profiles p
  cross join lateral (
    values
      ('survey', case when p.onboarding_role is null then 'none' else 'answered' end),
      ('heard_from', p.onboarding_heard_from),
      ('audience', p.onboarding_audience),
      ('role', p.onboarding_role),
      ('school_level', p.onboarding_school_level),
      ('school_year', p.onboarding_school_year),
      ('subject', p.onboarding_subject),
      ('motivation', p.onboarding_motivation),
      ('feature', p.onboarding_feature),
      ('class_focus', p.onboarding_class_focus),
      ('daily_goal', p.onboarding_daily_goal),
      ('grade_scale', p.onboarding_grade_scale::text),
      -- Grades are bucketed to the step the survey's stepper moves in on
      -- each scale, so the distribution reads as the choices people made.
      (
        'current_grade_' || p.onboarding_grade_scale::text,
        case p.onboarding_grade_scale
          when 5 then round(round(p.onboarding_current_average_grade * 2) / 2, 1)::text
          when 10 then round(p.onboarding_current_average_grade)::text
        end
      ),
      (
        'target_grade_' || p.onboarding_grade_scale::text,
        case p.onboarding_grade_scale
          when 5 then round(round(p.onboarding_target_grade * 2) / 2, 1)::text
          when 10 then round(p.onboarding_target_grade)::text
        end
      ),
      ('age_range', p.age_range),
      ('education_level', p.education_level)
  ) as q(question, answer)
  where p.onboarding_completed_at >= p_from
    and p.onboarding_completed_at < p_to
    and q.question is not null
    and q.answer is not null
  group by q.question, q.answer
  order by q.question, respondents desc, q.answer;
$$;

revoke all on function public.admin_onboarding_breakdown(timestamptz, timestamptz)
  from public, anon, authenticated;

-- The grade goal in numbers: where people say they are and where they want to
-- be, per marking scale, for everyone who answered both steppers.
create or replace function public.admin_onboarding_grades(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  grade_scale smallint,
  respondents integer,
  average_current numeric,
  average_target numeric,
  aiming_higher integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.onboarding_grade_scale,
    count(*)::integer as respondents,
    round(avg(p.onboarding_current_average_grade), 2) as average_current,
    round(avg(p.onboarding_target_grade), 2) as average_target,
    count(*) filter (
      where p.onboarding_target_grade > p.onboarding_current_average_grade
    )::integer as aiming_higher
  from public.profiles p
  where p.onboarding_completed_at >= p_from
    and p.onboarding_completed_at < p_to
    and p.onboarding_grade_scale is not null
    and p.onboarding_current_average_grade is not null
    and p.onboarding_target_grade is not null
  group by p.onboarding_grade_scale
  order by p.onboarding_grade_scale;
$$;

revoke all on function public.admin_onboarding_grades(timestamptz, timestamptz)
  from public, anon, authenticated;

-- Both functions window on the completion instant, which nothing indexed
-- before; without this each call scans every profile.
create index if not exists profiles_onboarding_completed_at_idx
  on public.profiles (onboarding_completed_at)
  where onboarding_completed_at is not null;
