import { useState, useEffect, useRef } from 'react'
import { getMembershipReport, getAppSettings } from '../../lib/api'
import { pct, gapInfo, monthRangesBetween } from '../../lib/kpiMath'
import DesktopLoading from '../DesktopLoading'

// Single-series trend with an optional dashed goal line. Hand-rolled inline SVG
// to match the existing report chart pattern (no charting dependency). Each
// plotted point is labeled with its value so the exact score is readable.
function KpiTrendChart({ points, goal }) {
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
          <text key={`v${p.key}`} x={toX(i)} y={toY(p.value) - 6} textAnchor="middle" className="fill-gray-600 font-semibold" style={{ fontSize: '8px' }}>{p.value}%</text>
        ))}
        {points.map((p, i) => (
          <text key={`l${p.key}`} x={toX(i)} y={h - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '8px' }}>{p.label}</text>
        ))}
      </svg>
      {goal != null && (
        <div className="flex items-center gap-1.5 mt-2 text-xs text-text-muted">
          <span className="inline-block w-4 h-0 border-t border-dashed" style={{ borderColor: '#e53e3e' }} />
          Goal {goal}%
        </div>
      )}
    </div>
  )
}

// Each KPI: how to read its current % from a /reports/membership response, and
// the app_config key prefix for its goal. Adding a future KPI = one entry here.
export const KPI_DEFS = [
  {
    key: 'trial',
    label: 'Trial Conversion',
    goalKey: 'kpi_goal_trial',
    derive: d => (d?.trial_conversion?.trial_started ? d.trial_conversion.rate : null),
  },
  {
    key: 'dayone',
    label: 'Day One Booking',
    goalKey: 'kpi_goal_dayone',
    derive: d => pct(d?.total_day_one_booked || 0, d?.total_memberships || 0),
  },
  {
    key: 'vip',
    label: 'VIP Booking',
    goalKey: 'kpi_goal_vip',
    derive: d => pct(d?.total_vips || 0, d?.total_memberships || 0),
  },
]

// Reads a goal for a def at the active location from the flat app_config map.
// Returns null for the all-locations view (goals are per-club only).
function goalFor(def, goals, locationSlug) {
  if (locationSlug === 'all') return null
  const raw = goals[`${def.goalKey}_${locationSlug}`]
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isNaN(n) ? null : n
}

// Parse a 'YYYY-MM-DD' string as a LOCAL date (avoids the UTC shift that
// `new Date(str)` applies to date-only strings).
function parseLocalDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Default comparison window: the trailing 12 calendar months ending today.
function defaultCompRange() {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  return { start: fmtDate(start), end: fmtDate(now) }
}

export default function KpiReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  // Shared comparison range for the trend graphs (defaults to last 12 months).
  const [comp, setComp] = useState(defaultCompRange)
  // trendByKey: { [defKey]: [{ key, label, value }] } for the open location+range.
  const [trendByKey, setTrendByKey] = useState(null)
  const [trendLoading, setTrendLoading] = useState(false)
  // Signature (location + comparison range) the cached trend was fetched for.
  const trendSigRef = useRef(null)
  const fetchToken = useRef(0)

  // The trend dataset depends only on location + comparison range, so key the
  // cache by that signature — switching which tile is open never refetches.
  const compSig = `${locationSlug}|${comp.start}|${comp.end}`

  useEffect(() => {
    let cancelled = false
    fetchToken.current += 1
    setLoading(true)
    setError(null)
    setOpenKey(null)
    setTrendByKey(null)
    setTrendLoading(false)
    Promise.all([
      getMembershipReport({ start_date: startDate, end_date: endDate, location_slug: locationSlug }),
      getAppSettings('kpi_goal_'),
    ])
      .then(([report, goalMap]) => {
        if (cancelled) return
        setData(report)
        setGoals(goalMap || {})
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Failed to load KPIs') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [startDate, endDate, locationSlug])

  // Lazily fetch the monthly trend whenever a tile is open and the cached data
  // is for a different location/range. One /reports/membership call per month,
  // run in parallel; per-month failures degrade to a gap (null), not a zero.
  useEffect(() => {
    if (!openKey) return
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
    Promise.all(
      ranges.map(r =>
        getMembershipReport({ start_date: r.start, end_date: r.end, location_slug: locationSlug })
          .then(rep => ({ ok: true, rep }))
          .catch(() => ({ ok: false, rep: null }))
      )
    ).then(results => {
      if (token !== fetchToken.current) return
      const byKey = {}
      for (const def of KPI_DEFS) {
        byKey[def.key] = ranges.map((r, i) => ({
          key: r.key,
          label: r.label,
          value: results[i].ok ? def.derive(results[i].rep) : null,
        }))
      }
      trendSigRef.current = compSig
      setTrendByKey(byKey)
    }).finally(() => {
      if (token === fetchToken.current) setTrendLoading(false)
    })
  }, [openKey, compSig, comp.start, comp.end, locationSlug])

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

  const isAll = locationSlug === 'all'
  const trendReady = trendSigRef.current === compSig && trendByKey

  return (
    <div className="space-y-3">
      {/* Shared comparison range — drives the monthly trend on every KPI graph. */}
      <div className="bg-surface rounded-xl border border-border p-4 flex items-center gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">Comparison Range</p>
          <p className="text-[11px] text-text-muted mt-0.5">Sets the months shown when you expand a KPI trend.</p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <label className="text-xs text-text-muted">From</label>
          <input
            type="date"
            value={comp.start}
            onChange={e => setComp(c => ({ ...c, start: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
          <label className="text-xs text-text-muted">To</label>
          <input
            type="date"
            value={comp.end}
            onChange={e => setComp(c => ({ ...c, end: e.target.value }))}
            className="px-3 py-1.5 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
        </div>
      </div>

      {KPI_DEFS.map(def => {
        const value = def.derive(data)
        const goal = goalFor(def, goals, locationSlug)
        const gap = gapInfo(value, goal)
        const open = openKey === def.key
        const points = trendReady ? trendByKey[def.key] : null
        return (
          <div key={def.key} className="bg-surface rounded-xl border border-border p-5">
            <button
              type="button"
              onClick={() => toggle(def.key)}
              aria-expanded={open}
              aria-controls={`kpi-trend-${def.key}`}
              className="w-full flex items-center gap-4 text-left"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-text-primary">{def.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{isAll ? 'All locations' : 'Current period'}</p>
              </div>
              <div className="ml-auto flex items-center gap-6 flex-shrink-0">
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-primary leading-none">
                    {value == null ? 'n/a' : `${value}%`}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Actual</p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-muted leading-none">{goal == null ? '—' : `${goal}%`}</p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Goal</p>
                </div>
                <div className="w-40 text-right">
                  {isAll ? (
                    <span className="text-xs text-text-muted">Goal: set per club</span>
                  ) : gap ? (
                    <span className={`text-xs font-semibold ${gap.tone === 'above' ? 'text-green-600' : 'text-red-500'}`}>
                      {gap.text}
                    </span>
                  ) : (
                    <span className="text-xs text-text-muted">Set a goal</span>
                  )}
                </div>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </button>

            {open && (
              <div id={`kpi-trend-${def.key}`}>
                {trendLoading && !points && (
                  <p className="text-xs text-text-muted mt-3">Loading trend…</p>
                )}
                {points && <KpiTrendChart points={points} goal={goal} />}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
