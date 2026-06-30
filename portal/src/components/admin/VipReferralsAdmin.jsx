import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { vipReferrals } from '../../lib/api'
import VipReferralsConfig from './VipReferralsConfig'

const SUB_STATUS = {
  completed: { label: 'All sent',    cls: 'bg-green-100 text-green-800' },
  partial:   { label: 'Some failed', cls: 'bg-orange-100 text-orange-800' },
  failed:    { label: 'All failed',  cls: 'bg-red-100 text-red-800' },
}
const REC_STATUS = {
  sent:    { label: 'Sent',                 cls: 'bg-green-100 text-green-800' },
  failed:  { label: 'Failed',              cls: 'bg-red-100 text-red-800' },
  skipped: { label: 'Skipped (incomplete)', cls: 'bg-gray-100 text-gray-600' },
}

function fmt(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '-'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function SubBadge({ status }) {
  const meta = SUB_STATUS[status] || { label: status, cls: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function RecBadge({ status }) {
  const meta = REC_STATUS[status] || { label: status, cls: 'bg-gray-100 text-gray-700' }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

function SubmissionDetail({ id, onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)
  const [retrying, setRetrying] = useState(null)

  const loadDetail = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await vipReferrals.getSubmission(id)
      setData(r)
    } catch (e) {
      setError(e.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadDetail() }, [loadDetail])

  async function onRetry(recipientId) {
    setRetrying(recipientId)
    try {
      await vipReferrals.retryRecipient(recipientId)
      await loadDetail()
    } finally {
      setRetrying(null)
    }
  }

  const sub        = data?.submission
  const recipients = data?.recipients || []

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl border border-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">Referral submission</h3>
            <p className="text-xs text-text-muted font-mono">{id}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading && <p className="text-sm text-text-muted text-center py-8">Loading...</p>}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">
              {error}
            </div>
          )}

          {sub && (
            <>
              {/* Referrer header */}
              <section className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xl font-bold text-text-primary">
                    {(`${sub.referrer_first_name || ''} ${sub.referrer_last_name || ''}`).trim() || '(no name)'}
                  </div>
                  <div className="text-xs text-text-muted">
                    {sub.referrer_email || ''}{sub.referrer_phone ? ` - ${sub.referrer_phone}` : ''}
                  </div>
                </div>
                <SubBadge status={sub.status} />
              </section>

              {/* Meta grid */}
              <section className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-text-muted">Location:</span>{' '}
                  <span className="font-semibold">{sub.location_slug || '-'}</span>
                </div>
                <div><span className="text-text-muted">Employee:</span>{' '}
                  <span>{sub.employee_name || '-'}</span>
                </div>
                <div><span className="text-text-muted">VIPs referred:</span>{' '}
                  <span className="font-semibold">{sub.vip_count ?? '-'}</span>
                </div>
                <div><span className="text-text-muted">Submitted:</span>{' '}
                  {fmt(sub.created_at)}
                </div>
              </section>

              {/* Recipients table */}
              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">
                  Recipients ({recipients.length})
                </p>
                {recipients.length === 0 ? (
                  <p className="text-xs text-text-muted">No recipients recorded.</p>
                ) : (
                  <div className="bg-bg border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="border-b border-border bg-surface/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-text-muted">Name</th>
                          <th className="text-left px-3 py-2 font-semibold text-text-muted">Phone</th>
                          <th className="text-left px-3 py-2 font-semibold text-text-muted">Status</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {recipients.map(r => (
                          <tr key={r.id} className="border-b border-border last:border-0">
                            <td className="px-3 py-2 font-medium text-text-primary">{(`${r.first_name || ''} ${r.last_name || ''}`).trim() || '-'}</td>
                            <td className="px-3 py-2 font-mono text-text-muted">{r.phone || '-'}</td>
                            <td className="px-3 py-2">
                              <RecBadge status={r.fanout_status} />
                              {r.error_detail && (
                                <div className="text-[10px] text-red-600 mt-0.5">{r.error_detail}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {r.fanout_status === 'failed' && (
                                <button
                                  onClick={() => onRetry(r.id)}
                                  disabled={retrying === r.id}
                                  className="text-xs text-wcs-red hover:underline disabled:opacity-50"
                                >
                                  {retrying === r.id ? 'Retrying...' : 'Retry'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

// ── Submissions list view ─────────────────────────────────────────────────────

function VipSubmissions() {
  const [submissions, setSubmissions] = useState([])
  const [counts, setCounts]           = useState({ submissions: 0, vips: 0, failed: 0 })
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState(null)
  const [page, setPage]               = useState(1)
  const [total, setTotal]             = useState(0)
  const [filters, setFilters]         = useState({ location: '', status: '', start_date: '', end_date: '' })
  const [detailId, setDetailId]       = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const params = { page, limit: 50 }
      if (filters.location)   params.location   = filters.location
      if (filters.status)     params.status     = filters.status
      if (filters.start_date) params.start_date = filters.start_date
      if (filters.end_date)   params.end_date   = filters.end_date
      const r = await vipReferrals.listSubmissions(params)
      setSubmissions(r.submissions || [])
      setTotal(r.total || 0)
      if (r.counts) setCounts(r.counts)
    } catch (e) {
      setError(e.message || 'Failed to load submissions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, filters.location, filters.status, filters.start_date, filters.end_date])

  const totalPages = Math.max(1, Math.ceil(total / 50))
  const hasFilters = filters.location || filters.status || filters.start_date || filters.end_date

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="bg-surface border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="block text-text-muted mb-0.5">Location</span>
          <select
            value={filters.location}
            onChange={e => { setPage(1); setFilters(f => ({ ...f, location: e.target.value })) }}
            className="px-2.5 py-1 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:border-wcs-red"
          >
            <option value="">All locations</option>
            <option value="salem">salem</option>
            <option value="keizer">keizer</option>
            <option value="eugene">eugene</option>
            <option value="milwaukie">milwaukie</option>
            <option value="clackamas">clackamas</option>
            <option value="springfield">springfield</option>
            <option value="medford">medford</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-text-muted mb-0.5">Status</span>
          <select
            value={filters.status}
            onChange={e => { setPage(1); setFilters(f => ({ ...f, status: e.target.value })) }}
            className="px-2.5 py-1 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:border-wcs-red"
          >
            <option value="">All</option>
            {Object.entries(SUB_STATUS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          <span className="block text-text-muted mb-0.5">From</span>
          <input
            type="date"
            value={filters.start_date}
            onChange={e => { setPage(1); setFilters(f => ({ ...f, start_date: e.target.value })) }}
            className="px-2.5 py-1 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:border-wcs-red"
          />
        </label>
        <label className="text-xs">
          <span className="block text-text-muted mb-0.5">To</span>
          <input
            type="date"
            value={filters.end_date}
            onChange={e => { setPage(1); setFilters(f => ({ ...f, end_date: e.target.value })) }}
            className="px-2.5 py-1 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:border-wcs-red"
          />
        </label>
        {hasFilters && (
          <button
            onClick={() => { setPage(1); setFilters({ location: '', status: '', start_date: '', end_date: '' }) }}
            className="text-xs text-wcs-red hover:underline"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-xs text-text-muted self-center">
          {loading ? 'Loading...' : `${total} result${total === 1 ? '' : 's'}`}
        </div>
      </div>

      {/* Counts strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-surface border border-border rounded-xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-text-primary">{counts.submissions}</div>
          <div className="text-xs text-text-muted">Submissions</div>
        </div>
        <div className="bg-surface border border-border rounded-xl px-4 py-3 text-center">
          <div className="text-2xl font-bold text-text-primary">{counts.vips}</div>
          <div className="text-xs text-text-muted">VIPs referred</div>
        </div>
        <div className="bg-surface border border-border rounded-xl px-4 py-3 text-center">
          <div className={`text-2xl font-bold ${counts.failed > 0 ? 'text-red-600' : 'text-text-primary'}`}>
            {counts.failed}
          </div>
          <div className="text-xs text-text-muted">Failed sends</div>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {/* Submissions table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Submitted</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Referrer</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Employee</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">VIPs</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {submissions.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-text-muted">
                  No submissions yet.
                </td>
              </tr>
            )}
            {submissions.map(s => (
              <tr
                key={s.id}
                className="border-b border-border last:border-0 hover:bg-bg/30 cursor-pointer"
                onClick={() => setDetailId(s.id)}
              >
                <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{fmt(s.created_at)}</td>
                <td className="px-3 py-2 text-xs font-semibold text-text-primary">{(`${s.referrer_first_name || ''} ${s.referrer_last_name || ''}`).trim() || '-'}</td>
                <td className="px-3 py-2 text-xs">{s.location_slug || '-'}</td>
                <td className="px-3 py-2 text-xs text-text-muted">{s.employee_name || '-'}</td>
                <td className="px-3 py-2 text-xs font-mono">{s.vip_count ?? '-'}</td>
                <td className="px-3 py-2"><SubBadge status={s.status} /></td>
                <td className="px-3 py-2 text-right">
                  <button className="text-xs text-wcs-red hover:underline">View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 rounded-lg border border-border text-text-muted disabled:opacity-50"
          >
            Prev
          </button>
          <span className="text-text-muted">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded-lg border border-border text-text-muted disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {detailId && (
        <SubmissionDetail id={detailId} onClose={() => setDetailId(null)} />
      )}
    </div>
  )
}

// ── Tab shell ─────────────────────────────────────────────────────────────────

const TABS = [
  { key: 'submissions', label: 'Submissions', desc: 'Referral log, fan-out status, retry' },
  { key: 'config',      label: 'Config',      desc: 'Webhook URLs and embed snippets' },
]

export default function VipReferralsAdmin() {
  const [tab, setTab] = useState('submissions')

  return (
    <div className="space-y-4">
      <div className="bg-surface border border-border rounded-xl p-2 flex flex-wrap gap-1">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === t.key
                ? 'bg-wcs-red text-white'
                : 'bg-bg text-text-muted hover:text-text-primary'
            }`}
            title={t.desc}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'submissions' && <VipSubmissions />}
      {tab === 'config'      && <VipReferralsConfig />}
    </div>
  )
}
