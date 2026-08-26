import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'

// ---------------------------------------------------------------------------
// Salesperson Performance — Analytics (admin only)
//
// Recreation of the external tool's "New Member Units" board. Two differences
// from the source, both deliberate:
//   - PT Intro Book Count is our **Day One Book Count**.
//   - Dues columns carry real numbers; the source tool renders $0 there.
//
// Columns with no data source yet (% on ACH, the three tour columns) render an
// explicit N/A rather than a zero, because a zero would read as a real
// measurement. `meta.unavailable` from the API says why for each.
// ---------------------------------------------------------------------------

const COLUMNS = [
  { key: 'newMemberUnits', label: 'New Member Units', format: 'int', bar: 'count', barTone: 'blue' },
  { key: 'pctOfClubTotal', label: '% of Club Total', format: 'pct', bar: 'pct', barTone: 'teal' },
  { key: 'pctOnAch', label: '% on ACH', format: 'pct', bar: 'pct', barTone: 'amber' },
  { key: 'totalNewDuesDraft', label: 'Total New Dues Draft', format: 'money' },
  { key: 'avgNewDuesDraft', label: 'Avg New Dues Draft', format: 'money' },
  { key: 'toursGiven', label: 'Tours Given', format: 'int' },
  { key: 'tourConversionRate', label: 'Tour Conversion Rate', format: 'pct' },
  { key: 'avgDaysToConversion', label: 'Avg Days from Tour to Conversion', format: 'num' },
  { key: 'dayOneBookCount', label: 'Day One Book Count', format: 'int', bar: 'count', barTone: 'red' },
  { key: 'dayOneBookPct', label: 'Day One Book %', format: 'pct', bar: 'pct', barTone: 'slate' },
  { key: 'bookOnJoinDateCount', label: 'Book on Join Date Count', format: 'int', bar: 'count', barTone: 'orange' },
  { key: 'bookOnJoinDatePct', label: 'Book on Join Date %', format: 'pct', bar: 'pct', barTone: 'blue' },
]

const BAR_TONES = {
  blue: 'bg-sky-500/70',
  teal: 'bg-teal-500/70',
  amber: 'bg-amber-500/70',
  red: 'bg-rose-500/70',
  slate: 'bg-slate-400/70',
  orange: 'bg-orange-500/70',
}

// Alternating column tint so a number is easy to trace back to its header.
//
// The tint is mixed from the theme's own ink into its own surface rather than
// picked from two named tokens: bg-bg and bg-surface are BOTH #ffffff under the
// press theme (and near-identical under wp), so a bg-bg/bg-surface pair renders
// as no stripe at all. Mixing also means this inverts correctly in dark mode,
// where the ink is light, without a second set of classes.
//
// The result is opaque on purpose. These cells scroll under a sticky header and
// a sticky first column, and a translucent stripe would let rows bleed through.
const ZEBRA_TINT = 'bg-[color-mix(in_srgb,var(--color-text-primary)_6%,var(--color-surface))]'
const zebra = (i) => (i % 2 === 0 ? ZEBRA_TINT : 'bg-surface')

// Row hover, mixed the same way and for the same reason. A translucent
// bg-wcs-red/6 here would punch a hole in the sticky first column on hover and
// let the scrolling columns show through it.
const HOVER_TINT = 'group-hover:bg-[color-mix(in_srgb,var(--color-wcs-red)_8%,var(--color-surface))]'

// What the first column is called, per grouping mode.
const ROW_LABEL = {
  club_salesperson: 'Club + Salesperson',
  club: 'Club',
  salesperson: 'Salesperson',
}

const VIEW_BY_OPTIONS = [
  { key: 'club_salesperson', label: 'Club + Salesperson' },
  { key: 'club', label: 'Club' },
  { key: 'salesperson', label: 'Salesperson' },
]

