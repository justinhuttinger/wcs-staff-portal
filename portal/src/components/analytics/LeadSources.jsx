import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { colorFor, fmtInt, fmtPct } from './chartPalette'

// ---------------------------------------------------------------------------
// Lead Sources — Analytics (admin only)
//
// Where leads come from and what became of them, on FIRST touch.
//
// Real and claimed attribution are a TOGGLE, not two columns side by side. They
// answer different questions on different populations, and putting them in one
// table invites reading the gap as a discrepancy rather than as the two
// different facts it is.
//
// The funnel counts OPPORTUNITIES in the membership pipelines and reconciles
// with GHL's own board. Day Pass counts CONTACTS, because a guest who never
// became an opportunity is not on that board — it is shown in the row for
// convenience but feeds none of the rates.
// ---------------------------------------------------------------------------

const STAGES = [
  { key: 'leads', label: 'Leads' },
  { key: 'tours', label: 'Toured' },
  { key: 'trials', label: 'Trials' },
  { key: 'won', label: 'Joined' },
  { key: 'notInterested', label: 'Not Interested' },
  { key: 'dayPasses', label: 'Day Passes' },
]

function Bar({ value, max, tone }) {
  const w = max ? Math.max(2, (value / max) * 100) : 0
  return (
    <span className="inline-block h-2 rounded-full align-middle" style={{ width: `${w}%`, background: tone }} />
  )
}

export default function LeadSources({ startDate, endDate, locationSlug }) {
  const [attribution, setAttribution] = useState('real')

  const query = useMemo(() => {
    const p = new URLSearchParams({ clubs: locationSlug || 'all', attribution })
    if (startDate) p.set('start', startDate)
    if (endDate) p.set('end', endDate)
    return p.toString()
  }, [startDate, endDate, locationSlug, attribution])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/lead-sources?${query}`, { cache: true, signal }),
    [query]
  )

  const sources = data?.sources || []
  const maxLeads = sources.reduce((m, s) => Math.max(m, s.leads), 0)

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 min-w-[190px]">
          <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wide">Attribution</span>
          <select
            value={attribution}
            onChange={e => setAttribution(e.target.value)}
            className="bg-bg border border-border rounded-lg px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="real">Observed (what GHL saw)</option>
            <option value="claimed">Claimed (what they told us)</option>
          </select>
        </label>
        <p className="text-[11px] text-text-muted pb-1.5">
          First touch. {data?.meta?.windowLabel}
        </p>
      </div>

      {loading && <DesktopLoading />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Coverage warnings sit ABOVE the numbers, not under them: a reader
              who has already drawn a conclusion will not revisit it. */}
          {data.notes?.claimed && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.claimed}</p>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {STAGES.map(st => (
              <div key={st.key} className="bg-surface rounded-xl border border-border px-3 py-2.5">
                <p className="text-[10px] font-semibold text-text-muted uppercase tracking-wide">{st.label}</p>
                <p className="text-xl font-bold tabular-nums text-text-primary mt-0.5">
                  {fmtInt(data.totals?.[st.key])}
                </p>
              </div>
            ))}
          </div>

          <div className="bg-surface rounded-xl border border-border p-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="text-left font-semibold py-1">Source</th>
                  <th className="text-left font-semibold py-1 w-1/4">Share of Leads</th>
                  <th className="text-right font-semibold py-1">Leads</th>
                  <th className="text-right font-semibold py-1">Toured</th>
                  <th className="text-right font-semibold py-1">Trials</th>
                  <th className="text-right font-semibold py-1">Joined</th>
                  <th className="text-right font-semibold py-1">Trial %</th>
                  <th className="text-right font-semibold py-1">Join %</th>
                  <th className="text-right font-semibold py-1">Trial → Join</th>
                  {/* Both outcomes DELETE the opportunity in GHL, so these are
                      counted per contact and are additional to the funnel on
                      their left, not a slice of it. Divided visually for that
                      reason. */}
                  <th className="text-right font-semibold py-1 border-l border-border pl-2">Not Int.</th>
                  <th className="text-right font-semibold py-1">Day Pass</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s, i) => (
                  <tr key={s.source} className="border-t border-border">
                    <td className="py-1.5 text-text-primary">
                      {s.source}
                      {/* Marked in the table itself, because a footnote below a
                          45% conversion rate is read second, if at all. */}
                      {s.notAChannel && (
                        <span className="ml-2 text-[10px] text-amber-600 border border-amber-500/40 rounded px-1 py-0.5">
                          not a channel
                        </span>
                      )}
                    </td>
                    <td className="py-1.5">
                      <Bar value={s.leads} max={maxLeads} tone={colorFor(s.source, i)} />
                    </td>
                    <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtInt(s.leads)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(s.tours)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(s.trials)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-primary font-semibold">{fmtInt(s.won)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtPct(s.trialRate)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-primary">{fmtPct(s.winRate)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtPct(s.trialToWinRate)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted border-l border-border pl-2">{fmtInt(s.notInterested)}</td>
                    <td className="py-1.5 text-right tabular-nums text-text-muted">{fmtInt(s.dayPasses)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border text-text-primary font-semibold">
                  {/* Totals exclude the artefact bucket, or a business-wide
                      conversion rate would be inflated by records that were
                      never leads. */}
                  <td className="py-1.5" colSpan={2}>Total (real channels)</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtInt(data.totals?.leads)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtInt(data.totals?.tours)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtInt(data.totals?.trials)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtInt(data.totals?.won)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtPct(data.totals?.trialRate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtPct(data.totals?.winRate)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtPct(data.totals?.trialToWinRate)}</td>
                  <td className="py-1.5 text-right tabular-nums border-l border-border pl-2">{fmtInt(data.totals?.notInterested)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtInt(data.totals?.dayPasses)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {data.outcomesNote && (
            <p className="text-[11px] text-text-muted px-1">{data.outcomesNote}</p>
          )}

          {data.notes?.noSource && (
            <p className="text-[11px] text-text-muted px-1">{data.notes.noSource}</p>
          )}
        </>
      )}
    </div>
  )
}
