// Nightly KPI snapshot job.
//
// Freezes each club's KPIs at end of day so the KPI report's History view can be
// scrolled day by day to find exactly when a metric degraded. Stored `value` is
// the MONTH-TO-DATE value as of the snapshot day (a stable running number);
// numerator/denominator/sample_size keep the raw inputs so a true single-day
// figure can also be derived. Runs 11:55pm Pacific; snapshot_date = that Pacific
// day. No backfill — history starts the day this deploys.
//
// Opt out with KPI_SNAPSHOT_DISABLED=1.

const cron = require('node-cron')
const { supabaseAdmin } = require('./supabase')
const { ALL_SLUGS } = require('../utils/locationSlug')
const { computeKpisForClub, KPI_KEYS } = require('./kpiCompute')

let running = false

// 'YYYY-MM-DD' for the given (or current) instant in Pacific time.
function pacificDate(d = new Date()) {
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
}

// All kpi_* app settings as a flat { key: value } map (goals + toggles).
async function loadKpiSettings() {
  const { data, error } = await supabaseAdmin
    .from('app_config')
    .select('key, value')
    .like('key', 'kpi_%')
  if (error) throw error
  const out = {}
  for (const r of (data || [])) out[r.key] = r.value
  return out
}

function goalFor(settings, kpiKey, slug) {
  const raw = settings[`kpi_goal_${kpiKey}_${slug}`]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

// Compute + upsert one day's snapshot for every club. `snapshotDate` is a
// Pacific YYYY-MM-DD; the MTD window is the 1st of that month through that day.
async function runSnapshot(snapshotDate = pacificDate()) {
  if (running) {
    console.warn('[kpiSnapshot] run already in progress — skipping')
    return { skipped: true }
  }
  running = true
  const monthStart = snapshotDate.slice(0, 8) + '01'
  const rows = []
  try {
    const settings = await loadKpiSettings()
    for (const slug of ALL_SLUGS) {
      let kpis
      try {
        kpis = await computeKpisForClub(slug, monthStart, snapshotDate)
      } catch (err) {
        console.error(`[kpiSnapshot] compute failed for ${slug}:`, err.message)
        continue
      }
      for (const key of KPI_KEYS) {
        const k = kpis[key] || { value: null }
        rows.push({
          snapshot_date: snapshotDate,
          location_slug: slug,
          kpi_key: key,
          value: k.value == null ? null : k.value,
          goal: goalFor(settings, key, slug),
          numerator: k.numerator == null ? null : k.numerator,
          denominator: k.denominator == null ? null : k.denominator,
          sample_size: k.sample_size == null ? null : k.sample_size,
        })
      }
    }

    if (rows.length) {
      const { error } = await supabaseAdmin
        .from('kpi_daily_snapshots')
        .upsert(rows, { onConflict: 'snapshot_date,location_slug,kpi_key' })
      if (error) throw error
    }
    console.log(`[kpiSnapshot] stored ${rows.length} rows for ${snapshotDate} (MTD from ${monthStart})`)
    return { snapshot_date: snapshotDate, month_start: monthStart, rows: rows.length }
  } finally {
    running = false
  }
}

function start() {
  if (process.env.KPI_SNAPSHOT_DISABLED === '1') {
    console.log('[kpiSnapshot] disabled via KPI_SNAPSHOT_DISABLED=1')
    return
  }
  // 11:55pm Pacific — captures the full day before it rolls over.
  cron.schedule('55 23 * * *', () => {
    runSnapshot().catch(err => console.error('[kpiSnapshot] nightly run failed:', err.message))
  }, { timezone: 'America/Los_Angeles' })
  console.log('[kpiSnapshot] scheduled — nightly 11:55pm PT')
}

module.exports = { start, runSnapshot, pacificDate }
