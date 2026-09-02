-- 181_club_abc_fallbacks.sql
--
-- Per-club values to substitute when a prospect's own answer is unusable.
--
-- ABC rejects an entire prospect over one bad field and names the rule rather
-- than the field. On 2026-09-01 three people signed a waiver and never reached
-- ABC because a form asked for a state and got "Not Sure". The fix stops
-- inventing a code, but it still needs something to fall back TO, and there was
-- nowhere in the system that knew a club's own address, state or phone.
--
-- These live on club_integrations rather than a new table because it is already
-- one row per club keyed by ABC club number, and the waiver service already
-- reads it (services/waiver/integrations.js, 60s cache, clubs-config.json
-- fallback). A second table would mean two places to keep in step.
--
-- The `fallback_` prefix is deliberate. These are NOT the club's canonical
-- contact details for general use: putting a gym's street address on a member
-- record makes them look like they live at the gym, which is only worth doing
-- when the alternative is losing the record entirely.

alter table club_integrations
  add column if not exists fallback_address1    text,
  add column if not exists fallback_city        text,
  add column if not exists fallback_state       text,
  add column if not exists fallback_postal_code text,
  add column if not exists fallback_phone       text;

comment on column club_integrations.fallback_address1 is
  'Club street address, used only when a prospect''s own address is unusable and '
  'ABC would otherwise refuse the whole record.';
comment on column club_integrations.fallback_state is
  'Two-letter state code for this club. The most load-bearing of these: an '
  'unrecognised state answer is what ABC refuses most often.';
comment on column club_integrations.fallback_phone is
  'Club phone, used only when a prospect''s number is not 10 digits. ABC accepts '
  'a prospect with no phone, so this is the weakest of the three fallbacks.';

-- Every WCS club is in Oregon, so the one value that actually caused the
-- outage can be seeded now rather than waiting for someone to fill the screen
-- in. Address and phone stay null until a human supplies real ones - a wrong
-- address is worse than none, and null means "fall back to clubs-config.json".
update club_integrations
   set fallback_state = 'OR'
 where fallback_state is null;
