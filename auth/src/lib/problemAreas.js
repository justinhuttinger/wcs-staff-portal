// Pure shaping for Analytics > Problem Areas. No I/O; the route fetches.
//
// This report exists so a manager does not have to go looking. Every other
// report answers a question you have to think to ask; this one states what is
// wrong, and WHO it belongs to, against thresholds set in Admin.
//
// PEOPLE ONLY. Club-level rows were removed deliberately: a club figure is an
// average of the people in it, and averages are what the other reports are for.
// A problem worth acting on has somebody's name on it.
//
// The cost of that is stated rather than hidden: an operational job nobody ever
// started has no name to attach, so it cannot appear here at all. The route
// counts those and returns the number.
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
// The three departments a problem can belong to. Operational Compliance is its
// own rather than being forced into PT or Membership: the jobs are club-wide
// and filing them under either would send the wrong manager after them.
const DEPARTMENTS = ['Membership', 'PT', 'Operations']

const CHECKS = [
  {
    key: 'dayone_book_pct',
    label: 'Day One Booking %',
    department: 'Membership',
    // Credited to whoever BOOKED the Day One.
    scopes: ['staff'],
    unit: 'pct',
    direction: 'below',
    defaultThreshold: 40,
    minSample: 4,
    sampleLabel: 'new members',
    why: 'New members are not being booked into a Day One.',
  },
  {
    key: 'vip_pct',
    label: 'VIP Collection %',
    department: 'Membership',
    scopes: ['staff'],
    unit: 'pct',
    direction: 'below',
    defaultThreshold: 40,
    minSample: 4,
    sampleLabel: 'new members',
    why: 'New members are not being asked for VIP referrals.',
  },
  {
    key: 'dayone_close_pct',
    label: 'Day One Close %',
    department: 'PT',
    // Credited to the trainer who SERVICED the Day One, not whoever booked it.
    scopes: ['staff'],
    unit: 'pct',
    direction: 'below',
    defaultThreshold: 30,
    minSample: 4,
    sampleLabel: 'completed Day Ones',
    why: 'Day Ones are happening but not converting to PT.',
  },
  {
    key: 'dayone_open_forms',
    label: 'Day One Forms Left Open',
    department: 'PT',
    scopes: ['staff'],
    unit: 'count',
    direction: 'above',
    defaultThreshold: 10,
    minSample: 0,
    sampleLabel: 'Day Ones past their date',
    why: 'Day Ones whose date has passed with no outcome recorded. Until the form is completed the appointment counts as neither held nor missed, so every close rate is measured on an incomplete picture.',
  },
  {
    key: 'ops_jobs_below',
    label: 'Jobs Below Standard',
    department: 'Operations',
    // STAFF ONLY, like every check here. A job somebody part-did is attributed
    // to them. A job NOBODY touched has no name to attach and therefore cannot
    // appear at all -- 489 of 575 below-standard jobs in a 30-day window were
    // never started by anyone. The route counts those and the report says how
    // many, because a silent omission on that scale would be worse than the
    // club row this replaced.
    scopes: ['staff'],
    unit: 'count',
    direction: 'above',
    // Any below-standard job is worth seeing, so the bar is "more than none".
    // How complete a job must be to pass is a separate setting -- see
    // problem_ops_job_pct.
    defaultThreshold: 0,
    minSample: 0,
    sampleLabel: 'jobs due',
    why: 'Operational jobs left below the completion standard.',
  },
]

// How complete a single Operandio job must be to count as done. Separate from
// the threshold above, which is how many below-standard jobs are tolerated.
const OPS_JOB_PCT_KEY = 'problem_ops_job_pct'
const DEFAULT_OPS_JOB_PCT = 75

function opsJobPct(settings) {
  const v = num((settings || {})[OPS_JOB_PCT_KEY])
  return v === null ? DEFAULT_OPS_JOB_PCT : v
}

const CHECK_BY_KEY = new Map(CHECKS.map(c => [c.key, c]))

/** app_config keys, matching the prefix the Admin tile edits. */
const settingKey = (key) => `problem_${key}`
const offKey = (key) => `problem_${key}_off`
// Per-club, because not every club runs every programme. Milwaukie and Eugene
// have no VIP fields configured at all, so a VIP check there measures the setup
// rather than the staff — and a permanent red row nobody can fix is how a
// report gets ignored.
const clubOffKey = (key, slug) => `problem_${key}_off_${slug}`

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

