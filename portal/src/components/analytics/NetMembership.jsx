import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { colorFor, fmtInt, fmtSigned, GOOD_COLOR, BAD_COLOR } from './chartPalette'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// Net Membership — Analytics (admin only)
//
// Two bars per segment: new members in, lost members out, with the net beside
// the name.
//
// Both bars share ONE scale, taken across every bar on the chart. Scaling each
// row to its own maximum would make a club that lost 80 look exactly like one
// that lost 800, which is the failure this report exists to catch.
//
// The two bars are the same hue, not two, because they are the same quantity
// measured in opposite directions; the labels and the arrow carry direction.
// Colour is spent on the net instead, where a reader actually needs it.
// ---------------------------------------------------------------------------

function Row({ row, maxBar, index, showPrior }) {
  const w = (v) => (maxBar ? `${Math.max(0, (v / maxBar) * 100)}%` : '0%')
  const up = row.net > 0
  const flat = row.net === 0
  const hue = colorFor(row.key, index)

  return (
    <div className={`group flex items-stretch gap-3 px-3 py-2 border-b border-border/60 ${zebra(index)} ${HOVER_TINT}`}>
      <div className="w-44 flex-shrink-0 min-w-0">
        <p className="text-xs font-semibold text-text-primary truncate" title={row.label}>{row.label}</p>
        <p className={`text-sm font-bold tabular-nums ${flat ? 'text-text-muted' : up ? 'text-emerald-600' : 'text-wcs-red'}`}>
          {fmtSigned(row.net)}
          <span aria-hidden="true" className="ml-1 text-[10px]">{flat ? '' : up ? '▲' : '▼'}</span>
          {/* Direction is stated for a screen reader too, never colour alone. */}
          <span className="sr-only">{flat ? 'no change' : up ? 'net gain' : 'net loss'}</span>
        </p>
        {showPrior && (
          <p className="text-[10px] text-text-muted tabular-nums">was {fmtSigned(row.priorNet)}</p>
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-1 self-center">
        {[
          { label: 'New Members', value: row.newMembers, prior: row.priorNew },
          { label: 'Lost Members', value: row.lostMembers, prior: row.priorLost },
        ].map(bar => (
          <div key={bar.label} className="flex items-center gap-2">
            <span className="w-24 flex-shrink-0 text-[10px] text-text-muted text-right">{bar.label}</span>
            <div className="flex-1 h-4 bg-bg rounded-sm relative min-w-[80px]">
              <div
                className="h-full rounded-sm"
                style={{ width: w(bar.value), background: hue, opacity: bar.label === 'Lost Members' ? 0.55 : 1 }}
              />
              {showPrior && bar.prior > 0 && (
                // Prior year as a hairline marker rather than a second bar:
                // doubling the bars doubles the ink for a reference value.
                <div
                  className="absolute top-0 h-full border-l-2 border-text-muted/70"
                  style={{ left: w(bar.prior) }}
                  title={`Prior year: ${fmtInt(bar.prior)}`}
                />
              )}
            </div>
            <span className="w-14 flex-shrink-0 text-[11px] tabular-nums text-text-primary font-medium">
              {fmtInt(bar.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Tile({ tile }) {
  const v = tile.value
  const tone = !tile.signed || v === null
    ? 'text-text-primary'
    : v > 0 ? 'text-emerald-600' : v < 0 ? 'text-wcs-red' : 'text-text-muted'
  return (
    <div className="bg-surface rounded-xl border border-border px-3 py-2 text-center">
      <p className={`text-lg font-bold tabular-nums ${tone}`}>
        {tile.signed ? fmtSigned(v) : fmtInt(v)}
      </p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">{tile.label}</p>
    </div>
  )
}

export default function NetMembership({ startDate, endDate, locationSlug }) {
  const [segment, setSegment] = useState('club')
  const [sort, setSort] = useState('net_desc')
  const [exclusion, setExclusion] = useState('exclude')
  const [showPrior, setShowPrior] = useState(true)

  const query = useMemo(() => new URLSearchParams({
    start: startDate, end: endDate, clubs: locationSlug || 'all', segment, sort, exclusion,
  }).toString(), [startDate, endDate, locationSlug, segment, sort, exclusion])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/net-membership?${query}`, { cache: true, signal }),
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

  const rows = data?.rows || []

  return (
    <div className="space-y-3">
      <Toolbar
        segment={segment} setSegment={setSegment} segments={data?.segments || []}
        sort={sort} setSort={setSort} sorts={data?.sorts || []}
        exclusion={exclusion} setExclusion={setExclusion}
        showPrior={showPrior} setShowPrior={setShowPrior}
      />

      <div className="grid grid-cols-3 xl:grid-cols-6 gap-2">
        {(data?.tiles || []).map(t => <Tile key={t.key} tile={t} />)}
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-hidden">
        {rows.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-10">No membership activity in this range.</p>
        ) : (
          rows.map((r, i) => (
            <Row key={r.key} row={r} maxBar={data?.maxBar || 0} index={i} showPrior={showPrior} />
          ))
        )}
      </div>

      {showPrior && rows.length > 0 && (
        <p className="text-[11px] text-text-muted px-1">
          The vertical marker on each bar is the same span one year earlier
          {data?.meta?.priorStart ? ` (${data.meta.priorStart} to ${data.meta.priorEnd})` : ''}.
        </p>
      )}
    </div>
  )
}

function Toolbar({ segment, setSegment, segments, sort, setSort, sorts, exclusion, setExclusion, showPrior, setShowPrior }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        View By
        <select value={segment} onChange={e => setSegment(e.target.value)} className={cls}>
          {segments.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className={wrap}>
        Sort
        <select value={sort} onChange={e => setSort(e.target.value)} className={cls}>
          {sorts.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label className={wrap}>
        Member Count
        <select value={exclusion} onChange={e => setExclusion(e.target.value)} className={cls}>
          <option value="exclude">Exclude</option>
          <option value="include">Include</option>
        </select>
      </label>
      <label className={`${wrap} cursor-pointer`}>
        <input
          type="checkbox" checked={showPrior} onChange={e => setShowPrior(e.target.checked)}
          className="accent-wcs-red"
        />
        Prior Year
      </label>
    </div>,
    slot
  )
}
