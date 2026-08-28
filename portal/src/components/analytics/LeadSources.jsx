import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import DesktopLoading from '../DesktopLoading'
import { PALETTE, OTHER_COLOR, UNKNOWN_COLOR, fmtInt, fmtPct } from './chartPalette'
import { TOOLBAR_SLOT_ID } from './toolbarSlot'

// ---------------------------------------------------------------------------
// Lead Sources — Analytics (admin only)
//
// A FUNNEL WHOSE EVERY BAR IS SPLIT BY SOURCE. Bar length is the stage's size
// against the lead count, so the narrowing is the drop-off; the segments inside
// are that stage's source mix. One picture answers both "where do we lose them"
// and "who did we lose", which two separate charts could not.
//
// Hovering a source dims it everywhere at once, so a channel can be traced down
// the funnel. That is the whole reason the stages are drawn as stacked bars
// rather than four separate donuts.
//
// COLOUR IS PINNED TO THE SOURCE, NEVER TO ITS RANK. Assigning by size order
// meant that widening the date range reordered the sources and repainted them,
// so a channel changed colour while you were trying to follow it across
// windows. A hue now belongs to a name for good.
//
// Observed and claimed never render together, so each keeps its own slot map
// and both get distinct hues for their whole working vocabulary. Facebook holds
// the same slot in both, because it is the same thing said two ways.
//
// The long tail below the pinned names takes the neutral grey rather than
// cycling back through the palette: two sources wearing one hue is worse than a
// source wearing grey, and the legend and table still name every row.
//
// The funnel counts OPPORTUNITIES and reconciles with GHL's own board. Not
// Interested / Day Pass counts CONTACTS and is drawn BELOW A DIVIDER, detached
// from the funnel, because both outcomes delete the opportunity: those people
// have already left the lead count above and are additional to it, not a slice.
// ---------------------------------------------------------------------------

// "Tour Booked" is the stage's name on the GHL board. It read "Toured", which
// claimed something stronger than the data supports: the stage records that a
// tour was booked, not that anybody turned up to it.
const STAGES = [
  { key: 'leads', label: 'Leads' },
  { key: 'tours', label: 'Tour Booked' },
  { key: 'trials', label: 'Trials' },
  { key: 'won', label: 'Joined' },
]

const OUTCOME_LABEL = 'Not Interested / Day Pass'

const OBSERVED_SLOTS = {
  'Website': 0,
  'Facebook': 1,
  'Walk-in / Manual': 2,
}

const CLAIMED_SLOTS = {
  'Friend or Family Referral': 0,
  'Facebook': 1,
  'Google Search': 2,
  'Instagram': 3,
  'Google Maps': 4,
  'Drove By / Saw the Gym': 5,
  'TikTok': 6,
  'Event or Pop-Up': 7,
}

// "We did not ask" and "it arrived from nowhere" are not peers of a real
// channel and must never look like one.
const NEUTRAL = new Set(['Not Asked', 'Unknown', 'No Source Recorded'])

function sourceColor(name, attribution) {
  if (NEUTRAL.has(name)) return UNKNOWN_COLOR
  if (name === 'Other') return OTHER_COLOR
  const slots = attribution === 'claimed' ? CLAIMED_SLOTS : OBSERVED_SLOTS
  const slot = slots[name]
  return slot === undefined ? OTHER_COLOR : PALETTE[slot]
}

