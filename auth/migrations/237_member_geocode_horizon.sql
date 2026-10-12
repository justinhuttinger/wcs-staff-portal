-- 237: geocode recent cancels and joins too, for the Member Map filters.
--
-- 236's member_geocode_pending only looked at active, counted members. The map
-- can now show New Members and Cancelled for a date range, so the geocoder
-- also takes anyone who joined (since_date) or was lost (member_status_date on
-- a lost status) in the last two years. That two-year horizon is the furthest
-- back those two filters can see; the report says so.
--
-- Inactive members only carry an address once the sync has revisited them
-- (the 90-day inactive pull each cycle, or ghl-sync/scripts/backfill-abc-
-- inactive-addresses.js for the rest of the two years).

create or replace function public.member_geocode_pending(p_limit integer default 1000)
returns table (address_key text, address_line1 text, city text, state text, postal_code text)
language sql stable
set search_path = public
as $$
  select distinct on (m.address_key)
         m.address_key, m.address_line1, m.city, m.state, left(m.postal_code, 5)
    from public.abc_members m
   where m.address_key is not null
     and (
       m.is_active
       or m.since_date >= current_date - 730
       or (m.member_status in ('Cancelled', 'Expired', 'Return For Collection')
           and m.member_status_date >= current_date - 730)
     )
     and not exists (select 1 from public.address_geocodes g where g.address_key = m.address_key)
   order by m.address_key
   limit p_limit;
$$;

revoke all on function public.member_geocode_pending(integer) from public, anon, authenticated;
grant execute on function public.member_geocode_pending(integer) to service_role;

-- 236's member_map_data() was never used: the report needs the skip list,
-- which the route applies in JS.
drop function if exists public.member_map_data();

notify pgrst, 'reload schema';
