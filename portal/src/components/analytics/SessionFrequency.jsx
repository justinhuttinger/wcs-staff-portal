import { useMemo } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatCard, BreakdownPanel } from './snapshotParts'
import Drillable from './Drillable'
import { fmtInt, GOOD_COLOR, BAD_COLOR } from './chartPalette'

// ---------------------------------------------------------------------------
// Session Frequency — how often clients actually train.
//
// PER WEEK, NOT PER WINDOW. The two windows are rarely the same length: month
// to date on the 3rd is three days against a full prior month, and comparing
// raw counts there reports that everybody stopped training.
//
// The report keys on people who trained in EITHER window, so a client who
// trained last month and not this one is visible. That row is the reason to
// open this report at all.
// ---------------------------------------------------------------------------

const DRILL = {
  clients:      { set: 'pt-clients', title: 'Clients trained' },
  sessions:     { set: 'pt-sessions', filter: 'pt', title: 'PT sessions' },
  perWeek:      { set: 'pt-sessions', filter: 'pt', title: 'PT sessions' },
  avgPerClient: { set: 'pt-clients', title: 'Clients trained' },
}

export default function SessionFrequency({ startDate, endDate, locationSlug }) {
  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/session-frequency?${query}`, { cache: true, signal }),
    [query]
  )

  if (loading) return <DesktopLoading variant="report" />

  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const rows = data?.rows || []
  const lapsed = data?.lapsed || []
  const params = { start: startDate, end: endDate, clubs: locationSlug || 'all' }

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-base font-bold text-text-primary">Session Frequency</p>
        <p className="text-[11px] text-text-muted">
          {data?.meta?.windowLabel}
          <span className="mx-1.5">vs</span>
          <span className="font-semibold text-text-primary">{data?.meta?.comparisonLabel}</span>
          {data?.meta?.currentWeeks && (
            <span className="ml-1.5">
              ({data.meta.currentWeeks} wks vs {data.meta.priorWeeks})
            </span>
          )}
        </p>
      </div>

      {data && !data.hasActivity && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">No PT sessions in either window.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-2">
        {(data?.stats || []).map(s => {
          const d = DRILL[s.key]
          const card = <StatCard stat={s} comparisonLabel={data?.meta?.comparisonLabel} />
          if (!d || !s.value) return <div key={s.key}>{card}</div>
          return (
            <Drillable key={s.key} set={d.set} title={d.title} params={{ ...params, filter: d.filter }}>
              {card}
            </Drillable>
          )
        })}
      </div>

      <BreakdownPanel
        title="How Often They Train"
        rows={data?.breakdowns?.byFrequency}
        empty="Nobody trained in either window."
      />

      {/* The rows worth acting on, ahead of the full list: somebody who trained
          last window and not this one has not cancelled, and there is still
          time to ask why. */}
      {lapsed.length > 0 && (
        <div className="bg-surface rounded-xl border border-border">
          <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-border">
            <div>
              <p className="text-sm font-bold text-text-primary">Stopped Training</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Trained last window, nothing this one
              </p>
            </div>
            <p className="text-[11px] text-text-muted tabular-nums">{fmtInt(lapsed.length)}</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="text-left font-semibold px-4 py-2">Client</th>
                  <th className="text-left font-semibold px-3 py-2">Trainer</th>
                  <th className="text-right font-semibold px-3 py-2">Was Training</th>
                  <th className="text-right font-semibold px-3 py-2">Last Session</th>
                </tr>
              </thead>
              <tbody>
                {lapsed.map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2 text-text-primary">{r.member}</td>
                    <td className="px-3 py-2 text-text-muted">{r.trainer}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                      {r.priorPerWeek} a week
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted whitespace-nowrap">
                      {r.last || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-surface rounded-xl border border-border">
        <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-border">
          <p className="text-sm font-bold text-text-primary">Every Client</p>
          <p className="text-[11px] text-text-muted tabular-nums">{fmtInt(rows.length)}</p>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-text-muted">Nobody trained in either window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  <th className="text-left font-semibold px-4 py-2">Client</th>
                  <th className="text-left font-semibold px-3 py-2">Trainer</th>
                  <th className="text-right font-semibold px-3 py-2">Sessions</th>
                  <th className="text-right font-semibold px-3 py-2">Per Week</th>
                  <th className="text-right font-semibold px-3 py-2">Was</th>
                  <th className="text-right font-semibold px-3 py-2">Change</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 200).map((r, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2 text-text-primary">{r.member}</td>
                    <td className="px-3 py-2 text-text-muted">{r.trainer}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{r.sessions}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary">{r.perWeek}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-muted">{r.priorPerWeek}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold"
                      style={{ color: r.change > 0 ? GOOD_COLOR : r.change < 0 ? BAD_COLOR : undefined }}>
                      {r.change > 0 ? '+' : ''}{r.change}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 200 && (
              <p className="px-4 py-2 text-[11px] text-text-muted border-t border-border">
                Showing the 200 busiest. The Data section below has every session.
              </p>
            )}
          </div>
        )}
      </div>

      {data?.note && (
        <p className="text-[11px] text-text-muted px-1 leading-snug">{data.note}</p>
      )}
    </div>
  )
}