/**
 * @param clubSlug when given, a club-specific switch is consulted as well.
 *
 * The global switch wins: turning a check off everywhere should not require
 * unticking it seven times.
 */
function isOff(check, settings, clubSlug = null) {
  const map = settings || {}
  if (map[offKey(check.key)] === '1') return true
  if (clubSlug && map[clubOffKey(check.key, clubSlug)] === '1') return true
  return false
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
  if (value === null || threshold === null) return 0
  // Divided by at least 1. A tolerance of zero — which is the sensible default
  // for "jobs below standard" — would otherwise divide by zero and score every
  // such problem as severity 0, sinking the worst rows to the bottom of a list
  // whose whole purpose is to put them at the top.
  const scale = Math.max(Math.abs(threshold), 1)
  return check.direction === 'below'
    ? Math.max(0, (threshold - value) / scale)
    : Math.max(0, (value - threshold) / scale)
}

function fails(check, value, threshold) {
  if (value === null || threshold === null) return false
  return check.direction === 'below' ? value < threshold : value > threshold
}

/**
 * @param clubs    [{ slug, name, metrics: { <checkKey>: { value, sample } } }]
 * @param staff    [{ slug, club, name, department, metrics: {...} }]
 * @param settings the app_config map for the `problem_` prefix
 *
 * Returns one row per firing check per subject, worst first, plus everything
 * that was looked at and could not be judged — so the reader can tell "no
 * problems" from "not measured", which is the distinction this report turns on.
 *
 * A check is evaluated at CLUB level, STAFF level, or both, per its `scopes`.
 * Operational Compliance is club-only: an Operandio job carries an assignment
 * rather than an owner, and naming whoever was assigned to work nobody picked
 * up would blame the wrong person.
 */
function buildProblemAreas(clubs, staff = [], settings = {}) {
  const problems = []
  let checked = 0

  // A row with no name attached is not a person. Operandio and the Day One
  // feed both leave a name blank rather than absent, and 'Unknown' on a
  // problem list is an accusation nobody can act on.
  const named = (n) => {
    const v = String(n || '').trim()
    return v !== '' && v.toLowerCase() !== 'unknown'
  }

  const evaluate = (subject, scope) => {
    for (const check of CHECKS) {
      if (isOff(check, settings, subject.slug)) continue
      if (!check.scopes.includes(scope)) continue
      // A staff row only answers for its own department, so a trainer is never
      // judged on a membership metric they have no hand in.
      if (scope === 'staff' && subject.department !== check.department) continue

      const m = (subject.metrics || {})[check.key] || {}
      const value = num(m.value)
      const sample = num(m.sample) ?? 0
      const threshold = thresholdFor(check, settings)

      const base = {
        scope,
        club: subject.club || subject.name,
        clubSlug: subject.slug,
        person: scope === 'staff' ? subject.name : null,
        department: check.department,
        key: check.key,
        label: check.label,
      }

      // Nothing measured, or too little to judge on: the check simply does not
      // fire. Silent rather than listed -- a manager wants the problems, not a
      // register of everything that was looked at.
      if (value === null) continue
      if (sample < check.minSample) continue

      checked++
      if (!fails(check, value, threshold)) continue

      // What the number is made of, so the row can say "12 of 40 booked, needs
      // 16" rather than a bare percentage nobody can act on.
      const numerator = num(m.numerator)
      const target = check.unit === 'pct' && sample
        ? Math.ceil((threshold / 100) * sample)
        : null
      const shortBy = target !== null && numerator !== null
        ? Math.max(0, target - numerator)
        : null

      problems.push({
        ...base,
        // The rows behind the number, where a subject supplies them. A count of
        // missed checklists is not actionable until you can see WHICH.
        details: (subject.details || {})[check.key] || null,
        unit: check.unit,
        direction: check.direction,
        value,
        threshold,
        sample,
        sampleLabel: check.sampleLabel,
        numerator,
        target,
        shortBy,
        why: check.why,
        severity: Math.round(severityOf(check, value, threshold) * 1000) / 1000,
      })
    }
  }

  // Clubs are accepted and ignored: no check is club-scoped any more, and the
  // parameter is kept so the route's shape does not have to change if one ever
  // is again.
  for (const person of staff || []) {
    if (!named(person.name)) continue
    evaluate(person, 'staff')
  }

  const worstFirst = (a, b) =>
    b.severity - a.severity ||
    String(a.club).localeCompare(String(b.club)) ||
    String(a.person || '').localeCompare(String(b.person || '')) ||
    String(a.label).localeCompare(String(b.label))

  problems.sort(worstFirst)

  // Grouped by club, because a club with eight flagged people is a different
  // conversation from eight clubs with one each.
  const byClub = new Map()
  for (const p of problems) {
    const cur = byClub.get(p.clubSlug) || { club: p.club, clubSlug: p.clubSlug, problems: [] }
    cur.problems.push(p)
    byClub.set(p.clubSlug, cur)
  }

  // And by person, so a manager can see whether one club is struggling or one
  // person is. Keyed on club AND name: two clubs can employ the same name.
  const byPerson = new Map()
  for (const p of problems) {
    const k = `${p.clubSlug}|${p.person}`
    const cur = byPerson.get(k) || {
      person: p.person, club: p.club, clubSlug: p.clubSlug,
      department: p.department, problems: [],
    }
    cur.problems.push(p)
    byPerson.set(k, cur)
  }

  const countBy = (dept) => problems.filter(p => p.department === dept).length

  return {
    problems,
    byClub: [...byClub.values()].sort((a, b) => b.problems.length - a.problems.length
      || String(a.club).localeCompare(String(b.club))),
    byPerson: [...byPerson.values()].sort((a, b) => b.problems.length - a.problems.length
      || String(a.person).localeCompare(String(b.person))),
    checksRun: checked,
    clean: problems.length === 0 && checked > 0,
    departments: DEPARTMENTS.map(d => ({ key: d, label: d, count: countBy(d) })),
    checks: CHECKS.map(c => ({
      key: c.key,
      label: c.label,
      department: c.department,
      scopes: c.scopes,
      unit: c.unit,
      direction: c.direction,
      threshold: thresholdFor(c, settings),
      // Off everywhere. Clubs it is off at individually are listed separately.
      off: isOff(c, settings),
      offClubs: Object.keys(settings || {})
        .filter(k => k.startsWith(`problem_${c.key}_off_`) && settings[k] === '1')
        .map(k => k.slice(`problem_${c.key}_off_`.length)),
      minSample: c.minSample,
    })),
  }
}

