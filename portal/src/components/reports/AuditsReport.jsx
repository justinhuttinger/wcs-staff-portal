import { useMemo } from 'react'
import { getOperandioQaReports, getOperandioQaReport } from '../../lib/api'
import { openAuditReport } from '../../lib/qaReportHtml'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { LOCATION_NAMES } from '../../config/locations'
import DesktopLoading from '../DesktopLoading'

const CLUB_LABEL = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))

// One stable color per club for the multi-series trend lines.
const CLUB_COLORS = {
  salem: '#e53e3e',
  keizer: '#3b82f6',
  eugene: '#10b981',
  springfield: '#f59e0b',
  clackamas: '#a855f7',
  milwaukie: '#06b6d4',
  medford: '#84cc16',
}

function fmtQaDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return `${m}-${d}-${y}`
}

function fmtShortDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return y === new Date().getFullYear() ? `${m}/${d}` : `${m}/${d}/${String(y).slice(-2)}`
}

function SectionHeader({ title, sub }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className="bg-surface/95 backdrop-blur-sm rounded-lg border border-border px-3 py-1.5 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text-primary">{title}</h3>
      </div>
      {sub && <span className="text-xs text-text-muted">{sub}</span>}
      <div className="flex-1 h-px bg-border" />
    </div>
  )
}

// Time-scaled multi-series line chart: one line per club, x = submission
// date, y = audit score % (0-100). Hand-rolled inline SVG to match the
// existing report chart pattern (no charting dependency).
function DepartmentTrendChart({ rows }) {
  // rows: all audits in one department, any club, newest first.
  const series = useMemo(() => {
    const byClub = {}
    for (const r of rows) {
      if (r.score_pct == null || !r.submitted_date) continue
      if (!byClub[r.location_slug]) byClub[r.location_slug] = []
      byClub[r.location_slug].push(r)
    }
    for (const slug of Object.keys(byClub)) {
      byClub[slug].sort((a, b) => a.submitted_date.localeCompare(b.submitted_date))
    }
    return byClub
  }, [rows])

  const allDates = rows.filter(r => r.submitted_date && r.score_pct != null).map(r => r.submitted_date)
  if (allDates.length === 0) return null

  const minT = new Date(`${allDates.reduce((a, b) => (a < b ? a : b))}T00:00:00`).getTime()
  const maxT = new Date(`${allDates.reduce((a, b) => (a > b ? a : b))}T00:00:00`).getTime()
  const span = Math.max(maxT - minT, 1)

  const w = 600, h = 190, padL = 32, padR = 14, padT = 18, padB = 26
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const toX = dateStr => {
    const t = new Date(`${dateStr}T00:00:00`).getTime()
    return allDates.length === 1 ? padL + chartW / 2 : padL + ((t - minT) / span) * chartW
  }
  const toY = v => padT + chartH - (v / 100) * chartH

  // X ticks: one per unique submission date (audits are monthly, so few).
  const uniqueDates = [...new Set(allDates)].sort()

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '210px' }}>
        {[0, 50, 100].map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={toY(v)} y2={toY(v)} stroke="#e2e8f0" strokeWidth="0.5" />
            <text x={padL - 4} y={toY(v) + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{v}</text>
          </g>
        ))}
        {uniqueDates.map(d => (
          <text key={d} x={toX(d)} y={h - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '8px' }}>
            {fmtShortDate(d)}
          </text>
        ))}
        {Object.entries(series).map(([slug, pts]) => {
          const color = CLUB_COLORS[slug] || '#a8722c'
          const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.submitted_date).toFixed(1)},${toY(p.score_pct).toFixed(1)}`).join(' ')
          return (
            <g key={slug}>
              {pts.length > 1 && <path d={path} fill="none" stroke={color} strokeWidth="2" />}
              {pts.map(p => (
                <g key={p.id}>
                  <circle cx={toX(p.submitted_date)} cy={toY(p.score_pct)} r="3" fill={color} />
                  <text x={toX(p.submitted_date)} y={toY(p.score_pct) - 6} textAnchor="middle" className="fill-gray-600 font-semibold" style={{ fontSize: '8px' }}>
                    {p.score_pct}%
                  </text>
                </g>
              ))}
            </g>
          )
        })}
      </svg>
      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-text-muted">
        {Object.keys(series).map(slug => (
          <span key={slug} className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CLUB_COLORS[slug] || '#a8722c' }} />
            {CLUB_LABEL[slug] || slug}
          </span>
        ))}
      </div>
    </div>
  )
}

function AuditTable({ rows }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 overflow-x-auto">
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
          {rows.map(r => (
            <tr key={r.id} className="border-t border-border">
              <td className="py-1.5 text-text-primary whitespace-nowrap">{fmtQaDate(r.submitted_date)}</td>
              <td className="py-1.5 text-text-primary">{CLUB_LABEL[r.location_slug] || r.location_slug}</td>
              <td className="py-1.5 text-text-muted truncate max-w-[220px]" title={r.job_name}>{r.job_name}</td>
              <td className="py-1.5 text-right tabular-nums text-text-muted whitespace-nowrap">
                {r.score_achieved != null && r.score_possible != null ? `${r.score_achieved}/${r.score_possible}` : '—'}
              </td>
              <td className="py-1.5 text-right tabular-nums font-semibold text-text-primary">
                {r.score_pct != null ? `${r.score_pct}%` : 'n/a'}
              </td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => openAuditReport(r, getOperandioQaReport, CLUB_LABEL[r.location_slug] || r.location_slug)}
                  className="text-xs font-semibold text-wcs-red hover:text-wcs-red/80"
                >
                  View Report
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Experimental Audits report: every scored Operandio audit (monthly per club
// per department), grouped by department with change-over-time charts and the
// in-house HTML view of each audit. Audits are too infrequent for date-range
// filtering, so the full history always shows (location filter still applies).
export default function AuditsReport({ locationSlug }) {
  const { data, loading, error } = useCancellableFetch(
    (signal) => {
      const params = {}
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      return getOperandioQaReports(params, { signal })
    },
    [locationSlug]
  )

  const departments = useMemo(() => {
    const out = []
    const byDept = {}
    for (const r of (data?.rows || [])) {
      const dept = r.department || r.job_name || 'Unknown'
      if (!byDept[dept]) {
        byDept[dept] = { department: dept, rows: [] }
        out.push(byDept[dept])
      }
      byDept[dept].rows.push(r)
    }
    // Most-recently audited department first.
    out.sort((a, b) => (b.rows[0]?.submitted_date || '').localeCompare(a.rows[0]?.submitted_date || ''))
    return out
  }, [data])

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  if (departments.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">
        No audits submitted yet. Audits flow in automatically when they're submitted in Operandio.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {departments.map(dept => (
        <div key={dept.department} className="space-y-4">
          <SectionHeader
            title={dept.department}
            sub={`${dept.rows.length} audit${dept.rows.length === 1 ? '' : 's'} · last ${fmtQaDate(dept.rows[0]?.submitted_date)}`}
          />
          <DepartmentTrendChart rows={dept.rows} />
          <AuditTable rows={dept.rows} />
        </div>
      ))}
    </div>
  )
}
