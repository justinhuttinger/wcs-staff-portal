import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { fmtInt, fmtMoney, fmtPct } from './chartPalette'
import WcsLoadingMark from '../WcsLoadingMark'

// ---------------------------------------------------------------------------
// The rows behind a number.
//
// Opened by <Drillable>, filled by /analytics/records. The columns come from
// the server with the rows, so this renders whatever a record set declares and
// no column list is written twice — add a set on the server and it displays
// here without a change.
//
// PORTALLED TO document.body. Analytics reports sit inside scrolling, clipping
// and (on mobile) overflow-clipped containers, any of which would trap a panel
// rendered in place. Same reasoning as LocationMultiSelect, which has the scar.
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

export default function RecordsModal({ open, onClose, title, set, params }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [offset, setOffset] = useState(0)

  // A fresh open starts at the top. Without this, opening a second, shorter
  // list while paged into a longer one shows an empty page.
  useEffect(() => { if (open) setOffset(0) }, [open, set, params])

  const query = useMemo(() => {
    const p = new URLSearchParams({ set, limit: String(PAGE), offset: String(offset) })
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== null && v !== undefined && v !== '') p.set(k, String(v))
    }
    return p.toString()
  }, [set, params, offset])

  useEffect(() => {
    if (!open) return
    let alive = true
    setLoading(true)
    setError(null)
    api(`/analytics/records?${query}`, { cache: true })
      .then(r => { if (alive) { setData(r); setLoading(false) } })
      .catch(e => { if (alive) { setError(e); setLoading(false) } })
    return () => { alive = false }
  }, [open, query])

  useEffect(() => {
    if (!open) return
    const onKey = e => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    // The page behind must not scroll while a panel is over it.
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const columns = data?.columns || []
  const rows = data?.rows || []
  const total = data?.total || 0
  const showing = rows.length
  const from = total === 0 ? 0 : offset + 1
  const to = offset + showing

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />

      {/* A sheet on a phone, a centred panel on a desktop: the same list, read
          the way each device expects. */}
      <div className="relative w-full sm:max-w-3xl max-h-[85vh] sm:max-h-[80vh] bg-surface sm:rounded-xl rounded-t-2xl border border-border shadow-xl flex flex-col">
        <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
          <div className="min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{title}</p>
            <p className="text-[11px] text-text-muted tabular-nums">
              {loading && !data ? 'Loading…'
                : total === 0 ? 'Nothing to show'
                : total > showing ? `Showing ${fmtInt(from)}–${fmtInt(to)} of ${fmtInt(total)}`
                : `${fmtInt(total)} ${total === 1 ? 'row' : 'rows'}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary hover:bg-bg transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading && !data ? (
            <div className="flex flex-col items-center justify-center py-16">
              <WcsLoadingMark size={48} className="text-wcs-red mb-3" />
              <p className="text-sm text-text-muted">Pulling the records</p>
            </div>
          ) : error ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm text-wcs-red font-semibold">Could not load the records</p>
              <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
            </div>
          ) : rows.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-text-muted">
              Nothing was recorded for this selection.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  {columns.map(c => (
                    <th
                      key={c.key}
                      className={`font-semibold px-3 py-2 whitespace-nowrap ${
                        c.format === 'text' ? 'text-left' : 'text-right'
                      }`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    {columns.map(c => (
                      <td
                        key={c.key}
                        className={`px-3 py-2 ${
                          c.format === 'text'
                            ? 'text-text-primary'
                            : 'text-right tabular-nums text-text-primary whitespace-nowrap'
                        }`}
                      >
                        {fmtCell(r[c.key], c.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {total > PAGE && (
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-t border-border">
            <button
              type="button"
              disabled={offset === 0 || loading}
              onClick={() => setOffset(o => Math.max(0, o - PAGE))}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-text-muted enabled:hover:text-text-primary disabled:opacity-40 transition-colors"
            >
              Previous
            </button>
            <span className="text-[11px] text-text-muted tabular-nums">
              Page {Math.floor(offset / PAGE) + 1} of {Math.ceil(total / PAGE)}
            </span>
            <button
              type="button"
              disabled={to >= total || loading}
              onClick={() => setOffset(o => o + PAGE)}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-border text-text-muted enabled:hover:text-text-primary disabled:opacity-40 transition-colors"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
