import { useState } from 'react'
import { api } from '../../lib/api'
import { useCancellableFetch } from '../../hooks/useCancellableFetch'
import { PALETTE, OTHER_COLOR, fmtInt, fmtPct } from './chartPalette'

// ---------------------------------------------------------------------------
// The two breakdowns under the Lead Sources funnel.
//
// FACEBOOK ADS. The funnel's Facebook row opened up into campaign > ad set >
// ad. The server guarantees the rows sum to that Facebook row, so a reader can
// drill in without the numbers shifting underneath them.
//
// WEBSITE TRAFFIC. Google Analytics visits by channel. VISITS, NOT LEADS: the
// panel sits apart from the funnel and says so, because dividing leads by
// visits from two different systems would produce a conversion rate that is
// not one.
// ---------------------------------------------------------------------------

// Pinned per channel like the funnel's sources: a hue belongs to a name, never
// to its rank, so widening the window cannot repaint a channel.
const CHANNEL_SLOTS = {
  'Paid Social': 0,
  'Organic Social': 3,
  'Direct': 2,
  'Organic Search': 4,
  'Paid Search': 1,
  'Referral': 5,
  'Email': 6,
}
const channelColor = (name) => {
  const slot = CHANNEL_SLOTS[name]
  return slot === undefined ? OTHER_COLOR : PALETTE[slot]
}

export default function LeadSourceBreakdowns({ query, showFacebook }) {
  return (
    <>
      {showFacebook && <FacebookAds query={query} />}
      <WebTraffic query={query} />
    </>
  )
}

function Card({ title, right, children }) {
  return (
    <div className="bg-surface rounded-xl border border-border">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <p className="text-sm font-bold text-text-primary">{title}</p>
        {right}
      </div>
      {children}
    </div>
  )
}

function Status({ loading, error, empty }) {
  if (loading) return <p className="text-sm text-text-muted text-center py-8">Loading…</p>
  if (error) return <p className="text-sm text-wcs-red text-center py-8">{String(error.message || error)}</p>
  if (empty) return <p className="text-sm text-text-muted text-center py-8">{empty}</p>
  return null
}

// ----- Facebook ads --------------------------------------------------------

