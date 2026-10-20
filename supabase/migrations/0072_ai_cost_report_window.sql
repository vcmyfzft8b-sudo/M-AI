-- One window of ai_usage_events, aggregated for the daily AI cost report.
--
-- The report used to page the raw rows oldest-first and stop at 60,000. Production writes about
-- 17,500 rows a day (October 2026), so a week's report ran out after four days and every newer
-- day, "yesterday" included, read as $0: the morning alarm could not fire, and on 2026-10-20 the
-- Gemini project hit its monthly spending cap without a warning.
--
-- The route now asks for one UTC day per call. That keeps each call to one day's rows (well
-- inside the statement timeout even with a cold cache; a 30-day aggregate took 3.8 s cold), and a
-- day that cannot be read is reported as missing instead of as free.
--
-- Returned as one document so a day costs one round trip:
--   groups    every (model, stage) pair: calls, failed calls, logged cost, and calls that used
--             tokens but logged no cost (a model missing from the price table);
--   lectures  the most expensive lectures of the window;
--   failures  failed calls grouped by their raw stage, code and message. The report normalises
--             and explains them (src/lib/ai-cost-report.ts); grouping here only keeps the payload
--             to one row per distinct message.
create or replace function public.ai_cost_report_window(
  p_from timestamptz,
  p_to timestamptz,
  p_top_lectures integer default 10,
  p_max_failure_groups integer default 500
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with window_rows as materialized (
    select
      model,
      stage,
      success,
      estimated_cost_usd,
      lecture_id,
      error_code,
      error_message,
      prompt_token_count
    from public.ai_usage_events
    where created_at >= p_from
      and created_at < p_to
  ),
  model_stage as (
    select
      model,
      stage,
      count(*) as calls,
      count(*) filter (where not success) as failed_calls,
      coalesce(sum(estimated_cost_usd), 0) as cost_usd,
      count(*) filter (
        where estimated_cost_usd is null and coalesce(prompt_token_count, 0) > 0
      ) as unpriced_calls
    from window_rows
    group by model, stage
  ),
  top_lectures as (
    select
      lecture_id,
      coalesce(sum(estimated_cost_usd), 0) as cost_usd,
      count(*) as calls
    from window_rows
    where lecture_id is not null
    group by lecture_id
    order by cost_usd desc, calls desc, lecture_id
    limit greatest(p_top_lectures, 0)
  ),
  failure_groups as (
    select
      stage,
      error_code,
      error_message,
      count(*) as failures
    from window_rows
    where not success
    group by stage, error_code, error_message
    order by failures desc, stage, error_code, error_message
    limit greatest(p_max_failure_groups, 0)
  )
  select jsonb_build_object(
    'groups', coalesce((select jsonb_agg(to_jsonb(g)) from model_stage g), '[]'::jsonb),
    'lectures', coalesce((select jsonb_agg(to_jsonb(l)) from top_lectures l), '[]'::jsonb),
    'failures', coalesce((select jsonb_agg(to_jsonb(f)) from failure_groups f), '[]'::jsonb)
  );
$$;

revoke all on function public.ai_cost_report_window(timestamptz, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.ai_cost_report_window(timestamptz, timestamptz, integer, integer)
  to service_role;
