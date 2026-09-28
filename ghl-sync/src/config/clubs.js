// The WCS club list for ghl-sync.
//
// Source of truth: public.clubs (edited in the portal's Admin -> Clubs).
// index.js calls loadClubs() BEFORE the app is required, which fills the list
// below in place. clubs.json (a copy of config/clubs.json) is only the fallback
// for when the database can't be read at boot. Modules such as
// config/locations build from this list when first required, which is why a
// club change restarts this service.

const bundled = require('./clubs.json').clubs;

const ALL_CLUBS = [];
// Per-club secrets from public.club_secrets, keyed by club number; kept off the
// club objects so nothing that logs a club can leak them.
const SECRETS = new Map();

function applyClubs(clubs, secrets = new Map()) {
  ALL_CLUBS.length = 0;
  ALL_CLUBS.push(...clubs);
  SECRETS.clear();
  for (const [k, v] of secrets) SECRETS.set(k, v);
}

applyClubs(bundled);

function activeClubs() {
  return ALL_CLUBS.filter(c => c.active);
}

// Render env var first (the existing clubs keep their credentials there), then
// the club row / encrypted secrets saved from the portal.
const FROM_DB = {
  GHL_LOCATION_: (c) => c.ghlLocationId,
  GHL_API_KEY_: (c) => SECRETS.get(c.clubNumber)?.ghlApiKey,
};
function envFor(club, prefix) {
  const env = process.env[`${prefix}${club.envKey}`];
  if (env) return env;
  const fromDb = FROM_DB[prefix];
  return (fromDb && fromDb(club)) || undefined;
}

module.exports = { ALL_CLUBS, applyClubs, activeClubs, envFor };
