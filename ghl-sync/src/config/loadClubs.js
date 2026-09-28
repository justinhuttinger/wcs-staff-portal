// Boot-time load of the club list from public.clubs (+ public.club_secrets).
// Never throws: on any failure the bundled clubs.json list stays in place.
// Mirrors auth/src/config/loadClubs.js.

const { applyClubs } = require('./clubs');

const TIMEOUT_MS = 10 * 1000;

function rowToClub(r) {
  const c = {
    slug: r.slug,
    name: r.name,
    clubNumber: r.club_number,
    envKey: r.env_key || String(r.slug).toUpperCase(),
    ghlLocationId: r.ghl_location_id || undefined,
    state: r.state || undefined,
    abcUrl: r.abc_url || undefined,
    background: r.background || undefined,
    timezone: r.timezone || 'America/Los_Angeles',
    active: r.active !== false,
  };
  if (r.trading_name) c.tradingName = r.trading_name;
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  return c;
}

async function fetchFromDb() {
  const supabase = require('../db/supabase');
  const { data: rows, error } = await supabase
    .from('clubs')
    .select('club_number, slug, name, sort_order, active, env_key, ghl_location_id, state, timezone, abc_url, background, trading_name')
    .order('sort_order');
  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) throw new Error('public.clubs is empty');

  const secrets = new Map();
  const { data: secretRows, error: secretErr } = await supabase
    .from('club_secrets')
    .select('club_number, ghl_api_key_enc');
  if (secretErr) {
    console.error(`[clubs] club_secrets unreadable, env vars only: ${secretErr.message}`);
  } else {
    const { decrypt } = require('../utils/crypto');
    for (const r of secretRows || []) {
      if (!r.ghl_api_key_enc) continue;
      try {
        secrets.set(r.club_number, { ghlApiKey: decrypt(r.ghl_api_key_enc) });
      } catch (e) {
        console.error(`[clubs] could not decrypt GHL token for club ${r.club_number}: ${e.message}`);
      }
    }
  }
  return { clubs: rows.map(rowToClub), secrets };
}

async function loadClubs() {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS).unref());
    const { clubs, secrets } = await Promise.race([fetchFromDb(), timeout]);
    applyClubs(clubs, secrets);
    console.log(`[clubs] loaded ${clubs.length} clubs from the database (${clubs.filter(c => c.active).length} active)`);
  } catch (err) {
    console.error(`[clubs] using the bundled club list: ${err.message}`);
  }
}

module.exports = { loadClubs, rowToClub };
