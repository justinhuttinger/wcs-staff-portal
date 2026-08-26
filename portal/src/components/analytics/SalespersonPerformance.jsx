import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
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

function Select({ label, value, onChange, options, allLabel = 'All' }) {
  return (
    <label className="flex flex-col gap-1 min-w-[150px]">
      <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
      >
        <option value="">{allLabel}</option>
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
  const [hovered, setHovered] = useState(null)

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
    return p.toString()
  }, [startDate, endDate, locationSlug, exclusion, joinSource, membershipType, gender, ageGroup, paymentTerm, paymentMethod, memberRelationship])

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
  const maxima = useMemo(() => {
    const out = {}
    for (const col of COLUMNS) {
      if (!col.bar) continue
      out[col.key] = rows.reduce((mx, r) => {
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

      {/* Controls */}
      <div className="bg-surface rounded-xl border border-border p-4 flex flex-wrap gap-4 items-end">
        <label className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Member Count Exclusion</span>
          <select
            value={exclusion}
            onChange={e => setExclusion(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
          >
            <option value="exclude">Exclude</option>
            <option value="include">Include</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[170px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Sort By</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
          >
            {SORT_OPTIONS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[120px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Sort Order</span>
          <select
            value={sortOrder}
            onChange={e => setSortOrder(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
          >
            <option value="desc">Descending</option>
            <option value="asc">Ascending</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 min-w-[150px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Average Lines</span>
          <select
            value={showAverages ? 'show' : 'hide'}
            onChange={e => setShowAverages(e.target.value === 'show')}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary"
          >
            <option value="show">Show</option>
            <option value="hide">Hide</option>
          </select>
        </label>
        <Select label="Join Source" value={joinSource} onChange={setJoinSource} options={options.joinSource || []} />
        <Select label="Membership Type" value={membershipType} onChange={setMembershipType} options={options.membershipType || []} />
        <Select label="Age Group" value={ageGroup} onChange={setAgeGroup} options={options.ageGroup || []} />
        <Select label="Gender" value={gender} onChange={setGender} options={options.gender || []} />
        <Select label="Payment Term" value={paymentTerm} onChange={setPaymentTerm} options={options.paymentTerm || []} />
        <Select label="Payment Mode" value={paymentMethod} onChange={setPaymentMethod} options={options.paymentMethod || []} />
        <Select label="Member Relationship" value={memberRelationship} onChange={setMemberRelationship} options={options.memberRelationship || []} />
      </div>

      {/* Table */}
      <div className="bg-surface rounded-xl border border-border">
        <div className="overflow-x-auto">
          <table className="min-w-max w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="sticky left-0 z-10 bg-surface text-left font-semibold text-text-primary px-4 py-3 min-w-[290px]">
                  Club + Salesperson
                </th>
                {COLUMNS.map(col => (
                  <th key={col.key} className="text-left font-semibold text-text-muted px-3 py-3 text-xs min-w-[140px]">
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr
                  key={row.key}
                  onMouseEnter={() => setHovered(row.key)}
                  onMouseLeave={() => setHovered(h => (h === row.key ? null : h))}
                  className="border-b border-border/60 last:border-0 hover:bg-bg/60 relative"
                >
                  <td className="sticky left-0 z-10 bg-surface px-4 py-2 whitespace-nowrap">
                    <span className="text-text-primary">{row.club} — {row.salesperson}</span>
                    {hovered === row.key && <RowTooltip row={row} startDate={startDate} endDate={endDate} />}
                  </td>
                  {COLUMNS.map(col => {
                    const value = row[col.key]
                    const max = maxima[col.key] || 0
                    const width = col.bar && typeof value === 'number' && max > 0
                      ? Math.max(2, Math.round((value / max) * 100))
                      : 0
                    const avg = showAverages ? averages[col.key] : null
                    const avgLeft = col.bar && typeof avg === 'number' && max > 0
                      ? Math.min(100, Math.round((avg / max) * 100))
                      : null
                    return (
                      <td key={col.key} className="px-3 py-2">
                        {col.bar ? (
                          <div className="relative flex items-center gap-2 h-5">
                            <div className="relative flex-1 h-4 min-w-[60px]">
                              <div className={`absolute inset-y-0 left-0 rounded-sm ${BAR_TONES[col.barTone]}`} style={{ width: `${width}%` }} />
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

// Hover breakdown, mirroring the source tool's tooltip.
function RowTooltip({ row, startDate, endDate }) {
  return (
    <div className="absolute left-4 top-full mt-1 z-30 w-[330px] bg-surface border border-border rounded-lg shadow-lg p-4 text-left pointer-events-none">
      <p className="text-[11px] text-text-muted mb-2">{startDate} – {endDate}</p>
      <p className="text-sm font-bold text-text-primary mb-3">{row.club} — {row.salesperson}</p>
      <dl className="space-y-1 text-xs">
        <Line label="New Member Units" value={fmt(row.newMemberUnits, 'int')} />
        <Line label="% of Club Total New Member Units" value={fmt(row.pctOfClubTotal, 'pct')} />
        <Line label="% of New Member Units on ACH" value={fmt(row.pctOnAch, 'pct')} />
        {Object.keys(row.paymentMix || {}).length > 0 && (
          <div className="pl-3 pt-0.5 space-y-0.5">
            {Object.entries(row.paymentMix)
              .sort((a, b) => b[1] - a[1])
              .map(([method, count]) => (
                <div key={method} className="flex justify-between gap-4 text-[11px]">
                  <dt className="text-text-muted">{method}</dt>
                  <dd className="text-text-muted tabular-nums flex-shrink-0">{count}</dd>
                </div>
              ))}
          </div>
        )}
        <div className="h-2" />
        <Line label="Total New Dues Draft" value={fmt(row.totalNewDuesDraft, 'money')} />
        <Line label="Avg New Dues Draft" value={fmt(row.avgNewDuesDraft, 'money')} />
        <div className="h-2" />
        <Line label="Tours Given" value={fmt(row.toursGiven, 'int')} />
        <Line label="Tour Conversion Rate" value={fmt(row.tourConversionRate, 'pct')} />
        <Line label="Avg Days from Tour to Conversion" value={fmt(row.avgDaysToConversion, 'num')} />
        <div className="h-2" />
        <Line label="Day One Book Count" value={fmt(row.dayOneBookCount, 'int')} />
        <Line label="Day One Book %" value={fmt(row.dayOneBookPct, 'pct')} />
        <Line label="Book on Join Date Count" value={fmt(row.bookOnJoinDateCount, 'int')} />
        <Line label="Book on Join Date %" value={fmt(row.bookOnJoinDatePct, 'pct')} />
      </dl>
    </div>
  )
}

function Line({ label, value }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-muted">{label}:</dt>
      <dd className="text-text-primary font-semibold tabular-nums flex-shrink-0">{value}</dd>
    </div>
  )
}

// Say plainly which columns are empty and why, so an N/A never reads as a zero.
function DataNotes({ meta }) {
  if (!meta) return null
  const notes = Object.values(meta.unavailable || {})
  return (
    <div className="bg-surface rounded-xl border border-border p-4 text-xs text-text-muted space-y-1">
      <p>
        <span className="font-semibold text-text-primary">Day One Book Count</span> replaces the source tool's
        PT Intro Book Count. Booking credit follows whoever booked the Day One, so a person can book more Day Ones
        than they sold memberships and exceed 100%.
      </p>
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
