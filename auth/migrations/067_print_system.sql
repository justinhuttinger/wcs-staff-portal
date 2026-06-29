-- 072_print_system.sql — Till-close auto-print: device registry, job queue, triggers.

-- A desktop launcher install that can print. One row per install_id.
CREATE TABLE IF NOT EXISTS print_devices (
  install_id         text PRIMARY KEY,
  location_id        uuid REFERENCES locations(id) ON DELETE SET NULL,
  location_slug      text,
  hostname           text,
  available_printers jsonb DEFAULT '[]'::jsonb,   -- [{ name, isDefault }]
  selected_printer   text,
  enabled            boolean NOT NULL DEFAULT false,
  last_seen          timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE print_devices ENABLE ROW LEVEL SECURITY;

-- Generic print job queue. v1 only produces type='till_close' and 'test'.
CREATE TABLE IF NOT EXISTS print_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid REFERENCES locations(id) ON DELETE SET NULL,
  location_slug text,
  install_id  text,                              -- target device (set when known)
  type        text NOT NULL,                     -- 'till_close' | 'test'
  dedupe_key  text,                              -- e.g. 'till_close:salem:2026-06-29'
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status      text NOT NULL DEFAULT 'pending',   -- pending|claimed|printed|failed
  attempts    int  NOT NULL DEFAULT 0,
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz,
  printed_at  timestamptz
);
ALTER TABLE print_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS print_jobs_install_status_idx ON print_jobs (install_id, status);
CREATE INDEX IF NOT EXISTS print_jobs_location_status_idx ON print_jobs (location_id, status);
-- Stop a re-submitted drawer close from double-printing the same day.
CREATE UNIQUE INDEX IF NOT EXISTS print_jobs_dedupe_idx
  ON print_jobs (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Per-location automation: which Operandio job name triggers which print type.
CREATE TABLE IF NOT EXISTS print_automations (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id    uuid REFERENCES locations(id) ON DELETE CASCADE,
  location_slug  text NOT NULL,
  job_name_match text NOT NULL DEFAULT '%drawer close%',  -- ILIKE pattern
  print_type     text NOT NULL DEFAULT 'till_close',
  enabled        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_slug, print_type)
);
ALTER TABLE print_automations ENABLE ROW LEVEL SECURITY;