const SORT_OPTIONS = [
  { key: 'newMemberUnits', label: 'New Member Units' },
  { key: 'pctOfClubTotal', label: '% of Club Total' },
  { key: 'totalNewDuesDraft', label: 'Total New Dues Draft' },
  { key: 'avgNewDuesDraft', label: 'Avg New Dues Draft' },
  { key: 'dayOneBookCount', label: 'Day One Book Count' },
  { key: 'dayOneBookPct', label: 'Day One Book %' },
  { key: 'bookOnJoinDateCount', label: 'Book on Join Date Count' },
  { key: 'salesperson', label: 'Salesperson' },
  { key: 'club', label: 'Club' },
]

function fmt(value, format) {
  if (value === null || value === undefined) return 'N/A'
  switch (format) {
    case 'pct': return `${value}%`
    case 'money': return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    case 'int': return Number(value).toLocaleString()
    default: return String(value)
  }
}

// Summary strip formats money without cents for the big totals, matching the
// source tool's header row.
function fmtSummary(value, format) {
  if (value === null || value === undefined) return 'N/A'
  if (format === 'money') return `$${Math.round(Number(value)).toLocaleString()}`
  return fmt(value, format)
}

const SUMMARY_TILES = [
  { key: 'newMemberUnits', label: 'New Member Units', format: 'int' },
  { key: 'pctOnAch', label: '% on ACH', format: 'pct' },
  { key: 'totalNewDuesDraft', label: 'Total New Dues Draft', format: 'money' },
  { key: 'avgNewDuesDraft', label: 'Avg New Dues Draft', format: 'money' },
  { key: 'toursGiven', label: 'Tours Given', format: 'int' },
  { key: 'tourConversionRate', label: 'Tour Conversion Rate', format: 'pct' },
  { key: 'avgDaysToConversion', label: 'Avg Days from Tour to Conversion', format: 'num' },
  { key: 'dayOneBookCount', label: 'Day One Book Count', format: 'int' },
  { key: 'dayOneBookPct', label: 'Day One Book %', format: 'pct' },
  { key: 'bookOnJoinDateCount', label: 'Book on Join Date Count', format: 'int' },
  { key: 'bookOnJoinDatePct', label: 'Book on Join Date %', format: 'pct' },
]

// allLabel={null} marks a setting rather than a filter — it has no "All"
// option because there is no such thing as unset.
function Select({ label, value, onChange, options, allLabel = 'All' }) {
  return (
    <label className="flex flex-col gap-1 min-w-[150px]">
      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
      >
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map(o => {
          const key = typeof o === 'string' ? o : o.key
          const text = typeof o === 'string' ? o : o.label
          return <option key={key} value={key}>{text}</option>
        })}
      </select>
    </label>
  )
}

