-- 024_dedupe_deletion_candidates_view.sql
-- Patch v_cross_location_deletion_candidates so each lead-side contact
-- shows up exactly once.
--
-- The 2026-05-18 smoke test surfaced the issue: when the same person has
-- the `sale` tag in 2+ sister-club GHL records, the original view
-- produced one row per (lead, member-side match), so the cleanup script
-- tried to delete the lead-side contact multiple times. The first DELETE
-- succeeds; the rest 400 ("Contact not found"). Not destructive, just
-- noisy in the audit log and wasteful at scale.
--
-- DISTINCT ON (lead_ghl_contact_id) collapses to one row per lead contact,
-- choosing the alphabetically-first member_location_slug for the audit log
-- (any choice is fine — they all point to a valid sister-club signup).

CREATE OR REPLACE VIEW v_cross_location_deletion_candidates AS
WITH club_map AS (
  SELECT * FROM (VALUES
    ('30935', 'salem'),
    ('31599', 'keizer'),
    ('7655',  'eugene'),
    ('31598', 'springfield'),
    ('31600', 'clackamas'),
    ('31601', 'milwaukie'),
    ('32073', 'medford')
  ) AS m(club_number, slug)
),
abc_emails_by_slug AS (
  SELECT DISTINCT lower(trim(a.email)) AS email_norm, cm.slug AS member_slug
  FROM abc_members a
  JOIN club_map cm ON cm.club_number = a.club_number
  WHERE a.email IS NOT NULL AND a.email <> ''
),
ghl_norm AS (
  SELECT c.id, c.location_id, l.slug AS location_slug,
         c.first_name, c.last_name, c.email, c.phone,
         lower(trim(c.email)) AS email_norm,
         'sale' = ANY(c.tags) AS has_sale_tag
  FROM ghl_contacts_v2 c
  JOIN ghl_locations l ON l.id = c.location_id
  WHERE c.email IS NOT NULL AND c.email <> ''
),
all_matches AS (
  SELECT
    lead.id              AS lead_ghl_contact_id,
    lead.location_id     AS lead_location_id,
    lead.location_slug   AS lead_location_slug,
    member.location_slug AS member_location_slug,
    lead.first_name,
    lead.last_name,
    lead.email,
    lead.phone
  FROM ghl_norm lead
  JOIN ghl_norm member
    ON member.email_norm = lead.email_norm
   AND member.location_id <> lead.location_id
   AND member.has_sale_tag
  JOIN abc_emails_by_slug abc
    ON abc.email_norm = lead.email_norm
   AND abc.member_slug = member.location_slug
  WHERE NOT lead.has_sale_tag
    AND NOT EXISTS (
      SELECT 1 FROM contact_deletion_log d
      WHERE d.ghl_contact_id = lead.id
        AND d.ghl_api_status BETWEEN 200 AND 299
    )
)
SELECT DISTINCT ON (lead_ghl_contact_id) *
FROM all_matches
ORDER BY lead_ghl_contact_id, member_location_slug;
