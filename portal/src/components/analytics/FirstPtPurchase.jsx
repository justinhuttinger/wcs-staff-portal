import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { colorFor, fmtInt, fmtPct } from './chartPalette'

// ---------------------------------------------------------------------------
// First Purchases by Join Month — Analytics (admin only)
//
// Of the members we signed, how many go on to buy PT, and how long after
// joining.
//
// TWO DIFFERENT DENOMINATORS ON ONE SCREEN, so both are labelled every time
// they appear:
//   * the bars are a share of PURCHASERS and add to 100%
//   * the tiles are a share of MEMBERS, a much smaller number
// Getting those confused is the whole risk of this report, which is why the
// axis label says "% of purchases" rather than just "%".
//
// Every bar chart here is a single series, so no legend is needed on the
// overall chart — the title names it. The per-segment charts are one small
// multiple per bucket, which keeps the six buckets comparable across segments
// without eight lines crossing each other.
// ---------------------------------------------------------------------------

function Bars({ rows, colorIndexFor, max }) {
  return (
    <div className="flex items-end gap-1 h-32">
      {rows.map((r, i) => {
        const h = max ? Math.max(r.pct === null ? 0 : (r.pct / max) * 100, r.pct ? 2 : 0) : 0
        return (
          <div key={r.key} className="flex-1 flex flex-col items-center justify-end min-w-0 h-full">
            <span className="text-[9px] tabular-nums text-text-muted mb-0.5 whitespace-nowrap">
              {r.pct === null ? '' : fmtPct(r.pct)}
            </span>
            <div
              className="w-full rounded-t-[4px]"
              style={{ height: `${h}%`, background: colorFor(r.key, colorIndexFor(r.key, i)), minHeight: r.pct ? 2 : 0 }}
              title={`${r.label}: ${fmtPct(r.pct)} (${fmtInt(r.purchasers)})`}
            />
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
        {tile.format === 'pct' ? fmtPct(tile.value) : fmtInt(tile.value)}
      </p>
      <p className="text-[10px] font-medium text-text-muted leading-tight mt-0.5">{tile.label}</p>
    </div>
  )
}

export default function FirstPtPurchase({ locationSlug }) {
  const [segment, setSegment] = useState('club')
  const [exclusion, setExclusion] = useState('exclude')
  const [joinFrom, setJoinFrom] = useState('')
  const [joinTo, setJoinTo] = useState('')

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all', segment, exclusion })
    if (/^\d{4}-\d{2}-\d{2}$/.test(joinFrom)) p.set('joinFrom', joinFrom)
    if (/^\d{4}-\d{2}-\d{2}$/.test(joinTo)) p.set('joinTo', joinTo)
    return p.toString()
  }, [locationSlug, segment, exclusion, joinFrom, joinTo])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/first-pt-purchase?${query}`, { cache: true, signal }),
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

  const buckets = data?.buckets || []
  const overall = data?.overall || []
  const bySegment = data?.bySegment || []
  const defs = Object.values(data?.meta?.definitions || {}).filter(Boolean)

  // One shared maximum across every small multiple, so a 30% bar is the same
  // height in every panel. Per-panel scaling would make each segment look alike.
  const segMax = Math.max(
    1,
    ...bySegment.flatMap(s => s.buckets.map(b => b.pct || 0)),
  )
  const overallMax = Math.max(1, ...overall.map(b => b.pct || 0))

  const segIndex = new Map(bySegment.map((s, i) => [s.key, i]))

  return (
    <div className="space-y-3">
      <Toolbar
        segment={segment} setSegment={setSegment} segments={data?.segments || []}
        exclusion={exclusion} setExclusion={setExclusion}
        joinFrom={joinFrom || data?.meta?.joinFrom || ''} setJoinFrom={setJoinFrom}
        joinTo={joinTo || data?.meta?.joinTo || ''} setJoinTo={setJoinTo}
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">
        {(data?.tiles || []).map(t => <Tile key={t.key} tile={t} />)}
      </div>

      <div className="bg-surface rounded-xl border border-border p-3">
        <p className="text-xs font-bold text-text-primary mb-2">
          Overall
          <span className="ml-2 font-medium text-text-muted">% of purchases, by how long after joining</span>
        </p>
        <Bars
          rows={overall.map(b => ({ key: b.bucket, label: b.bucket, pct: b.pct, purchasers: b.purchasers }))}
          colorIndexFor={() => 0}
          max={overallMax}
        />
        <div className="flex gap-1 mt-1">
          {buckets.map(b => (
            <span key={b} className="flex-1 text-center text-[9px] text-text-muted truncate" title={b}>{b}</span>
          ))}
        </div>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3">
        <p className="text-xs font-bold text-text-primary mb-2">
          By {data?.segments?.find(s => s.key === segment)?.label || 'Segment'}
          <span className="ml-2 font-medium text-text-muted">
            % of that segment&apos;s own purchases, so a small club is comparable with a large one
          </span>
        </p>

        {bySegment.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-8">Nobody in this cohort bought PT.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-4">
            {buckets.map(bucket => (
              <div key={bucket}>
                <p className="text-[11px] font-semibold text-text-primary text-center mb-1">{bucket}</p>
                <Bars
                  rows={bySegment.map(s => {
                    const hit = s.buckets.find(b => b.bucket === bucket)
                    return { key: s.key, label: s.label, pct: hit?.pct ?? null, purchasers: hit?.purchasers ?? 0 }
                  })}
                  colorIndexFor={(key) => segIndex.get(key) ?? 0}
                  max={segMax}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {bySegment.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {bySegment.map((s, i) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px]">
              <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: colorFor(s.key, i) }} />
              <span className="text-text-primary font-medium">{s.label}</span>
              <span className="text-text-muted tabular-nums">
                {fmtInt(s.purchasers)} of {fmtInt(s.members)} ({fmtPct(s.purchaseRate)})
              </span>
            </span>
          ))}
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

function Toolbar({ segment, setSegment, segments, exclusion, setExclusion, joinFrom, setJoinFrom, joinTo, setJoinTo }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        Segment
        <select value={segment} onChange={e => setSegment(e.target.value)} className={cls}>
          {segments.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      {/* The date range here is the member's JOIN date, not a payment window,
          so it gets its own labelled control rather than the shared one. */}
      <label className={wrap}>
        Joined After
        <input type="date" value={joinFrom} onChange={e => setJoinFrom(e.target.value)} className={cls} />
      </label>
      <label className={wrap}>
        Joined Before
        <input type="date" value={joinTo} onChange={e => setJoinTo(e.target.value)} className={cls} />
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
