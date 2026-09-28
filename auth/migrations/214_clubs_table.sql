-- 214: clubs table — the club list for SQL, mirroring config/clubs.json.
--
-- Until now ten live SQL objects carried their own inline VALUES list of the
-- seven clubs. They now read public.clubs instead, so adding a club is one
-- upsert (print it with `node scripts/sync-clubs.js --sql`) instead of editing
-- ten function bodies.
--
-- Mapping queries deliberately do NOT filter on `active`: a club that closes
-- keeps its history, so its number must still resolve to its slug.
--
-- The six large analytics functions are rewritten in place: the DO block below
-- reads each live definition, swaps exactly its inline club VALUES block for a
-- select from public.clubs, and raises if the block is not found exactly once.
-- Nothing else in those bodies changes.

create table if not exists public.clubs (
  club_number text primary key check (club_number ~ '^[1-9][0-9]*$'),
  slug        text not null unique,
  name        text not null unique,
  sort_order  integer not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.clubs is
  'WCS clubs for SQL. Mirrors config/clubs.json (source of truth); sync with node scripts/sync-clubs.js --sql.';

-- The analytics functions run as the caller (anon/authenticated can execute
-- them), so the list must be readable by those roles. It holds no secrets.
alter table public.clubs enable row level security;
drop policy if exists clubs_read on public.clubs;
create policy clubs_read on public.clubs for select to anon, authenticated using (true);
grant select on public.clubs to anon, authenticated;

insert into public.clubs (club_number, slug, name, sort_order, active) values
  ('30935', 'salem',       'Salem',       1, true),
  ('31599', 'keizer',      'Keizer',      2, true),
  ('7655',  'eugene',      'Eugene',      3, true),
  ('31598', 'springfield', 'Springfield', 4, true),
  ('31600', 'clackamas',   'Clackamas',   5, true),
  ('31601', 'milwaukie',   'Milwaukie',   6, true),
  ('32073', 'medford',     'Medford',     7, true)
on conflict (club_number) do update
  set slug = excluded.slug, name = excluded.name,
      sort_order = excluded.sort_order, active = excluded.active;

-- The two shared helpers (about 15 other analytics functions call them).
-- IMMUTABLE -> STABLE: they now read a table.
create or replace function public.analytics_checkin_clubs()
  returns table(club_number text, slug text)
  language sql
  stable
as $function$
  select c.club_number, c.slug from public.clubs c order by c.sort_order
$function$;

create or replace function public.analytics_club_slugs(p_clubs text[])
  returns text[]
  language sql
  stable
as $function$
  select case when p_clubs is null then null else array(
    select c.slug from public.clubs c
    where c.club_number = any(select ltrim(x, '0') from unnest(p_clubs) x)
    order by c.sort_order
  ) end
$function$;

do $mig$
declare
  fn   text;
  def  text;
  hits int;
  -- The inline list exactly as it appears in all six bodies (whitespace-tolerant).
  pat  text := $re$\(values\s*\('30935','salem'\),\s*\('31599','keizer'\),\s*\('7655','eugene'\),\s*\('31598','springfield'\),\s*\('31600','clackamas'\),\s*\('31601','milwaukie'\),\s*\('32073','medford'\)\s*\)$re$;
begin
  foreach fn in array array[
    'public.analytics_day_one_pending(date, date, text[])',
    'public.analytics_pt_scorecard(date, date, text[], boolean)',
    'public.analytics_salesperson_monthly(date, integer, text[], text)',
    'public.analytics_trainer_monthly(date, integer, text[], text)',
    'public.analytics_trainer_performance(date, date, text[])',
    'public.analytics_trainer_performance_totals(date, date, text[])'
  ] loop
    def := pg_get_functiondef(fn::regprocedure);
    select count(*) into hits from regexp_matches(def, pat, 'g');
    if hits <> 1 then
      raise exception '214: expected 1 inline club list in %, found %', fn, hits;
    end if;
    execute regexp_replace(def, pat, '(select c.club_number, c.slug from public.clubs c)');
  end loop;

  -- v_cross_location_deletion_candidates: club_map CTE.
  def := pg_get_viewdef('public.v_cross_location_deletion_candidates'::regclass);
  pat := $re$\(\s*VALUES\s*\('30935'::text,\s*'salem'::text\),\s*\('31599'::text,\s*'keizer'::text\),\s*\('7655'::text,\s*'eugene'::text\),\s*\('31598'::text,\s*'springfield'::text\),\s*\('31600'::text,\s*'clackamas'::text\),\s*\('31601'::text,\s*'milwaukie'::text\),\s*\('32073'::text,\s*'medford'::text\)\)\s*m\(club_number,\s*slug\)$re$;
  select count(*) into hits from regexp_matches(def, pat, 'g');
  if hits <> 1 then
    raise exception '214: expected 1 inline club list in v_cross_location_deletion_candidates, found %', hits;
  end if;
  execute 'create or replace view public.v_cross_location_deletion_candidates as '
    || regexp_replace(def, pat, 'public.clubs m');

  -- vip_credit_from_ghl: clubmap joins locations.name to a (name, number) list.
  def := pg_get_viewdef('public.vip_credit_from_ghl'::regclass);
  pat := $re$\(\s*VALUES\s*\('Salem'::text,\s*'30935'::text\),\s*\('Keizer'::text,\s*'31599'::text\),\s*\('Eugene'::text,\s*'7655'::text\),\s*\('Springfield'::text,\s*'31598'::text\),\s*\('Clackamas'::text,\s*'31600'::text\),\s*\('Milwaukie'::text,\s*'31601'::text\),\s*\('Medford'::text,\s*'32073'::text\)\)\s*c_1\(name,\s*club_number\)$re$;
  select count(*) into hits from regexp_matches(def, pat, 'g');
  if hits <> 1 then
    raise exception '214: expected 1 inline club list in vip_credit_from_ghl, found %', hits;
  end if;
  execute 'create or replace view public.vip_credit_from_ghl as '
    || regexp_replace(def, pat, 'public.clubs c_1');
end
$mig$;

notify pgrst, 'reload schema';
