import { useEffect, useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { fmtInt, fmtMoney, fmtPct } from './chartPalette'
import WcsLoadingMark from '../WcsLoadingMark'

// ---------------------------------------------------------------------------
// The data behind a whole report.
//
// Every report ends with this: the rows that went into it, whatever the report
// chose to draw. Some reports have plenty worth clicking and this is a way to
// check them; others — Payroll, Group X, Childcare — have almost nothing
// clickable, and this section IS their answer.
//
// Which sets a report shows is declared once, on the report's own entry in
// ANALYTICS_REPORTS, so adding a report gives it a data view by writing one
// more line rather than editing a component.
//
// COLLAPSED UNTIL ASKED FOR. Some of these are large — a month of revenue is
// 27,990 rows — and nothing is fetched until the section is opened, so a report
// does not get slower for carrying one.
// ---------------------------------------------------------------------------

const PAGE = 100

function fmtCell(value, format) {
  if (value === null || value === undefined || value === '') return '—'
  switch (format) {
    case 'money': return fmtMoney(value)
    case 'int': return fmtInt(value)
    case 'pct': return fmtPct(value)
    default: return String(value)
  }
}

function RecordTable({ set, params }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [offset, setOffset] = useState(0)

  useEffect(() => { setOffset(0) }, [set, params])

  const query = useMemo(() => {
    const p = new URLSearchParams({ set, limit: String(PAGE), offset: String(offset) })
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
    }
    return p.toString()
  }, [set, params, offset])

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api(`/analytics/records?${query}`, { cache: true })
      .then(r => { if (alive) { setData(r); setLoading(false) } })
      .catch(e => { if (alive) { setError(e); setLoading(false) } })
    return () => { alive = false }
  }, [query])

  if (loading && !data) {
    return (
      <div className="flex flex-col items-center justify-center py-10">
        <WcsLoadingMark size={40} className="text-wcs-red mb-2" />
        <p className="text-xs text-text-muted">Pulling the records</p>
      </div>
    )
  }
  if (error) {
    return (
      <p className="px-4 py-8 text-center text-sm text-wcs-red">
        Could not load these records. {String(error.message || error)}
      </p>
    )
  }

  const columns = data?.columns || []
  const rows = data?.rows || []
  const total = data?.total || 0
  if (rows.length === 0) {
    return <p className="px-4 py-8 text-center text-sm text-text-muted">Nothing recorded in this range.</p>
  }

  return (
    <>
      {/* Its own scroller: a wide record table must not push the page sideways. */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              {columns.map(c => (
                <th key={c.key} className={`font-semibold px-3 py-2 whitespace-nowrap ${
                  c.format === 'text' ? 'text-left' : 'text-right'
                }`}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-border/60 last:border-0">
                {columns.map(c => (
                  <td key={c.key} className={`px-3 py-2 ${
                    c.format === 'text'
                      ? 'text-text-primary'
                      : 'text-right tabular-nums text-text-primary whitespace-nowrap'
                  }`}>{fmtCell(r[c.key], c.format)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-border">
        <span className="text-[11px] text-text-muted tabular-nums">
          {total > rows.length
            ? `Showing ${fmtInt(offset + 1)}–${fmtInt(offset + rows.length)} of ${fmtInt(total)}`
            : `${fmtInt(total)} ${total === 1 ? 'row' : 'rows'}`}
        </span>
        {total > PAGE && (
          <span className="flex gap-2">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(o => Math.max(0, o - PAGE))}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border text-text-muted enabled:hover:text-text-primary disabled:opacity-40 transition-colors"
            >Previous</button>
            <button
              type="button"
              disabled={offset + rows.length >= total || loading}
              onClick={() => setOffset(o => o + PAGE)}
              className="px-2.5 py-1 text-xs font-semibold rounded-lg border border-border text-text-muted enabled:hover:text-text-primary disabled:opacity-40 transition-colors"
            >Next</button>
          </span>
        )}
      </div>
    </>
  )
}

/**
 * @param sets   record-set keys this report is built from, in reading order
 * @param params the filters currently on screen — window, clubs
 */
export default function ReportRecords({ sets, params }) {
  const list = (sets || []).filter(Boolean)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(list[0] || null)

  if (list.length === 0) return null

  return (
    <div className="bg-surface rounded-xl border border-border">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-sm font-bold text-text-primary">The Data</span>
          <span className="block text-[11px] text-text-muted">
            Every record this report is built from
          </span>
        </span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          aria-hidden="true"
          className={`w-4 h-4 text-text-muted flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t border-border">
          {/* One tab per set. A report built from three tables shows three
              lists rather than an interleaved one nobody could read. */}
          {list.length > 1 && (
            <div className="flex gap-1 overflow-x-auto px-3 py-2 border-b border-border">
              {list.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setActive(s)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-colors ${
                    active === s
                      ? 'bg-wcs-red text-white'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {SET_LABELS[s] || s}
                </button>
              ))}
            </div>
          )}
          <RecordTable set={active || list[0]} params={params} />
        </div>
      )}
    </div>
  )
}

// Tab labels. The server sends a label with the rows, but the tabs have to be
// named before any of them is fetched.
const SET_LABELS = {
  'pt-sessions': 'Sessions',
  'pt-clients': 'Clients',
  'pt-sales': 'PT Sales',
  'pt-losses': 'Deactivations',
  'day-ones': 'Day Ones',
  'day-ones-pending': 'Pending Outcome',
  'new-members': 'New Members',
  'lost-members': 'Members Lost',
  'past-due': 'Past Due',
  'revenue': 'Revenue',
  'vips': 'VIPs',
  'tours': 'Tours',
}
