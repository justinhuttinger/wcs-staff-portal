-- auth/migrations/071_till_settings.sql
-- Per-club till configuration. standard_float is the par the drawer resets to
-- each night; drop_upc is the UPC sentinel of the ABC "Cash Drop" POS item so
-- the reconciler can treat that line as a drawer reduction instead of a sale.
-- VERIFIED 2026-06-29 test ring: the Cash Drop item carries upc 'XXXCASHDROPXXX'
-- (catalog "Company", so the same UPC appears at all 7 clubs) under the shared
-- 'MISC. ITEMS' profit center -- hence we key on UPC, NOT profit center.
CREATE TABLE IF NOT EXISTS till_settings (
  club_number       text PRIMARY KEY,
  standard_float    numeric(12,2) NOT NULL DEFAULT 100,
  drop_upc          text NOT NULL DEFAULT 'XXXCASHDROPXXX',
  active            boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO till_settings (club_number, standard_float)
VALUES ('30935',100),('31599',100),('7655',100),('31598',100),
       ('31600',100),('31601',100),('32073',100)
ON CONFLICT (club_number) DO NOTHING;

ALTER TABLE till_settings ENABLE ROW LEVEL SECURITY;
