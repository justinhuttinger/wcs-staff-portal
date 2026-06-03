import { useState, useEffect, useRef } from 'react'
import { getMembershipReport, getAppSettings } from '../../lib/api'
import { pct, gapInfo, monthRangesBetween } from '../../lib/kpiMath'
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
            const a = perClub ? def.derive(perClub[slug]) : null
            const g = goalForSlug(def, goals, slug)
            const hit = a != null && g != null && a >= g
            return (
              <tr key={slug} className="border-t border-border">
                <td className="py-1.5 text-text-primary">{CLUB_LABEL[slug] || slug}</td>
                <td className="py-1.5 text-right text-text-primary">{a == null ? 'n/a' : `${a}%`}</td>
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

export default function KpiReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [goals, setGoals] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [openKey, setOpenKey] = useState(null)
  // Shared comparison range for the trend graphs (defaults to last 6 months).
  const [comp, setComp] = useState(defaultCompRange)
  // trendByKey: { [defKey]: [{ key, label, value }] } for the open location+range.
  const [trendByKey, setTrendByKey] = useState(null)
  const [trendLoading, setTrendLoading] = useState(false)
  // perClub: { [slug]: membershipReport } for the current period (multi-club view).
  const [perClub, setPerClub] = useState(null)
  const trendSigRef = useRef(null)
  const fetchToken = useRef(0)

  const clubs = selectedClubSlugs(locationSlug)
  const isMulti = clubs.length > 1
  const compSig = `${locationSlug}|${comp.start}|${comp.end}`

  // Combined current-period data (aggregate across the selection) + goals.
  useEffect(() => {
    let cancelled = false
    fetchToken.current += 1
    setLoading(true)
    setError(null)
    setOpenKey(null)
    setTrendByKey(null)
    trendSigRef.current = null
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

  // Per-club current-period data — only when more than one club is selected.
  // Fetched eagerly so the collapsed tiles can show an "on goal" count.
  useEffect(() => {
    if (!isMulti) { setPerClub(null); return }
    let cancelled = false
    setPerClub(null) // clear stale rows when switching between multi-club selections
    Promise.all(
      clubs.map(slug =>
        getMembershipReport({ start_date: startDate, end_date: endDate, location_slug: slug })
          .then(rep => ({ slug, rep }))
          .catch(() => ({ slug, rep: null }))
      )
    ).then(results => {
      if (cancelled) return
      const map = {}
      for (const r of results) map[r.slug] = r.rep
      setPerClub(map)
    })
    return () => { cancelled = true }
  }, [isMulti, locationSlug, startDate, endDate])

  // Lazily fetch the monthly trend when a tile is open in single-club mode.
  // One /reports/membership call per month; per-month failures become gaps.
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

  return (
    <div className="space-y-3">
      {/* Compact comparison-range pill — only meaningful in single-club trend mode. */}
      {!isMulti && (
        <div className="flex justify-end">
          <ComparisonPill comp={comp} setComp={setComp} />
        </div>
      )}

      {KPI_DEFS.map(def => {
        const value = def.derive(data)
        const singleGoal = !isMulti ? goalForSlug(def, goals, clubs[0]) : null
        const gap = !isMulti ? gapInfo(value, singleGoal) : null
        const open = openKey === def.key

        // Multi-club: count how many selected clubs (with a goal) are on target.
        let onGoal = 0, withGoal = 0
        if (isMulti && perClub) {
          for (const slug of clubs) {
            const g = goalForSlug(def, goals, slug)
            if (g == null) continue
            withGoal++
            const a = def.derive(perClub[slug])
            if (a != null && a >= g) onGoal++
          }
        }
        const points = trendReady ? trendByKey[def.key] : null

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
                <p className="text-sm font-bold text-text-primary">{def.label}</p>
                <p className="text-xs text-text-muted mt-0.5">{isMulti ? `${clubs.length} clubs` : 'Current period'}</p>
              </div>
              <div className="ml-auto flex items-center gap-6 flex-shrink-0">
                <div className="text-right">
                  <p className="text-2xl font-bold text-text-primary leading-none">
                    {value == null ? 'n/a' : `${value}%`}
                  </p>
                  <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">{isMulti ? 'Combined' : 'Actual'}</p>
                </div>
                {!isMulti && (
                  <div className="text-right">
                    <p className="text-2xl font-bold text-text-muted leading-none">{singleGoal == null ? '—' : `${singleGoal}%`}</p>
                    <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Goal</p>
                  </div>
                )}
                <div className="w-40 text-right">
                  {isMulti ? (
                    !perClub ? (
                      <span className="text-xs text-text-muted">Loading clubs…</span>
                    ) : withGoal === 0 ? (
                      <span className="text-xs text-text-muted">No goals set</span>
                    ) : (
                      <span className={`text-xs font-semibold ${onGoal === withGoal ? 'text-green-600' : 'text-red-500'}`}>
                        {onGoal}/{withGoal} clubs on goal
                      </span>
                    )
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
              <div id={`kpi-detail-${def.key}`}>
                {isMulti ? (
                  !perClub ? (
                    <p className="text-xs text-text-muted mt-3">Loading clubs…</p>
                  ) : (
                    <PerClubGoalTable def={def} clubs={clubs} perClub={perClub} goals={goals} />
                  )
                ) : (
                  <>
                    {trendLoading && !points && (
                      <p className="text-xs text-text-muted mt-3">Loading trend…</p>
                    )}
                    {points && <KpiTrendChart points={points} goal={singleGoal} />}
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
