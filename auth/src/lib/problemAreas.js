// Pure shaping for Analytics > Problem Areas. No I/O; the route fetches.
//
// This report exists so a manager does not have to go looking. Every other
// report answers a question you have to think to ask; this one states what is
// wrong, per club, against thresholds set in Admin.
//
// A CHECK ONLY FIRES ON EVIDENCE. Every check declares the smallest sample it
// will judge on, and stays silent below it. Two Day Ones and no sale is not a
// closing problem, and a report that cries wolf on a quiet week at a small club
// gets ignored on the week it matters.

/**
 * The checks, and how each is configured in Admin.
 *
 * `direction` is which way is bad:
 *   'below' — a percentage that should be high (booking, closing, compliance)
 *   'above' — a count that should be low (Day One forms left open)
 *
 * `defaultThreshold` applies until somebody sets one in Admin, so the report is
 * useful the moment it ships rather than blank until configured.
 *
 * `minSample` is the denominator below which the check abstains.
 */
const CHECKS = [
  {
    key: 'dayone_book_pct',
    label: 'Day One Booking %',
    unit: 'pct',
    direction: 'below',
    defaultThreshold: 40,
    minSample: 10,
    sampleLabel: 'new members',
    why: 'New members are not being booked into a Day One.',
  },
  {
    key: 'vip_pct',
    label: 'VIP Collection %',
    unit: 'pct',
    direction: 'below',
    defaultThreshold: 40,
    minSample: 10,
    sampleLabel: 'new members',
    why: 'New members are not being asked for VIP referrals.',
  },
  {
    key: 'dayone_close_pct',
    label: 'Day One Close %',
    unit: 'pct',
    direction: 'below',
    defaultThreshold: 30,
    minSample: 10,
    sampleLabel: 'completed Day Ones',
    why: 'Day Ones are happening but not converting to PT.',
  },
  {
    key: 'dayone_open_forms',
    label: 'Day One Forms Left Open',
    unit: 'count',
    direction: 'above',
    defaultThreshold: 10,
    minSample: 0,
    sampleLabel: 'Day Ones past their date',
    why: 'Day Ones whose date has passed with no outcome recorded. Until the form is completed the appointment counts as neither held nor missed, so every close rate is measured on an incomplete picture.',
  },
  {
    key: 'ops_pct',
    label: 'Operational Compliance %',
    unit: 'pct',
    direction: 'below',
    defaultThreshold: 75,
    minSample: 20,
    sampleLabel: 'jobs due',
    why: 'Scheduled operational tasks are not being completed.',
  },
]

const CHECK_BY_KEY = new Map(CHECKS.map(c => [c.key, c]))

/** app_config keys, matching the prefix the Admin tile edits. */
const settingKey = (key) => `problem_${key}`
const offKey = (key) => `problem_${key}_off`

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** The configured threshold, falling back to the check's own default. */
function thresholdFor(check, settings) {
  const set = num((settings || {})[settingKey(check.key)])
  return set === null ? check.defaultThreshold : set
}

function isOff(check, settings) {
  return (settings || {})[offKey(check.key)] === '1'
}

/**
 * How badly a value misses. Used only for ordering, so the worst problem is
 * read first rather than found.
 *
 * Expressed as a share of the threshold rather than an absolute gap, so a
 * compliance score of 2% against 75 outranks a booking rate of 38% against 40
 * — which is the order a manager would put them in.
 */
function severityOf(check, value, threshold) {
  if (value === null || threshold === null || !threshold) return 0
  return check.direction === 'below'
    ? Math.max(0, (threshold - value) / threshold)
    : Math.max(0, (value - threshold) / threshold)
}

function fails(check, value, threshold) {
  if (value === null || threshold === null) return false
  return check.direction === 'below' ? value < threshold : value > threshold
}

/**
 * @param clubs    [{ slug, name, metrics: { <checkKey>: { value, sample } } }]
 * @param settings the app_config map for the `problem_` prefix
 *
 * Returns one row per firing check per club, worst first, plus everything that
 * was checked and passed so the reader can tell "no problems" from "not looked
 * at" — the distinction this whole report turns on.
 */
function buildProblemAreas(clubs, settings = {}) {
  const problems = []
  const skipped = []
  let checked = 0

  for (const club of clubs || []) {
    for (const check of CHECKS) {
      if (isOff(check, settings)) continue

      const m = (club.metrics || {})[check.key] || {}
      const value = num(m.value)
      const sample = num(m.sample) ?? 0
      const threshold = thresholdFor(check, settings)

      // No data at all is not a pass. It is reported separately so an absent
      // feed cannot masquerade as a healthy club.
      if (value === null) {
        skipped.push({
          club: club.name, clubSlug: club.slug,
          key: check.key, label: check.label,
          reason: 'no data',
        })
        continue
      }
      if (sample < check.minSample) {
        skipped.push({
          club: club.name, clubSlug: club.slug,
          key: check.key, label: check.label,
          reason: `only ${sample} ${check.sampleLabel}`,
        })
        continue
      }

      checked++
      if (!fails(check, value, threshold)) continue

      problems.push({
        club: club.name,
        clubSlug: club.slug,
        key: check.key,
        label: check.label,
        unit: check.unit,
        direction: check.direction,
        value,
        threshold,
        sample,
        sampleLabel: check.sampleLabel,
        why: check.why,
        severity: Math.round(severityOf(check, value, threshold) * 1000) / 1000,
      })
    }
  }

  problems.sort((a, b) =>
    b.severity - a.severity ||
    String(a.club).localeCompare(String(b.club)) ||
    String(a.label).localeCompare(String(b.label))
  )

  // Grouped by club as well, because a club with four problems is a different
  // conversation from four clubs with one each.
  const byClub = new Map()
  for (const p of problems) {
    const cur = byClub.get(p.clubSlug) || { club: p.club, clubSlug: p.clubSlug, problems: [] }
    cur.problems.push(p)
    byClub.set(p.clubSlug, cur)
  }

  return {
    problems,
    byClub: [...byClub.values()].sort((a, b) => b.problems.length - a.problems.length
      || String(a.club).localeCompare(String(b.club))),
    skipped,
    checksRun: checked,
    clean: problems.length === 0 && checked > 0,
    checks: CHECKS.map(c => ({
      key: c.key,
      label: c.label,
      unit: c.unit,
      direction: c.direction,
      threshold: thresholdFor(c, settings),
      off: isOff(c, settings),
      minSample: c.minSample,
    })),
  }
}

module.exports = {
  buildProblemAreas, CHECKS, CHECK_BY_KEY,
  settingKey, offKey, thresholdFor, isOff, severityOf, fails,
}
