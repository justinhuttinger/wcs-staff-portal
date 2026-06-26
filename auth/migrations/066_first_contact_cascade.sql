-- ghl_first_contact.opportunity_id -> ghl_opportunities_v2.id was ON DELETE NO
-- ACTION, which blocked pruning opportunities that GHL deleted/merged: the prune
-- in ghl-sync (fullSync opportunities step) deletes a location's opps no longer
-- returned by GHL, but any such opp with a speed-to-lead first-contact row failed
-- the delete with a FK violation and was silently left behind (skipped).
--
-- ghl_first_contact is per-opportunity speed-to-lead tracking; if the opportunity
-- no longer exists in GHL the measurement is moot, so cascade-delete it with the
-- opp. Applied live via the Supabase admin connection on 2026-06-26.
alter table ghl_first_contact
  drop constraint ghl_first_contact_opportunity_id_fkey;

alter table ghl_first_contact
  add constraint ghl_first_contact_opportunity_id_fkey
  foreign key (opportunity_id) references ghl_opportunities_v2(id) on delete cascade;
