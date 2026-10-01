// Per-member check-ins per Pacific DAY -> abc_member_checkin_days (migration
// 225). Feeds the "X visits in Y days" check-in celebration rules, which the
// monthly table (abc_member_checkin_months) is too coarse for.
//
// One ABC /members/checkins/summaries request per club per day, with a
// one-day checkInTimestampRange. That range is CLUB LOCAL (Pacific) time, not
// UTC (see checkinsReport.js), so plain "YYYY-MM-DD 00:00:00" strings for the
// Pacific day are exactly right.
//
// Nightly: refreshCheckinDays({ days: 4 }) re-fetches the last 3 days plus
// today so far (catching late posts), then pruneCheckinDays. One-time 365-day
// backfill: scripts/backfill-checkin-days.js.
const axios = require('axios')

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const PAGE_SIZE = 5000
const MAX_PAGES = 50
const PAUSE_MS = 300
const UPSERT_BATCH = 1000
const TABLE = 'abc_member_checkin_days'

// Lazy default client (db/supabase.js connects at import time).
let _db = null
function getDefaultDb() {
  if (!_db) _db = require('../db/supabase')
  return _db
}

function pacificDay(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date)
}

function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Today (Pacific) and the n-1 days before it, oldest first.
function pacificDaysBack(n, now = new Date()) {
  const today = pacificDay(now)
  return Array.from({ length: n }, (_, i) => addDays(today, i - (n - 1)))
}

function defaultGet(url, opts) {
  return axios.get(url, {
    ...opts,
    headers: { app_id: process.env.ABC_APP_ID, app_key: process.env.ABC_APP_KEY, Accept: 'application/json' },
    timeout: 120000,
  })
}

// memberId -> check-ins on that day at that club.
async function fetchDay(clubNumber, day, { get = defaultGet, sleepFn = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const counts = new Map()
  let page = 1
  while (page <= MAX_PAGES) {
    const res = await get(`${ABC_BASE_URL}/${clubNumber}/members/checkins/summaries`, {
      params: { checkInTimestampRange: `${day} 00:00:00,${day} 23:59:59`, size: PAGE_SIZE, page },
    })
    const status = (res.data && res.data.status) || {}
    const members = (res.data && res.data.members) || []
    // ABC refuses with 200 + an empty list; only "no records" is a real zero
    // (same rule as backfill-member-checkin-months.js).
    if (members.length === 0) {
      const msg = String(status.message || '').trim()
      if (!(msg === '' || /^success$/i.test(msg) || /no records found/i.test(msg))) {
        throw new Error(`ABC rejected ${clubNumber} ${day}: ${msg}`)
      }
      break
    }
    for (const m of members) {
      let n = 0
      for (const c of (m.checkInCounts && m.checkInCounts.checkInCount) || []) {
        const v = parseInt(c.count, 10)
        if (!Number.isNaN(v)) n += v
      }
      if (n > 0) counts.set(m.memberId, (counts.get(m.memberId) || 0) + n)
    }
    const next = parseInt(status.nextPage, 10)
    if (!next || next === page) break
    page = next
    await sleepFn(PAUSE_MS)
  }
  return counts
}

async function refreshCheckinDays(options = {}) {
  const {
    days = 4,
    dates = null, // explicit list of YYYY-MM-DD (backfill); overrides `days`
    clubs = require('../config/clubs.json').clubs.filter(c => c.active).map(c => c.clubNumber),
    db = getDefaultDb(),
    get = defaultGet,
    sleepFn = ms => new Promise(r => setTimeout(r, ms)),
    now = new Date(),
    log = () => {},
  } = options
  const list = dates || pacificDaysBack(days, now)
  const summary = { days: list.length, rows: 0, visits: 0, failed: [] }
  for (const club of clubs) {
    for (const day of list) {
      try {
        const counts = await fetchDay(club, day, { get, sleepFn })
        const fetched_at = new Date().toISOString()
        const rows = [...counts].map(([member_id, checkins]) => ({ club_number: club, member_id, day, checkins, fetched_at }))
        for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
          const { error } = await db.from(TABLE).upsert(rows.slice(i, i + UPSERT_BATCH), { onConflict: 'club_number,member_id,day' })
          if (error) throw new Error(`upsert: ${error.message}`)
        }
        summary.rows += rows.length
        summary.visits += rows.reduce((a, r) => a + r.checkins, 0)
        log(`  ${club} ${day}: ${rows.length} members`)
      } catch (err) {
        summary.failed.push({ club, day, error: err.message })
        console.error(`[CheckinDays] ${club} ${day}: ${err.message}`)
      }
      await sleepFn(PAUSE_MS)
    }
  }
  return summary
}

async function pruneCheckinDays({ db = getDefaultDb(), keepDays = 400, now = new Date() } = {}) {
  const cutoff = addDays(pacificDay(now), -keepDays)
  const { error } = await db.from(TABLE).delete().lt('day', cutoff)
  if (error) throw new Error(`prune: ${error.message}`)
  return cutoff
}

module.exports = { pacificDay, pacificDaysBack, addDays, fetchDay, refreshCheckinDays, pruneCheckinDays }
