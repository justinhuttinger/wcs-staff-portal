import { useState, useEffect, useMemo } from 'react'
import { getSmsMarketingTemplates } from '../../lib/api'
import { exportCSV } from '../../lib/export'

// SMS engagement per automated text. GHL attaches no workflow id to a message,
// so each distinct text is identified by a fingerprint of its body; the label
// column is a human name for that cluster when one has been set.

function fmtInt(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—'
}
function fmtPct(v) {
  const n = Number(v)
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '—'
}
function fmtMinutes(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  if (n < 60) return `${Math.round(n)}m`
  if (n < 1440) return `${(n / 60).toFixed(1)}h`
  return `${(n / 1440).toFixed(1)}d`
}
function preview(body) {
  const s = (body || '').replace(/\s+/g, ' ').trim()
  return s.length > 90 ? s.slice(0, 90) + '…' : s || '—'
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

const KINDS = [
  { key: 'automated', label: 'Automated' },
  { key: 'staff', label: 'Staff sent' },
  { key: 'all', label: 'All' },
]

export default function SmsMarketingReport({ startDate, endDate, locationSlug }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [kind, setKind] = useState('automated')

  const allLoc = locationSlug === 'all' || !locationSlug
  const params = useMemo(
    () => ({ location_slug: allLoc ? '' : locationSlug, start_date: startDate, end_date: endDate, kind }),
    [allLoc, locationSlug, startDate, endDate, kind]
  )

  useEffect(() => {
    let ignore = false
    setLoading(true)
    setError('')
    getSmsMarketingTemplates(params)
      .then(d => { if (!ignore) setData(d) })
      .catch(e => { if (!ignore) setError(e.message || 'Failed to load SMS engagement') })
      .finally(() => { if (!ignore) setLoading(false) })
    return () => { ignore = true }
  }, [params])

  const rows = data?.templates || []
  const totals = data?.totals

  function handleExport() {
    exportCSV(
      rows.map(r => ({
        Location: r.location,
        Text: r.label || preview(r.sample_body),
        Sends: r.sends,
        Delivered: r.delivered,
        Failed: r.failed,
        Replies: r.replies,
        'Reply %': r.reply_rate,
        'Opt-outs': r.opt_outs,
        'Median reply (min)': r.median_reply_minutes ?? '',
      })),
      `sms-engagement-${startDate}_to_${endDate}`
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface rounded-xl border border-border p-3 flex items-center gap-2 flex-wrap">
        {KINDS.map(k => (
          <button
            key={k.key}
            onClick={() => setKind(k.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
              kind === k.key
                ? 'bg-wcs-red text-white'
                : 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {k.label}
          </button>
        ))}
        <div className="flex-1" />
        {rows.length > 0 && (
          <button
            onClick={handleExport}
            className="px-3 py-1.5 rounded-lg text-sm font-semibold text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            Export CSV
          </button>
        )}
      </div>

      {error && (
        <div className="bg-surface rounded-xl border border-border p-4">
          <p className="text-sm text-wcs-red">{error}</p>
        </div>
      )}

      {totals && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard label="Sends" value={fmtInt(totals.sends)} sub={`${fmtInt(totals.templates)} distinct texts`} />
          <StatCard label="Replies" value={fmtInt(totals.replies)} />
          <StatCard label="Reply Rate" value={fmtPct(totals.reply_rate)} />
          <StatCard label="Opt-outs" value={fmtInt(totals.opt_outs)} sub={fmtPct(totals.opt_out_rate)} />
        </div>
      )}

      {rows.length > 0 && (
        <div className="bg-surface rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-text-muted border-b border-border">
                <tr>
                  <th className="py-2.5 px-4 text-left">Text</th>
                  <th className="py-2.5 px-2 text-right">Sends</th>
                  <th className="py-2.5 px-2 text-right">Delivered</th>
                  <th className="py-2.5 px-2 text-right">Failed</th>
                  <th className="py-2.5 px-2 text-right">Replies</th>
                  <th className="py-2.5 px-2 text-right">Reply %</th>
                  <th className="py-2.5 px-2 text-right">Opt-outs</th>
                  <th className="py-2.5 px-2 text-right">Median Reply</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={`${r.location}|${r.template_key}`} className="border-b border-border/50 last:border-0 align-top">
                    <td className="py-2.5 px-4 max-w-md">
                      <p className="text-text-primary font-medium">{r.label || preview(r.sample_body)}</p>
                      {r.label && <p className="text-xs text-text-muted mt-0.5">{preview(r.sample_body)}</p>}
                      {allLoc && <p className="text-xs text-text-muted mt-0.5 capitalize">{r.location}</p>}
                    </td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.sends)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.delivered)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.failed)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.replies)}</td>
                    <td className="py-2.5 px-2 text-right font-semibold text-text-primary">{fmtPct(r.reply_rate)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtInt(r.opt_outs)}</td>
                    <td className="py-2.5 px-2 text-right text-text-primary">{fmtMinutes(r.median_reply_minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !error && !rows.length && (
        <div className="bg-surface rounded-xl border border-border p-6 text-center">
          <p className="text-sm text-text-muted">No SMS sends in this range yet.</p>
        </div>
      )}
    </div>
  )
}
