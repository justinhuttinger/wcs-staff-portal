import { useState, useMemo } from 'react'
import { getOperandioQaReports, getOperandioQaReport, getAppSettings } from '../../lib/api'
import { openAuditReport } from '../../lib/qaReportHtml'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { LOCATION_NAMES } from '../../config/locations'
import DesktopLoading from '../DesktopLoading'

const CLUB_LABEL = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))

// Settings key fragment for a department — must match AUDITS keys in
// AuditTogglesAdmin.jsx ("Front Desk Audit" -> "front_desk_audit").
function auditKey(department) {
  return (department || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
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

// Change-over-time chart for one department at one club: one point per audit
// submission. Hand-rolled inline SVG to match the KPI trend chart pattern.
function AuditTrendChart({ rows }) {
  const pts = rows
    .filter(r => r.score_pct != null && r.submitted_date)
    .slice()
    .sort((a, b) => a.submitted_date.localeCompare(b.submitted_date))
  if (pts.length === 0) return null

  const w = 600, h = 168, padL = 30, padR = 10, padT = 22, padB = 25
  const chartW = w - padL - padR
  const chartH = h - padT - padB
  const toX = i => padL + (pts.length > 1 ? (i / (pts.length - 1)) * chartW : chartW / 2)
  const toY = v => padT + chartH - (v / 100) * chartH
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(p.score_pct).toFixed(1)}`).join(' ')

  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-3">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Change Over Time</p>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: '190px' }}>
        {[0, 50, 100].map(v => (
          <g key={v}>
            <line x1={padL} x2={w - padR} y1={toY(v)} y2={toY(v)} stroke="#e2e8f0" strokeWidth="0.5" />
            <text x={padL - 4} y={toY(v) + 3} textAnchor="end" className="fill-gray-400" style={{ fontSize: '8px' }}>{v}</text>
          </g>
        ))}
        {pts.length > 1 && <path d={path} fill="none" stroke="#38a169" strokeWidth="2" />}
        {pts.map((p, i) => (
          <g key={p.id}>
            <circle cx={toX(i)} cy={toY(p.score_pct)} r="2.5" fill="#38a169" />
            <text x={toX(i)} y={toY(p.score_pct) - 6} textAnchor="middle" className="fill-gray-600 font-semibold" style={{ fontSize: '8px' }}>
              {p.score_pct}%
            </text>
            <text x={toX(i)} y={h - 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: '8px' }}>
              {fmtShortDate(p.submitted_date)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function AuditTable({ rows }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 mt-3 overflow-x-auto">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-3">Submissions</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wide text-text-muted">
            <th className="text-left font-semibold py-1">Date</th>
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
              <td className="py-1.5 text-text-muted truncate max-w-[260px]" title={r.job_name}>{r.job_name}</td>
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

// Experimental Audits report: the monthly Operandio audits (jobs with "Audit"
// in the name) for ONE club — the location pills in the report header pick
// which. KPI-style collapsible rows: department + most recent score, expand
// for change over time and the individual reports. Departments toggled off
// for this club in Admin → Audits are hidden.
export default function AuditsReport({ locationSlug }) {
  const [openDept, setOpenDept] = useState(null)

  const { data, loading, error } = useCancellableFetch(
    async (signal) => {
      const params = {}
      if (locationSlug && locationSlug !== 'all') params.location_slug = locationSlug
      const [reports, toggles] = await Promise.all([
        getOperandioQaReports(params, { signal }),
        getAppSettings('audit_off_').catch(() => ({})),
      ])
      return { reports, toggles: toggles || {} }
    },
    [locationSlug]
  )

  const departments = useMemo(() => {
    const out = []
    const byDept = {}
    const slug = locationSlug && locationSlug !== 'all' ? locationSlug : null
    for (const r of (data?.reports?.rows || [])) {
      const dept = r.department || r.job_name || 'Unknown'
      // Audits only (PT Audit, Front Desk Audit, ...). QA-Cleaning and other
      // scored jobs are collected in the same table but not shown here.
      if (!/audit/i.test(dept)) continue
      // Hide departments toggled off for this club in Admin → Audits.
      if (slug && data?.toggles?.[`audit_off_${auditKey(dept)}_${slug}`] === '1') continue
      if (!byDept[dept]) {
        byDept[dept] = { department: dept, rows: [] }
        out.push(byDept[dept])
      }
      byDept[dept].rows.push(r)
    }
    // Most-recently audited department first (rows arrive newest-first).
    out.sort((a, b) => (b.rows[0]?.submitted_date || '').localeCompare(a.rows[0]?.submitted_date || ''))
    return out
  }, [data, locationSlug])

  if (loading) return <DesktopLoading variant="report" />
  if (error) return <p className="text-wcs-red text-sm py-4">{error.message || String(error)}</p>
  if (!data) return null

  if (departments.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center text-text-muted">
        No audits for this club yet. Audits appear automatically when they're submitted in Operandio.
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-xl overflow-hidden">
      <ul className="divide-y divide-border">
        {departments.map(dept => {
          const latest = dept.rows[0]
          const open = openDept === dept.department
          return (
            <li key={dept.department} className="px-5 py-4">
              <button
                type="button"
                onClick={() => setOpenDept(prev => (prev === dept.department ? null : dept.department))}
                aria-expanded={open}
                className="w-full flex items-center gap-4 text-left"
              >
                <div className="min-w-0">
                  <p className="text-lg font-bold text-text-primary">{dept.department}</p>
                  <p className="text-xs text-text-muted mt-0.5">
                    {latest?.submitted_date ? `Last submitted ${fmtQaDate(latest.submitted_date)}` : 'No audits yet'}
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-6 flex-shrink-0">
                  <div className="text-right">
                    <p className="text-2xl font-bold text-text-primary leading-none">
                      {latest?.score_pct != null ? `${latest.score_pct}%` : 'n/a'}
                    </p>
                    <p className="text-[11px] text-text-muted mt-1 uppercase tracking-wide">Latest</p>
                  </div>
                  <div className="w-28 text-right">
                    <span className="text-sm text-text-muted">{dept.rows.length} audit{dept.rows.length === 1 ? '' : 's'}</span>
                  </div>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                    className={`w-4 h-4 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>

              {open && (
                <div>
                  <AuditTrendChart rows={dept.rows} />
                  <AuditTable rows={dept.rows} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
