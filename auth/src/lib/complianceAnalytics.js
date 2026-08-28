// Pure shaping for Analytics > Compliance. No I/O; the route fetches.
//
// DEFINITIONS ARE THE OLD REPORT'S, UNCHANGED. Both will be read side by side
// for a while, and a rebuild that quietly redefines its own headline is worse
// than no rebuild.
//
//   decided          on_time | late | missed. Judged once done or past due.
//   not yet due      pending | in_progress. Excluded from every rate.
//   on-time rate     on_time / decided
//   task completion  steps_done / steps_total across decided jobs only
//
// ONE CLUB CAN OWN THE COMPANY AVERAGE. In August six clubs sat between 72% and
// 87% task completion while Milwaukie sat at 3.8%, which pulled the pooled
// figure to 56%. A single headline number would have described a company-wide
// problem that six of seven clubs do not have, so the median travels beside the
// pooled figure and outliers are named.

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// A club this far below the median is not "a bit behind" — it is a different
// situation, and averaging it in describes nobody.
const OUTLIER_FRACTION_OF_MEDIAN = 0.5

function num(v) {
  if (v === null || v === undefined) return 0
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function rate(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

function median(values) {
  const xs = values.filter(v => v !== null && Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  const m = xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
  return Math.round(m * 10) / 10
}

function accum() {
  return { jobs: 0, decided: 0, onTime: 0, late: 0, missed: 0, notYetDue: 0, stepsTotal: 0, stepsDone: 0 }
}

function add(acc, r) {
  acc.jobs += num(r.jobs)
  acc.decided += num(r.decided)
  acc.onTime += num(r.on_time)
  acc.late += num(r.late)
  acc.missed += num(r.missed)
  acc.notYetDue += num(r.not_yet_due)
  acc.stepsTotal += num(r.steps_total)
  acc.stepsDone += num(r.steps_done)
  return acc
}

function withRates(acc, extra = {}) {
  return {
    ...extra,
    ...acc,
    taskPct: rate(acc.stepsDone, acc.stepsTotal),
    onTimeRate: rate(acc.onTime, acc.decided),
    missedRate: rate(acc.missed, acc.decided),
  }
}

/**
 * @param monthly    analytics_compliance_monthly rows
 * @param processes  analytics_compliance_by_process rows
 * @param dow        analytics_compliance_by_dow rows
 * @param opts       { priorMonthly, syncState, trendMonthly }
 */
function buildCompliance(monthly, processes, dow, opts = {}) {
  const rows = monthly || []

  // --- per club ------------------------------------------------------------
  const clubMap = new Map()
  for (const r of rows) {
    clubMap.set(r.slug, add(clubMap.get(r.slug) || accum(), r))
  }
  const byClub = [...clubMap.entries()]
    .map(([slug, acc]) => withRates(acc, { slug }))
    .sort((a, b) => (b.taskPct ?? -1) - (a.taskPct ?? -1))

  // --- pooled --------------------------------------------------------------
  const total = rows.reduce((acc, r) => add(acc, r), accum())
  const pooled = withRates(total)

  const clubPcts = byClub.map(c => c.taskPct)
  const medianTaskPct = median(clubPcts)

  // Named, not just flagged. "Milwaukie is at 3.8%" is actionable; "the average
  // is distorted" is not.
  const outliers = medianTaskPct === null ? [] : byClub.filter(
    c => c.taskPct !== null && c.taskPct < medianTaskPct * OUTLIER_FRACTION_OF_MEDIAN
  )

  // --- trend ---------------------------------------------------------------
  const trendRows = opts.trendMonthly || rows
  const monthMap = new Map()
  for (const r of trendRows) {
    const key = String(r.month).slice(0, 10)
    monthMap.set(key, add(monthMap.get(key) || accum(), r))
  }
  const months = [...monthMap.entries()]
    .map(([month, acc]) => withRates(acc, { month }))
    .sort((a, b) => a.month.localeCompare(b.month))

  // --- prior period --------------------------------------------------------
  const prior = (opts.priorMonthly || []).reduce((acc, r) => add(acc, r), accum())
  const priorTaskPct = rate(prior.stepsDone, prior.stepsTotal)

  // --- checklists ----------------------------------------------------------
  //
  // Kept per club. Pooled, the worst rows read as a company-wide collapse when
  // every one of those jobs belongs to a single club.
  const checklists = (processes || []).map(p => ({
    name: p.name,
    slug: p.slug,
    jobs: num(p.jobs),
    decided: num(p.decided),
    missed: num(p.missed),
    stepsTotal: num(p.steps_total),
    stepsDone: num(p.steps_done),
    taskPct: p.task_pct === null || p.task_pct === undefined ? null : num(p.task_pct),
  }))

  // A checklist that has run for months and never been opened is a different
  // problem from one that is merely behind, and worth separating out.
  const neverStarted = checklists.filter(c => c.stepsTotal > 0 && c.stepsDone === 0)

  const dowRows = (dow || []).map(d => ({
    dow: num(d.dow),
    label: DOW_NAMES[num(d.dow)] || String(d.dow),
    decided: num(d.decided),
    taskPct: d.task_pct === null || d.task_pct === undefined ? null : num(d.task_pct),
  }))

  return {
    summary: {
      taskPct: pooled.taskPct,
      medianClubTaskPct: medianTaskPct,
      onTimeRate: pooled.onTimeRate,
      decided: pooled.decided,
      missed: pooled.missed,
      // Surfaced rather than hidden: it is the count of jobs the report is
      // deliberately NOT judging, and a reader is entitled to see it.
      notYetDue: pooled.notYetDue,
      priorTaskPct,
      taskPctChange: priorTaskPct === null || pooled.taskPct === null
        ? null : Math.round((pooled.taskPct - priorTaskPct) * 10) / 10,
    },
    byClub,
    months,
    checklists,
    neverStarted,
    dow: dowRows,
    outliers: outliers.map(o => ({ slug: o.slug, taskPct: o.taskPct })),
    syncState: opts.syncState || [],
    notes: {
      outlier: outliers.length === 0 ? null
        : `${outliers.map(o => `${o.slug} (${o.taskPct}%)`).join(', ')} ` +
          `${outliers.length === 1 ? 'sits' : 'sit'} far below the other clubs and ` +
          `${outliers.length === 1 ? 'pulls' : 'pull'} the company figure of ${pooled.taskPct}% down. ` +
          `The median club is at ${medianTaskPct}%. Read the per-club bars rather than the average.`,
    },
  }
}

module.exports = {
  buildCompliance, DOW_NAMES, OUTLIER_FRACTION_OF_MEDIAN, median,
}
