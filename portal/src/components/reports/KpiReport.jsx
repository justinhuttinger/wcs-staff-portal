import { useState, useEffect, useRef } from 'react'
import { getMembershipReport, getAppSettings, getSpeedToLead, getCancelsReport, getOperandioRange, getOperandioQaReports } from '../../lib/api'
import { pct, gapInfo, monthRangesBetween, median, mean, formatMinutes } from '../../lib/kpiMath'
import { LOCATION_NAMES } from '../../config/locations'
import DesktopLoading from '../DesktopLoading'

const ALL_CLUB_SLUGS = LOCATION_NAMES.map(n => n.toLowerCase())
const CLUB_LABEL = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))

// Resolve the location selector value ('all' | 'salem' | 'salem,eugene') into
// the concrete list of club slugs it represents, in canonical order.
function selectedClubSlugs(locationSlug) {
  if (!locationSlug || locationSlug === 'all') return ALL_CLUB_SLUGS
  const want = String(locationSlug).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  return ALL_CLUB_SLUGS.filter(s => want.includes(s))
}

// Single-series trend with an optional dashed goal line. Hand-rolled inline SVG
// to match the existing report chart pattern (no charting dependency). Each
// plotted point is labeled with its value so the exact score is readable.
function KpiTrendChart({ points, goal, format }) {
  if (!points || points.length === 0) return null
  const values = points.map(p => p.value).filter(v => v != null)
  const candidates = values.concat(goal != null ? [goal] : [])
  const maxVal = Math.max(...candidates, 1)
  const w = 600, h = 168, padL = 30, padR = 10, padT = 22, padB = 25
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const toX = i => padL + (points.length > 1 ? (i / (points.length - 1)) * chartW : chartW / 2)
  const toY = v => padT + chartH - (v / maxVal) * chartH

  // Build the actual-% path, breaking the line across null (missing) months.
  let path = ''
  points.forEach((p, i) => {
    if (p.value == null) { path += ' '; return }
    const prevNull = i === 0 || points[i - 1].value == null
    path += `${prevNull ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.value).toFixed(1)} `
  })

  const yLabels = [0, Math.round(maxVal / 2), maxVal]

  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-3">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Monthly Trend</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '190px' }}>
        {yLabels.map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={toY(v)} y2={toY(v)} stroke="#e2e8f0" strokeWidth="0.5" />
            <text x={padL - 4} y={toY(v) + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{v}</text>
          </g>
        ))}
        {goal != null && (
          <line x1={padL} x2={w - padR} y1={toY(goal)} y2={toY(goal)} stroke="#e53e3e" strokeWidth="1" strokeDasharray="4 3" />
        )}
        <path d={path.trim()} fill="none" stroke="#38a169" strokeWidth="2" />
        {points.map((p, i) => p.value != null && (
          <circle key={`c${p.key}`} cx={toX(i)} cy={toY(p.value)} r="2.5" fill="#38a169" />
        ))}
        {/* Value label above each point so the exact score is readable. */}
        {points.map((p, i) => p.value != null && (
          <text key={`v${p.key}`} x={toX(i)} y={toY(p.value) - 6} textAnchor="middle" className="fill-gray-600 font-semibold" style={{ fontSize: '8px' }}>
            {format === 'minutes' ? formatMinutes(p.value) : `${p.value}%`}
          </text>
        ))}
        {points.map((p, i) => (
          <text key={`l${p.key}`} x={toX(i)} y={h - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '8px' }}>{p.label}</text>
        ))}
      </svg>
      {goal != null && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-text-muted">
          <span className="inline-block w-4 h-0 border-t border-dashed" style={{ borderColor: '#e53e3e' }} />
          Goal {format === 'minutes' ? formatMinutes(goal) : `${goal}%`}
        </div>
      )}
    </div>
  )
}

