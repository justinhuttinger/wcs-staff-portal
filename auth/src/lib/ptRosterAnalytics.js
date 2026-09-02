// ---------------------------------------------------------------------------
// PT Roster and Session Frequency — pure shaping, no I/O.
//
// Both are the old Reporting view's reports rebuilt for Analytics, and both
// read SYNCED tables rather than the live ABC API the originals called.
//
// WHY THAT CHANGE. The old roster fetched every recurring service from ABC per
// club and then a plan detail per plan, which is why it needed a six-hour cache
// and a warmer to stay usable at all. abc_pt_services carries the same rows,
// already synced, so this version is fast, drills down, and can sit beside the
// other Analytics reports without a special case.
//
// WHAT IS LOST BY THAT CHANGE, stated rather than hidden: the live API returned
// a plan detail carrying the "1XWEEK"/"3XWEEK" suffix. The synced table has
// `frequency` (Weekly, Bi-Weekly, Monthly, BI-Monthly) which is the billing
// cadence, not sessions per week. So the roster reports billing frequency and
// says so, and SESSIONS PER WEEK comes from the calendar instead, which is what
// actually happened rather than what was sold.
// ---------------------------------------------------------------------------

const PAID_IN_FULL = /paid in full/i

function num(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function round2(v) {
  return Math.round(num(v) * 100) / 100
}

function round1(v) {
  return Math.round(num(v) * 10) / 10
}

function isPaidInFull(service) {
  return PAID_IN_FULL.test(service?.recurring_type_desc || '')
}

/** Descending by count, ties broken by name so the order never wobbles. */
function rankRows(rows) {
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

// ---------------------------------------------------------------------------
// PT Roster — who is on the books right now.
// ---------------------------------------------------------------------------

/**
 * @param recurring active recurring services (status active, not paid in full)
 * @param pif       paid-in-full services sold inside the lookback window
 */
function buildPtRoster(recurring, pif, opts = {}) {
  const rec = recurring || []
  const paid = pif || []

  // One row per MEMBER, not per service: somebody on two recurring services is
  // one client with two lines, and counting them twice would inflate the roster
  // against every other client count in Analytics.
  const byMember = new Map()
  const add = (s, type) => {
    const key = `${s.club_number}|${s.member_id}`
    const cur = byMember.get(key) || {
      member: s.member_name || 'Unnamed member',
      clubNumber: s.club_number,
      trainer: s.trainer_name || 'Unassigned',
      type,
      services: 0,
      monthly: 0,
      paidUpFront: 0,
      frequency: s.frequency || null,
      lastSold: null,
      frozen: false,
    }
    cur.services += 1
    if (type === 'recurring') cur.monthly += num(s.invoice_total)
    else cur.paidUpFront += num(s.invoice_total)
    // A member on both counts as recurring: they have an ongoing commitment,
    // which is the thing the roster is for.
    if (type === 'recurring') cur.type = 'recurring'
    if (String(s.sub_status || '').toLowerCase() === 'frozen') cur.frozen = true
    const sold = s.sale_date ? String(s.sale_date).slice(0, 10) : null
    if (sold && (!cur.lastSold || sold > cur.lastSold)) cur.lastSold = sold
    byMember.set(key, cur)
  }
  for (const s of rec) add(s, 'recurring')
  for (const s of paid) add(s, 'pif')

  const clients = [...byMember.values()].map(c => ({
    ...c,
    monthly: round2(c.monthly),
    paidUpFront: round2(c.paidUpFront),
  }))

  const recurringClients = clients.filter(c => c.type === 'recurring')
  const pifClients = clients.filter(c => c.type === 'pif')
  const monthlyRevenue = round2(recurringClients.reduce((s, c) => s + c.monthly, 0))
  const frozen = clients.filter(c => c.frozen).length

  const byTrainer = new Map()
  for (const c of clients) {
    const cur = byTrainer.get(c.trainer) || { label: c.trainer, count: 0, value: 0 }
    cur.count += 1
    cur.value = round2(cur.value + c.monthly)
    byTrainer.set(c.trainer, cur)
  }

  const byFrequency = new Map()
  for (const c of recurringClients) {
    const label = c.frequency || 'Unknown'
    const cur = byFrequency.get(label) || { label, count: 0 }
    cur.count += 1
    byFrequency.set(label, cur)
  }

  return {
    hasActivity: clients.length > 0,
    stats: [
      { key: 'clients', label: 'PT Clients', format: 'int', value: clients.length, betterWhen: 'up' },
      { key: 'recurring', label: 'On Recurring', format: 'int', value: recurringClients.length, betterWhen: 'up' },
      { key: 'pif', label: 'Paid in Full', format: 'int', value: pifClients.length, betterWhen: 'up' },
      { key: 'frozen', label: 'Frozen', format: 'int', value: frozen, betterWhen: 'down' },
      { key: 'monthlyRevenue', label: 'Monthly Draft', format: 'money', value: monthlyRevenue, betterWhen: 'up' },
      {
        key: 'avgDraft',
        label: 'Avg Draft per Client',
        format: 'money',
        // Averaged over the recurring clients only: a paid-in-full client has
        // no monthly draft, and including them would drag the average toward
        // zero for a reason that has nothing to do with pricing.
        value: recurringClients.length ? round2(monthlyRevenue / recurringClients.length) : null,
        betterWhen: 'up',
      },
    ],
    breakdowns: {
      byTrainer: rankRows([...byTrainer.values()]),
      byFrequency: rankRows([...byFrequency.values()]),
    },
    clients: clients.sort((a, b) => b.monthly - a.monthly || a.member.localeCompare(b.member)),
    note:
      'Recurring clients are active services on the books today. Paid-in-full clients are ' +
      `those who bought in the last ${opts.pifLookbackMonths || 12} months — ABC does not put ` +
      'an end date on a paid-in-full package, so how many sessions are left cannot be seen ' +
      'from here. Frequency is the BILLING cadence, not sessions per week; for that, read ' +
      'Session Frequency.',
  }
}

// ---------------------------------------------------------------------------
// Session Frequency — how often they actually come.
// ---------------------------------------------------------------------------

/**
 * @param current  completed sessions in the window
 * @param prior    completed sessions in the comparison window
 * @param opts     { currentWeeks, priorWeeks }
 */
function buildSessionFrequency(current, prior, opts = {}) {
  const currentWeeks = Math.max(num(opts.currentWeeks), 0.1)
  const priorWeeks = Math.max(num(opts.priorWeeks), 0.1)

  const key = s => `${s.club_number}|${s.member_id}`
  const fold = (rows) => {
    const map = new Map()
    for (const s of rows || []) {
      if (!s.member_id) continue
      const cur = map.get(key(s)) || {
        member: `${s.member_first_name || ''} ${s.member_last_name || ''}`.trim() || 'Unnamed member',
        clubNumber: s.club_number,
        trainer: `${s.employee_first_name || ''} ${s.employee_last_name || ''}`.trim() || 'Unassigned',
        sessions: 0,
        last: null,
      }
      cur.sessions += 1
      const d = String(s.event_timestamp_local || '').slice(0, 10)
      if (d && (!cur.last || d > cur.last)) {
        cur.last = d
        // The trainer they saw MOST RECENTLY, not the first one in the list:
        // a client who switched trainers should read against the current one.
        cur.trainer = `${s.employee_first_name || ''} ${s.employee_last_name || ''}`.trim() || cur.trainer
      }
      map.set(key(s), cur)
    }
    return map
  }

  const now = fold(current)
  const was = fold(prior)

  // Everybody who trained in EITHER window. A client who trained last month and
  // not this one is the single most useful row in the report, and keying only
  // on the current window would drop them.
  const allKeys = new Set([...now.keys(), ...was.keys()])
  const rows = [...allKeys].map(k => {
    const a = now.get(k)
    const b = was.get(k)
    const base = a || b
    const sessions = a ? a.sessions : 0
    const priorSessions = b ? b.sessions : 0
    return {
      member: base.member,
      clubNumber: base.clubNumber,
      trainer: (a || b).trainer,
      sessions,
      perWeek: round1(sessions / currentWeeks),
      priorSessions,
      priorPerWeek: round1(priorSessions / priorWeeks),
      change: sessions - priorSessions,
      last: a?.last || b?.last || null,
    }
  })

  const total = rows.reduce((s, r) => s + r.sessions, 0)
  const priorTotal = rows.reduce((s, r) => s + r.priorSessions, 0)
  const activeNow = rows.filter(r => r.sessions > 0)
  // Trained last window, not this one. The report's whole reason to exist.
  const lapsed = rows.filter(r => r.sessions === 0 && r.priorSessions > 0)

  const buckets = [
    { key: 'none', label: 'Did not train', test: r => r.sessions === 0 },
    { key: 'lt1', label: 'Under 1 a week', test: r => r.perWeek > 0 && r.perWeek < 1 },
    { key: 'one', label: '1 to 2 a week', test: r => r.perWeek >= 1 && r.perWeek < 2 },
    { key: 'two', label: '2 to 3 a week', test: r => r.perWeek >= 2 && r.perWeek < 3 },
    { key: 'three', label: '3 or more a week', test: r => r.perWeek >= 3 },
  ]

  return {
    hasActivity: rows.length > 0,
    stats: [
      { key: 'clients', label: 'Clients Training', format: 'int', value: activeNow.length, betterWhen: 'up' },
      { key: 'sessions', label: 'Sessions', format: 'int', value: total, prior: priorTotal, betterWhen: 'up' },
      {
        key: 'perWeek', label: 'Sessions per Week', format: 'num',
        value: round1(total / currentWeeks), prior: round1(priorTotal / priorWeeks), betterWhen: 'up',
      },
      {
        key: 'avgPerClient', label: 'Avg per Client per Week', format: 'num',
        value: activeNow.length ? round1(total / currentWeeks / activeNow.length) : null,
        betterWhen: 'up',
      },
      { key: 'lapsed', label: 'Stopped Training', format: 'int', value: lapsed.length, betterWhen: 'down' },
    ],
    breakdowns: {
      byFrequency: buckets.map(b => ({ label: b.label, count: rows.filter(b.test).length })),
    },
    rows: rows.sort((a, b) => b.sessions - a.sessions || a.member.localeCompare(b.member)),
    lapsed: lapsed.sort((a, b) => b.priorSessions - a.priorSessions).slice(0, 50),
    note:
      'Counted from completed calendar appointments, so this is what happened rather than ' +
      'what was sold. Anyone who trained in either window appears, which is how a client who ' +
      'stopped is visible at all.',
  }
}

module.exports = {
  buildPtRoster, buildSessionFrequency, isPaidInFull,
}
