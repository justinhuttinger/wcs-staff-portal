import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { fmtInt, fmtMoney, fmtMonth } from './chartPalette'
import { RankedBars, zebraColumn } from './charts'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'
import { LOCATION_NAMES } from '../../config/locations'

// ---------------------------------------------------------------------------
// Payroll — Analytics (admin only)
//
// DELIBERATELY PLAIN. This is a document somebody reconciles against a payroll
// run, not an analysis: commission per person for one period, the two sources
// that pay it, and the totals. No trend, no comparison, no rates — every extra
// number here is one more thing to have to explain to whoever is being paid.
//
// A PERIOD, NOT A DATE RANGE. Commission is calculated and paid per month, and
// a window straddling two would produce a figure nobody pays anyone. The report
// picks from the periods that exist rather than taking the shell's range.
// ---------------------------------------------------------------------------

const CLUB_NAMES = Object.fromEntries(LOCATION_NAMES.map(n => [n.toLowerCase(), n]))
const CLUB_LABEL = s => (s ? (CLUB_NAMES[s] || s.charAt(0).toUpperCase() + s.slice(1)) : s)

export default function Payroll({ locationSlug }) {
  const [period, setPeriod] = useState(null)

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all' })
    if (period) p.set('period', period)
    return p.toString()
  }, [period, locationSlug])

  const { data, loading, error, retrying } = useCancellableFetch(
    signal => api(`/analytics/payroll?${query}`, { cache: true, signal }),
    [query]
  )

  const s = data?.summary || {}
  const people = data?.people || []

  return (
    <div className="space-y-3">
      <Toolbar
        periods={data?.periods || []}
        period={data?.period || null}
        setPeriod={setPeriod}
      />

      {loading && <DesktopLoading retrying={retrying} />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* A missing upload must not read as a quiet month, or people arrive
              to argue about commission that simply has not been loaded. */}
          {data.notes?.missingSource && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.missingSource}</p>
            </div>
          )}
          {data.notes?.shared && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.shared}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                { label: 'Total Commission', value: fmtMoney(s.total) },
                { label: 'Sales', value: fmtMoney(s.sales) },
                { label: 'PT Recurring', value: fmtMoney(s.recurring) },
                { label: 'People Paid', value: fmtInt(s.people), muted: true },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[140px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}>
                    {t.value}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          {(data.byClub || []).length > 1 && (
            <RankedBars
              title="Commission by Club"
              rows={(data.byClub || []).map(c => ({ ...c, label: CLUB_LABEL(c.slug) }))}
              labelKey="label" valueKey="total" format="int"
              secondary={c => `${fmtInt(c.people)} paid · ${fmtMoney(c.sales)} sales, ${fmtMoney(c.recurring)} PT`}
              emptyText="Nothing in this period."
            />
          )}

          <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
            <div className="flex items-baseline justify-between gap-3 mb-2">
              <p className="text-xs font-bold text-text-primary">Commission by Person</p>
              <p className="text-[11px] text-text-muted">highest first</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted border-b border-border">
                  {['Employee', 'Club', 'Sales', 'PT Recurring', 'Total'].map((h, i) => (
                    <th key={h}
                      className={`py-1.5 px-2 font-semibold ${i >= 2 ? 'text-right' : 'text-left'}`}
                      style={zebraColumn(i)}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {people.map((p, i) => (
                  <tr key={`${p.slug}-${p.employee}-${i}`} className="border-b border-border/60 last:border-0">
                    <td className="py-1.5 px-2 text-text-primary" style={zebraColumn(0)}>
                      {p.employee}
                      {/* Flagged in the row itself: whoever is about to pay this
                          needs to see it here, not in a note above. */}
                      {p.sharedName && (
                        <span className="ml-2 text-[10px] text-amber-600 border border-amber-500/40 rounded px-1 py-0.5">
                          split, attribute by hand
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 px-2 text-text-muted" style={zebraColumn(1)}>{CLUB_LABEL(p.slug)}</td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(2)}>
                      {fmtMoney(p.sales)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-text-muted" style={zebraColumn(3)}>
                      {fmtMoney(p.recurring)}
                    </td>
                    <td className="py-1.5 px-2 text-right tabular-nums text-text-primary font-semibold" style={zebraColumn(4)}>
                      {fmtMoney(p.total)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border text-text-primary font-semibold">
                  <td className="py-1.5 px-2" colSpan={2}>Total</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtMoney(s.sales)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtMoney(s.recurring)}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmtMoney(s.total)}</td>
                </tr>
              </tfoot>
            </table>
            {people.length === 0 && (
              <p className="text-sm text-text-muted text-center py-8">No commission in this period.</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function Toolbar({ periods, period, setPeriod }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  return createPortal(
    <label className="flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide">
      Period
      <select value={period || ''} onChange={e => setPeriod(e.target.value)} className={cls}>
        {periods.map(p => (
          <option key={p.period} value={p.period}>
            {fmtMonth(p.period)}
            {/* Marked in the picker so an incomplete period is obvious before
                it is opened, not after. */}
            {p.hasSales ? '' : ' — no sales upload'}
          </option>
        ))}
      </select>
    </label>,
    slot
  )
}
