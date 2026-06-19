-- 051_university_enrollments.sql
--
-- WCS University trainee enrollment (admin "Enroll" action in the portal).
--
-- An admin picks a GHL user and clicks Enroll; the backend (1) grants that user
-- access to the West Coast University sub-account with restricted permissions,
-- and (2) creates that trainee's own copy of the practice (persona) contacts in
-- University, each assigned to them. Two tables back that:
--
--   university_seed_contacts — the editable template of practice contacts to
--     clone on every enroll (so the 5 personas aren't hardcoded in the handler
--     and can be tuned without a redeploy). Phones are the dedicated Retell
--     persona numbers; scenario/difficulty/call_type/lead_source mirror the keys
--     in services/university/scenarios.js + callTypes.js, and are stamped onto
--     the cloned contact's custom fields so the existing call flow personalizes.
--
--   university_enrollments — one row per enrolled GHL user. `ghl_user_id` is
--     UNIQUE and is the idempotency key: a retried/double-clicked enroll inserts
--     (or finds) the same row, and only the persona contacts not already in
--     created_contacts get created. Also the audit trail (who/when/result).
--
-- Service-role-only (RLS on, no policy) per migration 035. Idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS university_seed_contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name  text NOT NULL,
  last_name   text,
  phone       text,                       -- E.164; the persona's dedicated Retell number
  scenario    text NOT NULL,              -- scenarios.js key (e.g. 'easy_lead')
  difficulty  text NOT NULL DEFAULT 'medium',
  call_type   text,                       -- callTypes.js key (e.g. 'cold_lead')
  lead_source text,
  tag         text NOT NULL DEFAULT 'training_contact',
  active      boolean NOT NULL DEFAULT true,
  sort_order  int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_university_seed_contacts_updated_at ON university_seed_contacts;
CREATE TRIGGER trg_university_seed_contacts_updated_at
  BEFORE UPDATE ON university_seed_contacts
  FOR EACH ROW EXECUTE FUNCTION university_touch_updated_at();

-- The 5 fixed personas (matches services/university/scenarios.js course personas).
-- Phones are the dedicated Retell numbers per the original seed spec.
INSERT INTO university_seed_contacts (first_name, last_name, phone, scenario, difficulty, call_type, lead_source, sort_order)
VALUES
  ('Sarah',   'Easy-Lead',     '+19714385092', 'easy_lead',     'easy',   'cold_lead',     'instagram', 1),
  ('Marcus',  'Hard-Lead',     '+19713877739', 'hard_lead',     'hard',   'cold_lead',     'snapchat',  2),
  ('Megan',   'Trial-Ending',  '+12523592358', 'trial_ending',  'medium', 'mid_trial',     'trial',     3),
  ('Brandon', 'Trial-Expired', '+15109301814', 'trial_expired', 'hard',   'expired_trial', 'expired',   4),
  ('Tyler',   'New-Member',    '+15054818681', 'new_member',    'easy',   'new_member',    'membership',5)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS university_enrollments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ghl_user_id         text NOT NULL UNIQUE,        -- idempotency key
  user_email          text,
  user_name           text,
  location_id         text NOT NULL,               -- University sub-account
  status              text NOT NULL DEFAULT 'pending', -- pending | complete | partial | failed
  granted_location    boolean NOT NULL DEFAULT false,
  permissions_applied boolean NOT NULL DEFAULT false,
  created_contacts    jsonb NOT NULL DEFAULT '[]',  -- [{ seed_id, scenario, ghl_contact_id }]
  error               text,
  enrolled_by         text,                         -- staff email who clicked Enroll
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS trg_university_enrollments_updated_at ON university_enrollments;
CREATE TRIGGER trg_university_enrollments_updated_at
  BEFORE UPDATE ON university_enrollments
  FOR EACH ROW EXECUTE FUNCTION university_touch_updated_at();

ALTER TABLE university_seed_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE university_enrollments   ENABLE ROW LEVEL SECURITY;

COMMIT;
