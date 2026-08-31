// auth/src/lib/tillMovements.js
// Portal-recorded cash movements in and out of a drawer: the reasons staff can
// pick, the rules a submission has to satisfy, and the per-day totals the
// reconciler folds into expected_close.
//
// Pure. No I/O, no clock — the caller passes today's Pacific date in, so the
// day-boundary rules are testable without freezing time.
//
// This is the portal-side replacement for ringing the ABC "Cash Drop" POS item
// (see 179_till_cash_movements.sql). POS drops still count; these are added to
// them.

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

// Reasons, per direction. `key` is what lands in the column; `label` is what
// the tile shows. `needsNote` reasons are the vague ones — if a drawer is short
// three weeks later, "Other, $80" with no note tells nobody anything.
const REASONS = {
  out: [
    { key: 'bank_drop', label: 'Bank drop' },
    { key: 'to_safe', label: 'To the safe' },
    { key: 'payout', label: 'Payout / expense', needsNote: true },
    { key: 'other', label: 'Other', needsNote: true },
  ],
  in: [
    { key: 'from_safe', label: 'Change from the safe' },
    { key: 'float_topup', label: 'Float top-up' },
    { key: 'other', label: 'Other', needsNote: true },
  ],
}

const DIRECTIONS = Object.keys(REASONS)

// How far back a movement may be dated. A close often happens after midnight,
// and a missed entry gets noticed the next morning, so a week of slack is
// useful; beyond that the day has been reconciled and reported on already.
const MAX_BACKDATE_DAYS = 7

// Sanity ceiling. A drawer holds hundreds, not tens of thousands; a five-digit
// entry is a typo (a missing decimal point) far more often than it is real.
const MAX_AMOUNT = 25000

function reasonLabel(direction, key) {
  const found = (REASONS[direction] || []).find(r => r.key === key)
  return found ? found.label : String(key)
}

// 'YYYY-MM-DD' string arithmetic through UTC, which has no DST to trip over.
// Both inputs are calendar dates, so the result is a plain day count.
function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(toDate + 'T00:00:00Z') - Date.parse(fromDate + 'T00:00:00Z')) / 86400000)
}

/**
 * Validate one submitted movement.
 *
 * @param {object} body        the request body
 * @param {string} todayPacific today's Pacific calendar date, 'YYYY-MM-DD'
 * @returns {{ error: string } | { value: object }}
 */
function validateMovement(body = {}, todayPacific) {
  const direction = String(body.direction || '').trim()
  if (!DIRECTIONS.includes(direction)) {
    return { error: "direction must be 'out' or 'in'" }
  }

  const reason = String(body.reason || '').trim()
  const spec = REASONS[direction].find(r => r.key === reason)
  if (!spec) {
    return { error: `reason '${reason || '(none)'}' is not a valid reason for cash ${direction}` }
  }

  const amount = typeof body.amount === 'number' ? body.amount : parseFloat(body.amount)
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: 'amount must be a positive number' }
  }
  if (amount > MAX_AMOUNT) {
    return { error: `amount looks wrong (over $${MAX_AMOUNT.toLocaleString('en-US')}) — check the decimal point` }
  }

  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 500) : ''
  if (spec.needsNote && !note) {
    return { error: `a note is required when the reason is "${spec.label}"` }
  }

  const businessDate = body.business_date ? String(body.business_date).slice(0, 10) : todayPacific
  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate) || Number.isNaN(Date.parse(businessDate + 'T00:00:00Z'))) {
    return { error: 'business_date must be YYYY-MM-DD' }
  }
  const age = daysBetween(businessDate, todayPacific)
  if (age < 0) return { error: 'business_date cannot be in the future' }
  if (age > MAX_BACKDATE_DAYS) {
    return { error: `business_date can be backdated at most ${MAX_BACKDATE_DAYS} days` }
  }

  return {
    value: {
      direction,
      reason,
      amount: r2(amount),
      note: note || null,
      business_date: businessDate,
    },
  }
}

/**
 * Total the non-voided movements per business date.
 *
 * @param {Array} rows till_cash_movements rows
 * @returns {Map<string, { manualOut: number, manualIn: number }>}
 */
function netMovementsByDay(rows) {
  const byDay = new Map()
  for (const row of rows || []) {
    if (row.voided_at) continue
    const day = String(row.business_date || '').slice(0, 10)
    if (!day) continue
    const amt = Number(row.amount) || 0
    const cur = byDay.get(day) || { manualOut: 0, manualIn: 0 }
    if (row.direction === 'in') cur.manualIn = r2(cur.manualIn + amt)
    else cur.manualOut = r2(cur.manualOut + amt)
    byDay.set(day, cur)
  }
  return byDay
}

module.exports = {
  REASONS, DIRECTIONS, MAX_BACKDATE_DAYS, MAX_AMOUNT,
  reasonLabel, validateMovement, netMovementsByDay,
}
