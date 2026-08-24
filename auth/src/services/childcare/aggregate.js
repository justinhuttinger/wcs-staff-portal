// auth/src/services/childcare/aggregate.js
// Pure aggregation for the childcare report. No I/O.
'use strict'

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const BLOCKS = ['morning', 'evening']

// Day of week for a YYYY-MM-DD, read off the calendar date itself (anchored at
// UTC noon) so no timezone can shift a Monday into a Sunday.
function dayOfWeek(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0)).getUTCDay()
}

const sum = (ns) => ns.reduce((a, b) => a + b, 0)
const round1 = (n) => Math.round(n * 10) / 10

// Average over the occurrences that actually reported a number. A block with
// no submission is UNKNOWN and is excluded, never averaged in as a zero.
function stats(values) {
  const known = values.filter((v) => typeof v === 'number')
  if (known.length === 0) return { avg: null, peak: null, total: 0, occurrences: 0 }
  return {
    avg: round1(sum(known) / known.length),
    peak: Math.max(...known),
    total: sum(known),
    occurrences: known.length,
  }
}

// The ledger: one row per club per day, both blocks side by side.
// Days where nothing was submitted never appear — no empty rows.
function buildLedger(entries) {
  const byDay = new Map()
  for (const e of entries) {
    const key = `${e.date}|${e.location_slug}`
    if (!byDay.has(key)) {
      byDay.set(key, {
        date: e.date,
        location_slug: e.location_slug,
        day_of_week: DOW[dayOfWeek(e.date)],
        morning: null,
        evening: null,
        corrections: 0,
      })
    }
    const row = byDay.get(key)
    row[e.block] = {
      over1: e.over1,
      under1: e.under1,
      total: (e.over1 || 0) + (e.under1 || 0),
      submitted_by: e.submitted_by,
      submissions: e.submissions,
    }
    if (e.submissions > 1) row.corrections += e.submissions - 1
  }

  return [...byDay.values()]
    .map((r) => ({
      ...r,
      day_total: (r.morning ? r.morning.total : 0) + (r.evening ? r.evening.total : 0),
    }))
    .sort((a, b) => b.date.localeCompare(a.date)
      || a.location_slug.localeCompare(b.location_slug))
}

// The staffing view: day of week x block, with the average as the headline and
// the occurrence count so a 3-sample average is never mistaken for a 30-sample
// one. Combinations that never happened are omitted.
function buildDayOfWeek(entries) {
  const buckets = new Map()
  for (const e of entries) {
    const key = `${dayOfWeek(e.date)}|${e.block}`
    if (!buckets.has(key)) buckets.set(key, { over1: [], under1: [], totals: [], dates: new Set() })
    const b = buckets.get(key)
    b.over1.push(e.over1)
    b.under1.push(e.under1)
    if (typeof e.over1 === 'number' || typeof e.under1 === 'number') {
      b.totals.push((e.over1 || 0) + (e.under1 || 0))
    }
    b.dates.add(e.date)
  }

  const rows = []
  for (let dow = 0; dow < 7; dow++) {
    for (const block of BLOCKS) {
      const b = buckets.get(`${dow}|${block}`)
      if (!b) continue
      rows.push({
        day_of_week: DOW[dow],
        dow,
        block,
        over1: stats(b.over1),
        under1: stats(b.under1),
        combined: stats(b.totals),
        days_sampled: b.dates.size,
      })
    }
  }
  // Monday first: this is a planning table, not a calendar.
  return rows.sort((a, b) => ((a.dow + 6) % 7) - ((b.dow + 6) % 7)
    || BLOCKS.indexOf(a.block) - BLOCKS.indexOf(b.block))
}

// Daily totals across the range, oldest first, for the trend line.
function buildTrend(entries) {
  const byDate = new Map()
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, { date: e.date, over1: 0, under1: 0, total: 0 })
    const d = byDate.get(e.date)
    d.over1 += e.over1 || 0
    d.under1 += e.under1 || 0
    d.total = d.over1 + d.under1
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function buildTotals(entries) {
  const over1 = stats(entries.map((e) => e.over1))
  const under1 = stats(entries.map((e) => e.under1))
  return {
    over1,
    under1,
    blocks_reported: entries.length,
    days_reported: new Set(entries.map((e) => e.date)).size,
    corrections: entries.reduce((a, e) => a + Math.max(0, e.submissions - 1), 0),
  }
}

module.exports = { buildLedger, buildDayOfWeek, buildTrend, buildTotals, dayOfWeek, stats, DOW }