// Reads a goal for a def at a specific club slug from the flat app_config map.
function goalForSlug(def, goals, slug) {
  const raw = goals[`${def.goalKey}_${slug}`]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

// Per-club goal status, shown when more than one club is selected so each
// club's standing is visible without switching the location filter.
function PerClubGoalTable({ def, clubs, perClub, goals }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted">
            <th className="text-left font-semibold py-1">Club</th>
            <th className="text-right font-semibold py-1">Actual</th>
            <th className="text-right font-semibold py-1">Goal</th>
            <th className="text-right font-semibold py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map(slug => {
            const a = perClub ? def.derive(perClub[slug]?.[def.source]) : null
            const g = goalForSlug(def, goals, slug)
            const hit = onTarget(def, a, g)
            return (
              <tr key={slug} className="border-t border-border">
                <td className="py-1.5 text-text-primary">{CLUB_LABEL[slug] || slug}</td>
                <td className="py-1.5 text-right text-text-primary">{formatValue(def, a)}</td>
                <td className="py-1.5 text-right text-text-muted">{g == null ? '—' : formatValue(def, g)}</td>
                <td className="py-1.5 text-right">
                  {g == null ? (
                    <span className="text-text-muted text-xs">No goal</span>
                  ) : a == null ? (
                    <span className="text-text-muted text-xs">n/a</span>
                  ) : hit ? (
                    <span className="text-green-600 font-semibold text-xs">Hit</span>
                  ) : (
                    <span className="text-red-500 font-semibold text-xs">Missed</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Multi-club view for timeless audit KPIs: each club's MOST RECENT audit
// score against its goal, plus when that audit was submitted (the cadence is
// irregular, so the date matters as much as the score).
function QaPerClubTable({ def, clubs, latestByClub, goals }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted">
            <th className="text-left font-semibold py-1">Club</th>
            <th className="text-right font-semibold py-1">Latest Score</th>
            <th className="text-right font-semibold py-1">Last Submitted</th>
            <th className="text-right font-semibold py-1">Goal</th>
            <th className="text-right font-semibold py-1">Status</th>
          </tr>
        </thead>
        <tbody>
          {clubs.map(slug => {
            const r = latestByClub?.[slug]
            const a = r?.score_pct ?? null
            const g = goalForSlug(def, goals, slug)
            const hit = onTarget(def, a, g)
            return (
              <tr key={slug} className="border-t border-border">
                <td className="py-1.5 text-text-primary">{CLUB_LABEL[slug] || slug}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{a == null ? 'n/a' : `${a}%`}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted whitespace-nowrap">{r?.submitted_date || 'Never'}</td>
                <td className="py-1.5 text-right text-text-muted">{g == null ? '—' : `${g}%`}</td>
                <td className="py-1.5 text-right">
                  {g == null ? (
                    <span className="text-text-muted text-xs">No goal</span>
                  ) : a == null ? (
                    <span className="text-text-muted text-xs">n/a</span>
                  ) : hit ? (
                    <span className="text-green-600 font-semibold text-xs">Hit</span>
                  ) : (
                    <span className="text-red-500 font-semibold text-xs">Missed</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// Individual audit submissions (newest first) — these arrive on an irregular
// (roughly monthly) cadence, so each row shows its submission date plus a
// link that opens the full scored report in Operandio in a new window.
function SubmissionsList({ rows }) {
  const list = rows || []
  if (list.length === 0) {
    return <p className="text-xs text-text-muted mt-3">No audits submitted yet.</p>
  }
  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-3 overflow-x-auto">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Submissions</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted">
            <th className="text-left font-semibold py-1">Date</th>
            <th className="text-left font-semibold py-1">Club</th>
            <th className="text-left font-semibold py-1">Audit</th>
            <th className="text-right font-semibold py-1">Score</th>
            <th className="text-right font-semibold py-1">%</th>
            <th className="text-right font-semibold py-1"></th>
          </tr>
        </thead>
        <tbody>
          {list.map(r => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1.5 text-text-primary whitespace-nowrap">{r.submitted_date}</td>
              <td className="py-1.5 text-text-primary">{CLUB_LABEL[r.location_slug] || r.location_slug}</td>
              <td className="py-1.5 text-text-muted truncate max-w-[220px]" title={r.job_name}>{r.job_name}</td>
              <td className="py-1.5 text-right tabular-nums text-text-muted whitespace-nowrap">
                {r.score_achieved != null && r.score_possible != null ? `${r.score_achieved}/${r.score_possible}` : '—'}
              </td>
              <td className="py-1.5 text-right tabular-nums font-semibold text-text-primary">
                {r.score_pct != null ? `${r.score_pct}%` : 'n/a'}
              </td>
              <td className="py-1.5 text-right">
                {r.report_url ? (
                  <button
                    type="button"
                    onClick={() => window.open(r.report_url, '_blank', 'noopener')}
                    className="text-xs font-semibold text-wcs-red hover:text-wcs-red/80"
                  >
                    View Report
                  </button>
                ) : (
                  <span className="text-xs text-text-muted">No report</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Parse a 'YYYY-MM-DD' string as a LOCAL date (avoids the UTC shift that
// `new Date(str)` applies to date-only strings).
function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

// Default comparison window: the trailing 6 calendar months ending today.
function defaultCompRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  return { start: fmtDate(start), end: fmtDate(now) }
}

// Compact, tucked-away control for the trend comparison range. Shows a small
// pill with the current range; clicking opens a popover with From/To inputs.
function ComparisonPill({ comp, setComp }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border border-border bg-bg text-text-muted hover:text-text-primary transition-colors"
        title="Change the trend comparison range"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
        </svg>
        Trend: {comp.start} to {comp.end}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-64 bg-surface border border-border rounded-xl shadow-lg p-3 space-y-2">
          <p className="text-[11px] uppercase tracking-wide font-semibold text-text-muted">Comparison Range</p>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted w-9">From</label>
            <input
              type="date"
              value={comp.start}
              onChange={e => setComp(c => ({ ...c, start: e.target.value }))}
              className="flex-1 px-2 py-1 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:border-wcs-red"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-muted w-9">To</label>
            <input
              type="date"
              value={comp.end}
              onChange={e => setComp(c => ({ ...c, end: e.target.value }))}
              className="flex-1 px-2 py-1 rounded-lg border border-border bg-bg text-text-primary text-xs focus:outline-none focus:border-wcs-red"
            />
          </div>
          <div className="flex justify-between pt-1">
            <button
              type="button"
              onClick={() => setComp(defaultCompRange())}
              className="text-[11px] text-text-muted hover:text-text-primary font-semibold"
            >
              Last 6 months
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] text-wcs-red hover:text-wcs-red/80 font-semibold"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Each KPI: how to read its current value from its source response, and
// the app_config key prefix for its goal. Adding a future KPI = one entry here.
// source: which fetcher to use (keys of SOURCE_FETCHERS).
// format: 'minutes' for duration KPIs; default is percentage.
// lowerIsBetter: true for duration KPIs (lower response time = better).
export const KPI_DEFS = [
  { key: 'trial', label: 'Trial Conversion', goalKey: 'kpi_goal_trial', source: 'membership',
    derive: d => (d?.trial_conversion?.trial_started ? d.trial_conversion.rate : null) },
  { key: 'dayone', label: 'Day One Attachment', goalKey: 'kpi_goal_dayone', source: 'membership',
    derive: d => pct(d?.total_day_one_booked || 0, d?.total_memberships || 0) },
  { key: 'vip', label: 'VIP Collection Percentage', goalKey: 'kpi_goal_vip', source: 'membership',
    derive: d => pct(d?.total_vips || 0, d?.total_memberships || 0) },
  { key: 'speed', label: 'Speed to Lead', goalKey: 'kpi_goal_speed', source: 'speed',
    format: 'minutes', lowerIsBetter: true,
    derive: d => (d?.contacted_count ? d.median_minutes : null) },
  // Average of the daily Operandio overall scores in range (weekly rows are
  // skipped so they don't double-count) — same math as the Operations report.
  { key: 'ops', label: 'Operational Compliance', goalKey: 'kpi_goal_ops', source: 'operations',
    derive: d => mean((d?.rows || []).filter(r => r.period_start === r.period_end).map(r => r.overall_pct)) },
  // Share of Cancelled members that went through Click2Save. Member-level
  // match computed server-side (c2s_utilization): of the membership
  // (non-insurance) members whose cancel took effect in range, how many have a
  // matching C2S CANCEL request. Bounded at 100% — comparing raw event counts
  // to effective cancels overshoots because requests precede effective dates.
  { key: 'c2s', label: 'Click2Save Utilization', goalKey: 'kpi_goal_c2s', source: 'cancels',
    derive: d => (d?.c2s_utilization
      ? pct(d.c2s_utilization.via_c2s, d.c2s_utilization.cancelled_members)
      : null) },
  // QA-Cleaning audits submitted in Operandio by leadership on an irregular
  // (roughly monthly) cadence. `timeless`: the fetch ignores the report date
  // range and the value is each club's MOST RECENT audit score (averaged when
  // multiple clubs are selected) — audits are too infrequent for date-range
  // math. The trend plots one point per submission instead of month buckets,
  // and hasSubmissions lists each audit with a link to the Operandio report.
  { key: 'qa', label: 'Cleanliness - Quality Assessment', goalKey: 'kpi_goal_qa', source: 'qa',
    hasSubmissions: true, timeless: true,
    derive: d => {
      const latest = Object.values(latestQaByClub(d)).map(r => r.score_pct).filter(v => v != null)
      return latest.length ? mean(latest) : null
    } },
]

const SOURCE_FETCHERS = {
  membership: (params, opts) => getMembershipReport(params, opts),
  speed: (params, opts) => getSpeedToLead(params, opts),
  operations: (params, opts) => getOperandioRange(params, opts),
  cancels: (params, opts) => getCancelsReport(params, opts),
  qa: (params, opts) => getOperandioQaReports(params, opts),
}
const DISTINCT_SOURCES = [...new Set(KPI_DEFS.map(d => d.source))]
// Sources still needing the per-club (date-bound) fetch in multi-club view —
// timeless defs derive per-club values from their combined dateless response.
const PER_CLUB_SOURCES = [...new Set(KPI_DEFS.filter(d => !d.timeless).map(d => d.source))]

// Most recent audit per club (the /qa-reports rows arrive newest-first).
function latestQaByClub(d) {
  const out = {}
  for (const r of (d?.rows || [])) {
    if (!out[r.location_slug]) out[r.location_slug] = r
  }
  return out
}

// Compact date label for per-submission trend points: "6/5", with a 2-digit
// year tacked on once the data spans into earlier years.
function fmtSubmittedLabel(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return y === new Date().getFullYear() ? `${m}/${d}` : `${m}/${d}/${String(y).slice(-2)}`
}

// Per-club KPI toggle, set in Admin → KPI Goals. '1' = this KPI is turned off
// for this club: hidden in its single-club view, excluded from the blended
// combined number and the per-club tables in multi-club view.
function offFor(settings, def, slug) {
  return settings[`kpi_off_${def.key}_${slug}`] === '1'
}

// Resolve which of the selected clubs have this KPI enabled, plus the
// location_slug param + cache key for the combined fetch. When every selected
// club is enabled the original selector value is reused so 'all' stays 'all'.
function planFor(settings, def, clubs, locationSlug) {
  const enabled = clubs.filter(s => !offFor(settings, def, s))
  const slugParam = enabled.length === clubs.length ? locationSlug : enabled.join(',')
  return { enabled, slugParam, key: `${def.source}|${slugParam}` }
}

function formatValue(def, v) {
  if (v == null) return 'n/a'
  return def.format === 'minutes' ? formatMinutes(v) : `${v}%`
}
function gapFor(def, value, goal) {
  return gapInfo(value, goal, { lowerIsBetter: !!def.lowerIsBetter, unit: def.format === 'minutes' ? 'm' : '%' })
}
// Big-number rendering of the goal gap: "+5%" / "-12m" with a caption like
// "Above goal" — matches the Actual/Goal stat columns instead of small text.
function gapValueText(def, gap) {
  if (gap.diff === 0) return 'Met'
  const unit = def.format === 'minutes' ? 'm' : '%'
  return `${gap.diff > 0 ? '+' : ''}${gap.diff}${unit}`
}
function gapCaption(def, gap) {
  if (gap.diff === 0) return 'Goal met'
  if (def.lowerIsBetter) return gap.tone === 'above' ? 'Under goal' : 'Over goal'
  return gap.tone === 'above' ? 'Above goal' : 'Below goal'
}
function onTarget(def, value, goal) {
  if (value == null || goal == null) return false
  return def.lowerIsBetter ? value <= goal : value >= goal
}

export default function KpiReport({ startDate, endDate, locationSlug }) {
  // dataByPlan: { '<source>|<slugParam>': response } — one entry per unique
  // (source, enabled-club-set) combination among the KPI defs.
  const [dataByPlan, setDataByPlan] = useState(null)
  // goals holds ALL kpi_* app settings: kpi_goal_* values + kpi_off_* toggles.
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  // Shared comparison range for the trend graphs (defaults to last 6 months).
  const [comp, setComp] = useState(defaultCompRange)
  // trendByKey: { [defKey]: [{ key, label, value }] } for the open location+range.
  const [trendByKey, setTrendByKey] = useState(null)
  const [trendLoading, setTrendLoading] = useState(false)
  // perClub: { [slug]: { [source]: response } } for the current period (multi-club view).
  const [perClub, setPerClub] = useState(null)
  const trendSigRef = useRef(null)
  const fetchToken = useRef(0)

  const clubs = selectedClubSlugs(locationSlug)
  const isMulti = clubs.length > 1
  const compSig = `${locationSlug}|${comp.start}|${comp.end}`

  // Combined current-period data (aggregate across the selection) + goals.
  // Settings load first so per-club KPI toggles can shape which clubs each
  // KPI's combined fetch includes (the blended number excludes off clubs).
  useEffect(() => {
    let cancelled = false
    fetchToken.current += 1
    setLoading(true)
    setError(null)
    setOpenKey(null)
    setTrendByKey(null)
    trendSigRef.current = null
    setTrendLoading(false)
    ;(async () => {
      try {
        const settingsMap = (await getAppSettings('kpi_')) || {}
        if (cancelled) return
        setGoals(settingsMap)
        const clubsNow = selectedClubSlugs(locationSlug)
        const plans = new Map()
        for (const def of KPI_DEFS) {
          const p = planFor(settingsMap, def, clubsNow, locationSlug)
          if (p.enabled.length === 0) continue
          plans.set(p.key, { source: def.source, slugParam: p.slugParam, timeless: !!def.timeless })
        }
        const pairs = await Promise.all([...plans.entries()].map(([key, p]) =>
          SOURCE_FETCHERS[p.source](p.timeless
            ? { location_slug: p.slugParam }
            : { start_date: startDate, end_date: endDate, location_slug: p.slugParam })
            .then(r => [key, r]).catch(() => [key, null])
        ))
        if (cancelled) return
        setDataByPlan(Object.fromEntries(pairs))
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load KPIs')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  // Per-club current-period data — only when more than one club is selected.
  // Fetched eagerly so the collapsed tiles can show an "on goal" count.
  useEffect(() => {
    if (!isMulti) { setPerClub(null); return }
    let cancelled = false
    setPerClub(null) // clear stale rows when switching between multi-club selections
    Promise.all(clubs.map(async slug => {
      const pairs = await Promise.all(PER_CLUB_SOURCES.map(s =>
        SOURCE_FETCHERS[s]({ start_date: startDate, end_date: endDate, location_slug: slug })
          .then(r => [s, r]).catch(() => [s, null])
      ))
      return [slug, Object.fromEntries(pairs)]
    })).then(results => { if (!cancelled) setPerClub(Object.fromEntries(results)) })
    return () => { cancelled = true }
  }, [isMulti, locationSlug, startDate, endDate])

  // Lazily fetch the monthly trend when a tile is open in single-club mode.
  // One call per source per month; per-month failures become gaps.
  useEffect(() => {
    if (isMulti || !openKey) return
    if (trendSigRef.current === compSig) return
    const token = ++fetchToken.current
    const ranges = monthRangesBetween(parseLocalDate(comp.start), parseLocalDate(comp.end))
    if (ranges.length === 0) {
      trendSigRef.current = compSig
      setTrendByKey({})
      setTrendLoading(false)
      return
    }
    setTrendLoading(true)
    ;(async () => {
      try {
        // Only fetch sources still needed once per-club KPI toggles are applied
        // (e.g. skip the Operandio calls if Operational Compliance is off here).
        // Timeless defs (QA audits) build their trend from the combined
        // dateless response — no monthly refetches.
        const activeDefs = KPI_DEFS.filter(def => !def.timeless && clubs.some(s => !offFor(goals, def, s)))
        const activeSources = [...new Set(activeDefs.map(d => d.source))]
        const perMonth = await Promise.all(ranges.map(async r => {
          const pairs = await Promise.all(activeSources.map(s =>
            SOURCE_FETCHERS[s]({ start_date: r.start, end_date: r.end, location_slug: locationSlug })
              .then(x => [s, x]).catch(() => [s, null])
          ))
          return { range: r, bySource: Object.fromEntries(pairs) }
        }))
        if (token !== fetchToken.current) return
        const byKey = {}
        for (const def of activeDefs) {
          byKey[def.key] = perMonth.map(({ range, bySource }) => ({
            key: range.key, label: range.label, value: def.derive(bySource[def.source]),
          }))
        }
        trendSigRef.current = compSig
        setTrendByKey(byKey)
      } finally {
        if (token === fetchToken.current) setTrendLoading(false)
      }
    })()
  }, [isMulti, openKey, compSig, comp.start, comp.end, locationSlug])

  function toggle(key) {
    setOpenKey(prev => (prev === key ? null : key))
  }

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center text-red-500">
        {error}
      </div>
    )
  }

  const trendReady = trendSigRef.current === compSig && trendByKey

  // KPIs turned off for every selected club disappear from the report.
  const visibleDefs = KPI_DEFS.filter(def => clubs.some(s => !offFor(goals, def, s)))

  return (
    <div className="space-y-3">
      {/* Compact comparison-range pill — only meaningful in single-club trend mode. */}
      {!isMulti && (
        <div className="flex justify-end">
          <ComparisonPill comp={comp} setComp={setComp} />
        </div>
      )}

      {visibleDefs.length === 0 && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">
          All KPIs are turned off for this selection. Re-enable them in Admin → KPI Goals.
        </div>
      )}

      {visibleDefs.map(def => {
        const plan = planFor(goals, def, clubs, locationSlug)
        const planData = dataByPlan?.[plan.key]
        const value = def.derive(planData)
        const singleGoal = !isMulti ? goalForSlug(def, goals, clubs[0]) : null
        const gap = !isMulti ? gapFor(def, value, singleGoal) : null
        const open = openKey === def.key

        // Timeless defs (QA audits): per-club latest values come straight from
        // the combined dateless response — no per-club fetches needed.
        const latestByClub = def.timeless ? latestQaByClub(planData) : null

        // Multi-club: count how many enabled clubs (with a goal) are on target.
        let onGoal = 0, withGoal = 0
        const perClubReady = def.timeless ? !!planData : !!perClub
        if (isMulti && perClubReady) {
          for (const slug of plan.enabled) {
            const g = goalForSlug(def, goals, slug)
            if (g == null) continue
            withGoal++
            const a = def.timeless
              ? (latestByClub[slug]?.score_pct ?? null)
              : def.derive(perClub[slug]?.[def.source])
            if (onTarget(def, a, g)) onGoal++
          }
        }
        // Timeless trend: one point per submission (oldest → newest); others
        // use the lazily-fetched monthly buckets.
        const points = def.timeless
          ? (planData?.rows || []).slice().reverse().filter(r => r.score_pct != null)
              .map(r => ({ key: r.id, label: fmtSubmittedLabel(r.submitted_date), value: r.score_pct }))
          : (trendReady ? trendByKey[def.key] : null)

        return (
          <div key={def.key} className="bg-surface rounded-xl border border-border p-5">
            <button
              type="button"
              onClick={() => toggle(def.key)}
              aria-expanded={open}
              aria-controls={`kpi-detail-${def.key}`}
              className="w-full flex items-center gap-4 text-left"
            >
              <div className="min-w-0">
                <p className="text-lg font-bold text-text-primary">{def.label}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {isMulti
                    ? `${plan.enabled.length} club${plan.enabled.length === 1 ? '' : 's'}`
                    : def.timeless
                      ? (latestByClub?.[clubs[0]]
                          ? `Last submitted ${fmtSubmittedLabel(latestByClub[clubs[0]].submitted_date)}`
                          : 'No audits yet')
                      : 'Current period'}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-6 flex-shrink-0">
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-primary leading-none">
                    {formatValue(def, value)}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">
                    {def.timeless ? (isMulti ? 'Avg of latest' : 'Latest') : (isMulti ? 'Combined' : 'Actual')}
                  </p>
                </div>
                {!isMulti && (
                  <div className="text-right">
                    <p className="text-2xl font-bold text-text-muted leading-none">{singleGoal == null ? '—' : formatValue(def, singleGoal)}</p>
                    <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Goal</p>
                  </div>
                )}
                <div className="w-40 text-right">
                  {isMulti ? (
                    !perClubReady ? (
                      <span className="text-sm text-text-muted">Loading clubs…</span>
                    ) : withGoal === 0 ? (
                      <span className="text-sm text-text-muted">No goals set</span>
                    ) : (
                      <>
                        <p className={`text-2xl font-bold leading-none ${onGoal === withGoal ? 'text-green-600' : 'text-red-500'}`}>
                          {onGoal}/{withGoal}
                        </p>
                        <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Clubs on goal</p>
                      </>
                    )
                  ) : gap ? (
                    <>
                      <p className={`text-2xl font-bold leading-none ${gap.tone === 'above' ? 'text-green-600' : 'text-red-500'}`}>
                        {gapValueText(def, gap)}
                      </p>
                      <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">{gapCaption(def, gap)}</p>
                    </>
                  ) : (
                    <span className="text-sm text-text-muted">Set a goal</span>
                  )}
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {open && (
              <div id={`kpi-detail-${def.key}`}>
                {isMulti ? (
                  def.timeless ? (
                    <QaPerClubTable def={def} clubs={plan.enabled} latestByClub={latestByClub} goals={goals} />
                  ) : !perClub ? (
                    <p className="text-xs text-text-muted mt-3">Loading clubs…</p>
                  ) : (
                    <PerClubGoalTable def={def} clubs={plan.enabled} perClub={perClub} goals={goals} />
                  )
                ) : (
                  <>
                    {!def.timeless && trendLoading && !points && (
                      <p className="text-xs text-text-muted mt-3">Loading trend…</p>
                    )}
                    {points && points.length > 0 && <KpiTrendChart points={points} goal={singleGoal} format={def.format} />}
                  </>
                )}
                {def.hasSubmissions && (
                  <SubmissionsList rows={planData?.rows} />
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
