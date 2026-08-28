import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { StatCard, TrendPanel, PersonPicker } from './snapshotParts'

// ---------------------------------------------------------------------------
// Membership Snapshot — Analytics (admin only)
//
// One salesperson, month to date, against the same window a month earlier.
//
// Every number here is the same number Salesperson Performance shows for that
// person — both come from buildReport — so the drill-down can never disagree
// with the table it came from.
// ---------------------------------------------------------------------------

export default function MembershipSnapshot({ startDate, endDate, locationSlug }) {
  const [person, setPerson] = useState('')

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    if (person) p.set('person', person)
    return p.toString()
  }, [startDate, endDate, locationSlug, person])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/membership-snapshot?${query}`, { cache: true, signal }),
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

  const series = data?.series || []
  const months = series.map(s => s.month)

  return (
    <div className="space-y-3">
      <Toolbar
        people={data?.people || []}
        value={person || data?.salesperson || ''}
        onChange={setPerson}
      />

      <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <p className="text-base font-bold text-text-primary">{data?.salesperson || 'No one selected'}</p>
          <p className="text-[11px] text-text-muted">{data?.club || ''}</p>
        </div>
        <p className="text-[11px] text-text-muted tabular-nums">
          {data?.meta?.start} to {data?.meta?.end}
          <span className="mx-1">vs</span>
          {data?.meta?.priorStart} to {data?.meta?.priorEnd}
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
        {(data?.stats || []).map(s => <StatCard key={s.key} stat={s} />)}
      </div>

      {/* Counts and rates never share a panel. */}
      <TrendPanel
        title="Memberships and Day Ones"
        months={months}
        series={[
          { key: 'New Members', label: 'New Members', points: series.map(r => ({ month: r.month, value: r.newMembers })) },
          { key: 'Day Ones', label: 'Day Ones Booked', points: series.map(r => ({ month: r.month, value: r.dayOnesBooked })) },
          { key: 'Sold', label: 'Day Ones Sold', points: series.map(r => ({ month: r.month, value: r.dayOnesSold })) },
        ]}
      />

      <TrendPanel
        title="Book Rate and Close Rate"
        kind="rate"
        months={months}
        series={[
          { key: 'Book %', label: 'Day One Book %', points: series.map(r => ({ month: r.month, value: r.bookPct })) },
          { key: 'Close %', label: 'Day One Close %', points: series.map(r => ({ month: r.month, value: r.closeRate })) },
        ]}
      />

      <p className="text-[11px] text-text-muted px-1">
        Book % is Day Ones booked against the memberships this person signed, and stands in for the
        conversion metric still being defined. It can exceed 100% where someone books more Day Ones
        than they sign.
      </p>
    </div>
  )
}

function Toolbar({ people, value, onChange }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <PersonPicker label="Team Member" people={people} value={value} onChange={onChange} />,
    slot
  )
}
