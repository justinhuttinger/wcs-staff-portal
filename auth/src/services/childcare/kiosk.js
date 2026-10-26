// Childcare Kiosk report: what the childcare iPad recorded (childcare_visits,
// migrations 244/245), as opposed to the Operandio checklist headcounts the
// rest of this folder reports on.
//
// One row is one child's visit, typed by the desk. Nothing links visits to a
// member or to each other, so "families" below are grouped by the parent name
// + phone exactly as typed; a typo makes two families. That is the honest
// reading of data that was deliberately never linked.
//
// A VISIT NOBODY CHECKED OUT HAS NO END. It was closed by the end-of-day sweep
// (auto_closed), so its length is unknown. It is left out of every stay and
// every hourly count rather than guessed, and counted on its own instead.

const { supabaseAdmin } = require('../supabase')
const { CLUB_BY_SLUG, CLUB_BY_NUMBER } = require('../../config/clubs')

const TZ = 'America/Los_Angeles'
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const PAGE = 1000

const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour12: false,
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long',
})

// Club-local calendar date, weekday and fractional hour of an instant.
function local(iso) {
  const p = {}
  for (const { type, value } of PARTS.formatToParts(new Date(iso))) p[type] = value
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    dow: p.weekday,
    hour: (Number(p.hour) % 24) + Number(p.minute) / 60,
  }
}

const round1 = n => Math.round(n * 10) / 10
const median = xs => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function stayMinutes(v) {
  if (!v.checked_out_at || v.auto_closed) return null
  return Math.max(0, Math.round((new Date(v.checked_out_at) - new Date(v.checked_in_at)) / 60000))
}

/**
 * Pure: visits -> report. `visits` are rows already limited to the requested
 * clubs and Pacific date range. `now` lets a visit still in the room today
 * count toward the hours it has been there.
 */
