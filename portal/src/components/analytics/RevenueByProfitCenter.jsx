import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { colorFor, fmtMoney } from './chartPalette'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// Revenue by Profit Center — Analytics (admin only)
//
// One stacked bar per row, segmented by profit centre group.
//
// The bars are ABSOLUTE, not normalised to 100%. Membership Mix normalises
// because its question is "what is the mix"; here the question is "how much did
// each club take, and from what", and a 100% bar would show a small club and a
// large one as the same length.
//
// A 2px gap between segments, so two adjacent groups never read as one block.
// ---------------------------------------------------------------------------

function StackedBar({ row, groups, maxTotal, hovered, onHover }) {
  return (
    <div className="flex-1 min-w-[220px] h-7 flex bg-bg rounded-sm overflow-hidden"
         style={{ width: maxTotal ? `${(row.total / maxTotal) * 100}%` : '0%' }}>
      {groups.map((g, gi) => {
        const v = row.values[g] || 0
        if (v <= 0) return null
        const pctOfRow = row.total ? (v / row.total) * 100 : 0
        const dim = hovered && hovered !== g
        return (
          <div
            key={g}
            className="h-full relative"
            style={{
              width: `${pctOfRow}%`,
              background: colorFor(g, gi),
              opacity: dim ? 0.3 : 1,
              // 2px of surface between segments; without it two adjacent hues
              // of similar lightness read as a single wider block.
              boxShadow: 'inset -2px 0 0 0 var(--color-surface)',
            }}
            onMouseEnter={() => onHover(g)}
            onMouseLeave={() => onHover(null)}
            title={`${g}: ${fmtMoney(v)}`}
          >
            {/* Printed only where the segment is wide enough to hold it —
                identity never rests on colour alone, but a clipped label is
                worse than none. */}
            {pctOfRow > 11 && (
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white/95 pointer-events-none">
                {fmtMoney(v, { compact: true })}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Tile({ tile }) {
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2 text-center">
      <p className="text-lg font-bold tabular-nums text-text-primary">
        {tile.format === 'money' ? fmtMoney(tile.value) : (tile.value ?? 'N/A')}
      </p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">
        {tile.label}
        {tile.sub !== null && tile.sub !== undefined && tile.format === 'text' && (
          <span className="block tabular-nums">{fmtMoney(tile.sub)}</span>
        )}
      </p>
    </div>
  )
}

export default function RevenueByProfitCenter({ startDate, endDate, locationSlug }) {
  const [view, setView] = useState('club')
  const [sort, setSort] = useState('total_desc')
  const [hovered, setHovered] = useState(null)
  const [showTable, setShowTable] = useState(false)

  const query = useMemo(() => new URLSearchParams({
    start: startDate, end: endDate, clubs: locationSlug || 'all', view, sort,
  }).toString(), [startDate, endDate, locationSlug, view, sort])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/revenue-by-profit-center?${query}`, { cache: true, signal }),
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

  const groups = data?.groups || []
  const rows = data?.rows || []
  const defs = Object.values(data?.meta?.definitions || {}).filter(Boolean)

  return (
    <div className="space-y-3">
      <Toolbar
        view={view} setView={setView} views={data?.views || []}
        sort={sort} setSort={setSort} sorts={data?.sorts || []}
        showTable={showTable} setShowTable={setShowTable}
      />

      <div className="grid grid-cols-3 gap-2">
        {(data?.tiles || []).map(t => <Tile key={t.key} tile={t} />)}
      </div>

      {/* Legend first: it names the colours before they are used. */}
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {groups.map((g, i) => {
          const total = data?.groupTotals?.find(t => t.group === g)?.revenue ?? 0
          return (
            <button
              key={g}
              type="button"
              onMouseEnter={() => setHovered(g)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(g)}
              onBlur={() => setHovered(null)}
              className="inline-flex items-center gap-1.5 text-[11px]"
            >
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: colorFor(g, i) }} />
              <span className="text-text-primary font-medium">{g}</span>
              <span className="text-text-muted tabular-nums">{fmtMoney(total, { compact: true })}</span>
            </button>
          )
        })}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-10">No revenue in this range.</p>
        ) : rows.map((r, i) => (
          <div key={r.key} className={`group flex items-center gap-3 px-3 py-2 border-b border-border/60 ${zebra(i)} ${HOVER_TINT}`}>
            <p className="w-44 flex-shrink-0 text-xs font-semibold text-text-primary truncate" title={r.label}>
              {r.label}
            </p>
            <StackedBar row={r} groups={groups} maxTotal={data?.maxTotal || 0} hovered={hovered} onHover={setHovered} />
            <p className="w-20 flex-shrink-0 text-right text-xs font-bold tabular-nums text-text-primary">
              {fmtMoney(r.total, { compact: true })}
            </p>
          </div>
        ))}
      </div>

      {/* A table view is always one click away, which is what makes the
          low-contrast hues in the palette acceptable. */}
      {showTable && rows.length > 0 && (
        <div className="bg-surface rounded-xl border border-border overflow-auto">
          <table className="min-w-max w-full text-xs border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 bg-surface text-left font-semibold text-text-primary px-3 py-2 border-b border-border">
                  {data?.views?.find(v => v.key === view)?.label || 'Row'}
                </th>
                {groups.map(g => (
                  <th key={g} className="sticky top-0 z-10 bg-surface text-right font-semibold text-text-muted px-3 py-2 border-b border-border whitespace-nowrap">{g}</th>
                ))}
                <th className="sticky top-0 z-10 bg-surface text-right font-semibold text-text-primary px-3 py-2 border-b border-border">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key} className="group">
                  <td className={`sticky left-0 z-10 px-3 py-1.5 text-text-primary whitespace-nowrap border-b border-border/60 ${zebra(i)}`}>{r.label}</td>
                  {groups.map(g => (
                    <td key={g} className="px-3 py-1.5 text-right tabular-nums text-text-primary border-b border-border/60">
                      {fmtMoney(r.values[g] || 0)}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums font-bold text-text-primary border-b border-border/60">{fmtMoney(r.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {defs.length > 0 && (
        <div className="text-xs text-text-muted px-1 space-y-1">
          {defs.map(d => <p key={d}>{d}</p>)}
        </div>
      )}
    </div>
  )
}

function Toolbar({ view, setView, views, sort, setSort, sorts, showTable, setShowTable }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        View By
        <select value={view} onChange={e => setView(e.target.value)} className={cls}>
          {views.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
        </select>
      </label>
      <label className={wrap}>
        Sort
        <select value={sort} onChange={e => setSort(e.target.value)} className={cls}>
          {sorts.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className={`${wrap} cursor-pointer`}>
        <input type="checkbox" checked={showTable} onChange={e => setShowTable(e.target.checked)} className="accent-wcs-red" />
        Table
      </label>
    </div>,
    slot
  )
}
