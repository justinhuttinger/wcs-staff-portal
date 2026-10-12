// US Census Bureau batch geocoder: free, no key, up to 10k rows per request.
// Batches are kept at 1000 so one request stays well inside its timeout.
const CENSUS_BATCH_URL = 'https://geocoding.geo.census.gov/geocoder/locations/addressbatch';
const BATCH_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

function csvField(v) {
  const s = String(v ?? '').replace(/[\r\n]+/g, ' ').trim();
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Census input: id,street,city,state,zip. The id is the row's index in `rows`. */
function buildCensusCsv(rows) {
  return rows.map((r, i) =>
    [i, r.address_line1, r.city, r.state, r.postal_code].map(csvField).join(',')
  ).join('\n') + '\n';
}

function parseCsvLine(line) {
  const out = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Census output, one line per input row (any order):
 *   id,"input",Match,Exact,"matched","lon,lat",tigerId,side
 *   id,"input",No_Match
 * Returns Map(id -> { status, match_type, matched_address, lat, lng }).
 * "Tie" (several candidates) is treated as no_match: we would be guessing.
 */
function parseCensusResponse(text) {
  const results = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const f = parseCsvLine(line);
    const id = Number(f[0]);
    if (f[0] === '' || !Number.isInteger(id)) continue;
    if (f[2] === 'Match') {
      const [lng, lat] = String(f[5] || '').split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        results.set(id, { status: 'match', match_type: f[3] || null, matched_address: f[4] || null, lat, lng });
        continue;
      }
    }
    results.set(id, { status: 'no_match', match_type: null, matched_address: null, lat: null, lng: null });
  }
  return results;
}

async function geocodeBatch(rows, { fetchImpl = fetch } = {}) {
  const form = new FormData();
  form.append('benchmark', 'Public_AR_Current');
  form.append('addressFile', new Blob([buildCensusCsv(rows)], { type: 'text/csv' }), 'addresses.csv');
  const res = await fetchImpl(CENSUS_BATCH_URL, {
    method: 'POST', body: form, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
  return parseCensusResponse(await res.text());
}

/**
 * Geocode active-member addresses that have no address_geocodes row yet.
 * Each address is looked up once; a household shares one row. Rows Census
 * did not return are left alone and retried next run. An HTTP failure stops
 * the run without writing anything for that batch, so an outage never marks
 * good addresses as no_match.
 */
async function runMemberGeocode({ maxAddresses = 5000, batchSize = BATCH_SIZE, fetchImpl, db } = {}) {
  // Lazy so the pure helpers (and tests) load without Supabase env.
  db = db || require('../db/supabase');
  const summary = { looked_up: 0, matched: 0, no_match: 0, batches: 0 };
  while (summary.looked_up < maxAddresses) {
    const limit = Math.min(batchSize, maxAddresses - summary.looked_up);
    const { data: pending, error } = await db.rpc('member_geocode_pending', { p_limit: limit });
    if (error) throw new Error(`member_geocode_pending: ${error.message}`);
    if (!pending || pending.length === 0) break;

    const results = await geocodeBatch(pending, { fetchImpl });
    const now = new Date().toISOString();
    const rows = [];
    pending.forEach((p, i) => {
      const r = results.get(i);
      if (r) rows.push({ address_key: p.address_key, source: 'census', geocoded_at: now, ...r });
    });
    if (rows.length) {
      const { error: upErr } = await db.from('address_geocodes').upsert(rows, { onConflict: 'address_key' });
      if (upErr) throw new Error(`address_geocodes upsert: ${upErr.message}`);
    }
    summary.batches++;
    summary.looked_up += pending.length;
    summary.matched += rows.filter(r => r.status === 'match').length;
    summary.no_match += rows.filter(r => r.status === 'no_match').length;
    // Nothing written means Census returned nothing usable; stop rather than
    // fetch the same pending rows again.
    if (rows.length === 0 || pending.length < limit) break;
  }
  return summary;
}

module.exports = { runMemberGeocode, buildCensusCsv, parseCensusResponse, geocodeBatch };
