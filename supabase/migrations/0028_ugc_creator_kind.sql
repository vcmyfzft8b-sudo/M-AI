-- Distinguish the brand's own TikTok account from the campaign's creators.
--
-- Memo AI posts from @memo_ai_si itself. Those views and the revenue they drive
-- are real and belong on the dashboard, but they are not a creator's work:
-- averaging them into "per creator" figures, or ranking the brand against the
-- people being paid to post, reads wrong. A column keeps them countable and
-- separable at the same time.

alter table public.ugc_creators
  add column if not exists kind text not null default 'creator';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ugc_creators_kind_check'
  ) then
    alter table public.ugc_creators
      add constraint ugc_creators_kind_check
      check (kind in ('creator', 'owned'));
  end if;
end
$$;

create index if not exists ugc_creators_kind_idx
  on public.ugc_creators (kind, status);
