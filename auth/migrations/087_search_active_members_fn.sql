-- Fuzzy search of active ABC members across all clubs, powering the Tour
-- Check-In "referring member" picker for Started VIP Pass tours.
--
-- Matches on name / email / barcode and on phone. Phones in abc_members are
-- stored formatted (e.g. "(503) 991-9435"), so both the stored value and the
-- query are digit-normalized before comparison — typing 5039919435, 991-9435,
-- or a name all match. Deduplicated by member_id so multi-club members collapse
-- to a single row. Read-only; callers are already admin-gated in the app.

create or replace function public.search_active_members(q text)
returns table (
  member_id text,
  first_name text,
  last_name text,
  email text,
  phone text,
  membership_type text,
  home_club text
)
language sql
stable
as $$
  select member_id, first_name, last_name, email, phone, membership_type, home_club
  from (
    select distinct on (m.member_id)
      m.member_id,
      m.first_name,
      m.last_name,
      m.email,
      coalesce(nullif(m.mobile_phone, ''), m.primary_phone) as phone,
      m.membership_type,
      m.home_club,
      m.last_name  as sort_last,
      m.first_name as sort_first
    from abc_members m
    where m.is_active = true
      and (
        m.first_name ilike '%' || trim(coalesce(q, '')) || '%'
        or m.last_name ilike '%' || trim(coalesce(q, '')) || '%'
        or (coalesce(m.first_name, '') || ' ' || coalesce(m.last_name, '')) ilike '%' || trim(coalesce(q, '')) || '%'
        or m.email ilike '%' || trim(coalesce(q, '')) || '%'
        or m.barcode ilike '%' || trim(coalesce(q, '')) || '%'
        or (
          length(regexp_replace(coalesce(q, ''), '\D', '', 'g')) >= 3
          and (
            regexp_replace(coalesce(m.primary_phone, ''), '\D', '', 'g') like '%' || regexp_replace(coalesce(q, ''), '\D', '', 'g') || '%'
            or regexp_replace(coalesce(m.mobile_phone, ''), '\D', '', 'g') like '%' || regexp_replace(coalesce(q, ''), '\D', '', 'g') || '%'
          )
        )
      )
    order by m.member_id
  ) s
  order by s.sort_last, s.sort_first
  limit 20;
$$;

grant execute on function public.search_active_members(text) to service_role;
