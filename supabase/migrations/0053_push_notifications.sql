-- Claimed after checking both open PR heads on 2026-09-20: neither goes past
-- 0042, and main is at 0052.
--
-- ---------------------------------------------------------------------------
-- Telling a learner their note is finished, after they have put the phone away
-- ---------------------------------------------------------------------------
--
-- A note takes minutes. The whole point of the wait is that you do not have to
-- sit through it, so the app has to be able to reach someone who has locked
-- the phone and walked off. That needs two things kept server-side: where to
-- send (`push_devices`) and what is owed (`push_queue`).

set local lock_timeout = '5s';

-- ---------------------------------------------------------------------------
-- Devices
-- ---------------------------------------------------------------------------
--
-- Keyed by the APNs token rather than by user: a token belongs to an install,
-- not to a person, and the same phone can be signed into a different Memo
-- account tomorrow. Making the token the identity means re-registering simply
-- moves it, and the previous owner stops being notified on a phone that is no
-- longer theirs — which is the outcome that matters.
--
-- `environment` records which APNs host minted the token. A build installed
-- from Xcode gets a sandbox token and a TestFlight or App Store build gets a
-- production one; sending to the wrong host is rejected with BadDeviceToken.
-- The sender corrects and rewrites this column when that happens, so a wrong
-- guess costs one delivery, once, per device.
create table public.push_devices (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'ios',
  environment text not null default 'production',
  locale text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  disabled_reason text,
  constraint push_devices_platform_check check (platform in ('ios')),
  constraint push_devices_environment_check check (environment in ('production', 'sandbox'))
);

-- Every send starts from "which live devices does this user have", so the
-- index carries the liveness test rather than making the query filter it.
create index push_devices_user_idx
  on public.push_devices(user_id)
  where disabled_at is null;

alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon, authenticated;
grant all on public.push_devices to service_role;

-- ---------------------------------------------------------------------------
-- What is owed
-- ---------------------------------------------------------------------------
--
-- A queue rather than a send at the call site, because the moment a note
-- becomes ready is the moment least able to afford an outbound HTTP request:
-- it is the end of a long pipeline run, and a slow or failing APNs would take
-- the note down with it. The row is written inside the same transaction that
-- finishes the note, so it cannot be lost, and delivery happens afterwards.
create table public.push_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lecture_id uuid references public.lectures(id) on delete cascade,
  kind text not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz,
  last_error text,
  constraint push_queue_kind_check check (kind in ('note_ready', 'note_failed'))
);

-- One notification per note per outcome, forever. A status that is rewritten —
-- a retry that lands on `ready` twice, a reconciler repeating itself — must not
-- buzz the phone again.
create unique index push_queue_once_idx
  on public.push_queue(lecture_id, kind)
  where lecture_id is not null;

create index push_queue_pending_idx
  on public.push_queue(created_at)
  where sent_at is null;

alter table public.push_queue enable row level security;
revoke all on public.push_queue from anon, authenticated;
grant all on public.push_queue to service_role;

-- ---------------------------------------------------------------------------
-- The enqueue
-- ---------------------------------------------------------------------------
--
-- A trigger for the same reason `mark_trial_consumed_on_ready` is one: `ready`
-- is written from several places — note generation, the scan path, the status
-- reconciler — and will be written from more later. Hanging the notification
-- off the status change itself means a new path cannot forget to announce
-- itself, and a path that is removed takes its notification with it.
create or replace function public.enqueue_lecture_push()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.push_queue(user_id, lecture_id, kind)
  values (
    new.user_id,
    new.id,
    case when new.status = 'ready' then 'note_ready' else 'note_failed' end
  )
  on conflict do nothing;

  return null;
end;
$$;

drop trigger if exists lectures_enqueue_push on public.lectures;

-- `when` rather than an `if` in the body, so the trigger costs nothing on the
-- many status writes that are neither of the two settling states, and a
-- repeated write of the same status does not re-fire it.
create trigger lectures_enqueue_push
after update of status on public.lectures
for each row
when (new.status in ('ready', 'failed') and old.status is distinct from new.status)
execute procedure public.enqueue_lecture_push();