function FacebookAds({ query }) {
  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/lead-sources/facebook?${query}`, { cache: true, signal }),
    [query]
  )
  const campaigns = data?.campaigns || []
  const [open, setOpen] = useState(() => new Set())
  const toggle = (key) => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const status = <Status loading={loading} error={error} empty={!campaigns.length && 'No Facebook leads in this selection.'} />
  return (
    <Card
      title="Facebook Leads by Campaign, Ad Set and Ad"
      right={<span className="text-xs text-text-muted">Click a row to open it</span>}
    >
      {loading || error || !campaigns.length ? status : (
        <div className="overflow-x-auto">
          <table className="min-w-max w-full text-sm">
            <thead>
              <tr className="border-b border-border text-[11px] uppercase tracking-wide text-text-muted">
                <th className="sticky left-0 z-10 bg-surface text-left font-semibold py-2 px-4 min-w-[280px]">Campaign / Ad Set / Ad</th>
                <th className="text-right font-semibold px-3 py-2">Leads</th>
                <th className="text-right font-semibold px-3 py-2">Tour Booked</th>
                <th className="text-right font-semibold px-3 py-2">Trials</th>
                <th className="text-right font-semibold px-3 py-2">Joined</th>
                <th className="text-right font-semibold px-3 py-2">Trial %</th>
                <th className="text-right font-semibold px-3 py-2">Join %</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map(c => {
                const cKey = c.name
                const cOpen = open.has(cKey)
                return [
                  <FbRow key={cKey} node={c} depth={0} open={cOpen} onToggle={() => toggle(cKey)} />,
                  ...(cOpen ? c.adsets.flatMap(s => {
                    const sKey = cKey + '\u0000' + s.name
                    const sOpen = open.has(sKey)
                    return [
                      <FbRow key={sKey} node={s} depth={1} open={sOpen} onToggle={() => toggle(sKey)} />,
                      ...(sOpen ? s.ads.map((a, i) => (
                        <FbRow key={sKey + '\u0000' + a.name + i} node={a} depth={2} />
                      )) : []),
                    ]
                  }) : []),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-text-muted px-4 py-3 border-t border-border">
        These rows add up to the Facebook row above. Leads from Facebook Lead Forms carry the ad names;
        website clicks from ads that predate the portal's tracking tags show Meta's ad and ad set numbers instead.
      </p>
    </Card>
  )
}

function FbRow({ node, depth, open, onToggle }) {
  const expandable = depth < 2
  const pad = ['pl-4', 'pl-9', 'pl-14'][depth]
  const weight = depth === 0 ? 'font-semibold text-text-primary' : depth === 1 ? 'text-text-primary' : 'text-text-muted'
  return (
    <tr
      className={`border-b border-border/60 last:border-0 ${expandable ? 'cursor-pointer hover:bg-bg/60' : ''}`}
      onClick={expandable ? onToggle : undefined}
    >
      <td className={`sticky left-0 z-10 bg-surface ${pad} pr-4 py-2 whitespace-nowrap ${weight}`}>
        <span className="inline-flex items-center gap-2">
          {expandable && (
            <span className="text-text-muted text-[10px] w-3 inline-block">{open ? '▼' : '▶'}</span>
          )}
          <span className="truncate max-w-[420px]" title={node.adId ? `Ad ID ${node.adId}` : node.name}>{node.name}</span>
        </span>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-text-primary">{fmtInt(node.leads)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtInt(node.tours)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtInt(node.trials)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-text-primary font-semibold">{fmtInt(node.won)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-text-muted">{fmtPct(node.trialRate)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-text-primary">{fmtPct(node.winRate)}</td>
    </tr>
  )
}

// ----- Website traffic -----------------------------------------------------

function WebTraffic({ query }) {
  const { data, loading, error } = useCancellableFetch(
    signal => api(`/analytics/lead-sources/web-traffic?${query}`, { cache: true, signal }),
    [query]
  )
  const channels = data?.channels || []
  const total = data?.totals?.sessions || 0
  const showKeyEvents = (data?.totals?.keyEvents || 0) > 0
  const excluded = data?.meta?.excluded?.length > 0 && !data?.unavailable

  return (
    <Card
      title="Website Traffic by Channel"
      right={<span className="text-xs text-text-muted">Google Analytics · visits, not leads</span>}
    >
      {loading || error ? <Status loading={loading} error={error} /> : data?.unavailable ? (
        <p className="text-sm text-text-muted text-center py-8 px-4">{data.unavailable}</p>
      ) : (
        <div className="px-4 py-4 space-y-3">
          {/* Above the numbers: a reader who has drawn a conclusion from a
              near-empty chart will not scroll back up to the caveat. */}
          {data?.warning && (
            <div className="rounded-lg border border-amber-500/40 p-3">
              <p className="text-[11px] text-amber-600">{data.warning}</p>
            </div>
          )}

          {channels.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-6">No visits recorded in this window.</p>
          ) : (
            <div className="space-y-2">
              {channels.map(c => (
                <div key={c.channel} className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
                  <div className="flex items-baseline justify-between gap-2 sm:contents">
                    <span className="text-xs text-text-primary truncate sm:w-32 sm:text-right sm:flex-shrink-0 sm:order-1">
                      {c.channel}
                    </span>
                    <span className="flex items-baseline gap-2 flex-shrink-0 sm:contents">
                      <span className="text-xs text-text-primary tabular-nums font-semibold sm:w-16 sm:text-right sm:flex-shrink-0 sm:order-3">
                        {fmtInt(c.sessions)}
                      </span>
                      <span className="text-[11px] text-text-muted tabular-nums sm:w-28 sm:text-right sm:flex-shrink-0 sm:order-4">
                        {fmtPct(c.share)}{showKeyEvents ? ` · ${fmtInt(c.keyEvents)} conv.` : ''}
                      </span>
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 sm:min-w-[200px] sm:order-2">
                    <div className="h-5 rounded-sm bg-bg overflow-hidden">
                      <div
                        className="h-full rounded-sm"
                        style={{ width: `${total ? Math.max(1.5, (c.sessions / total) * 100) : 0}%`, background: channelColor(c.channel) }}
                        title={`${c.channel}: ${fmtInt(c.sessions)} visits (${fmtPct(c.share)})`}
                      />
                    </div>
                  </div>
                </div>
              ))}
              <p className="text-xs text-text-primary font-semibold text-right tabular-nums pt-1">
                {fmtInt(total)} visits{showKeyEvents ? ` · ${fmtInt(data.totals.keyEvents)} conversions` : ''}
              </p>
            </div>
          )}

          {data?.note && <p className="text-[11px] text-text-muted">{data.note}</p>}
          {excluded && (
            <p className="text-[11px] text-text-muted">
              East Side Athletic Club is left out: it has its own website, outside this Google Analytics property.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}
