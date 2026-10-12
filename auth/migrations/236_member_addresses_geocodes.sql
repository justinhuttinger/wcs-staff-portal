-- 236: member home addresses + geocodes, for the owner-only Member Map.
--
-- ABC's /members response carries personal.addressLine1/2, city, state and
-- postalCode; until now the sync dropped them. The sync pulls every ACTIVE
-- member in full each cycle, so these columns fill on the first run after
-- deploy. Inactive members fill only as they are revisited, which is fine:
-- the map shows active members only.
--
-- address_key is the join between a member and their geocode. It is computed
-- here (not in JS) so the sync, the geocoder and the report can never disagree
-- on how an address is normalised. Built with || and coalesce rather than
-- concat_ws because a generated column needs an immutable expression.
-- address_line2 (apt/suite) is deliberately left out: it does not move the pin.

alter table public.abc_members
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city          text,
  add column if not exists state         text,
  add column if not exists postal_code   text;

alter table public.abc_members
  add column if not exists address_key text generated always as (
    case
      when nullif(btrim(address_line1), '') is null then null
      else upper(regexp_replace(
        btrim(address_line1) || '|' ||
        btrim(coalesce(city, '')) || '|' ||
        btrim(coalesce(state, '')) || '|' ||
        left(btrim(coalesce(postal_code, '')), 5),
        '\s+', ' ', 'g'))
    end
  ) stored;

create index if not exists abc_members_address_key_idx
  on public.abc_members (address_key) where address_key is not null;

-- One row per distinct address, so a household shares one lookup and an
-- address is only ever geocoded once. A member who moves gets a new key and
-- is picked up again. No_match rows are kept so they are not retried forever.
create table if not exists public.address_geocodes (
  address_key     text primary key,
  status          text not null check (status in ('match', 'no_match')),
  match_type      text,             -- Census: Exact | Non_Exact
  matched_address text,
  lat             double precision,
  lng             double precision,
  source          text not null default 'census',
  geocoded_at     timestamptz not null default now()
);

comment on table public.address_geocodes is
  'Geocodes for abc_members.address_key (home addresses). Service role only; read by the owner-only Member Map.';

-- Home addresses: service role only. RLS on with no policies.
alter table public.address_geocodes enable row level security;
revoke all on public.address_geocodes from anon, authenticated;

-- Club pins. Separate from public.clubs so the registry (config/clubs.json +
-- Admin -> Clubs) is untouched. Seeded from ABC GET /{club}/clubs addresses;
-- coordinates from the Census geocoder, Keizer from OpenStreetMap (Census
-- has no match for 5045 River Rd N).
create table if not exists public.club_geo (
  club_number text primary key references public.clubs (club_number),
  address     text not null,
  lat         double precision not null,
  lng         double precision not null,
  source      text not null,
  updated_at  timestamptz not null default now()
);

alter table public.club_geo enable row level security;
revoke all on public.club_geo from anon, authenticated;

insert into public.club_geo (club_number, address, lat, lng, source) values
  ('30935', '290 Moyer Ln NW, Salem, OR 97304',          44.948314698465, -123.048534278203, 'census'),
  ('31599', '5045 River Rd N, Keizer, OR 97303',         44.9981534,      -123.0282917,      'osm'),
  ('7655',  '1009 Green Acres Rd, Eugene, OR 97408',     44.093438353305, -123.095365844698, 'census'),
  ('31598', '2728 Pheasant Blvd, Springfield, OR 97477', 44.073075312782, -123.033435605283, 'census'),
  ('31600', '9100 SE Sunnyside Rd, Clackamas, OR 97015', 45.433269901174, -122.570566459393, 'census'),
  ('31601', '4606 SE Boardman Ave, Milwaukie, OR 97267', 45.395146659642, -122.615453698799, 'census'),
  ('32073', '1600 N Riverside Ave, Medford, OR 97501',   42.34202823202,  -122.878224846231, 'census')
on conflict (club_number) do nothing;

-- Distinct active-member addresses that still need a geocode. Active = the
-- same rule every report uses (abc_members_counted.counts_as_member).
create or replace function public.member_geocode_pending(p_limit integer default 1000)
returns table (address_key text, address_line1 text, city text, state text, postal_code text)
language sql stable
set search_path = public
as $$
  select distinct on (m.address_key)
         m.address_key, m.address_line1, m.city, m.state, left(m.postal_code, 5)
    from public.abc_members m
    join public.abc_members_counted c on c.id = m.id
   where m.is_active and c.counts_as_member
     and m.address_key is not null
     and not exists (select 1 from public.address_geocodes g where g.address_key = m.address_key)
   order by m.address_key
   limit p_limit;
$$;

-- Everything the Member Map draws, as ONE jsonb value so PostgREST's row cap
-- never truncates the ~21k points.
create or replace function public.member_map_data()
returns jsonb
language sql stable
set search_path = public
as $$
  select jsonb_build_object(
    'clubs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'club_number', k.club_number, 'name', k.name, 'slug', k.slug,
               'address', g.address, 'lat', g.lat, 'lng', g.lng) order by k.sort_order), '[]'::jsonb)
        from public.clubs k
        join public.club_geo g on g.club_number = k.club_number
       where k.active
    ),
    'members', (
      select coalesce(jsonb_agg(jsonb_build_array(
               m.member_id, m.club_number,
               initcap(coalesce(m.first_name, '')) || ' ' || initcap(coalesce(m.last_name, '')),
               concat_ws(', ', m.address_line1, m.city, m.state || ' ' || left(m.postal_code, 5)),
               round(g.lat::numeric, 6), round(g.lng::numeric, 6),
               c.membership_category)), '[]'::jsonb)
        from public.abc_members m
        join public.abc_members_counted c on c.id = m.id
        join public.address_geocodes g on g.address_key = m.address_key and g.status = 'match'
       where m.is_active and c.counts_as_member
    ),
    'unmapped', (
      select jsonb_object_agg(club_number, n) from (
        select m.club_number, count(*) n
          from public.abc_members m
          join public.abc_members_counted c on c.id = m.id
          left join public.address_geocodes g on g.address_key = m.address_key
         where m.is_active and c.counts_as_member
           and (g.status is distinct from 'match')
         group by m.club_number) u
    )
  );
$$;

revoke all on function public.member_geocode_pending(integer) from public, anon, authenticated;
revoke all on function public.member_map_data() from public, anon, authenticated;
grant execute on function public.member_geocode_pending(integer) to service_role;
grant execute on function public.member_map_data() to service_role;

notify pgrst, 'reload schema';
