import { useMemo, useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { zebra, HOVER_TINT } from './tableTints'

// ---------------------------------------------------------------------------
// VIP Analysis — Analytics (corporate+)
//
// One question: of the VIP referrals collected, how many got going and how many
// joined. The drop between them is the whole report, which is why they sit on
// one row and the rates are printed beside the counts rather than on a chart of
// their own.
//
// CAME IN IS THE TRIAL STARTED PIPELINE STAGE. It was completed tours to begin
// with, and that was wrong: one of September's 176 referrals had a tour on
// record, because VIPs are worked in GHL rather than walked through the tour
// check-in. Pass Redeemed sits beside it as its own column rather than being
// folded in, because the two disagree by club.
//
// The rates answer different people. Came In % is a referral-quality number —
// the referral was taken and the person never got going. Joined of Visits is a
// floor number — they got going and nobody closed them. A single "VIP
// conversion" figure would hide which of the two went wrong.
//
// A blank cell is never a zero here: see auth/src/lib/vipAnalysis. The report
// says WHY underneath rather than leaving a dash to be interpreted.
// ---------------------------------------------------------------------------

const VIEWS = [
  { key: 'club', label: 'By Club' },
  { key: 'collector', label: 'By Collector' },
]

const fmtInt = v => (v === null || v === undefined ? 'N/A' : Number(v).toLocaleString())
const fmtPct = v => (v === null || v === undefined ? 'N/A' : `${v}%`)

const TILES = [
  { key: 'collected', label: 'VIPs Collected', format: 'int' },
  { key: 'cameIn', label: 'Came In', format: 'int' },
  { key: 'cameInPct', label: 'Came In %', format: 'pct' },
  { key: 'passRedeemed', label: 'Pass Redeemed', format: 'int' },
  { key: 'signedUp', label: 'Signed Up', format: 'int' },
  { key: 'signedUpPct', label: 'Signed Up %', format: 'pct' },
  { key: 'closedOfVisitsPct', label: 'Joined of Visits', format: 'pct' },
]

/** A count with its share of the step before, and a bar to read the drop by. */
function FunnelCell({ value, pctValue, max, tone }) {
  const width = typeof value === 'number' && max > 0
    ? Math.max(2, Math.round((value / max) * 100))
    : 0
  return (
    <div className="flex items-center gap-2 h-5">
      <div className="relative flex-1 h-4 min-w-[48px]">
        {typeof value === 'number' && (
          <div className={`absolute inset-y-0 left-0 rounded-sm ${tone}`} style={{ width: `${width}%` }} />
        )}
      </div>
      <span className={`text-xs tabular-nums w-10 text-right flex-shrink-0 ${
        value === null ? 'text-text-muted' : 'text-text-primary'
      }`}>
        {fmtInt(value)}
      </span>
      <span className="text-[11px] tabular-nums text-text-muted w-12 text-right flex-shrink-0">
        {fmtPct(pctValue)}
      </span>
    </div>
  )
}

export default function VipAnalysis({ startDate, endDate, locationSlug }) {
  const [viewBy, setViewBy] = useState('club')

  const query = useMemo(() => new URLSearchParams({
    clubs: locationSlug || 'all',
    start: startDate,
    end: endDate,
    viewBy,
  }).toString(), [startDate, endDate, locationSlug, viewBy])

  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/vip-analysis?${query}`, { cache: true, signal }),
    [query]
  )

  const rows = data?.rows || []
  // Each column scales to its own biggest value: the counts fall away down the
  // funnel, so one shared ceiling would flatten Signed Up into a sliver at
  // every club and make the differences between clubs unreadable.
  const maxima = useMemo(() => ({
    collected: Math.max(0, ...rows.map(r => r.collected || 0)),
    cameIn: Math.max(0, ...rows.map(r => r.cameIn || 0)),
    passRedeemed: Math.max(0, ...rows.map(r => r.passRedeemed || 0)),
    signedUp: Math.max(0, ...rows.map(r => r.signedUp || 0)),
  }), [rows])

  if (loading) return <DesktopLoading variant="report" />
  if (error) {
    return (
      <div className="bg-surface rounded-xl border border-border p-8 text-center">
        <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
        <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
      </div>
    )
  }

  const summary = data?.summary || {}
  const noVip = data?.meta?.unconfiguredVip || []
  const noTrial = data?.meta?.noTrialStage || []
  const noPass = data?.meta?.noPassStage || []

  return (
    <div className="space-y-3">
      <div className="bg-surface rounded-xl border border-border p-3 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {VIEWS.map(v => (
            <button
              key={v.key}
              type="button"
              onClick={() => setViewBy(v.key)}
              aria-pressed={viewBy === v.key}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                viewBy === v.key
                  ? 'bg-wcs-red text-white border-wcs-red'
                  : 'bg-bg text-text-muted border-border hover:text-text-primary'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-text-muted ml-auto max-w-[46rem] text-right">
          Came In means the contact reached the <strong className="font-semibold">Trial Started</strong> stage
          in GHL; Pass Redeemed is the VIP pipeline&rsquo;s own stage. Both count only if reached AFTER
          the referral. Signing up is counted within {data?.meta?.attributionDays ?? 30} days of the window closing.
        </p>
      </div>

      <div className="bg-surface rounded-xl border border-border overflow-x-auto">
        <div className="flex min-w-max divide-x divide-border">
          {TILES.map(t => (
            <div key={t.key} className="px-5 py-4 text-center min-w-[130px] flex-1">
              <p className="text-xl font-bold text-text-primary">
                {t.format === 'pct' ? fmtPct(summary[t.key]) : fmtInt(summary[t.key])}
              </p>
              <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
            </div>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface rounded-xl border border-border p-10 text-center">
          <p className="text-sm text-text-muted">No VIP referrals were collected in this range.</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl border border-border">
          <div className="overflow-auto max-h-[calc(100vh-22rem)]">
            <table className="min-w-max w-full text-sm border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 top-0 z-30 bg-surface text-left font-semibold text-text-primary px-4 py-3 min-w-[200px] border-b border-border">
                    {viewBy === 'club' ? 'Club' : 'Collected By'}
                  </th>
                  {['Collected', 'Came In', 'Pass Redeemed', 'Signed Up'].map((label, i) => (
                    <th key={label} scope="col"
                      className={`sticky top-0 z-20 text-left font-semibold text-text-muted px-3 py-3 text-xs min-w-[170px] border-b border-border ${zebra(i)}`}>
                      {label}
                    </th>
                  ))}
                  <th scope="col" className="sticky top-0 z-20 text-right font-semibold text-text-muted px-3 py-3 text-xs min-w-[120px] border-b border-border">
                    Joined of Visits
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.key} className="group">
                    <td className={`sticky left-0 z-10 bg-surface ${HOVER_TINT} px-4 py-2 whitespace-nowrap border-b border-border/60 text-text-primary`}>
                      {r.label}
                    </td>
                    <td className={`px-3 py-2 border-b border-border/60 ${zebra(0)} ${HOVER_TINT}`}>
                      <FunnelCell value={r.collected} pctValue={null} max={maxima.collected} tone="bg-violet-500/70" />
                    </td>
                    <td className={`px-3 py-2 border-b border-border/60 ${zebra(1)} ${HOVER_TINT}`}>
                      <FunnelCell value={r.cameIn} pctValue={r.cameInPct} max={maxima.cameIn} tone="bg-sky-500/70" />
                    </td>
                    <td className={`px-3 py-2 border-b border-border/60 ${zebra(2)} ${HOVER_TINT}`}>
                      <FunnelCell value={r.passRedeemed} pctValue={r.passRedeemedPct} max={maxima.passRedeemed} tone="bg-amber-500/70" />
                    </td>
                    <td className={`px-3 py-2 border-b border-border/60 ${zebra(3)} ${HOVER_TINT}`}>
                      <FunnelCell value={r.signedUp} pctValue={r.signedUpPct} max={maxima.signedUp} tone="bg-teal-500/70" />
                    </td>
                    <td className={`px-3 py-2 border-b border-border/60 text-right ${HOVER_TINT}`}>
                      <span className={`text-xs tabular-nums ${r.closedOfVisitsPct === null ? 'text-text-muted' : 'text-text-primary'}`}>
                        {fmtPct(r.closedOfVisitsPct)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Why a cell is blank, said out loud. An N/A the reader has to guess at
          is worse than the zero it was put there to avoid. */}
      {(noVip.length > 0 || noTrial.length > 0 || noPass.length > 0) && (
        <div className="text-[11px] text-text-muted px-1 space-y-1">
          {noVip.length > 0 && (
            <p>
              No VIP fields are configured in GHL at {noVip.join(', ')}, so nothing can be
              collected there. Those clubs read N/A rather than zero.
            </p>
          )}
          {noTrial.length > 0 && (
            <p>
              No pipeline at {noTrial.join(', ')} has a Trial Started stage, so Came In is
              withheld there rather than reported as nobody getting going.
            </p>
          )}
          {noPass.length > 0 && (
            <p>
              No VIP pipeline at {noPass.join(', ')} has a Pass Redeemed stage. Clubs differ
              on which of the two stages they work, which is why both are shown.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