function aggregate(visits, { now = new Date() } = {}) {
  const totals = {
    visits: visits.length,
    monthly: 0,
    drop_in: 0,
    under1: 0,
    not_checked_out: 0,
    still_in_room: 0,
    pickup: { same_parent: 0, approved_alternate: 0, other: 0 },
    avg_stay_min: null,
    median_stay_min: null,
    days: 0,
  }
  const stays = []
  const clubs = new Map()
  const families = new Map()
  // occupancy[club|date][hour] = children present at some point in that hour
  const clubDays = new Map()

  for (const v of visits) {
    totals[v.membership_kind === 'monthly' ? 'monthly' : 'drop_in']++
    if (v.child_age_months < 12) totals.under1++
    if (v.auto_closed) totals.not_checked_out++
    else if (!v.checked_out_at) totals.still_in_room++
    if (v.checked_out_by && totals.pickup[v.checked_out_by] !== undefined) totals.pickup[v.checked_out_by]++

    const stay = stayMinutes(v)
    if (stay !== null) stays.push(stay)

    const start = local(v.checked_in_at)
    const club = clubs.get(v.club_number) || {
      club_number: v.club_number,
      name: CLUB_BY_NUMBER[v.club_number]?.name || v.club_number,
      visits: 0, monthly: 0, drop_in: 0, under1: 0, other_pickups: 0, not_checked_out: 0, stays: [], dates: new Set(),
    }
    club.visits++
    club[v.membership_kind === 'monthly' ? 'monthly' : 'drop_in']++
    if (v.child_age_months < 12) club.under1++
    if (v.checked_out_by === 'other') club.other_pickups++
    if (v.auto_closed) club.not_checked_out++
    if (stay !== null) club.stays.push(stay)
    club.dates.add(start.date)
    clubs.set(v.club_number, club)

    // Hourly presence. An auto-closed visit has no end, so it is skipped.
    const key = `${v.club_number}|${start.date}`
    const day = clubDays.get(key) || { dow: start.dow, hours: new Map() }
    clubDays.set(key, day)
    if (!v.auto_closed) {
      const endIso = v.checked_out_at || now.toISOString()
      const end = local(endIso)
      // Same-day only; the sweep closes anything that crosses midnight.
      const endHour = end.date === start.date ? end.hour : 24
      for (let h = Math.floor(start.hour); h < Math.max(Math.ceil(endHour), Math.floor(start.hour) + 1); h++) {
        day.hours.set(h, (day.hours.get(h) || 0) + 1)
      }
    }

    if (v.membership_kind === 'drop_in') {
      const fkey = `${v.club_number}|${String(v.parent_first_name).toLowerCase()} ${String(v.parent_last_name).toLowerCase()}|${v.parent_phone}`
      const f = families.get(fkey) || {
        club_number: v.club_number,
        club: club.name,
        parent: `${v.parent_first_name} ${v.parent_last_name}`,
        phone: v.parent_phone,
        visits: 0,
        dates: new Set(),
        children: new Set(),
        last_visit: v.checked_in_at,
      }
      f.visits++
      f.dates.add(start.date)
      f.children.add(`${v.child_first_name} ${v.child_last_name}`)
      if (v.checked_in_at > f.last_visit) f.last_visit = v.checked_in_at
      families.set(fkey, f)
    }
  }

  if (stays.length) {
    totals.avg_stay_min = Math.round(stays.reduce((a, b) => a + b, 0) / stays.length)
    totals.median_stay_min = Math.round(median(stays))
  }
  totals.days = new Set([...clubDays.keys()].map(k => k.split('|')[1])).size

  // Average children in the room per weekday x hour, over the club-days the
  // kiosk was actually used on that weekday. A day nobody checked in is
  // unknown (kiosk unused or room closed), not an empty room.
  const daysPerDow = new Map()
  const sums = new Map()
  const peaks = new Map()
  for (const d of clubDays.values()) {
    daysPerDow.set(d.dow, (daysPerDow.get(d.dow) || 0) + 1)
    for (const [h, n] of d.hours) {
      const k = `${d.dow}|${h}`
      sums.set(k, (sums.get(k) || 0) + n)
      peaks.set(k, Math.max(peaks.get(k) || 0, n))
    }
  }
  const hourSet = new Set()
  for (const k of sums.keys()) hourSet.add(Number(k.split('|')[1]))
  // Every hour from the first to the last, so a quiet midday shows as quiet
  // instead of the columns either side closing up around it.
  const hours = []
  if (hourSet.size) for (let h = Math.min(...hourSet); h <= Math.max(...hourSet); h++) hours.push(h)
  const hourly = DOW.slice(1).concat(DOW[0])
    .filter(d => daysPerDow.has(d))
    .map(d => ({
      day_of_week: d,
      days: daysPerDow.get(d),
      hours: hours.map(h => {
        const k = `${d}|${h}`
        return { hour: h, avg: sums.has(k) ? round1(sums.get(k) / daysPerDow.get(d)) : 0, peak: peaks.get(k) || 0 }
      }),
    }))

  const byClub = [...clubs.values()]
    .map(c => ({
      club_number: c.club_number,
      name: c.name,
      visits: c.visits,
      monthly: c.monthly,
      drop_in: c.drop_in,
      under1: c.under1,
      days: c.dates.size,
      avg_per_day: round1(c.visits / c.dates.size),
      avg_stay_min: c.stays.length ? Math.round(c.stays.reduce((a, b) => a + b, 0) / c.stays.length) : null,
      other_pickups: c.other_pickups,
      not_checked_out: c.not_checked_out,
    }))
    .sort((a, b) => b.visits - a.visits)

  const dropInFamilies = [...families.values()]
    .map(f => ({
      club: f.club,
      parent: f.parent,
      phone: f.phone,
      visits: f.visits,
      days: f.dates.size,
      children: [...f.children].sort(),
      last_visit: f.last_visit,
    }))
    .sort((a, b) => b.days - a.days || b.visits - a.visits)

  const log = [...visits]
    .sort((a, b) => String(b.checked_in_at).localeCompare(String(a.checked_in_at)))
    .map(v => ({
      id: v.id,
      club: CLUB_BY_NUMBER[v.club_number]?.name || v.club_number,
      child: `${v.child_first_name} ${v.child_last_name}`,
      child_age_months: v.child_age_months,
      parent: `${v.parent_first_name} ${v.parent_last_name}`,
      membership_kind: v.membership_kind,
      checked_in_at: v.checked_in_at,
      checked_out_at: v.checked_out_at,
      stay_min: stayMinutes(v),
      auto_closed: v.auto_closed,
      checked_out_by: v.checked_out_by,
      picked_up_by: v.checked_out_by_first_name ? `${v.checked_out_by_first_name} ${v.checked_out_by_last_name}` : null,
    }))

  return { totals, hourly, by_club: byClub, drop_in_families: dropInFamilies, log }
}

const COLS = 'id, club_number, child_first_name, child_last_name, child_age_months, ' +
  'parent_first_name, parent_last_name, parent_phone, membership_kind, checked_in_at, checked_out_at, ' +
  'checked_out_by, checked_out_by_first_name, checked_out_by_last_name, auto_closed'

// YYYY-MM-DD +/- n days, calendar arithmetic.
function shift(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * start/end are Pacific dates; slugs null = every club. The query window is
 * padded a day each side in UTC and then cut to exact Pacific dates in JS, so
 * no DST arithmetic is needed to get the boundary right.
 */
async function loadKioskReport({ start, end, slugs = null, now = new Date() }) {
  let clubNumbers = null
  if (slugs) {
    clubNumbers = slugs.map(s => CLUB_BY_SLUG[s]?.clubNumber).filter(Boolean)
    if (!clubNumbers.length) return aggregate([], { now })
  }

  const rows = []
  for (let from = 0; ; from += PAGE) {
    let q = supabaseAdmin
      .from('childcare_visits')
      .select(COLS)
      .gte('checked_in_at', `${shift(start, -1)}T00:00:00Z`)
      .lt('checked_in_at', `${shift(end, 2)}T00:00:00Z`)
      .order('checked_in_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (clubNumbers) q = q.in('club_number', clubNumbers)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    rows.push(...(data || []))
    if (!data || data.length < PAGE) break
  }

  const inRange = rows.filter(v => {
    const d = local(v.checked_in_at).date
    return d >= start && d <= end
  })
  return aggregate(inRange, { now })
}

module.exports = { aggregate, loadKioskReport, local }
