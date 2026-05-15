// Phase 3: Supabase-backed reader for the abc_recurring_services table.
//
// The table is populated by ghl-sync's recurringServicesSync.js. The full ABC
// payload is preserved in `raw`, so we can hand the consumer code back exactly
// what it was already shaped to handle — no downstream aggregator changes.
//
// The sync's best-effort cancel_date is promoted to the top-level
// `cancellationDate` so the consumer's deactivationDate() sweep finds it first.
//
// supabase is lazy-required inside each fetch helper so the pure
// mapRowToAbcPayload can be unit-tested without dragging supabase-js in.

function getSupabase() {
  return require('./supabase').supabaseAdmin
}

// Convert a row from abc_recurring_services back into the ABC-API-shaped
// recurringService object the report aggregators expect.
function mapRowToAbcPayload(row) {
  if (!row) return null
  const raw = row.raw || {}
  const dates = raw.recurringServiceDates || {}
  return {
    ...raw,
    // The consumer's deactivationDate() walks recognized termination fields
    // in priority order; cancellationDate is the first it checks. Use the
    // sync's already-resolved cancel_date as the source of truth.
    cancellationDate: row.cancel_date || raw.cancellationDate || dates.cancellationDate || null,
  }
}

async function fetchAllPages(query) {
  const all = []
  let from = 0
  while (true) {
    const { data, error } = await query.range(from, from + 999)
    if (error) {
      throw new Error(`abc_recurring_services query failed: ${error.message}`)
    }
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < 1000) break
    from += 1000
  }
  return all
}

// Fetch PT recurring services for a club whose last_modified_timestamp falls
// in [startDate, endDate]. Mirrors auth/src/routes/deactivatedPT.js's
// fetchPTRecurringServices(..., 'lastModifiedTimestampRange').
async function fetchPTRSModifiedInRange(clubNumber, startDate, endDate) {
  const q = getSupabase()
    .from('abc_recurring_services')
    .select('*')
    .eq('club_number', clubNumber)
    .gte('last_modified_timestamp', `${startDate}T00:00:00Z`)
    .lte('last_modified_timestamp', `${endDate}T23:59:59.999Z`)
  const rows = await fetchAllPages(q)
  return rows.map(mapRowToAbcPayload)
}

// Fetch PT recurring services for a club anchored on sale_date — used by
// /reports/pt-new-clients in a future PR.
async function fetchPTRSSoldInRange(clubNumber, startDate, endDate) {
  const q = getSupabase()
    .from('abc_recurring_services')
    .select('*')
    .eq('club_number', clubNumber)
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)
  const rows = await fetchAllPages(q)
  return rows.map(mapRowToAbcPayload)
}

// Fetch every PT RS for a single member — used by deactivatedPT.js's
// PIF-burned verification path (fetchMemberAllRS).
async function fetchAllRSForMember(clubNumber, memberId) {
  if (!memberId) return []
  const q = getSupabase()
    .from('abc_recurring_services')
    .select('*')
    .eq('club_number', clubNumber)
    .eq('member_id', memberId)
  const rows = await fetchAllPages(q)
  return rows.map(mapRowToAbcPayload)
}

module.exports = {
  mapRowToAbcPayload,
  fetchPTRSModifiedInRange,
  fetchPTRSSoldInRange,
  fetchAllRSForMember,
}
