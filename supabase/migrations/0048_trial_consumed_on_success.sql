-- ---------------------------------------------------------------------------
-- The free note is spent when a note succeeds, and at no other moment
-- ---------------------------------------------------------------------------
--
-- `trial_consumed_at` was stamped the instant a learner pressed create. It
-- therefore recorded an *attempt*, not a note — so every attempt that broke
-- took the learner's one free note with it: a dropped upload, a recording we
-- could not read, a note they abandoned. On 2026-09-06 that left 160 accounts
-- unable to create anything, having received nothing.
--
-- The column now means what it says. A trigger stamps it when a lecture the
-- profile's trial points at reaches `ready`, so:
--
--   * a failed or abandoned attempt spends nothing, and the learner may try
--     again — as many times as they need;
--   * a note that succeeds spends the free note, once;
--   * deleting that successful note does not give it back, because the stamp
--     lives on the profile and outlives the row it came from.
--
-- A trigger rather than application code because `ready` is written from
-- several places (note generation, the scan path, the status reconciler) and
-- may be written from more later. The invariant belongs next to the data.

set local lock_timeout = '5s';

create or replace function public.mark_trial_consumed_on_ready()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the note the trial actually points at, and only the first time. The
  -- WHERE does all the work: a paid learner, a second note, or a profile that
  -- is already stamped all match nothing.
  update public.profiles
  set trial_consumed_at = now()
  where id = new.user_id
    and trial_lecture_id = new.id
    and trial_consumed_at is null;

  return null;
end;
$$;

drop trigger if exists lectures_mark_trial_consumed on public.lectures;

-- `when` rather than an `if` in the body: the trigger then costs nothing on
-- the many updates that are not a lecture becoming ready, and `is distinct
-- from` keeps a repeated write of the same status from re-firing it.
create trigger lectures_mark_trial_consumed
after update of status on public.lectures
for each row
when (new.status = 'ready' and old.status is distinct from 'ready')
execute procedure public.mark_trial_consumed_on_ready();

-- ---------------------------------------------------------------------------
-- Give back the free note to everyone who was charged for an attempt
-- ---------------------------------------------------------------------------
--
-- Under the old rule these profiles are marked as having used their free note
-- while holding nothing to show for it. Two independent signals have to be
-- absent before we clear the stamp, so that someone who did receive a note and
-- later deleted it keeps it spent:
--
--   * no lecture of theirs is `ready` now, and
--   * no successful `note_write` was ever billed for them — the stage that
--     only runs when the pipeline is actually writing a note.
--
-- The second signal only reaches back to 2026-04-20, when `ai_usage_events`
-- began; a learner who finished and deleted a note before that date and has
-- none left today would be given another one. That is a handful of accounts at
-- most, and it errs towards the learner, which is the direction to err in.
update public.profiles as p
set trial_consumed_at = null
where p.trial_consumed_at is not null
  and not exists (
    select 1
    from public.lectures as l
    where l.user_id = p.id
      and l.status = 'ready'
  )
  and not exists (
    select 1
    from public.ai_usage_events as e
    where e.user_id = p.id
      and e.stage = 'note_write'
      and e.success
  );