export default function SalespersonPerformance({ startDate, endDate, locationSlug }) {
  const [exclusion, setExclusion] = useState('exclude')
  const [sortBy, setSortBy] = useState('newMemberUnits')
  const [sortOrder, setSortOrder] = useState('desc')
  const [showAverages, setShowAverages] = useState(true)
  const [joinSource, setJoinSource] = useState('')
  const [membershipType, setMembershipType] = useState('')
  const [gender, setGender] = useState('')
  const [ageGroup, setAgeGroup] = useState('')
  const [paymentTerm, setPaymentTerm] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [memberRelationship, setMemberRelationship] = useState('')
  const [viewBy, setViewBy] = useState('club_salesperson')
  const [filtersOpen, setFiltersOpen] = useState(false)

  // Only the value filters count toward the badge; View By, sorting and the
  // average lines are display settings, not narrowing.
  const activeFilterCount = [joinSource, membershipType, gender, ageGroup, paymentTerm, paymentMethod, memberRelationship]
    .filter(Boolean).length + (exclusion === 'include' ? 1 : 0)

  function clearFilters() {
    setJoinSource('')
    setMembershipType('')
    setGender('')
    setAgeGroup('')
    setPaymentTerm('')
    setPaymentMethod('')
    setMemberRelationship('')
    setExclusion('exclude')
  }

  const query = useMemo(() => {
    const p = new URLSearchParams({
      start: startDate,
      end: endDate,
      clubs: locationSlug || 'all',
      exclusion,
    })
    if (joinSource) p.set('joinSource', joinSource)
    if (membershipType) p.set('membershipType', membershipType)
    if (gender) p.set('gender', gender)
    if (ageGroup) p.set('ageGroup', ageGroup)
    if (paymentTerm) p.set('paymentTerm', paymentTerm)
    if (paymentMethod) p.set('paymentMethod', paymentMethod)
    if (memberRelationship) p.set('memberRelationship', memberRelationship)
    p.set('viewBy', viewBy)
    return p.toString()
  }, [startDate, endDate, locationSlug, exclusion, joinSource, membershipType, gender, ageGroup, paymentTerm, paymentMethod, memberRelationship, viewBy])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/salesperson-performance?${query}`, { cache: true, signal }),
    [query]
  )

  const rows = useMemo(() => {
    const list = [...(data?.rows || [])]
    const dir = sortOrder === 'asc' ? 1 : -1
    list.sort((a, b) => {
      const av = a[sortBy]
      const bv = b[sortBy]
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av || '').localeCompare(String(bv || '')) * dir
      }
      // Nulls always sink, whichever way the sort points — an N/A is not the
      // smallest value, it's the absence of one.
      if (av === null || av === undefined) return 1
      if (bv === null || bv === undefined) return -1
      return (av - bv) * dir
    })
    return list
  }, [data, sortBy, sortOrder])

  // Column maxima drive the in-cell bar widths, so each column scales to its
  // own biggest value rather than to some shared arbitrary ceiling.
  // Bar scale per column.
  //
  // Percentage columns are pinned to a 0-100 track, NOT to the column's own
  // maximum. Day One Book % is credited to the booker while the denominator is
  // that person's own sales, so a front-desk row can legitimately hit 400% —
  // and scaling to that flattened every honest 40-60% row into a sliver. A
  // fixed track keeps 50% looking like half regardless of who else is on the
  // list; the outlier is drawn full-width and flagged as capped.
  //
  // Count columns still scale to the column max: there is no natural ceiling
  // for "how many did you sell", so relative height is the only useful reading.
  const maxima = useMemo(() => {
    const out = {}
    for (const col of COLUMNS) {
      if (!col.bar) continue
      out[col.key] = col.format === 'pct'
        ? 100
        : rows.reduce((mx, r) => {
            const v = r[col.key]
            return typeof v === 'number' && v > mx ? v : mx
          }, 0)
    }
    return out
  }, [rows])

  const averages = data?.averages || {}

  if (loading) return <DesktopLoading />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const summary = data?.summary || {}
  const options = data?.filterOptions || {}

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {SUMMARY_TILES.map(tile => (
            <div key={tile.key} className="px-5 py-4 text-center min-w-[130px] flex-1">
              <p className="text-xl font-bold text-text-primary">{fmtSummary(summary[tile.key], tile.format)}</p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{tile.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filters live in a popup anchored to the toolbar button, which is
          portalled up next to the shared date range. Keeping eleven controls
          permanently on screen pushed the table below the fold. */}
      <FiltersToolbar
        open={filtersOpen}
        onOpenChange={setFiltersOpen}
        activeCount={activeFilterCount}
        onClear={clearFilters}
      >
        <Select label="View By" value={viewBy} onChange={setViewBy} options={VIEW_BY_OPTIONS} allLabel={null} />
        <Select
          label="Member Count Exclusion"
          value={exclusion}
          onChange={setExclusion}
          options={[{ key: 'exclude', label: 'Exclude' }, { key: 'include', label: 'Include' }]}
          allLabel={null}
        />
        <Select label="Sort By" value={sortBy} onChange={setSortBy} options={SORT_OPTIONS} allLabel={null} />
        <Select
          label="Sort Order"
          value={sortOrder}
          onChange={setSortOrder}
          options={[{ key: 'desc', label: 'Descending' }, { key: 'asc', label: 'Ascending' }]}
          allLabel={null}
        />
        <Select
          label="Average Lines"
          value={showAverages ? 'show' : 'hide'}
          onChange={v => setShowAverages(v === 'show')}
          options={[{ key: 'show', label: 'Show' }, { key: 'hide', label: 'Hide' }]}
          allLabel={null}
        />
        <Select label="Join Source" value={joinSource} onChange={setJoinSource} options={options.joinSource || []} />
        <Select label="Membership Type" value={membershipType} onChange={setMembershipType} options={options.membershipType || []} />
        <Select label="Age Group" value={ageGroup} onChange={setAgeGroup} options={options.ageGroup || []} />
        <Select label="Gender" value={gender} onChange={setGender} options={options.gender || []} />
        <Select label="Payment Term" value={paymentTerm} onChange={setPaymentTerm} options={options.paymentTerm || []} />
        <Select label="Payment Mode" value={paymentMethod} onChange={setPaymentMethod} options={options.paymentMethod || []} />
        <Select label="Member Relationship" value={memberRelationship} onChange={setMemberRelationship} options={options.memberRelationship || []} />
      </FiltersToolbar>

      {/* Table.
          The scroll container is capped to the viewport rather than growing
          with the row count, so the horizontal scrollbar sits at the bottom of
          the screen instead of the bottom of the table — you no longer have to
          scroll through every row to reach it. Vertical scrolling happens
          inside the container and the header row sticks to the top of it. */}
      <div className="bg-surface rounded-xl border border-border">
        <div className="overflow-auto max-h-[calc(100vh-15rem)] min-h-[240px]">
          <table className="min-w-max w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                {/* Sticky on both axes, so it stays put whichever way you
                    scroll. The higher z-index keeps it above the sticky first
                    column where the two overlap. */}
                <th className="sticky left-0 top-0 z-30 bg-surface text-left font-semibold text-text-primary px-4 py-3 min-w-[290px] border-b border-border">
                  {ROW_LABEL[viewBy] || ROW_LABEL.club_salesperson}
                </th>
                {COLUMNS.map((col, i) => (
                  <th
                    key={col.key}
                    className={`sticky top-0 z-20 text-left font-semibold text-text-muted px-3 py-3 text-xs min-w-[140px] border-b border-border ${zebra(i)}`}
                  >
                    {col.key === 'pctOfClubTotal' ? (viewBy === 'club_salesperson' ? '% of Club Total' : '% of Total') : col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.key} className="group">
                  <td className={`sticky left-0 z-10 bg-surface ${HOVER_TINT} px-4 py-2 whitespace-nowrap border-b border-border/60`}>
                    <span className="text-text-primary">
                      {[row.club, row.salesperson].filter(Boolean).join('; ')}
                    </span>
                  </td>
                  {COLUMNS.map((col, i) => {
                    const value = row[col.key]
                    const max = maxima[col.key] || 0
                    const rawWidth = col.bar && typeof value === 'number' && max > 0
                      ? Math.max(2, Math.round((value / max) * 100))
                      : 0
                    // Over-scale values run off a fixed track, so clamp the
                    // drawn bar and mark it rather than letting it overflow the
                    // cell. The number beside it still reads the true value.
                    const overflows = rawWidth > 100
                    const width = Math.min(100, rawWidth)
                    const avg = showAverages ? averages[col.key] : null
                    const avgLeft = col.bar && typeof avg === 'number' && max > 0
                      ? Math.min(100, Math.round((avg / max) * 100))
                      : null
                    return (
                      <td key={col.key} className={`px-3 py-2 border-b border-border/60 ${zebra(i)} ${HOVER_TINT}`}>
                        {col.bar ? (
                          <div className="relative flex items-center gap-2 h-5">
                            <div className="relative flex-1 h-4 min-w-[60px]">
                              <div
                                className={`absolute inset-y-0 left-0 ${overflows ? 'rounded-l-sm' : 'rounded-sm'} ${BAR_TONES[col.barTone]}`}
                                style={{ width: `${width}%` }}
                              />
                              {overflows && (
                                // Notched right edge: this bar is clipped, the
                                // real figure is larger than the track.
                                <div
                                  className={`absolute inset-y-0 right-0 w-1.5 ${BAR_TONES[col.barTone]}`}
                                  style={{ clipPath: 'polygon(0 0, 100% 50%, 0 100%)' }}
                                  title={`${fmt(value, col.format)} — beyond the 100% scale`}
                                />
                              )}
                              {avgLeft !== null && (
                                <div
                                  className="absolute inset-y-0 border-l border-dashed border-text-muted/70"
                                  style={{ left: `${avgLeft}%` }}
                                  title={`Average: ${fmt(avg, col.format)}`}
                                />
                              )}
                            </div>
                            <span className="text-xs text-text-primary tabular-nums w-14 text-right flex-shrink-0">
                              {fmt(value, col.format)}
                            </span>
                          </div>
                        ) : (
                          <span className={`text-xs tabular-nums ${value === null ? 'text-text-muted' : 'text-text-primary'}`}>
                            {fmt(value, col.format)}
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <p className="text-sm text-text-muted text-center py-10">No sales or Day One bookings in this range.</p>
        )}
      </div>

      <DataNotes meta={data?.meta} />
    </div>
  )
}

// Say plainly which columns are empty and why, so an N/A never reads as a zero.
function DataNotes({ meta }) {
  if (!meta) return null
  const notes = Object.values(meta.unavailable || {})
  return (
    <div className="bg-surface rounded-xl border border-border p-4 text-xs text-text-muted space-y-1">
      {meta.paymentMethodCoverage !== null && meta.paymentMethodCoverage < 100 && (
        <p>
          <span className="font-semibold text-text-primary">% on ACH</span> is scored against the{' '}
          {meta.paymentMethodCoverage}% of members that have a payment method on file. Run the
          migration-123 backfill to cover the rest.
        </p>
      )}
      {meta.excludedTypes?.length > 0 && (
        <p>Excluded membership types: {meta.excludedTypes.join(', ')}.</p>
      )}
      {notes.map(note => <p key={note}>Showing N/A: {note}.</p>)}
      <p>{meta.memberRows?.toLocaleString()} membership records and {meta.dayOneRows?.toLocaleString()} Day One bookings in range.</p>
    </div>
  )
}

// The trigger button is portalled into the shell header so it sits beside the
// shared date range; the panel itself is rendered next to it and anchored
// right so it never runs off the edge of the page.
function FiltersToolbar({ open, onOpenChange, activeCount, onClear, children }) {
  const [slot, setSlot] = useState(null)
  const wrapRef = useRef(null)

  // The slot belongs to the shell, which renders before this report mounts.
  // Resolve it after mount rather than at module scope.
  useEffect(() => {
    setSlot(document.getElementById(TOOLBAR_SLOT_ID))
  }, [])

  useEffect(() => {
    if (!open) return
    function onDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) onOpenChange(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') onOpenChange(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  if (!slot) return null

  return createPortal(
    <div className="relative" ref={wrapRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
          open || activeCount > 0
            ? 'bg-wcs-red text-white border-wcs-red'
            : 'bg-bg text-text-muted border-border hover:text-text-primary'
        }`}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-3.5 h-3.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6h16.5M6.75 12h10.5m-7.5 6h4.5" />
        </svg>
        Filters
        {activeCount > 0 && (
          <span className="ml-0.5 min-w-[16px] h-4 flex items-center justify-center rounded-full bg-white/25 text-[10px] font-bold px-1">
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-40 w-[620px] max-w-[85vw] max-h-[70vh] overflow-y-auto bg-surface border border-border rounded-xl shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-bold text-text-primary">Filters &amp; display</p>
            <button
              type="button"
              onClick={onClear}
              className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
            >
              Clear filters
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">{children}</div>
        </div>
      )}
    </div>,
    slot
  )
}
