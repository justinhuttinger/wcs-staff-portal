// Pure aggregation for Analytics > Membership Mix. No I/O; the route fetches.
//
// One row per club (or other grouping), split into segments by whichever
// dimension is chosen. Segments are capped: a hundred-segment stacked bar is a
// stripe pattern, not a chart. The largest segments across the whole selection
// are kept and the rest fold into "Other", so the same colour means the same
// thing in every row — a per-row top-N would repaint segments club by club.

// Segment cap. Eight is the categorical palette's slot count; the ninth
// position is "Other" rather than a generated hue.
const MAX_SEGMENTS = 8
const OTHER = 'Other'
const UNKNOWN = 'Unknown'

// Generations by birth year, Pew's boundaries.
const GENERATIONS = [
  { key: 'gen_alpha', label: 'Gen Alpha', from: 2013, to: 9999 },
  { key: 'gen_z', label: 'Gen Z', from: 1997, to: 2012 },
  { key: 'millennial', label: 'Millennial', from: 1981, to: 1996 },
  { key: 'gen_x', label: 'Gen X', from: 1965, to: 1980 },
  { key: 'boomer', label: 'Boomer', from: 1946, to: 1964 },
  { key: 'silent', label: 'Silent', from: 1900, to: 1945 },
]

const AGE_BUCKETS = [
  { label: 'Under 18', max: 17 },
  { label: '18-24', max: 24 },
  { label: '25-34', max: 34 },
  { label: '35-44', max: 44 },
  { label: '45-54', max: 54 },
  { label: '55-64', max: 64 },
  { label: '65+', max: Infinity },
]

// Visit-frequency bands. The top band is open-ended because a handful of
// members come in daily and would otherwise stretch every band above them.
const CHECKIN_BUCKETS = [
  { label: 'Never', max: 0 },
  { label: 'Under 1 / mo', max: 0.999 },
  { label: '1-3 / mo', max: 3.999 },
  { label: '4-7 / mo', max: 7.999 },
  { label: '8-11 / mo', max: 11.999 },
  { label: '12+ / mo', max: Infinity },
]

function ageOn(birthDate, onDate) {
  if (!birthDate) return null
  const b = new Date(String(birthDate) + 'T00:00:00')
  const d = new Date(String(onDate) + 'T00:00:00')
  if (Number.isNaN(b.getTime()) || Number.isNaN(d.getTime())) return null
  let age = d.getFullYear() - b.getFullYear()
  const m = d.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && d.getDate() < b.getDate())) age -= 1
  return age
}

function bucketBy(value, buckets) {
  if (value === null || value === undefined) return UNKNOWN
  return (buckets.find(b => value <= b.max) || buckets[buckets.length - 1]).label
}

// Paid in full vs recurring. ABC's agreement term carries this: a Cash term is
// bought outright, an Open or Installment term drafts.
const PIF_TERMS = new Set(['Cash', 'Cash Open'])

function isPaidInFull(member) {
  return PIF_TERMS.has(member.agreement_term)
}

const BREAKDOWNS = [
  { key: 'membership_type', label: 'Membership Type' },
  { key: 'gender', label: 'Gender' },
  { key: 'age_group', label: 'Age Group' },
  { key: 'generation', label: 'Generation' },
  { key: 'payment_term', label: 'Payment Term' },
  { key: 'payment_method', label: 'Payment Mode' },
  { key: 'join_source', label: 'Join Source' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'checkin_frequency', label: 'Avg Monthly Check-ins' },
  { key: 'relationship', label: 'Member Relationship' },
]
const BREAKDOWN_KEYS = new Set(BREAKDOWNS.map(b => b.key))

const VIEW_BY = ['club', 'membership_type', 'salesperson']

function nonEmpty(v) {
  const s = (v === null || v === undefined) ? '' : String(v).trim()
  return s === '' ? null : s
}

/**
 * The segment a member falls into, for the chosen breakdown.
 * `asOf` dates the age calculations; `checkinRate` is average check-ins per
 * month, supplied by the caller from the member-month table.
 */
function segmentFor(member, breakdown, asOf, checkinRate) {
  switch (breakdown) {
    case 'gender':
      return nonEmpty(member.gender) || UNKNOWN
    case 'age_group':
      return bucketBy(ageOn(member.birth_date, asOf), AGE_BUCKETS)
    case 'generation': {
      if (!member.birth_date) return UNKNOWN
      const year = Number(String(member.birth_date).slice(0, 4))
      if (!Number.isFinite(year)) return UNKNOWN
      return (GENERATIONS.find(g => year >= g.from && year <= g.to) || {}).label || UNKNOWN
    }
    case 'payment_term':
      return nonEmpty(member.agreement_term) || UNKNOWN
    case 'payment_method':
      return nonEmpty(member.agreement_payment_method) || UNKNOWN
    case 'join_source':
      return nonEmpty(member.agreement_entry_source) || UNKNOWN
    case 'salesperson':
      return nonEmpty(member.sales_person_name)?.replace(/\s+/g, ' ') || UNKNOWN
    case 'checkin_frequency':
      // Undefined means we hold no check-in history for them at all, which is
      // not the same as never visiting.
      return checkinRate === undefined ? UNKNOWN : bucketBy(checkinRate, CHECKIN_BUCKETS)
    case 'relationship':
      if (member.is_primary_member === true) return 'Primary'
      if (member.is_primary_member === false) return 'Secondary / Dependent'
      return UNKNOWN
    default:
      return nonEmpty(member.membership_type) || UNKNOWN
  }
}

