import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { StatCard, TrendPanel, PersonSearch, ChooseSomeone } from './snapshotParts'
import PendingOutcomePanel from './PendingOutcomePanel'

// ---------------------------------------------------------------------------
// Trainer Snapshot — Analytics (admin only)
//
// One trainer, month to date, compared against EITHER the same window a month
// earlier or another trainer. Never both.
//
// Every number here is the same number the Trainer Performance table shows for
// that person — both come from buildTrainerPerformance — so the drill-down
// cannot disagree with the table it came from.
//
// DAY ONES ARE THE ONES THIS TRAINER SERVICED, not ones they booked. Trainers
// run intros; the front desk books them. The Day One panel therefore shows what
// became of the intros they were given: completed, sold, cancelled, no-showed.
//
// PT Close Amount is credited to the COMMISSION employee and split into
// recurring versus paid in full. Lost revenue is credited to the SERVICE
// employee instead: losing a client happens to whoever was training them.
// ---------------------------------------------------------------------------

export default function TrainerSnapshot({ startDate, endDate, locationSlug }) {
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
    (signal) => api(`/analytics/trainer-snapshot?${query}`, { cache: true, signal }),
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

      {!loading && !error && !person && <ChooseSomeone what="trainer" />}

      {!loading && !error && person && (
        <>
          <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
            <div>
              <p className="text-base font-bold text-text-primary">
                {data?.trainer || person}
                {cmpName && <span className="text-text-muted font-medium"> vs {cmpName}</span>}
              </p>
              <p className="text-[11px] text-text-muted">
                {[data?.club, data?.lastSession ? `last session ${data.lastSession}` : null]
                  .filter(Boolean).join(' · ')}
              </p>
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
                No sessions, Day Ones or PT sales for this trainer in the selected range.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
            {(data?.stats || []).map(s => (
              <StatCard key={s.key} stat={s} comparisonLabel={data?.meta?.comparisonLabel} />
            ))}
          </div>

          {cmpName ? (
            <>
              <TrendPanel title="Sessions" months={months} series={[
                line(data?.trainer || person, 'completedSessions', series),
                line(cmpName, 'completedSessions', compareSeries),
              ]} />
              <TrendPanel title="Day Ones Serviced" months={months} series={[
                line(data?.trainer || person, 'dayOnes', series),
                line(cmpName, 'dayOnes', compareSeries),
              ]} />
              <TrendPanel title="PT Close Amount" months={months} series={[
                line(data?.trainer || person, 'closeAmount', series),
                line(cmpName, 'closeAmount', compareSeries),
              ]} />
            </>
          ) : (
            <>
              <TrendPanel title="Sessions and Clients" months={months} series={[
                line('Sessions', 'completedSessions', series),
                line('Clients', 'uniqueClients', series),
              ]} />

              {/* What became of the intros this trainer was given. All five are
                  counts of the same population, so they belong on one scale. */}
              <TrendPanel title="Day Ones Serviced" months={months} series={[
                line('Day Ones', 'dayOnes', series),
                line('Completed', 'dayOnesCompleted', series),
                line('Sold', 'dayOnesSold', series),
                line('Cancelled', 'dayOnesCancelled', series),
                line('No Showed', 'dayOnesNoShow', series),
                line('Pending Outcome', 'dayOnesPending', series),
              ]} />

              {/* This trainer's own outstanding intros, oldest first. */}
              <PendingOutcomePanel pending={data?.pending} title="Their Pending Outcomes" />

              <TrendPanel title="Close Rate and Cancellation Rate" kind="rate" months={months} series={[
                line('Close Rate', 'closeRate', series),
                line('Cancellation Rate', 'cancellationRate', series),
              ]} />

              <TrendPanel title="PT Close Amount" months={months} series={[
                line('PT Close Amount', 'closeAmount', series),
              ]} />

              {/* The same money, split by what was sold. These two sum to the
                  panel above. */}
              <TrendPanel title="PT Close by Type" months={months} series={[
                line('Recurring', 'closeAmountRs', series),
                line('Paid in Full', 'closeAmountPif', series),
              ]} />

              {/* Won against lost. Both drawn positive because the chart scales
                  from zero; the net is on the stat card. The qualifier is in the
                  title rather than a footnote: paid-in-full packages that simply
                  ran out are not counted, so this is not the whole story of
                  churn and should not be read as if it were. */}
              <TrendPanel title="Revenue Closed and Lost (recurring deactivations only)" months={months} series={[
                line('Closed', 'closeAmount', series),
                line('Lost', 'lostValue', series),
              ]} />
            </>
          )}
        </>
      )}
    </div>
  )
}

function Toolbar({ people, person, setPerson, compare, setCompare, comparing, setComparing }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <PersonSearch
        label="Trainer"
        listId="trainer-people"
        people={people}
        value={person}
        onChange={setPerson}
      />
      {comparing && (
        <PersonSearch
          label="Compare With"
          listId="trainer-compare"
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
