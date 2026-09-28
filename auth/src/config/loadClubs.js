// Boot-time load of the club list from public.clubs (+ public.club_secrets).
//
// Called by index.js before the app is required. Never throws: on any failure
// (database down, table missing, empty table, timeout) the bundled clubs.json
// list stays in place and the reason is logged, so a boot never fails over it.

const { applyClubs } = require('./clubs')

const TIMEOUT_MS = 10 * 1000

// public.clubs row -> the registry shape every module already uses.
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
  }
  if (r.trading_name) c.tradingName = r.trading_name
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k]
  return c
}

function decryptSecrets(rows, decrypt) {
  const out = new Map()
  for (const r of rows || []) {
    const s = {}
    try { if (r.ghl_api_key_enc) s.ghlApiKey = decrypt(r.ghl_api_key_enc) } catch (e) {
      console.error(`[clubs] could not decrypt GHL token for club ${r.club_number}: ${e.message}`)
    }
    try { if (r.paychex_company_id_enc) s.paychexCompanyId = decrypt(r.paychex_company_id_enc) } catch (e) {
      console.error(`[clubs] could not decrypt Paychex company for club ${r.club_number}: ${e.message}`)
    }
    out.set(r.club_number, s)
  }
  return out
}

async function fetchFromDb() {
  const { supabaseAdmin } = require('../services/supabase')
  const { data: rows, error } = await supabaseAdmin
    .from('clubs')
    .select('club_number, slug, name, sort_order, active, env_key, ghl_location_id, state, timezone, abc_url, background, trading_name')
    .order('sort_order')
  if (error) throw new Error(error.message)
  if (!rows || rows.length === 0) throw new Error('public.clubs is empty')

  let secrets = new Map()
  const { data: secretRows, error: secretErr } = await supabaseAdmin
    .from('club_secrets')
    .select('club_number, ghl_api_key_enc, paychex_company_id_enc')
  if (secretErr) {
    console.error(`[clubs] club_secrets unreadable, env vars only: ${secretErr.message}`)
  } else if (secretRows && secretRows.length) {
    secrets = decryptSecrets(secretRows, require('../utils/crypto').decrypt)
  }
  return { clubs: rows.map(rowToClub), secrets }
}

async function loadClubs() {
  try {
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS).unref())
    const { clubs, secrets } = await Promise.race([fetchFromDb(), timeout])
    applyClubs(clubs, secrets, 'database')
    console.log(`[clubs] loaded ${clubs.length} clubs from the database (${clubs.filter(c => c.active).length} active)`)
  } catch (err) {
    console.error(`[clubs] using the bundled club list: ${err.message}`)
  }
}

module.exports = { loadClubs, rowToClub, decryptSecrets }
