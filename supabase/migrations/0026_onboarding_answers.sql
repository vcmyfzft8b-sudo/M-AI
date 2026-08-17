-- Store the raw onboarding answers alongside the derived profile fields.
-- The existing columns (age_range, education_level, study_goal, ...) keep a
-- lossy summary of the survey; these columns keep what the user actually chose.

alter table public.profiles
  add column if not exists onboarding_heard_from text,
  add column if not exists onboarding_audience text,
  add column if not exists onboarding_role text,
  add column if not exists onboarding_school_level text,
  add column if not exists onboarding_school_year text,
  add column if not exists onboarding_subject text,
  add column if not exists onboarding_motivation text,
  add column if not exists onboarding_feature text,
  add column if not exists onboarding_class_focus text,
  add column if not exists onboarding_daily_goal text,
  add column if not exists onboarding_current_average_grade numeric(4, 1),
  add column if not exists onboarding_target_grade numeric(4, 1),
  add column if not exists onboarding_grade_scale smallint;

-- The option lists are validated in the application (src/lib/onboarding-options.ts)
-- so that adding a survey option does not require a migration. Only the grade
-- values, whose meaning depends on the scale, are constrained here.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_onboarding_grade_scale_check'
  ) then
    alter table public.profiles
      add constraint profiles_onboarding_grade_scale_check
      check (onboarding_grade_scale is null or onboarding_grade_scale in (5, 10));
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_onboarding_grades_check'
  ) then
    alter table public.profiles
      add constraint profiles_onboarding_grades_check
      check (
        (
          onboarding_current_average_grade is null
          or (onboarding_current_average_grade >= 1 and onboarding_current_average_grade <= 10)
        )
        and (
          onboarding_target_grade is null
          or (onboarding_target_grade >= 1 and onboarding_target_grade <= 10)
        )
      );
  end if;
end
$$;

-- The survey never asked for an age: the onboarding route was the only writer
-- of age_range and it always wrote the same hardcoded bucket, so every stored
-- value is fabricated. The route no longer writes the column at all.
update public.profiles
set age_range = null
where age_range = '19_22';

create index if not exists profiles_onboarding_heard_from_idx
  on public.profiles (onboarding_heard_from)
  where onboarding_heard_from is not null;

create index if not exists profiles_onboarding_role_idx
  on public.profiles (onboarding_role)
  where onboarding_role is not null;
