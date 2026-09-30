// Nightly check-in milestone alerts.
//
// A member one visit short of a milestone (checkinMilestones.js) gets a
// show-once ABC alert, "CELEBRATE 10TH VISIT!", which ABC shows on the check-in
// card of their next visit: the milestone one. WCS ABC spots that text on the
// card and plays the party cue (launcher abc-scraper.js).
//
// Runs after the nightly check-in months refresh (scheduler.js) so counts are
// current. ABC alerts can't be listed or deleted through the API, so every
// alert posted is logged in checkin_milestone_alerts (migration 219) and never
// posted twice, even if the member doesn't come back for weeks.
//
// Dependency-injectable (db, postAlert, sleepFn) so tests run offline.
const axios = require('axios')
const { planAlert } = require('./checkinMilestones')
const { loadExcludedTypes } = require('./lapsedConfig')

// Lazy default client: db/supabase.js connects at import time (see
// lapsedTaggingJob.js), and tests inject their own.
let _defaultDb = null
function getDefaultDb() {
  if (!_defaultDb) _defaultDb = require('../db/supabase')
  return _defaultDb
}

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest'
const PAGE = 1000
// Never Purple: purple is staff-typed alerts, which get WCS ABC's blocking
// initials box. Blue only if ABC refuses Green.
const COLORS = ['Green', 'Blue']

// ABC answers 200 with field-validation failures in the BODY (same rule as
// prospects services/waiver/abc.js), so a 200 alone is not success.
function abcOk(data) {
  const status = (data && data.status) || {}
  const message = String(status.message || '').toLowerCase()
  if (message && message !== 'success') return false
  if (status.count !== undefined && String(status.count) === '0') return false
  return true
}

async function postAbcAlert(clubNumber, memberId, payload) {
  try {
    const res = await axios.post(`${ABC_BASE_URL}/${clubNumber}/members/alerts/${memberId}`, payload, {
      headers: {
        app_id: process.env.ABC_APP_ID,
        app_key: process.env.ABC_APP_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      timeout: 20000,
    })
    if (abcOk(res.data)) return { ok: true, data: res.data }
    return { ok: false, data: res.data, error: ((res.data && res.data.status) || {}).message || 'ABC reported a failure' }
  } catch (err) {
    return { ok: false, error: (err.response && err.response.data) || err.message }
  }
}

// PostgREST caps responses at 1000 rows; page until a short page.
async function pageAll(makeQuery, label) {
  const rows = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery().range(from, from + PAGE - 1)
    if (error) throw new Error(`[Milestones] ${label}: ${error.message}`)
    if (!data || !data.length) break
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

async function runCheckinMilestonesForClub(clubNumber, options = {}) {
  const {
    dryRun = true,
    db = getDefaultDb(),
    postAlert = postAbcAlert,
    sleepFn = ms => new Promise(r => setTimeout(r, ms)),
  } = options
  const summary = { club: clubNumber, backfillStart: null, members: 0, candidates: 0, alreadySent: 0, posted: 0, failed: 0, planned: [] }

  // The club's first month of check-in history. Members who joined before it
  // have visits we never counted, so they're left out (isEligible).
  const { data: first, error: firstErr } = await db.from('abc_member_checkin_months')
    .select('month').eq('club_number', clubNumber).order('month', { ascending: true }).limit(1)
  if (firstErr) throw new Error(`[Milestones] ${clubNumber}: backfill start: ${firstErr.message}`)
  summary.backfillStart = first && first[0] ? String(first[0].month).slice(0, 10) : null
  if (!summary.backfillStart) return summary

  const excludedTypes = await loadExcludedTypes(db)
  const members = await pageAll(() => db.from('abc_members')
    .select('member_id, first_name, last_name, is_active, member_status, membership_type, sign_date, begin_date, since_date')
    .eq('club_number', clubNumber).eq('is_active', true).eq('member_status', 'Active')
    .order('member_id'), `${clubNumber} members`)
  summary.members = members.length
  const totals = await pageAll(() => db.rpc('checkin_milestone_totals', { p_club: clubNumber }), `${clubNumber} totals`)
  const visitsById = new Map(totals.map(t => [t.member_id, Number(t.visits)]))

  const candidates = []
  for (const member of members) {
    const visits = visitsById.get(member.member_id) || 0
    const plan = planAlert({ member, visits, excludedTypes, backfillStart: summary.backfillStart })
    if (plan) candidates.push({ member, visits, ...plan })
  }
  summary.candidates = candidates.length
  if (!candidates.length) return summary

  const sent = new Set()
  const ids = candidates.map(c => c.member.member_id)
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from('checkin_milestone_alerts')
      .select('member_id, milestone').eq('club_number', clubNumber).in('member_id', ids.slice(i, i + 200))
    if (error) throw new Error(`[Milestones] ${clubNumber}: sent lookup: ${error.message}`)
    for (const r of data || []) sent.add(`${r.member_id}:${r.milestone}`)
  }

  for (const c of candidates) {
    const id = c.member.member_id
    if (sent.has(`${id}:${c.milestone}`)) { summary.alreadySent++; continue }
    const name = `${c.member.first_name || ''} ${c.member.last_name || ''}`.trim()
    summary.planned.push({ member_id: id, name, visits: c.visits, milestone: c.milestone, text: c.text })
    if (dryRun) continue

    let result = null
    let color = null
    for (const col of COLORS) {
      result = await postAlert(clubNumber, id, { clubNumber, text: c.text, color: col, showOneTime: 'true', acknowledge: 'false' })
      if (result.ok) { color = col; break }
    }
    if (!color) {
      // Nothing logged, so tomorrow's run tries again.
      summary.failed++
      console.error(`[Milestones] ${clubNumber}: alert failed for ${id}: ${JSON.stringify(result.error)}`)
    } else {
      summary.posted++
      const { error } = await db.from('checkin_milestone_alerts').insert({
        club_number: clubNumber, member_id: id, milestone: c.milestone, visits: c.visits,
        alert_text: c.text, color, abc_response: result.data || null,
      })
      if (error) console.error(`[Milestones] ${clubNumber}: log insert failed for ${id}: ${error.message}`)
    }
    await sleepFn(250)
  }
  return summary
}

async function runCheckinMilestonesAll({ dryRun = true } = {}) {
  const clubs = require('../config/clubs.json').clubs.filter(c => c.active).map(c => c.clubNumber)
  const out = []
  for (const club of clubs) {
    try {
      const s = await runCheckinMilestonesForClub(club, { dryRun })
      console.log(`[Milestones] ${club}${dryRun ? ' (dry run)' : ''}: ${s.candidates} candidates, ${s.alreadySent} already sent, ${s.posted} posted, ${s.failed} failed`)
      for (const p of s.planned) console.log(`[Milestones]   ${club} ${p.name} (${p.member_id}) ${p.visits} visits -> ${p.text}`)
      out.push(s)
    } catch (err) {
      console.error(`[Milestones] ${club}: run failed: ${err.message}`)
      out.push({ club, error: err.message })
    }
  }
  return out
}

module.exports = { runCheckinMilestonesForClub, runCheckinMilestonesAll, postAbcAlert, abcOk }
