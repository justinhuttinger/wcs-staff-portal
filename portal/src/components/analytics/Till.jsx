import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, fmtMonth, GOOD_COLOR, BAD_COLOR } from './chartPalette'
import { MonthlyTrend, RankedBars } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Till — Analytics (admin only)
//
// NET AND ABSOLUTE VARIANCE ARE BOTH SHOWN, AND RANKINGS USE ABSOLUTE. A club
// $50 short on Monday and $50 over on Tuesday nets to zero and did not
// reconcile either day. Ranking on net lets the worst drawer in the company
// average out to looking perfect.
//
// A MISSING COUNT IS NEVER A ZERO. A club that stopped counting and a club with
// perfect drawers produce the same net, and they are opposite facts. Days
// without a closing count are reported as missing and excluded from every rate.
// ---------------------------------------------------------------------------

const CLUB_LABEL = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

const money = v => (v === null || v === undefined ? '—' : fmtMoney(v))

/** Over is green, short is red, and the sign is always printed. */
function Variance({ value, bold = false }) {
  if (value === null || value === undefined) return <span className="text-text-muted">—</span>
  const colour = value === 0 ? undefined : value > 0 ? GOOD_COLOR : BAD_COLOR
  return (
    <span className={`tabular-nums ${bold ? 'font-semibold' : ''}`} style={colour ? { color: colour } : undefined}>
      {value > 0 ? '+' : ''}{fmtMoney(value)}
    </span>
  )
}

