import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Membership Mix — Analytics (admin only)
//
// One 100% stacked bar per club, split by whichever dimension is chosen.
//
// Colour: a fixed eight-slot categorical order, assigned by the segment's rank
// across the WHOLE selection rather than within each row, so a colour means the
// same thing in every bar. A ninth segment is never a generated hue — it folds
// into "Other". Unknown is always the same grey, never a category colour,
// because "we don't know" is not a peer of the real values.
//
// Three of the eight hues sit below 3:1 against white, so the relief rule
// applies: percentages are printed on the segments and a table view is always
// one click away. Identity is never carried by colour alone.
// ---------------------------------------------------------------------------

const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']
const OTHER_COLOR = '#8a8f98'
const UNKNOWN_COLOR = '#c2c6cc'

function colorFor(name, index) {
  if (name === 'Unknown') return UNKNOWN_COLOR
  if (name === 'Other') return OTHER_COLOR
  return PALETTE[index % PALETTE.length]
}

const VIEW_BY_OPTIONS = [
  { key: 'club', label: 'Club' },
  { key: 'membership_type', label: 'Membership Type' },
  { key: 'salesperson', label: 'Salesperson' },
]

const fmtInt = (n) => (n === null || n === undefined ? 'N/A' : Math.round(n).toLocaleString())

function StackedBar({ row, colors, onHover, hovered }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1 h-7 rounded-sm overflow-hidden flex bg-bg min-w-[200px]">
        {row.segments.map(seg => {
          if (seg.count === 0) return null
          const dim = hovered && hovered !== seg.name
          return (
            <div
              key={seg.name}
              className="relative h-full flex items-center justify-center transition-opacity"
              style={{
                width: `${seg.pct}%`,
                background: colors[seg.name],
                // 2px of surface between segments, so adjacent fills read as
                // separate blocks rather than one gradient.
                boxShadow: 'inset -2px 0 0 var(--color-surface)',
                opacity: dim ? 0.35 : 1,
              }}
              onMouseEnter={() => onHover(seg.name)}
              onMouseLeave={() => onHover(null)}
              title={`${seg.name}: ${fmtInt(seg.count)} (${seg.pct}%)`}
            >
              {/* Printed only where it fits — a label narrower than its
                  segment is worse than none. */}
              {seg.pct >= 7 && (
                <span className="text-[10px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)] px-1 truncate">
                  {seg.pct}%
                </span>
              )}
            </div>
          )
        })}
      </div>
      <span className="text-xs text-text-primary tabular-nums w-16 text-right flex-shrink-0">{fmtInt(row.total)}</span>
    </div>
  )
}

