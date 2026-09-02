const { personKey, displayName } = require('./salespersonPerformance')

// ---------------------------------------------------------------------------
// Pending-outcome Day Ones.
//
// A Day One whose date has PASSED with nobody recording an outcome. The rule
// lives in SQL (migration 180, mirroring day_one_appointments_v.display_status)
// so every report agrees by construction rather than by six copies of the same
// `status = 'scheduled' and scheduled_date < today` test.
//
// KEYED ON scheduled_date, ALWAYS. Several of the reports that show this metric
// key their other Day One counts on booked_at — the month the intro was put in
// the diary. Pending has to be the day it was SUPPOSED TO HAPPEN, or a
// still-open intro booked in June for a July date reads as June's problem.
// Anything surfacing this number therefore labels it by appointment date.
//
// The volume is tens of rows for a month window (62 of August 2026's 303 Day
// Ones), so rows come back whole and are bucketed here. That is deliberate: the
// point of the metric is which trainer and which member, not a bare count.
// ---------------------------------------------------------------------------

/** Rows are attributed to a person by the same key SQL groups trainers on. */
const UNASSIGNED = 'Unassigned'

/**
 * @param {string[]|null} clubNumbers null means every club.
 */
async function loadPendingDayOnes(clubNumbers, start, end) {
  // Lazily required so everything below stays importable without Supabase env,
  // the same reason middleware/role.js defers its own require. The shaping is
  // pure and is unit-tested; only this one function touches the database.
  const { supabaseAdmin } = require('../services/supabase')
  const { fetchAll } = require('./supabaseFetchAll')
  const rows = await fetchAll(
    supabaseAdmin.rpc('analytics_day_one_pending', {
      p_start: start,
      p_end: end,
      p_clubs: clubNumbers,
    })
  )

  // MOST DAY ONES HAVE NO contact_name. The booking widget writes the
  // appointment before anybody types a name onto it: 270 of August's 303 are
  // null. Every one of those carries a ghl_contact_id though, so the name is
  // one lookup away — and a chase list that says "Unnamed member" 270 times
  // cannot do the only job it has.
  //
  // The function does not return the contact id, so it is read back off the
  // table for the rows that need it and nothing else.
  const missing = rows.filter(r => !String(r.contact_name || '').trim())
  if (missing.length === 0) return rows

  const byAppt = new Map()
  const CHUNK = 200
  const ids = [...new Set(missing.map(r => r.id).filter(Boolean))]
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('day_one_appointments')
      .select('id, ghl_contact_id')
      .in('id', ids.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const r of data || []) byAppt.set(r.id, r.ghl_contact_id)
  }

  const contactIds = [...new Set([...byAppt.values()].filter(Boolean))]
  const names = new Map()
  for (let i = 0; i < contactIds.length; i += CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('ghl_contacts_v2')
      .select('id, first_name, last_name')
      .in('id', contactIds.slice(i, i + CHUNK))
    if (error) throw new Error(error.message)
    for (const c of data || []) {
      const full = `${c.first_name || ''} ${c.last_name || ''}`.trim()
      if (full) names.set(c.id, full)
    }
  }

  return rows.map(r => (
    String(r.contact_name || '').trim()
      ? r
      // Left null where neither the appointment nor the contact has a name —
      // a real gap, which the panel still shows as "Unnamed member".
      : { ...r, contact_name: names.get(byAppt.get(r.id)) || r.contact_name }
  ))
}

/** Bucket a list of {name, count} into descending order, ties broken by name. */
function rank(map) {
  return [...map.entries()]
    .map(([key, v]) => ({ key, name: v.name, count: v.count, oldestDays: v.oldestDays }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function bucket(rows, pick) {
  const map = new Map()
  for (const r of rows) {
    const raw = pick(r)
    const key = personKey(raw) || 'unassigned'
    const name = raw ? displayName(raw) : UNASSIGNED
    const cur = map.get(key) || { name, count: 0, oldestDays: 0 }
    cur.count += 1
    cur.oldestDays = Math.max(cur.oldestDays, Number(r.days_overdue) || 0)
    map.set(key, cur)
  }
  return rank(map)
}

/**
 * Every shape the reports ask for, from one list of rows.
 *
 * `oldestDays` is the age of the longest-outstanding one, which is what turns
 * "14 pending" into "and one of them has been sitting for five weeks".
 */
function summarisePending(rows) {
  const list = rows || []
  const byClub = {}
  const byDay = {}
  for (const r of list) {
    if (r.club_number) byClub[r.club_number] = (byClub[r.club_number] || 0) + 1
    if (r.scheduled_date) byDay[r.scheduled_date] = (byDay[r.scheduled_date] || 0) + 1
  }
  return {
    total: list.length,
    oldestDays: list.reduce((m, r) => Math.max(m, Number(r.days_overdue) || 0), 0),
    byClub,
    byDay,
    byTrainer: bucket(list, r => r.trainer_name),
    byBooker: bucket(list, r => r.booked_by_name),
  }
}

/** The rows for one person, matched on trainer_name the way SQL groups them. */
function pendingForTrainer(rows, name) {
  const k = personKey(name)
  if (!k) return []
  return (rows || []).filter(r => personKey(r.trainer_name) === k)
}

/**
 * The chase list: who is outstanding, oldest first, trimmed to `limit`.
 *
 * Contact name is included because "Springfield has 11" is a number and
 * "Springfield has 11, the oldest is Jane Doe from 16 January" is an action.
 */
function pendingList(rows, limit = 50) {
  return (rows || [])
    .slice()
    .sort((a, b) => (Number(b.days_overdue) || 0) - (Number(a.days_overdue) || 0))
    .slice(0, limit)
    .map(r => ({
      id: r.id,
      club: r.location_slug,
      date: r.scheduled_date,
      daysOverdue: Number(r.days_overdue) || 0,
      member: r.contact_name || null,
      trainer: r.trainer_name ? displayName(r.trainer_name) : null,
      bookedBy: r.booked_by_name ? displayName(r.booked_by_name) : null,
    }))
}

module.exports = {
  loadPendingDayOnes, summarisePending, pendingForTrainer, pendingList, UNASSIGNED,
}
