-- 215: public.clubs becomes the source of truth for the club list.
--
-- Adds every field the services need (they used to come from config/clubs.json)
-- and a service-role-only club_secrets table for per-club credentials entered
-- in Admin -> Clubs (GHL private-integration token, Paychex company id),
-- encrypted with the vault key (auth/src/utils/crypto.js).
--
-- The backfill copies config/clubs.json exactly, so the database list the
-- services load at boot is the list they already run on. Render env vars
-- (GHL_API_KEY_SALEM, ...) keep precedence over club_secrets, so the existing
-- clubs' credentials do not move.

alter table public.clubs
  add column if not exists env_key         text,
  add column if not exists ghl_location_id text,
  add column if not exists state           text,
  add column if not exists timezone        text not null default 'America/Los_Angeles',
  add column if not exists abc_url         text,
  add column if not exists background      text,
  add column if not exists trading_name    text,
  add column if not exists updated_at      timestamptz not null default now();

-- Slug = lowercased name with no spaces. Paychex lookups, Operandio parsing and
-- background photos derive one from the other.
alter table public.clubs drop constraint if exists clubs_slug_shape;
alter table public.clubs add constraint clubs_slug_shape check (slug ~ '^[a-z]+$');

update public.clubs c set
  env_key = v.env_key, ghl_location_id = v.ghl_location_id, state = v.state,
  timezone = v.timezone, abc_url = v.abc_url, background = v.background,
  trading_name = v.trading_name, updated_at = now()
from (values
  ('30935', 'SALEM', 'uflpfHNpByAnaBLkQzu3', 'Oregon', 'America/Los_Angeles', 'https://prod02.abcfinancial.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=9a84c8e908a74fc494d114a36a48c969&wizardFirstLoad=1', '/bg-salem.jpg', null),
  ('31599', 'KEIZER', 'g75BBgiSvlCRbvxYRMAb', 'Oregon', 'America/Los_Angeles', 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=cff423f895d340888d67812e4ee2409f&wizardFirstLoad=1', '/bg-keizer.jpg', null),
  ('7655', 'EUGENE', 'NNTZT21fPm3SxpLg8s04', 'Oregon', 'America/Los_Angeles', 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=e3eae001c08148038497e1379344f0e0&wizardFirstLoad=1', '/bg-eugene.jpg', null),
  ('31598', 'SPRINGFIELD', 'xXV3CXt5DkgfGnTt8CG1', 'Oregon', 'America/Los_Angeles', 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=310aa987194d4e4295aff333c6e69df9&wizardFirstLoad=1', '/bg-springfield.jpg', null),
  ('31600', 'CLACKAMAS', 'aqSDfuZLimMXuPz6Zx3p', 'Oregon', 'America/Los_Angeles', 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=4bab4e83fd394d5d81970af7b88e4426&wizardFirstLoad=1', '/bg-clackamas.jpg', null),
  ('31601', 'MILWAUKIE', 'BQfUepBFzqVan4ruCQ6R', 'Oregon', 'America/Los_Angeles', 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=da82fd71e8ac4edb989e11207a92ec8d&wizardFirstLoad=1', '/bg-milwaukie.jpg', 'East Side Athletic Club'),
  ('32073', 'MEDFORD', 'ZxcRZBvwIO7vd4D3bjJO', 'Oregon', 'America/Los_Angeles', 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=87c18f3a76c4400198c951d50d5d94a4&wizardFirstLoad=1', '/bg-medford.jpg', null)

) as v(club_number, env_key, ghl_location_id, state, timezone, abc_url, background, trading_name)
where c.club_number = v.club_number;

create table if not exists public.club_secrets (
  club_number            text primary key references public.clubs(club_number) on update cascade,
  ghl_api_key_enc        text,
  paychex_company_id_enc text,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.staff(id)
);

comment on table public.club_secrets is
  'Per-club credentials entered in Admin -> Clubs, AES-256-GCM encrypted with VAULT_ENCRYPTION_KEY. Service role only. Env vars take precedence.';

-- Service role only: RLS on, no policies, and no grants to the API roles.
alter table public.club_secrets enable row level security;
revoke all on public.club_secrets from anon, authenticated;

notify pgrst, 'reload schema';
