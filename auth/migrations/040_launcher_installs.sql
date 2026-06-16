-- 040_launcher_installs.sql
-- Central registry of desktop-launcher installs + one-time deep links for
-- remotely setting a machine's location + ABC URL.
--
-- The launcher stores its location/abc_url in a local config.json and never
-- reported back, so there was no way to see installs or change them without
-- touching each machine. Now the launcher heartbeats on startup + every 15 min;
-- an admin can set a per-machine target (applied on next heartbeat) OR mint a
-- one-time wcsportal:// deep link the user clicks to apply it immediately.

-- The per-club ABC workstation URLs lived only in the launcher (locations.js);
-- mirror them into the DB so the admin UI + link mint can resolve them.
UPDATE locations SET abc_url = v.url FROM (VALUES
  ('Salem',       'https://prod02.abcfinancial.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=9a84c8e908a74fc494d114a36a48c969&wizardFirstLoad=1'),
  ('Keizer',      'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=cff423f895d340888d67812e4ee2409f&wizardFirstLoad=1'),
  ('Eugene',      'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=e3eae001c08148038497e1379344f0e0&wizardFirstLoad=1'),
  ('Springfield', 'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=310aa987194d4e4295aff333c6e69df9&wizardFirstLoad=1'),
  ('Clackamas',   'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=4bab4e83fd394d5d81970af7b88e4426&wizardFirstLoad=1'),
  ('Milwaukie',   'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=da82fd71e8ac4edb989e11207a92ec8d&wizardFirstLoad=1'),
  ('Medford',     'https://prod02.abcfitness.com/SystemLoginCommand.pml?menuClick=true&hideMenus=YES&workstationId=87c18f3a76c4400198c951d50d5d94a4&wizardFirstLoad=1')
) AS v(name, url)
WHERE locations.name = v.name AND (locations.abc_url IS NULL OR locations.abc_url = '');

-- One row per installed machine, keyed by a stable install_id the launcher
-- generates on first run and persists in config.json.
CREATE TABLE IF NOT EXISTS launcher_installs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  install_id      text NOT NULL UNIQUE,
  hostname        text,
  location        text,                 -- last reported
  abc_url         text,                 -- last reported
  app_version     text,
  target_location text,                 -- admin-set desired (null = none pending)
  target_abc_url  text,
  target_set_at   timestamptz,
  target_set_by   text,
  applied_at      timestamptz,          -- when the launcher confirmed the target took
  first_seen_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_launcher_installs_last_seen
  ON launcher_installs(last_seen_at DESC);

-- One-time links. The token is the credential — clicking wcsportal://set-location
-- ?token=... has the launcher redeem it for {location, abc_url} and apply.
CREATE TABLE IF NOT EXISTS launcher_location_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token           text NOT NULL UNIQUE,
  location        text NOT NULL,
  abc_url         text,
  install_id      text,                 -- optional: restrict to one machine
  created_by      uuid,
  created_by_name text,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  used_by_install text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_launcher_links_token ON launcher_location_links(token);

-- Keep updated_at fresh on installs (reuse the existing helper from 038).
DROP TRIGGER IF EXISTS trg_launcher_installs_updated_at ON launcher_installs;
CREATE TRIGGER trg_launcher_installs_updated_at
  BEFORE UPDATE ON launcher_installs
  FOR EACH ROW EXECUTE FUNCTION inventory_touch_updated_at();

-- Service-role-only access (RLS on, no policy) — matches migration 035.
ALTER TABLE launcher_installs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE launcher_location_links  ENABLE ROW LEVEL SECURITY;
