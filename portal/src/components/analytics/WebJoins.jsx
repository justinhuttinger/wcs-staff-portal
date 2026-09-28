import { useMemo } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { PALETTE, fmtInt, fmtPct } from './chartPalette'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// Web Joins — Analytics (manager+, club-scoped)
//
// Total web joins and the web share of all joins: headline + per club for the
// selected range, and a trailing 13-month trend. The server owns the
// definitions (auth/src/lib/webJoins.js).
//
// One hue for web, the muted surface for in-club: the question is "how big is
// the web slice", so only that slice earns colour.
// ---------------------------------------------------------------------------

const WEB_COLOR = PALETTE[0]

function monthLabel(mo) {
  const [y, m] = mo.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

function Tile({ label, value }) {
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2 text-center">
      <p className="text-lg font-bold tabular-nums text-text-primary">{value}</p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">{label}</p>
    </div>
  )
}

// A stacked bar: web slice coloured, the in-club remainder muted. Width is the
// SHARE, so every bar reads on the same 0-100% scale.
function ShareBar({ webPct }) {
  const w = webPct === null ? 0 : Math.min(100, Math.max(0, webPct))
  return (
    <div className="flex-1 h-4 bg-bg rounded-sm overflow-hidden min-w-[80px]">
      <div className="h-full" style={{ width: `${w}%`, background: WEB_COLOR }} />
    </div>
  )
}

function ShareRow({ label, sub, row, index }) {
  return (
    <div className={`group flex items-center gap-3 px-3 py-2 border-b border-border/60 ${zebra(index)} ${HOVER_TINT}`}>
      <div className="w-32 flex-shrink-0 min-w-0">
        <p className="text-xs font-semibold text-text-primary truncate" title={label}>{label}</p>
        {sub && <p className="text-[10px] text-text-muted">{sub}</p>}
      </div>
      <ShareBar webPct={row.webPct} />
      <span className="w-14 flex-shrink-0 text-right text-sm font-bold tabular-nums text-text-primary">{fmtPct(row.webPct)}</span>
      <span className="w-24 flex-shrink-0 text-right text-[11px] tabular-nums text-text-muted">
        {fmtInt(row.web)} of {fmtInt(row.total)}
      </span>
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wide text-text-primary">{title}</h3>
        <span className="flex items-center gap-1.5 text-[10px] text-text-muted">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: WEB_COLOR }} /> Web share
        </span>
      </div>
      {children}
    </div>
  )
}

export default function WebJoins({ startDate, endDate, locationSlug, category, basis }) {
  const query = useMemo(() => new URLSearchParams({
    start: startDate, end: endDate, clubs: locationSlug || 'all', category, basis,
  }).toString(), [startDate, endDate, locationSlug, category, basis])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/web-joins?${query}`, { cache: true, signal }),
    [query]
  )

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }
  if (!data) return null

  const s = data.summary
  // Newest month first: the question is usually "how did this month go".
  const months = [...(data.months || [])].reverse()
  const notes = data.meta?.notes || {}

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        <Tile label="Total Joins" value={fmtInt(s.total)} />
        <Tile label="Web Joins" value={fmtInt(s.web)} />
        <Tile label="In-Club Joins" value={fmtInt(s.inClub)} />
        <Tile label="Web % of Joins" value={fmtPct(s.webPct)} />
      </div>

      <Panel title="Web Share by Month (trailing 13 months)">
        {months.every(m => m.total === 0) ? (
          <p className="text-sm text-text-muted text-center py-10">No joins in this window.</p>
        ) : (
          months.map((m, i) => (
            <ShareRow
              key={m.month}
              label={monthLabel(m.month)}
              sub={m.partial ? 'month to date' : null}
              row={m}
              index={i}
            />
          ))
        )}
      </Panel>

      <Panel title="Web Share by Club (selected range)">
        {data.byClub.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-10">No joins in this range.</p>
        ) : (
          data.byClub.map((c, i) => <ShareRow key={c.key} label={c.label} row={c} index={i} />)
        )}
      </Panel>

      <div className="space-y-1 px-1">
        {[notes.filter, notes.definition, notes.caveat].filter(Boolean).map(n => (
          <p key={n} className="text-[11px] text-text-muted">{n}</p>
        ))}
      </div>
    </div>
  )
}
