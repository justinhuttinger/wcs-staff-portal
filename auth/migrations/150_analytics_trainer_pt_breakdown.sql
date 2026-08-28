-- 150_analytics_trainer_pt_breakdown.sql
--
-- Trainer Snapshot gains two things: PT Close Amount split into recurring
-- versus paid-in-full, and the revenue that went the other way when a client
-- of theirs deactivated.
--
-- This is a COMPANION to analytics_trainer_performance rather than a rewrite of
-- it. Adding four OUT columns would mean dropping and restating that whole
-- function, and the copy would then be free to drift from migration 144's
-- version of who gets credited for what. The route joins the two by the same
-- normalised name key both sides build.
--
-- THE TWO SIDES ARE ATTRIBUTED TO DIFFERENT PEOPLE, ON PURPOSE.
--
--   Close amount  the COMMISSION employee, falling back to the deliverer where
--                 payroll has no row. Identical to migration 144, because a
--                 split that credited someone else would not sum to the total
--                 sitting beside it on the card.
--   Lost revenue  the SERVICE employee — abc_pt_services.trainer_name. Losing a
--                 client is something that happens to whoever was training
--                 them, not to whoever booked the sale months earlier.
--
-- Paid-in-full packages are absent from the loss side for the same reason they
-- are absent from PT Snapshot: no PIF row in abc_pt_services has ever carried
-- an inactive_date, because ABC only reveals a spent package one member at a
-- time. See migration 148.

create or replace function public.analytics_trainer_pt_breakdown(
  p_start date,
  p_end   date,
  p_clubs text[] default null
)
returns table (
  trainer_key      text,
  trainer          text,
  close_amount_rs  numeric,
  close_amount_pif numeric,
  lost_count       bigint,
  lost_value       numeric
)
language sql
stable
as $$
  with sold as (
    -- Mirrors the svc CTE in migration 144 exactly, including the fallback,
    -- so close_amount_rs + close_amount_pif equals the close_amount already on
    -- the row. A different name key here would silently drop a trainer.
    select
      coalesce(
        lower(regexp_replace(trim(p.employee_name), '\s+', ' ', 'g')),
        lower(regexp_replace(trim(s.trainer_name), '\s+', ' ', 'g'))
      ) as k,
      coalesce(
        trim(regexp_replace(p.employee_name, '\s+', ' ', 'g')),
        trim(regexp_replace(s.trainer_name, '\s+', ' ', 'g'))
      ) as raw,
      coalesce(s.invoice_total, 0) as amount,
      (s.recurring_type_desc ilike '%paid in full%') as is_pif
    from public.abc_pt_services s
    left join public.payroll_recurring_commissions p
      on p.recurring_service_id = s.recurring_service_id
    where s.sale_date between p_start and p_end
      and trim(coalesce(p.employee_name, s.trainer_name, '')) <> ''
      and (p_clubs is null or s.club_number = any(p_clubs))
  ),
  lost as (
    select
      lower(regexp_replace(trim(s.trainer_name), '\s+', ' ', 'g')) as k,
      trim(regexp_replace(s.trainer_name, '\s+', ' ', 'g')) as raw,
      coalesce(s.invoice_total, 0) as amount
    from public.abc_pt_services s
    where s.inactive_date is not null
      and s.inactive_date::date between p_start and p_end
      and s.recurring_type_desc not ilike '%paid in full%'
      and s.trainer_name is not null and trim(s.trainer_name) <> ''
      and (p_clubs is null or s.club_number = any(p_clubs))
  ),
  -- Full outer join: a trainer can sell nothing and still lose a client, or
  -- lose nothing and still sell. An inner join would drop whichever it was.
  keys as (
    select k, max(raw) as raw from (
      select k, raw from sold union all select k, raw from lost
    ) z group by k
  )
  select
    keys.k,
    keys.raw,
    coalesce((select sum(amount) filter (where not is_pif) from sold where sold.k = keys.k), 0),
    coalesce((select sum(amount) filter (where is_pif)     from sold where sold.k = keys.k), 0),
    coalesce((select count(*) from lost where lost.k = keys.k), 0),
    coalesce((select sum(amount) from lost where lost.k = keys.k), 0)
  from keys
$$;

-- The same split, month by month, for the Trainer Snapshot trend panels.
create or replace function public.analytics_trainer_pt_breakdown_monthly(
  p_end    date,
  p_months integer default 13,
  p_clubs  text[] default null,
  p_person text default null
)
returns table (
  month_start      date,
  close_amount_rs  numeric,
  close_amount_pif numeric,
  lost_count       bigint,
  lost_value       numeric
)
language sql
stable
as $$
  with months as (
    select generate_series(
      date_trunc('month', p_end)::date - ((p_months - 1) || ' months')::interval,
      date_trunc('month', p_end)::date,
      '1 month'
    )::date as m
  ),
  bounds as (
    -- Newest month stops at p_end, so the current month is compared against the
    -- same day of earlier months rather than against whole ones.
    select m as start_d,
           least((m + interval '1 month' - interval '1 day')::date, p_end) as end_d
    from months
  )
  select
    b.start_d,
    coalesce(sum(t.close_amount_rs), 0),
    coalesce(sum(t.close_amount_pif), 0),
    coalesce(sum(t.lost_count), 0),
    coalesce(sum(t.lost_value), 0)
  from bounds b
  left join lateral public.analytics_trainer_pt_breakdown(b.start_d, b.end_d, p_clubs) t
    on p_person is null
    or t.trainer_key = lower(regexp_replace(trim(p_person), '\s+', ' ', 'g'))
  group by b.start_d
  order by b.start_d
$$;
