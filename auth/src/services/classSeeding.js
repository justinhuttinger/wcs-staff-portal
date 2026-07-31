// Class seeding: enrols house accounts into otherwise-empty Group X classes.
//
// WCS classes are free and well attended, but almost nobody books through the
// ABC app, so a class with 20 people in the room reads as 0 booked online. This
// puts a few house accounts into classes nobody has booked, so the app does not
// say "nobody goes to this".
//
// Rules that matter:
//   * Only classes with ZERO bookings. Never stack on top of a real member.
//   * Only future classes inside ABC's 14-day booking horizon.
//   * Every attempt is logged, so it is auditable and reversible.
const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { CLUBS } = require('../lib/groupXClubs')
const { parseAbcTs, padDate, toIsoDate } = require('../lib/abcTime')
const {
  SEED_WINDOW_DAYS, pickCount, pickAccounts, offsetForEvent, selectClassesToSeed,
} = require('../lib/classSeedPlan')

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const ABC_OK_CODE = 'API-CAL-EVT-0000'

function abcHeaders() {
  const appId = process.env.ABC_APP_ID
  const appKey = process.env.ABC_APP_KEY
  if (!appId || !appKey) throw new Error('ABC_APP_ID and ABC_APP_KEY must be set')
  // Accept JSON explicitly: this endpoint answers in XML by default.
  return { app_id: appId, app_key: appKey, Accept: 'application/json' }
}

