-- 023_cross_location_deletion_candidates.sql
-- Read-only view backing the cross-location lead cleanup script.
--
-- Surfaces the lead-side GHL contact rows that are safe to delete:
--   * No 'sale' tag on the contact itself
--   * Same normalized email exists in another location AND that record
--     HAS the 'sale' tag in GHL
--   * The member-side location also has an `abc_members` row with the
--     matching email — i.e., the person actually signed up at the sister
--     club, not just got mis-tagged in GHL
--   * Not already deleted (left-anti-joined against contact_deletion_log)
--
-- The script does `select * from v_cross_location_deletion_candidates`,
-- optionally filtered by `lead_location_slug`, and walks the rows.
--
-- club_number → location_slug mapping is encoded here because the
-- `locations` table doesn't carry the ABC club_number. If we ever add
-- that column to `locations`, replace this LATERAL with a join.

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
)
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
  );
