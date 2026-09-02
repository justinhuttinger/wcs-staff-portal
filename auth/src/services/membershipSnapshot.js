// Nightly membership snapshot.
//
// WHY THIS EXISTS. abc_members is a CURRENT-STATE table — one row per member,
// holding the status they are in today. When somebody cancels and re-joins,
// since_date moves onto the new membership and the earlier one stops existing,
// so every historical membership figure is reconstructed from present state and
// every one of them understates the past. Measured 2026-09-02: 8.6% of active
// members have a record predating their current membership, and the as-of count
// for September 2025 misses at least 752 members out of 14,371.
//
// The past cannot be recovered — ABC's REST API is current-state at every
// endpoint, and dues transactions cover barely half the member base. See
// migration 182 for the full working. What this job does is stop the erosion:
// from tonight, a member counted on the 3rd stays counted on the 3rd whatever
// later happens to their record.
//
// Modelled on kpiSnapshot, deliberately — same 11:55pm Pacific slot, same
// upsert-by-day shape, same "no backfill, history starts today" honesty.
//
// Opt out with MEMBERSHIP_SNAPSHOT_DISABLED=1.

const { CLUBS, isExcludedType } = require('../lib/salespersonPerformance')

// Supabase, the skip list and the scheduler are all required lazily, inside the
// functions that use them. Without that this module cannot be imported at all
// where those are absent, and the date and status helpers below — which are
// pure and worth testing — would be untestable for no reason. Same pattern
// middleware/role.js uses.

let running = false

// The three statuses ABC uses for a membership that has ended, matching
// analytics_topline_window so the snapshot and the live report agree.
const LOST_STATUSES = ['Cancelled', 'Expired', 'Return For Collection']

/** 'YYYY-MM-DD' for the given (or current) instant in Pacific time. */
function pacificDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Members the conditional-membership rule does not count, as a Set of
 * club|member keys.
 *
 * Read from the report's own function rather than re-derived, for the same
 * reason every other consumer does: "live" is defined once, in SQL, and a JS
 * replica would be a second definition to drift from it.
 */
async function excludedAsOf(asOf) {
  const { supabaseAdmin } = require('./supabase')
  const { data, error } = await supabaseAdmin
    .rpc('analytics_members_excluded_as_of', { p_asof: asOf })
  if (error) throw new Error(error.message)
  return new Set((data || []).map(r => `${r.club_number}|${r.member_id}`))
}

/**
 * One night's row for every club.
 *
 * Everything is computed from the members table AS IT STANDS TONIGHT, which is
 * the whole point: tonight it is correct, and tomorrow it may not be.
 */
async function runSnapshot(snapshotDate = pacificDate()) {
  if (running) {
    console.warn('[membershipSnapshot] run already in progress — skipping')
    return { skipped: true }
  }
  running = true
  try {
    const { supabaseAdmin } = require('./supabase')
    const { fetchAll } = require('../lib/supabaseFetchAll')
    const { getSkipList } = require('../utils/membershipSkipList')
    const [members, skip, dead] = await Promise.all([
      fetchAll(supabaseAdmin
        .from('abc_members')
        .select('member_id, club_number, membership_type, member_status, member_status_date, since_date, is_past_due, past_due_balance')),
      getSkipList(),
      excludedAsOf(snapshotDate),
    ])

    const byClub = new Map(CLUBS.map(c => [c.clubNumber, {
      snapshot_date: snapshotDate,
      location_slug: c.slug,
      total_members: 0,
      total_members_raw: 0,
      joined: 0,
      left_count: 0,
      past_due_members: 0,
      past_due_balance: 0,
    }]))

    for (const m of members) {
      const row = byClub.get(m.club_number)
      // A club_number we do not recognise is a data problem, not a club. Left
      // out rather than pooled into whichever club happens to sort first.
      if (!row) continue

      const lost = LOST_STATUSES.includes(m.member_status)
      const onBooks = !lost && m.since_date && m.since_date <= snapshotDate

      if (onBooks) {
        row.total_members_raw += 1
        // The counted figure applies both gates the reports apply: the skip
        // list and the conditional-membership rule.
        if (!isExcludedType(m.membership_type, skip)
            && !dead.has(`${m.club_number}|${m.member_id}`)) {
          row.total_members += 1
        }
      }

      // Flows for THIS day only. Excluded types are left out of both, so the
      // day's joined and left reconcile against the counted total rather than
      // the raw one.
      if (isExcludedType(m.membership_type, skip)) continue
      if (m.since_date === snapshotDate) row.joined += 1
      if (lost && m.member_status_date === snapshotDate) row.left_count += 1

      if (onBooks && m.is_past_due === true) {
        row.past_due_members += 1
        row.past_due_balance += num(m.past_due_balance)
      }
    }

    const rows = [...byClub.values()].map(r => ({
      ...r,
      past_due_balance: Math.round(r.past_due_balance * 100) / 100,
    }))

    const { error } = await supabaseAdmin
      .from('membership_daily_snapshots')
      .upsert(rows, { onConflict: 'snapshot_date,location_slug' })
    if (error) throw error

    const total = rows.reduce((n, r) => n + r.total_members, 0)
    console.log(`[membershipSnapshot] stored ${rows.length} clubs for ${snapshotDate} (${total} members)`)
    return { snapshot_date: snapshotDate, clubs: rows.length, total_members: total }
  } finally {
    running = false
  }
}

function start() {
  if (process.env.MEMBERSHIP_SNAPSHOT_DISABLED === '1') {
    console.log('[membershipSnapshot] disabled via MEMBERSHIP_SNAPSHOT_DISABLED=1')
    return
  }
  // Required here rather than at the top so the date and status helpers stay
  // importable — and unit-testable — without the scheduler, the same reason
  // middleware/role.js defers its own require.
  const cron = require('node-cron')
  // 11:50pm Pacific, five minutes before the KPI snapshot: both read the same
  // tables and there is no reason to have them contend.
  cron.schedule('50 23 * * *', () => {
    runSnapshot().catch(err => console.error('[membershipSnapshot] nightly run failed:', err.message))
  }, { timezone: 'America/Los_Angeles' })
  console.log('[membershipSnapshot] scheduled — nightly 11:50pm PT')
}

module.exports = { start, runSnapshot, pacificDate, LOST_STATUSES }