/**
 * Is this job old enough to be judged?
 *
 * A JOB CANNOT BE "NOT COMPLETED" BEFORE IT IS DUE. The report window runs to
 * TODAY, so without this every club is marked against whatever hour the page
 * happens to be opened on. Salem at 3:12pm was being judged on a Closing
 * Checklist that does not open until 8:00pm and a Drawer Close Count that opens
 * at 7:00pm — both sitting at 0% because nobody can start them yet. Across a
 * month-to-date window that was 110 jobs not yet due, 75 of them below the bar
 * and landing on somebody's name.
 *
 * The deadline is due_at. 14 jobs of 1,623 carry none, and those fall back to
 * available_from so that a job which has not even opened is still never judged;
 * a job with neither is judged as before, because there is nothing to wait for.
 */
function isJudgeableJob(job, nowMs = Date.now()) {
  const at = (v) => {
    if (v === null || v === undefined || v === '') return null
    const t = v instanceof Date ? v.getTime() : Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  const deadline = at(job && job.due_at) ?? at(job && job.available_from)
  if (deadline === null) return true
  return deadline <= nowMs
}

/**
 * The day a job belongs to, as the club lived it.
 *
 * job_date is the Pacific business day and is the only correct answer. Slicing
 * available_from gives the UTC day, which for anything on the closing shift is
 * TOMORROW: Salem's 8pm Closing Checklist on 28 August is 03:00Z on the 29th,
 * and the report showed a missed job dated a day in the future. The fallback
 * formats in Pacific rather than slicing an ISO string for that reason.
 */
function jobDay(job) {
  if (!job) return null
  if (job.job_date) return String(job.job_date).slice(0, 10)
  const raw = job.due_at || job.available_from
  if (!raw) return null
  const t = raw instanceof Date ? raw.getTime() : Date.parse(raw)
  if (!Number.isFinite(t)) return null
  // en-CA gives YYYY-MM-DD, which is what the UI already expects.
  return new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}


module.exports = {
  buildProblemAreas, CHECKS, CHECK_BY_KEY, DEPARTMENTS,
  OPS_JOB_PCT_KEY, DEFAULT_OPS_JOB_PCT, opsJobPct,
  settingKey, offKey, clubOffKey, thresholdFor, isOff, severityOf, fails,
  isJudgeableJob, jobDay,
}
