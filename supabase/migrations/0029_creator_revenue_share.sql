-- Split a creator's pay into its two independent parts.
--
-- `rate_kind`/`rate_amount` modelled the arrangement as a single exclusive
-- choice: a fee *or* a share. In practice they stack — the per-video creators
-- are paid their fee and 20% of what their own code brings in — so a creator on
-- both could only be recorded as one of them, and was underpaid by the other.
--
-- The flat fee keeps `rate_kind`/`rate_amount`; the share moves to its own
-- column so the two can be set independently.

alter table public.ugc_creators
  add column if not exists revenue_share_percent numeric(5, 2);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'ugc_creators_revenue_share_check'
  ) then
    alter table public.ugc_creators
      add constraint ugc_creators_revenue_share_check
      check (
        revenue_share_percent is null
        or (revenue_share_percent >= 0 and revenue_share_percent <= 100)
      );
  end if;
end
$$;

-- Anyone previously recorded as share-only keeps that share, and their now
-- meaningless fee fields are cleared so the two cannot disagree.
update public.ugc_creators
set
  revenue_share_percent = coalesce(revenue_share_percent, rate_amount),
  rate_kind = null,
  rate_amount = null
where rate_kind = 'revenue_share';