export default function MembershipMix({ locationSlug }) {
  const [breakdown, setBreakdown] = useState('membership_type')
  const [viewBy, setViewBy] = useState('club')
  const [exclusion, setExclusion] = useState('exclude')
  const [asTable, setAsTable] = useState(false)
  const [hovered, setHovered] = useState(null)

  const query = useMemo(
    () => new URLSearchParams({ clubs: locationSlug || 'all', breakdown, viewBy, exclusion }).toString(),
    [locationSlug, breakdown, viewBy, exclusion]
  )

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/membership-mix?${query}`, { cache: true, signal }),
    [query]
  )

  const colors = useMemo(() => {
    const out = {}
    let slot = 0
    for (const name of (data?.segments || [])) {
      out[name] = (name === 'Other' || name === 'Unknown') ? colorFor(name) : colorFor(name, slot++)
    }
    return out
  }, [data])

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const s = data?.summary || {}
  const rows = data?.rows || []
  const segments = data?.segments || []
  const activeBreakdown = (data?.breakdowns || []).find(b => b.key === data?.breakdown)

  return (
    <div className="space-y-4">
      <Toolbar
        breakdown={breakdown} setBreakdown={setBreakdown}
        viewBy={viewBy} setViewBy={setViewBy}
        exclusion={exclusion} setExclusion={setExclusion}
        breakdowns={data?.breakdowns || []}
      />

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {[
            { label: 'Total Members', value: s.total },
            { label: 'Primary Members', value: s.primary },
            { label: 'Secondary + Dependent', value: s.secondary },
            { label: 'Relationship Unknown', value: s.relationshipUnknown },
            { label: 'Recurring Members', value: s.recurring },
            { label: 'Paid in Full', value: s.paidInFull },
          ].map(t => (
            <div key={t.label} className="px-5 py-4 text-center min-w-[130px] flex-1">
              <p className="text-xl font-bold text-text-primary tabular-nums">{fmtInt(t.value)}</p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <p className="text-sm font-bold text-text-primary">
            By {VIEW_BY_OPTIONS.find(v => v.key === viewBy)?.label} and {activeBreakdown?.label || 'Membership Type'}
          </p>
          <button
            type="button"
            onClick={() => setAsTable(v => !v)}
            className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
          >
            {asTable ? 'Show chart' : 'Show table'}
          </button>
        </div>

        {asTable ? (
          <div className="overflow-x-auto">
            <table className="min-w-max w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="sticky left-0 z-10 bg-surface text-left font-semibold text-text-primary px-4 py-2 min-w-[200px]">
                    {VIEW_BY_OPTIONS.find(v => v.key === viewBy)?.label}
                  </th>
                  <th className="text-right font-semibold text-text-muted px-3 py-2 text-xs">Total</th>
                  {segments.map(name => (
                    <th key={name} className="text-right font-semibold text-text-muted px-3 py-2 text-xs whitespace-nowrap">{name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.key} className="border-b border-border/60 last:border-0">
                    <td className="sticky left-0 z-10 bg-surface px-4 py-2 text-text-primary whitespace-nowrap">{row.label}</td>
                    <td className="px-3 py-2 text-right text-xs text-text-primary tabular-nums">{fmtInt(row.total)}</td>
                    {row.segments.map(seg => (
                      <td key={seg.name} className="px-3 py-2 text-right text-xs text-text-primary tabular-nums whitespace-nowrap">
                        {fmtInt(seg.count)} <span className="text-text-muted">({seg.pct}%)</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-4 space-y-2">
            {rows.map(row => (
              <div key={row.key} className="flex items-center gap-3">
                <span className="text-xs text-text-primary w-44 text-right flex-shrink-0 truncate" title={row.label}>{row.label}</span>
                <div className="flex-1">
                  <StackedBar row={row} colors={colors} onHover={setHovered} hovered={hovered} />
                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="text-sm text-text-muted text-center py-10">No members in this selection.</p>
            )}
          </div>
        )}

        {/* Legend. Always present — colour never carries identity on its own. */}
        {segments.length > 0 && (
          <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 py-3 border-t border-border">
            {segments.map(name => (
              <button
                key={name}
                type="button"
                onMouseEnter={() => setHovered(name)}
                onMouseLeave={() => setHovered(null)}
                className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
              >
                <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: colors[name] }} />
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Toolbar({ breakdown, setBreakdown, viewBy, setViewBy, exclusion, setExclusion, breakdowns }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        Breakdown
        <select value={breakdown} onChange={e => setBreakdown(e.target.value)} className={cls}>
          {(breakdowns.length ? breakdowns : [{ key: 'membership_type', label: 'Membership Type' }])
            .map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
        </select>
      </label>
      <label className={wrap}>
        View By
        <select value={viewBy} onChange={e => setViewBy(e.target.value)} className={cls}>
          {VIEW_BY_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
      <label className={wrap}>
        Member Count
        <select value={exclusion} onChange={e => setExclusion(e.target.value)} className={cls}>
          <option value="exclude">Exclude</option>
          <option value="include">Include</option>
        </select>
      </label>
    </div>,
    slot
  )
}
