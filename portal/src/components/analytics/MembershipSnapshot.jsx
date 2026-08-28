import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { StatCard, TrendPanel, PersonSearch, ChooseSomeone } from './snapshotParts'

// ---------------------------------------------------------------------------
// Membership Snapshot — Analytics (admin only)
//
// One salesperson, month to date, compared against EITHER the same window a
// month earlier or another person. Never both: two comparisons on one card
// means two readings of every arrow.
//
// Every number here is the same number Salesperson Performance shows for that
// person — both come from buildReport — so the drill-down cannot disagree with
// the table it came from.
//
// Day One SOLD is deliberately absent. Closing a Day One is a training outcome
// and belongs to the trainer who ran it, not to whoever signed the member.
// ---------------------------------------------------------------------------

export default function MembershipSnapshot({ startDate, endDate, locationSlug }) {
  const [person, setPerson] = useState('')
  const [compare, setCompare] = useState('')
  const [comparing, setComparing] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    if (person) p.set('person', person)
    if (comparing && compare) p.set('compare', compare)
    return p.toString()
  }, [startDate, endDate, locationSlug, person, compare, comparing])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/membership-snapshot?${query}`, { cache: true, signal }),
    [query]
  )

  const people = data?.people || []
  const series = data?.series || []
  const compareSeries = data?.compareSeries || []
  const months = series.map(s => s.month)
  const cmpName = data?.comparingTo || null

  const line = (label, key, rows) => ({
    key: label, label, points: rows.map(r => ({ month: r.month, value: r[key] })),
  })

  return (
    <div className="space-y-3">
      <Toolbar
        people={people}
        person={person} setPerson={setPerson}
        compare={compare} setCompare={setCompare}
        comparing={comparing} setComparing={setComparing}
      />

      {loading && <DesktopLoading />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && !person && <ChooseSomeone what="team member" />}

      {!loading && !error && person && (
        <>
          <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <p className="text-base font-bold text-text-primary">
                {data?.salesperson || person}
                {cmpName && <span className="text-text-muted font-medium"> vs {cmpName}</span>}
              </p>
              <p className="text-[11px] text-text-muted">{data?.club || ''}</p>
            </div>
            <p className="text-[11px] text-text-muted">
              {data?.meta?.windowLabel}
              <span className="mx-1.5">vs</span>
              <span className="font-semibold text-text-primary">{data?.meta?.comparisonLabel}</span>
            </p>
          </div>

          {data && !data.hasActivity && (
            <div className="bg-surface rounded-xl border border-border p-6 text-center">
              <p className="text-sm text-text-muted">
                No memberships or Day Ones for this person in the selected range.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
            {(data?.stats || []).map(s => (
              <StatCard key={s.key} stat={s} comparisonLabel={data?.meta?.comparisonLabel} />
            ))}
          </div>

          {/* Counts and rates never share a panel. In compare mode each panel
              carries one metric for both people, which is the only way two
              people's trends read against each other. */}
          {cmpName ? (
            <>
              <TrendPanel title="New Members" months={months} series={[
                line(data?.salesperson || person, 'newMembers', series),
                line(cmpName, 'newMembers', compareSeries),
              ]} />
              <TrendPanel title="Day Ones Booked" months={months} series={[
                line(data?.salesperson || person, 'dayOnesBooked', series),
                line(cmpName, 'dayOnesBooked', compareSeries),
              ]} />
              <TrendPanel title="Day One Book %" kind="rate" months={months} series={[
                line(data?.salesperson || person, 'bookPct', series),
                line(cmpName, 'bookPct', compareSeries),
              ]} />
            </>
          ) : (
            <>
              <TrendPanel title="Memberships and Day Ones" months={months} series={[
                line('New Members', 'newMembers', series),
                line('Day Ones Booked', 'dayOnesBooked', series),
              ]} />
              <TourPanel months={months} series={series} />
            </>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Tours given, tours sold, and average days to sign.
 *
 * All three are null today: tours are live-fetched from GHL and never stored,
 * so there is nothing to aggregate over — the same reason the tour columns on
 * Salesperson Performance read N/A. The panel says so rather than drawing three
 * flat lines along zero, which would read as "no tours given" instead of "we do
 * not record tours yet".
 */
function TourPanel({ months, series }) {
  const hasTours = series.some(r => typeof r.toursGiven === 'number')
  if (!hasTours) {
    return (
      <div className="bg-surface rounded-xl border border-border p-6 text-center">
        <p className="text-xs font-bold text-text-primary">Tours</p>
        <p className="text-xs text-text-muted mt-1">
          Tours given, tours sold and average days to sign will appear here once tour events are
          stored. They are fetched live from GHL today and nothing is kept, so there is nothing to
          chart — the same reason the tour columns on Salesperson Performance read N/A.
        </p>
      </div>
    )
  }
  return (
    <TrendPanel
      title="Tours"
      months={months}
      series={[
        { key: 'Tours Given', label: 'Tours Given', points: series.map(r => ({ month: r.month, value: r.toursGiven })) },
        { key: 'Tours Sold', label: 'Tours Sold', points: series.map(r => ({ month: r.month, value: r.toursSold })) },
        { key: 'Avg Days to Sign', label: 'Avg Days to Sign', points: series.map(r => ({ month: r.month, value: r.avgDaysToSign })) },
      ]}
    />
  )
}

function Toolbar({ people, person, setPerson, compare, setCompare, comparing, setComparing }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <PersonSearch
        label="Team Member"
        listId="membership-people"
        people={people}
        value={person}
        onChange={setPerson}
      />
      {comparing && (
        <PersonSearch
          label="Compare With"
          listId="membership-compare"
          people={people}
          value={compare}
          onChange={setCompare}
        />
      )}
      <button
        type="button"
        onClick={() => { setComparing(v => !v); if (comparing) setCompare('') }}
        className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
          comparing
            ? 'bg-wcs-red text-white border-wcs-red'
            : 'bg-bg text-text-primary border-border hover:border-text-muted'
        }`}
      >
        {comparing ? 'Comparing' : 'Compare'}
      </button>
    </div>,
    slot
  )
}
