import { useState, useEffect, useRef } from 'react'
import { getMembershipReport, getAppSettings } from '../../lib/api'
import { pct, gapInfo, trendDirection, monthRanges } from '../../lib/kpiMath'
import DesktopLoading from '../DesktopLoading'

// Single-series trend with an optional dashed goal line. Hand-rolled inline SVG
// to match the existing report chart pattern (no charting dependency).
function KpiTrendChart({ points, goal }) {
  if (!points || points.length === 0) return null
  const values = points.map(p => p.value).filter(v => v != null)
  const candidates = values.concat(goal != null ? [goal] : [])
  const maxVal = Math.max(...candidates, 1)
  const w = 600, h = 160, padL = 30, padR = 10, padT = 10, padB = 25
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
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Last 6 Months</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '180px' }}>
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
          <circle key={p.label} cx={toX(i)} cy={toY(p.value)} r="2.5" fill="#38a169" />
        ))}
        {points.map((p, i) => (
          <text key={`l${i}`} x={toX(i)} y={h - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '8px' }}>{p.label}</text>
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

export default function KpiReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  // trendByKey: { [defKey]: [{ label, value }] } for the open location.
  const [trendByKey, setTrendByKey] = useState(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const fetchToken = useRef(0)

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

  // Lazily fetch the 6-month trend the first time any tile is expanded for the
  // current location. One /reports/membership call per month, run in parallel.
  function ensureTrend() {
    if (trendByKey || trendLoading) return
    setTrendLoading(true)
    const token = fetchToken.current
    const ranges = monthRanges(new Date(), 6)
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
          label: r.label,
          value: results[i].ok ? def.derive(results[i].rep) : null,
        }))
      }
      setTrendByKey(byKey)
    }).finally(() => {
      if (token === fetchToken.current) setTrendLoading(false)
    })
  }

  function toggle(key) {
    setOpenKey(prev => (prev === key ? null : key))
    ensureTrend()
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

  return (
    <div className="space-y-3">
      {KPI_DEFS.map(def => {
        const value = def.derive(data)
        const goal = goalFor(def, goals, locationSlug)
        const gap = gapInfo(value, goal)
        const open = openKey === def.key
        const points = trendByKey?.[def.key] || null
        const dir = points ? trendDirection(points, goal) : null
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
                {points && (
                  <>
                    {dir && (
                      <p className={`text-xs font-medium mt-3 ${dir === 'toward' ? 'text-green-600' : dir === 'away' ? 'text-red-500' : 'text-text-muted'}`}>
                        {dir === 'toward' ? 'Trending toward goal' : dir === 'away' ? 'Trending away from goal' : 'Holding steady'}
                      </p>
                    )}
                    <KpiTrendChart points={points} goal={goal} />
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