export default function LeadSources({ startDate, endDate, locationSlug }) {
  const [attribution, setAttribution] = useState('real')
  const [asTable, setAsTable] = useState(false)
  const [hovered, setHovered] = useState(null)

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

  // Channels only, in the server's stable order. The artefact bucket is kept
  // out of the picture for the same reason it is kept out of the totals, and
  // stays visible in the table.
  const channels = useMemo(() => sources.filter(s => !s.notAChannel), [sources])

  // Keyed by name, not by position, so the map is identical whatever the window
  // returns or in what order.
  const colors = useMemo(() => {
    const out = {}
    for (const s of sources) out[s.source] = sourceColor(s.source, attribution)
    return out
  }, [sources, attribution])

  const leadTotal = data?.totals?.leads || 0

  return (
    <div className="space-y-4">
      <Toolbar
        attribution={attribution} setAttribution={setAttribution}
        asTable={asTable} setAsTable={setAsTable}
      />

      {loading && <DesktopLoading />}

      {!loading && error && (
        <div className="bg-surface rounded-xl border border-border p-8 text-center">
          <p className="text-sm text-wcs-red font-semibold">Could not load the report</p>
          <p className="text-xs text-text-muted mt-1">{String(error.message || error)}</p>
        </div>
      )}

      {!loading && !error && data && (
        <>
          {/* Coverage warning sits ABOVE the numbers: a reader who has already
              drawn a conclusion will not revisit it. */}
          {data.notes?.claimed && (
            <div className="bg-surface rounded-xl border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.notes.claimed}</p>
            </div>
          )}

          <div className="bg-surface rounded-xl border border-border overflow-x-auto">
            <div className="flex min-w-max divide-x divide-border">
              {[
                ...STAGES.map(st => ({ label: st.label, value: data.totals?.[st.key] })),
                { label: OUTCOME_LABEL, value: data.totals?.outcomes, muted: true },
              ].map(t => (
                <div key={t.label} className="px-5 py-4 text-center min-w-[140px] flex-1">
                  <p className={`text-xl font-bold tabular-nums ${t.muted ? 'text-text-muted' : 'text-text-primary'}`}>
                    {fmtInt(t.value)}
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5 leading-tight">{t.label}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-surface rounded-xl border border-border">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
              <p className="text-sm font-bold text-text-primary">
                Funnel by {attribution === 'claimed' ? 'Claimed' : 'Observed'} Source
              </p>
              <span className="text-xs text-text-muted">{data.meta?.windowLabel}</span>
            </div>

            {asTable ? (
              <TableView sources={sources} totals={data.totals} colors={colors} />
            ) : (
              <div className="px-4 py-4 space-y-2.5">
                {STAGES.map(st => (
                  <FunnelBar
                    key={st.key}
                    label={st.label}
                    stageKey={st.key}
                    channels={channels}
                    total={data.totals?.[st.key] || 0}
                    leadTotal={leadTotal}
                    colors={colors}
                    hovered={hovered}
                    onHover={setHovered}
                  />
                ))}

                {/* Detached on purpose — see the header comment. */}
                {(data.totals?.outcomes || 0) > 0 && (
                  <div className="pt-3 mt-1 border-t border-dashed border-border">
                    <FunnelBar
                      label={OUTCOME_LABEL}
                      stageKey="outcomes"
                      channels={channels}
                      total={data.totals?.outcomes || 0}
                      leadTotal={leadTotal}
                      colors={colors}
                      hovered={hovered}
                      onHover={setHovered}
                      detached
                    />
                  </div>
                )}

                {channels.length === 0 && (
                  <p className="text-sm text-text-muted text-center py-10">No leads in this selection.</p>
                )}
              </div>
            )}

            {/* Legend. Always present — colour never carries identity alone. */}
            {channels.length > 0 && (
              <div className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 py-3 border-t border-border">
                {channels.map(s => (
                  <button
                    key={s.source}
                    type="button"
                    onMouseEnter={() => setHovered(s.source)}
                    onMouseLeave={() => setHovered(null)}
                    className="flex items-center gap-1.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
                  >
                    <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: colors[s.source] }} />
                    {s.source}
                  </button>
                ))}
              </div>
            )}
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

/**
 * One stage of the funnel.
 *
 * The bar's WIDTH is the stage against the lead count, which is what makes the
 * shape a funnel; the segments inside divide that width by source. The detached
 * outcome row is scaled the same way so it stays visually comparable, even
 * though it is not part of the funnel's arithmetic.
 */
function FunnelBar({ label, stageKey, channels, total, leadTotal, colors, hovered, onHover, detached }) {
  // Floored so a small-but-real stage is still a visible sliver rather than
  // nothing at all.
  const width = leadTotal ? Math.min(100, Math.max(1.5, (total / leadTotal) * 100)) : 0
  const conversion = leadTotal ? (total / leadTotal) * 100 : null

  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-text-primary w-28 text-right flex-shrink-0 truncate" title={label}>
        {label}
      </span>

      <div className="flex-1 min-w-[200px]">
        <div className="h-7 rounded-sm bg-bg overflow-hidden">
          <div className="h-full flex rounded-sm overflow-hidden" style={{ width: `${width}%` }}>
            {channels.map(s => {
              const v = s[stageKey] || 0
              if (v === 0 || total === 0) return null
              const pct = (v / total) * 100
              const dim = hovered && hovered !== s.source
              return (
                <div
                  key={s.source}
                  className="relative h-full flex items-center justify-center transition-opacity"
                  style={{
                    width: `${pct}%`,
                    background: colors[s.source],
                    // 2px of surface between fills so adjacent segments read as
                    // separate blocks rather than one gradient.
                    boxShadow: 'inset -2px 0 0 var(--color-surface)',
                    opacity: dim ? 0.3 : 1,
                  }}
                  onMouseEnter={() => onHover(s.source)}
                  onMouseLeave={() => onHover(null)}
                  title={`${s.source} — ${label}: ${fmtInt(v)} (${pct.toFixed(1)}% of stage)`}
                >
                  {/* Printed only where it fits: a label wider than its segment
                      is worse than no label. */}
                  {pct >= 12 && width >= 18 && (
                    <span className="text-[10px] font-semibold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)] px-1 truncate">
                      {fmtInt(v)}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <span className="text-xs text-text-primary tabular-nums w-16 text-right flex-shrink-0 font-semibold">
        {fmtInt(total)}
      </span>
      <span className="text-[11px] text-text-muted tabular-nums w-24 text-right flex-shrink-0">
        {conversion === null ? '' : `${conversion.toFixed(1)}% of leads`}
      </span>
    </div>
  )
}

function TableView({ sources, totals, colors }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-max w-full text-sm">
        <thead>
          <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-muted">
            <th className="sticky left-0 z-10 bg-surface text-left font-semibold py-2 px-4 min-w-[190px]">Source</th>
            <th className="text-right font-semibold px-3 py-2">Leads</th>
            <th className="text-right font-semibold px-3 py-2">Tour Booked</th>
            <th className="text-right font-semibold px-3 py-2">Trials</th>
            <th className="text-right font-semibold px-3 py-2">Joined</th>
            <th className="text-right font-semibold px-3 py-2">Trial %</th>
            <th className="text-right font-semibold px-3 py-2">Join %</th>
            <th className="text-right font-semibold px-3 py-2">Trial to Join</th>
            <th className="text-right font-semibold px-3 py-2 border-l border-border">Not Int. / Day Pass</th>
          </tr>
        </thead>
        <tbody>
          {sources.map(s => (
            <tr key={s.source} className="border-b border-border/60 last:border-0">
              <td className="sticky left-0 z-10 bg-surface px-4 py-2 text-text-primary whitespace-nowrap">
                <span className="inline-flex items-center gap-2">
                  <span
                    className="w-3 h-3 rounded-sm flex-shrink-0"
                    style={{ background: colors[s.source] || 'var(--color-border)' }}
                  />
                  {s.source}
                  {s.notAChannel && (
                    <span className="text-[10px] text-amber-600 border border-amber-500/40 rounded px-1 py-0.5">
                      not a channel
                    </span>
                  )}
                </span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-text-primary">{fmtInt(s.leads)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtInt(s.tours)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtInt(s.trials)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-primary font-semibold">{fmtInt(s.won)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtPct(s.trialRate)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-primary">{fmtPct(s.winRate)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtPct(s.trialToWinRate)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-muted border-l border-border">
                {fmtInt(s.outcomes)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border text-text-primary font-semibold">
            <td className="sticky left-0 z-10 bg-surface px-4 py-2">Total (real channels)</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totals?.leads)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totals?.tours)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totals?.trials)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtInt(totals?.won)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtPct(totals?.trialRate)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtPct(totals?.winRate)}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtPct(totals?.trialToWinRate)}</td>
            <td className="px-3 py-2 text-right tabular-nums border-l border-border">{fmtInt(totals?.outcomes)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Toolbar({ attribution, setAttribution, asTable, setAsTable }) {
  const [slot, setSlot] = useState(null)
  useEffect(() => { setSlot(document.getElementById(TOOLBAR_SLOT_ID)) }, [])
  if (!slot) return null
  const cls = 'px-2.5 py-1.5 rounded-lg text-xs bg-bg border border-border text-text-primary normal-case tracking-normal font-medium'
  const wrap = 'flex items-center gap-1.5 text-[11px] font-semibold text-text-muted uppercase tracking-wide'
  return createPortal(
    <div className="flex items-center gap-3 flex-wrap">
      <label className={wrap}>
        Attribution
        <select value={attribution} onChange={e => setAttribution(e.target.value)} className={cls}>
          <option value="real">Observed (what GHL saw)</option>
          <option value="claimed">Claimed (what they told us)</option>
        </select>
      </label>
      <button
        type="button"
        onClick={() => setAsTable(v => !v)}
        className="text-xs font-semibold text-text-muted hover:text-wcs-red transition-colors"
      >
        {asTable ? 'Show funnel' : 'Show table'}
      </button>
    </div>,
    slot
  )
}