export default function Till({ startDate, endDate, locationSlug }) {
  const [asTable, setAsTable] = useState(false)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/till?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const byClub = data?.byClub || []
  const byPerson = data?.byPerson || []
  const worstDays = useMemo(() => (data?.materialDays || []).slice(0, 12), [data])

  return (
    <div className="space-y-3">
      <Toolbar asTable={asTable} setAsTable={setAsTable} />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="bg-surface rounded-xl border border-border p-3">
            <p className="text-[11px] text-text-muted">{data.notes?.absolute}</p>
          </div>

          {data.notes?.coverage && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.coverage}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              <div className="px-5 py-4 text-center min-w-[130px] flex-1">
                <p className="text-xl font-bold"><Variance value={s.net} bold /></p>
                <p className="text-[11px] text-text-muted mt-0.5">Net Over / Short</p>
              </div>
              {[
                { label: 'Absolute Variance', value: money(s.absolute) },
                { label: 'Avg per Day', value: money(s.avgAbsolute) },
                { label: 'Days Off by $5+', value: fmtInt(s.materialDays), alarm: s.materialDays > 0 },
                { label: 'Days Reconciled', value: `${fmtInt(s.reconciledDays)} / ${fmtInt(s.totalDays)}` },
                { label: 'Count Rate', value: s.countRate === null || s.countRate === undefined ? 'N/A' : `${s.countRate}%` },
                { label: 'Cash Taken', value: money(s.cashSales), muted: true },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[120px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${
                    t.alarm ? 'text-wcs-red' : t.muted ? 'text-text-muted' : 'text-text-primary'
                  }`}>
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {asTable ? (
            <TableView days={data.days || []} byClub={byClub} byPerson={byPerson} months={data.months || []} />
          ) : (
            <>
              <MonthlyTrend
                title="Absolute Variance by Month"
                months={data.months || []}
                valueKey="absolute"
                format="int"
                seriesName="till"
                subtitle="shortages and overages added, not netted"
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <RankedBars
                  title="Variance by Club"
                  rows={byClub.map(c => ({ ...c, label: CLUB_LABEL(c.slug) }))}
                  labelKey="label" valueKey="absolute" format="int"
                  secondary={c => `net ${c.net > 0 ? '+' : ''}${fmtMoney(c.net)} · ${c.reconciledDays}/${c.days} days counted`}
                  emptyText="No till activity in this selection."
                />
                <RankedBars
                  title="Variance by Closer"
                  rows={byPerson.slice(0, 12).map(p => ({ ...p, label: p.name }))}
                  labelKey="label" valueKey="absolute" format="int"
                  secondary={p => `${p.days} close${p.days === 1 ? '' : 's'} · avg ${fmtMoney(p.avgAbsolute)}`}
                  emptyText="No named closing counts in this selection."
                />
              </div>

              {worstDays.length > 0 && (
                <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
                  <p className="text-xs font-bold text-text-primary mb-1">Drawers That Did Not Balance</p>
                  <p className="text-[11px] text-text-muted mb-2">
                    Days off by $5 or more, largest first. Small change is rounding; this is not.
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                        <th className="text-left font-semibold py-1.5">Date</th>
                        <th className="text-left font-semibold py-1.5">Club</th>
                        <th className="text-left font-semibold py-1.5">Closed By</th>
                        <th className="text-right font-semibold py-1.5">Expected</th>
                        <th className="text-right font-semibold py-1.5">Counted</th>
                        <th className="text-right font-semibold py-1.5">Over / Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {worstDays.map((d, i) => (
                        <tr key={`${d.slug}-${d.date}-${i}`} className="border-b border-border/60 last:border-0">
                          <td className="py-1.5 text-text-primary">{d.date}</td>
                          <td className="py-1.5 text-text-muted">{CLUB_LABEL(d.slug)}</td>
                          <td className="py-1.5 text-text-muted">{d.closeBy || '—'}</td>
                          <td className="py-1.5 text-right tabular-nums text-text-muted">{money(d.expectedClose)}</td>
                          <td className="py-1.5 text-right tabular-nums text-text-primary">{money(d.countedClose)}</td>
                          <td className="py-1.5 text-right"><Variance value={d.overShort} bold /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function TableView({ days, byClub, byPerson, months }) {
  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Club</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Club</th>
              <th className="text-right font-semibold py-1.5">Net</th>
              <th className="text-right font-semibold py-1.5">Absolute</th>
              <th className="text-right font-semibold py-1.5">Avg / Day</th>
              <th className="text-right font-semibold py-1.5">Days Off $5+</th>
              <th className="text-right font-semibold py-1.5">Counted</th>
              <th className="text-right font-semibold py-1.5">Cash Taken</th>
            </tr>
          </thead>
          <tbody>
            {byClub.map(c => (
              <tr key={c.slug} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{CLUB_LABEL(c.slug)}</td>
                <td className="py-1.5 text-right"><Variance value={c.net} /></td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{money(c.absolute)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{money(c.avgAbsolute)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(c.material)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{c.reconciledDays}/{c.days}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{money(c.cashSales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Closer</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Name</th>
              <th className="text-left font-semibold py-1.5">Clubs</th>
              <th className="text-right font-semibold py-1.5">Closes</th>
              <th className="text-right font-semibold py-1.5">Net</th>
              <th className="text-right font-semibold py-1.5">Absolute</th>
              <th className="text-right font-semibold py-1.5">Avg / Close</th>
            </tr>
          </thead>
          <tbody>
            {byPerson.map((p, i) => (
              <tr key={`${p.name}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{p.name}</td>
                <td className="py-1.5 text-text-muted">{p.clubs.map(CLUB_LABEL).join(', ')}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(p.days)}</td>
                <td className="py-1.5 text-right"><Variance value={p.net} /></td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{money(p.absolute)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{money(p.avgAbsolute)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">By Month</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Month</th>
              <th className="text-right font-semibold py-1.5">Days</th>
              <th className="text-right font-semibold py-1.5">Net</th>
              <th className="text-right font-semibold py-1.5">Absolute</th>
            </tr>
          </thead>
          <tbody>
            {months.map(m => (
              <tr key={m.month} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{fmtMonth(m.month)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(m.days)}</td>
                <td className="py-1.5 text-right"><Variance value={m.net} /></td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{money(m.absolute)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
        <p className="text-xs font-bold text-text-primary mb-2">Every Day</p>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
              <th className="text-left font-semibold py-1.5">Date</th>
              <th className="text-left font-semibold py-1.5">Club</th>
              <th className="text-left font-semibold py-1.5">Status</th>
              <th className="text-right font-semibold py-1.5">Cash</th>
              <th className="text-right font-semibold py-1.5">Expected</th>
              <th className="text-right font-semibold py-1.5">Counted</th>
              <th className="text-right font-semibold py-1.5">Over / Short</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={`${d.slug}-${d.date}-${i}`} className="border-b border-border/60 last:border-0">
                <td className="py-1.5 text-text-primary">{d.date}</td>
                <td className="py-1.5 text-text-muted">{CLUB_LABEL(d.slug)}</td>
                <td className={`py-1.5 text-[11px] ${d.status === 'complete' ? 'text-text-muted' : 'text-amber-600'}`}>
                  {d.status.replace(/_/g, ' ')}
                </td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{money(d.cashSales)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-muted">{money(d.expectedClose)}</td>
                <td className="py-1.5 text-right tabular-nums text-text-primary">{money(d.countedClose)}</td>
                <td className="py-1.5 text-right"><Variance value={d.overShort} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Toolbar({ asTable, setAsTable }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <button
        type="button"
        onClick={() => setAsTable(v => !v)}
        className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
      >
        {asTable ? 'Show charts' : 'Show table'}
      </button>
    </div>,
    slot
  )
}