function groupFor(member, viewBy, clubNameFor) {
  if (viewBy === 'membership_type') return nonEmpty(member.membership_type) || UNKNOWN
  if (viewBy === 'salesperson') return nonEmpty(member.sales_person_name)?.replace(/\s+/g, ' ') || UNKNOWN
  return clubNameFor(member.club_number)
}

/**
 * @param members  the counted membership base
 * @param opts     { breakdown, viewBy, asOf, clubNameFor, checkinRateFor }
 */
function buildMembershipMix(members, opts = {}) {
  const breakdown = BREAKDOWN_KEYS.has(opts.breakdown) ? opts.breakdown : 'membership_type'
  const viewBy = VIEW_BY.includes(opts.viewBy) ? opts.viewBy : 'club'
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10)
  const clubNameFor = opts.clubNameFor || ((n) => n)
  const checkinRateFor = opts.checkinRateFor || (() => undefined)

  const list = members || []

  // Segment totals across the WHOLE selection decide which survive the cap, so
  // a segment keeps its identity (and its colour) in every row.
  const overall = new Map()
  const tagged = list.map(m => {
    const segment = segmentFor(m, breakdown, asOf, checkinRateFor(m))
    overall.set(segment, (overall.get(segment) || 0) + 1)
    return { m, segment }
  })

  const ranked = [...overall.entries()]
    .filter(([name]) => name !== UNKNOWN)
    .sort((a, b) => b[1] - a[1])
  const kept = new Set(ranked.slice(0, MAX_SEGMENTS).map(([name]) => name))
  const folded = ranked.length > MAX_SEGMENTS
  const hasUnknown = overall.has(UNKNOWN)

  // Legend order is the overall ranking, with Other and Unknown last, so the
  // colour assignment is stable no matter which club is on screen.
  const segments = [
    ...ranked.slice(0, MAX_SEGMENTS).map(([name]) => name),
    ...(folded ? [OTHER] : []),
    ...(hasUnknown ? [UNKNOWN] : []),
  ]

  const rowsMap = new Map()
  for (const { m, segment } of tagged) {
    const key = groupFor(m, viewBy, clubNameFor)
    if (!rowsMap.has(key)) {
      rowsMap.set(key, {
        key,
        label: key,
        total: 0,
        primary: 0,
        secondary: 0,
        paidInFull: 0,
        recurring: 0,
        counts: new Map(),
      })
    }
    const row = rowsMap.get(key)
    row.total += 1
    if (m.is_primary_member === true) row.primary += 1
    else if (m.is_primary_member === false) row.secondary += 1
    if (isPaidInFull(m)) row.paidInFull += 1
    else row.recurring += 1

    const name = segment === UNKNOWN ? UNKNOWN : (kept.has(segment) ? segment : OTHER)
    row.counts.set(name, (row.counts.get(name) || 0) + 1)
  }

  const rows = [...rowsMap.values()].map(row => ({
    key: row.key,
    label: row.label,
    total: row.total,
    primary: row.primary,
    secondary: row.secondary,
    paidInFull: row.paidInFull,
    recurring: row.recurring,
    // Every row carries every segment, zeros included, so the stack has a
    // consistent order and the legend never points at a missing colour.
    segments: segments.map(name => {
      const count = row.counts.get(name) || 0
      return {
        name,
        count,
        pct: row.total ? Math.round((count / row.total) * 1000) / 10 : 0,
      }
    }),
  })).sort((a, b) => b.total - a.total)

  const summary = rows.reduce((acc, r) => {
    acc.total += r.total
    acc.primary += r.primary
    acc.secondary += r.secondary
    acc.paidInFull += r.paidInFull
    acc.recurring += r.recurring
    return acc
  }, { total: 0, primary: 0, secondary: 0, paidInFull: 0, recurring: 0 })

  return {
    rows,
    segments,
    summary: {
      ...summary,
      // Members whose relationship ABC has not recorded. Called out rather than
      // folded into primary, which would overstate it.
      relationshipUnknown: summary.total - summary.primary - summary.secondary,
    },
    breakdown,
    viewBy,
    asOf,
    foldedSegments: folded ? ranked.length - MAX_SEGMENTS : 0,
  }
}

module.exports = {
  buildMembershipMix, segmentFor, groupFor, isPaidInFull, ageOn, bucketBy,
  BREAKDOWNS, VIEW_BY, MAX_SEGMENTS, OTHER, UNKNOWN,
  AGE_BUCKETS, CHECKIN_BUCKETS, GENERATIONS,
}