// Classes in a window, each with how many members are currently booked.
// listClasses in abcGroupX drops the members array, and the count is the whole
// question here, so this reads the raw payload.
async function listClassesWithCounts(clubNumber, startDate, endDate) {
  const params = new URLSearchParams({
    eventDateRange: `${padDate(startDate, -1)},${padDate(endDate, 1)}`,
    size: '500',
  })
  const res = await fetch(`${ABC_BASE_URL}/${clubNumber}/calendars/events?${params}`, {
    headers: abcHeaders(),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`ABC API HTTP ${res.status} listing classes`)
  const body = await res.json()
  const code = body?.status?.messageCode
  if (code && code !== ABC_OK_CODE) {
    throw new Error(`ABC ${code}: ${(body.status.message || '').trim()}`)
  }

  return (body?.events || [])
    .filter(e => String(e.category || '').toLowerCase() === 'class')
    .map(e => {
      const ts = parseAbcTs(e.eventTimestamp)
      const name = [e.employeeFirstName, e.employeeLastName].filter(Boolean).join(' ').trim()
      return {
        event_id: e.eventId,
        class_name: e.eventName || null,
        event_timestamp: ts.utc,
        event_timestamp_local: ts.local,
        status: e.status || null,
        member_count: (e.members || []).length,
        max_attendees: e.maxAttendees ? parseInt(e.maxAttendees, 10) : null,
        unbooked: /^unbooked\b/i.test(name),
      }
    })
    .filter(e => {
      const day = (e.event_timestamp_local || '').slice(0, 10)
      return day >= startDate && day <= endDate
    })
}

// POST /{club}/calendars/events/{eventId}/members/{memberId}, no body.
// Confirmed against the live API: success is messageCode API-CAL-EVT-0000.
async function enrollMember(clubNumber, eventId, memberId) {
  const path = `/${clubNumber}/calendars/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(memberId)}`
  const res = await fetch(ABC_BASE_URL + path, {
    method: 'POST',
    headers: abcHeaders(),
    signal: AbortSignal.timeout(30000),
  })
  let data = null
  try { data = await res.json() } catch { /* XML or empty body */ }

  if (!res.ok) {
    return { ok: false, error: data?.status?.message || `HTTP ${res.status}` }
  }
  // ABC reports failures inside a 200, same as everywhere else in this API.
  const code = data?.status?.messageCode
  if (code && code !== ABC_OK_CODE) {
    return { ok: false, error: `${code}: ${(data.status.message || '').trim()}` }
  }
  return { ok: true, error: null }
}

async function unenrollMember(clubNumber, eventId, memberId) {
  const path = `/${clubNumber}/calendars/events/${encodeURIComponent(eventId)}/members/${encodeURIComponent(memberId)}`
  const res = await fetch(ABC_BASE_URL + path, {
    method: 'DELETE',
    headers: abcHeaders(),
    signal: AbortSignal.timeout(30000),
  })
  let data = null
  try { data = await res.json() } catch { /* empty body is fine */ }
  if (!res.ok) return { ok: false, error: data?.status?.message || `HTTP ${res.status}` }
  return { ok: true, error: null }
}

async function loadConfig() {
  const [accountsRes, settingsRes] = await Promise.all([
    supabaseAdmin.from('class_seed_accounts').select('*').eq('active', true),
    supabaseAdmin.from('class_seed_settings').select('*'),
  ])
  if (accountsRes.error) throw new Error(accountsRes.error.message)
  if (settingsRes.error) throw new Error(settingsRes.error.message)
  return { accounts: accountsRes.data || [], settings: settingsRes.data || [] }
}

// Runs one club. Returns a summary rather than throwing, so one bad club does
// not take down the nightly pass for the other six.
async function runClub(club, accounts, setting, opts) {
  const dryRun = !!(opts && opts.dryRun)
  const summary = {
    club: club.name, club_number: club.clubNumber,
    considered: 0, seeded_classes: 0, enrolled: 0, failed: 0, skipped_already: 0, error: null,
  }
  if (!setting || !setting.enabled) { summary.error = 'disabled'; return summary }
  if (accounts.length === 0) { summary.error = 'no house accounts configured'; return summary }

  try {
    const today = toIsoDate(new Date())
    const horizonDate = padDate(today, SEED_WINDOW_DAYS)
    const classes = await listClassesWithCounts(club.clubNumber, today, horizonDate)

    const targets = selectClassesToSeed(classes, {
      nowIso: new Date().toISOString(),
      horizonIso: new Date(horizonDate + 'T23:59:59Z').toISOString(),
    })
    summary.considered = targets.length

    // Anything already logged as enrolled is skipped, so a re-run is a no-op
    // rather than piling more accounts into the same class.
    const { data: prior } = await supabaseAdmin
      .from('class_seed_log')
      .select('abc_event_id, member_id')
      .eq('club_number', club.clubNumber)
      .eq('ok', true)
      .in('abc_event_id', targets.map(t => t.event_id).slice(0, 500))
    const already = new Set((prior || []).map(r => `${r.abc_event_id}:${r.member_id}`))

    for (const cls of targets) {
      const count = pickCount(setting.min_count, setting.max_count, opts && opts.rand)
      const chosen = pickAccounts(accounts, count, offsetForEvent(cls.event_id))
      if (chosen.length === 0) continue

      let seededHere = 0
      for (const acct of chosen) {
        if (already.has(`${cls.event_id}:${acct.member_id}`)) { summary.skipped_already++; continue }
        if (dryRun) { seededHere++; summary.enrolled++; continue }

        const r = await enrollMember(club.clubNumber, cls.event_id, acct.member_id)
        await supabaseAdmin.from('class_seed_log').insert({
          club_number: club.clubNumber,
          abc_event_id: cls.event_id,
          member_id: acct.member_id,
          class_name: cls.class_name,
          event_local: cls.event_timestamp_local,
          ok: r.ok,
          error: r.error,
        })
        if (r.ok) { seededHere++; summary.enrolled++ } else { summary.failed++ }
      }
      if (seededHere > 0) summary.seeded_classes++
    }
  } catch (err) {
    summary.error = err.message
  }
  return summary
}

async function runAll(opts) {
  const { accounts, settings } = await loadConfig()
  const byClub = new Map(settings.map(s => [s.club_number, s]))
  const results = []
  for (const club of CLUBS) {
    results.push(await runClub(club, accounts, byClub.get(club.clubNumber), opts))
  }
  return results
}

function start() {
  if (process.env.CLASS_SEEDING_DISABLED === '1') {
    console.log('[classSeeding] disabled via CLASS_SEEDING_DISABLED=1')
    return
  }
  // Nightly at 2:40am Pacific (09:40 UTC), after the ABC syncs have run and
  // well clear of gym hours.
  cron.schedule('40 9 * * *', () => {
    runAll().then(
      rs => console.log('[classSeeding] nightly run:', JSON.stringify(rs)),
      e => console.error('[classSeeding] nightly run failed:', e.message),
    )
  })
  console.log('[classSeeding] scheduled — nightly 2:40am PT')
}

module.exports = {
  start, runAll, runClub, loadConfig,
  listClassesWithCounts, enrollMember, unenrollMember,
}
