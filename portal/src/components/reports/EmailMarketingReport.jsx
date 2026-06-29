import { useState, useEffect, useMemo } from 'react'
import { getEmailMarketingCampaigns } from '../../lib/api'
import { exportCSV } from '../../lib/export'

// Email Marketing report — GHL email campaign performance per send. Data comes
// from the email_stats table (synced from GHL by ghl-sync). GHL precomputes the
// rates per send; we display them as-is. Date range + location come from the
// Reporting shell as props.

function fmtInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}
function fmtPct(v) {
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'
}
function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// Friendly label for the GHL campaign source.
const SOURCE_LABELS = {
  'bulk-actions': 'Bulk Email',
  'email-campaigns': 'Campaign',
  'workflow-campaigns': 'Workflow',
}
function sourceLabel(s) {
  return SOURCE_LABELS[s] || s || '—'
}

function SortHeader({ label, col, sort, onSort, align = 'right' }) {
  const active = sort?.col === col
  return (
    <th
      onClick={() => onSort(col)}
      title="Click to sort"
      className={`py-2.5 px-2 cursor-pointer select-none group ${align === 'left' ? 'text-left px-4' : 'text-right'}`}
    >
      <span className={`inline-flex items-center gap-1 ${align === 'left' ? '' : 'justify-end'} ${active ? 'text-wcs-red' : 'text-text-muted group-hover:text-text-primary'}`}>
        {label}
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={`w-3 h-3 flex-shrink-0 ${active ? '' : 'opacity-40 group-hover:opacity-70'}`}>
          {!active
            ? <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15 12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" />
            : sort.dir === 'desc'
              ? <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              : <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 15.75l7.5-7.5 7.5 7.5" />}
        </svg>
      </span>
    </th>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1 text-text-primary">{value}</p>
      {sub && <p className="text-xs text-text-muted mt-0.5">{sub}</p>}
    </div>
  )
}

export default function EmailMarketingReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState({ col: 'completed_at', dir: 'desc' })

  const allLoc = locationSlug === 'all' || !locationSlug
  const params = useMemo(
    () => ({ location_slug: allLoc ? '' : locationSlug, start_date: startDate, end_date: endDate }),
    [allLoc, locationSlug, startDate, endDate]
  )

  useEffect(() => {
    let ignore = false
    setLoading(true); setError('')
    getEmailMarketingCampaigns(params)
      .then(res => { if (!ignore) setData(res) })
      .catch(err => { if (!ignore) setError(err.message) })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [params])

  function cycleSort(col) {
    setSort(s => (!s || s.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : { col: 'completed_at', dir: 'desc' }))
  }

  const campaigns = data?.campaigns || []
  const totals = data?.totals || null

  const sortedCampaigns = useMemo(() => {
    const rows = campaigns.slice()
    const getters = {
      completed_at: r => r.completed_at || '',
      name: r => (r.name || '').toLowerCase(),
      sent: r => Number(r.sent),
      delivered: r => Number(r.delivered),
      opened: r => Number(r.opened),
      open_rate: r => Number(r.open_rate),
      click_rate: r => Number(r.click_rate),
      clicked: r => Number(r.clicked),
      replied: r => Number(r.replied),
      unsubscribed: r => Number(r.unsubscribed),
      bounced: r => Number(r.bounced),
    }
    const get = getters[sort.col] || getters.completed_at
    const dir = sort.dir === 'asc' ? 1 : -1
    rows.sort((a, b) => {
      const av = get(a), bv = get(b)
      if (typeof av === 'string') return dir * av.localeCompare(bv)
      return dir * (av - bv)
    })
    return rows
  }, [campaigns, sort])

  function exportRows() {
    exportCSV(
      [['Sent', 'Campaign', 'Subject', 'Type', allLoc ? 'Club' : null, 'Status', 'Sent #', 'Delivered', 'Opened', 'Open %', 'Clicked', 'Click %', 'Replied', 'Unsub', 'Bounced'].filter(Boolean),
        ...sortedCampaigns.map(r => [
          fmtDate(r.completed_at), r.name || '', r.subject || '', sourceLabel(r.source),
          ...(allLoc ? [r.location || ''] : []),
          r.status || '', r.sent, r.delivered, r.opened, r.open_rate, r.clicked, r.click_rate, r.replied, r.unsubscribed, r.bounced,
        ])],
      `email-marketing-${startDate}_to_${endDate}`
    )
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      {/* Summary cards */}
      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard label="Sends" value={fmtInt(totals.sends)} sub={`${fmtInt(totals.sent)} recipients`} />
          <StatCard label="Delivered" value={fmtInt(totals.delivered)} sub={totals.bounced > 0 ? `${fmtInt(totals.bounced)} bounced` : null} />
          <StatCard label="Open Rate" value={fmtPct(totals.open_rate)} sub={`${fmtInt(totals.opened)} opened`} />
          <StatCard label="Click Rate" value={fmtPct(totals.click_rate)} sub={`${fmtInt(totals.clicked)} clicked`} />
          <StatCard label="Replies" value={fmtInt(totals.replied)} sub={fmtPct(totals.reply_rate)} />
        </div>
      )}

      {/* Export */}
      <div className="flex items-center justify-end">
        <button
          onClick={exportRows}
          disabled={!sortedCampaigns.length}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-bg text-text-muted hover:text-text-primary transition-colors disabled:opacity-40">
          Export CSV
        </button>
      </div>

      {/* Campaign table */}
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
        {loading && !data ? (
          <p className="text-sm text-text-muted p-6 text-center">Loading email campaigns...</p>
        ) : !campaigns.length ? (
          <p className="text-sm text-text-muted p-8 text-center">No email campaigns sent in this range.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <SortHeader label="Sent" col="completed_at" sort={sort} onSort={cycleSort} align="left" />
                  <SortHeader label="Campaign" col="name" sort={sort} onSort={cycleSort} align="left" />
                  {allLoc && <th className="py-2.5 px-2">Club</th>}
                  <SortHeader label="Recipients" col="sent" sort={sort} onSort={cycleSort} />
                  <SortHeader label="Delivered" col="delivered" sort={sort} onSort={cycleSort} />
                  <SortHeader label="Open %" col="open_rate" sort={sort} onSort={cycleSort} />
                  <SortHeader label="Click %" col="click_rate" sort={sort} onSort={cycleSort} />
                  <SortHeader label="Replied" col="replied" sort={sort} onSort={cycleSort} />
                  <SortHeader label="Unsub" col="unsubscribed" sort={sort} onSort={cycleSort} />
                  <SortHeader label="Bounced" col="bounced" sort={sort} onSort={cycleSort} />
                </tr>
              </thead>
              <tbody>
                {sortedCampaigns.map((r, idx) => (
                  <tr key={r.source_id || idx} className="border-b border-border/50 hover:bg-bg/40">
                    <td className="py-2 px-4 text-text-muted whitespace-nowrap">{fmtDate(r.completed_at)}</td>
                    <td className="py-2 px-4">
                      <div className="font-medium text-text-primary">{r.name || '—'}</div>
                      {r.subject && <div className="text-[11px] text-text-muted">{r.subject}</div>}
                      <div className="text-[10px] uppercase tracking-wide text-text-muted">{sourceLabel(r.source)}</div>
                    </td>
                    {allLoc && <td className="py-2 px-2 capitalize text-text-muted">{r.location || '—'}</td>}
                    <td className="py-2 px-2 text-right">{fmtInt(r.sent)}</td>
                    <td className="py-2 px-2 text-right">{fmtInt(r.delivered)}</td>
                    <td className="py-2 px-2 text-right">
                      <span className="font-semibold text-text-primary">{fmtPct(r.open_rate)}</span>
                      <span className="text-text-muted text-xs"> ({fmtInt(r.opened)})</span>
                    </td>
                    <td className="py-2 px-2 text-right">
                      <span className="font-semibold text-text-primary">{fmtPct(r.click_rate)}</span>
                      <span className="text-text-muted text-xs"> ({fmtInt(r.clicked)})</span>
                    </td>
                    <td className="py-2 px-2 text-right">{r.replied > 0 ? <span className="text-emerald-600 font-semibold">{fmtInt(r.replied)}</span> : '—'}</td>
                    <td className="py-2 px-2 text-right">{r.unsubscribed > 0 ? fmtInt(r.unsubscribed) : '—'}</td>
                    <td className="py-2 px-4 text-right">{r.bounced > 0 ? <span className="text-wcs-red">{fmtInt(r.bounced)}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-text-muted px-1">
        Open / click / reply rates are GoHighLevel's own figures (calculated over delivered). Bounces combine permanent and temporary failures.
      </p>
    </div>
  )
}
