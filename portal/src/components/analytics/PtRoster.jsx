import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { StatCard, BreakdownPanel } from './snapshotParts'
import Drillable from './Drillable'
import { fmtInt, fmtMoney } from './chartPalette'

// ---------------------------------------------------------------------------
// PT Roster — who is on training right now.
//
// A STOCK, not a window, which is why there is no trend panel and no date
// controls: this is the book as it stands today. Session Frequency is the
// report that answers what has been happening over time.
// ---------------------------------------------------------------------------

const DRILL = {
  clients:        { set: 'pt-sales', title: 'PT sales' },
  recurring:      { set: 'pt-sales', filter: 'rs', title: 'Recurring PT sales' },
  pif:            { set: 'pt-sales', filter: 'pif', title: 'Paid-in-full PT sales' },
  monthlyRevenue: { set: 'pt-sales', filter: 'rs', title: 'Recurring PT sales' },
}

export default function PtRoster({ locationSlug, startDate, endDate }) {
  // The window's END is the as-of date. A roster is always "as at" a moment,
  // and abc_pt_services keeps every service as a dated term, so the same report
  // answers today and any day back to June 2022.
  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (endDate) p.set('asOf', endDate)
    return p.toString()
  }, [locationSlug, endDate])

  const { data, loading, error } = useCancellableFetch(
    (signal) => api(`/analytics/pt-roster?${query}`, { cache: true, signal }),
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

  const clients = data?.clients || []
  // The drill-downs read PT SALES, which are dated, so they take the shared
  // window rather than the roster's "today" — the roster itself has no window.
  const params = { start: startDate, end: endDate, clubs: locationSlug || 'all' }

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-base font-bold text-text-primary">PT Roster</p>
        <p className="text-[11px] text-text-muted">
          {data?.meta?.isHistorical ? 'As it stood ' : 'As it stands '}
          <span className="font-semibold text-text-primary">{data?.meta?.asOf}</span>
        </p>
      </div>

      {data && !data.hasActivity && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">Nobody is on personal training at these clubs.</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
        {(data?.stats || []).map(s => {
          const d = DRILL[s.key]
          const card = <StatCard stat={s} />
          if (!d || !s.value) return <div key={s.key}>{card}</div>
          return (
            <Drillable key={s.key} set={d.set} title={d.title} params={{ ...params, filter: d.filter }}>
              {card}
            </Drillable>
          )
        })}
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <BreakdownPanel
          title="Clients per Trainer"
          rows={data?.breakdowns?.byTrainer}
          showValue
          empty="Nobody has clients."
        />
        {/* Billing cadence, not sessions per week — the note below says so, and
            Session Frequency is where the other question is answered. */}
        <BreakdownPanel
          title="Billing Frequency"
          rows={data?.breakdowns?.byFrequency}
          empty="No recurring services on the books."
        />
      </div>

      <TrainerRoster trainers={data?.trainers} total={clients.length} />

      {data?.note && (
        <p className="text-[11px] text-text-muted px-1 leading-snug">{data.note}</p>
      )}
    </div>
  )
}

/**
 * The roster by trainer, each collapsed to a line until it is opened.
 *
 * This is how the roster is actually read — "what is on Katie's book". A flat
 * list of four hundred names sorted by draft answers "who pays the most", which
 * is not a question anybody opens this report to ask.
 *
 * Everything needed to scan a trainer is on the CLOSED line: how many clients,
 * what they draft, how many are frozen. Opening one is for the names.
 */
function TrainerRoster({ trainers, total }) {
  const list = trainers || []
  const [open, setOpen] = useState(() => new Set())

  function toggle(name) {
    setOpen(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  if (list.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-text-muted">Nothing on the books.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-3 border-b border-border">
        <p className="text-sm font-bold text-text-primary">By Trainer</p>
        <p className="text-[11px] text-text-muted tabular-nums">
          {fmtInt(list.length)} trainers · {fmtInt(total)} clients
        </p>
      </div>

      {list.map(t => {
        const isOpen = open.has(t.trainer)
        return (
          <div key={t.trainer} className="border-b border-border last:border-0">
            <button
              type="button"
              onClick={() => toggle(t.trainer)}
              aria-expanded={isOpen}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
                aria-hidden="true"
                className={'w-3.5 h-3.5 text-text-muted flex-shrink-0 transition-transform '
                  + (isOpen ? 'rotate-90' : '')}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-sm font-semibold text-text-primary flex-1 min-w-0 truncate">
                {t.trainer}
              </span>
              {t.frozen > 0 && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-bg text-text-muted whitespace-nowrap">
                  {t.frozen} frozen
                </span>
              )}
              <span className="text-[11px] text-text-muted tabular-nums whitespace-nowrap">
                {fmtInt(t.count)} {t.count === 1 ? 'client' : 'clients'}
              </span>
              <span className="text-sm font-bold text-text-primary tabular-nums w-24 text-right whitespace-nowrap">
                {t.monthly ? fmtMoney(t.monthly) : '—'}
              </span>
            </button>

            {isOpen && (
              <div className="bg-bg border-t border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                      <th className="text-left font-semibold px-4 py-2">Client</th>
                      <th className="text-left font-semibold px-3 py-2">Club</th>
                      <th className="text-left font-semibold px-3 py-2">Type</th>
                      <th className="text-right font-semibold px-3 py-2">Monthly</th>
                      <th className="text-right font-semibold px-3 py-2">Paid Up Front</th>
                      <th className="text-right font-semibold px-3 py-2">Last Sold</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.clients.map((c, i) => (
                      <tr key={i} className="border-t border-border/60">
                        <td className="px-4 py-2 text-text-primary">
                          {c.member}
                          {c.frozen && (
                            <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-surface text-text-muted">
                              Frozen
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-text-muted">{c.club}</td>
                        <td className="px-3 py-2 text-text-muted">
                          {c.type === 'recurring' ? 'Recurring' : 'Paid in Full'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-primary">
                          {c.monthly ? fmtMoney(c.monthly) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-muted">
                          {c.paidUpFront ? fmtMoney(c.paidUpFront) : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-text-muted whitespace-nowrap">
                          {c.lastSold || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
