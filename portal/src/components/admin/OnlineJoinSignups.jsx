import { useState, useEffect } from 'react'
import { onlineJoin } from '../../lib/api'

const STATUS_BADGES = {
  started:            { label: 'Started',           cls: 'bg-gray-50 text-gray-700 border-gray-200' },
  payment_pending:    { label: 'Payment pending',   cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  submitted_to_abc:   { label: 'Submitted to ABC',  cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  agreement_created:  { label: 'Agreement created', cls: 'bg-green-50 text-green-700 border-green-200' },
  failed:             { label: 'Failed',            cls: 'bg-red-50 text-red-700 border-red-200' },
}

function statusBadge(s) {
  return STATUS_BADGES[s] || { label: s || 'Unknown', cls: 'bg-gray-50 text-gray-700 border-gray-200' }
}

function fmtDateTime(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d)) return s
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function SignupDetail({ signup, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const r = await onlineJoin.getSignup(signup.id)
        if (!cancelled) setDetail(r)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load signup')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [signup.id])

  const s = detail?.signup || signup
  const errors = detail?.errors || []
  const b = statusBadge(s.status)
  const name = [s.first_name, s.last_name].filter(Boolean).join(' ') || '—'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-text-primary truncate">{name}</h3>
            <p className="text-xs text-text-muted">{s.wcs_location_id} · started {fmtDateTime(s.started_at)}</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${b.cls}`}>{b.label}</span>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {loading && <p className="text-sm text-text-muted">Loading…</p>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

          {!loading && (
            <>
              <section className="grid grid-cols-2 gap-3 text-xs">
                <DetailRow label="Email" value={s.email} />
                <DetailRow label="Phone" value={s.cell_phone} />
                <DetailRow label="Birthday" value={s.birthday} />
                <DetailRow label="Address" value={[s.address_line1, s.city, s.state, s.zip_code].filter(Boolean).join(', ')} />
                <DetailRow label="Payment method" value={s.payment_method_choice} />
                <DetailRow label="Payment type" value={s.paypage_payment_type} />
                <DetailRow label="ABC member ID" value={s.abc_member_id} monospace />
                <DetailRow label="ABC agreement ID" value={s.abc_agreement_id} monospace />
                <DetailRow label="GHL contact ID" value={s.ghl_contact_id} monospace />
                <DetailRow label="Meta CAPI sent" value={s.meta_capi_sent ? 'yes' : 'no'} />
                <DetailRow label="Email sent" value={s.confirmation_email_sent ? 'yes' : 'no'} />
                <DetailRow label="UTM source / medium / campaign" value={[s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ') || '—'} />
              </section>

              {errors.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-2">Errors ({errors.length})</p>
                  <div className="space-y-2">
                    {errors.map(e => (
                      <div key={e.id} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-red-800">{e.step}{e.error_type ? ` · ${e.error_type}` : ''}</span>
                          <span className="text-[10px] text-red-600">{fmtDateTime(e.occurred_at)}</span>
                        </div>
                        <p className="text-red-700">{e.error_message}</p>
                        {e.error_payload && (
                          <details className="mt-1">
                            <summary className="text-[10px] text-red-600 cursor-pointer">payload</summary>
                            <pre className="mt-1 text-[10px] bg-white p-2 rounded overflow-x-auto">{JSON.stringify(e.error_payload, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value, monospace }) {
  return (
    <div className="bg-bg rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className={`text-sm text-text-primary ${monospace ? 'font-mono break-all' : ''}`}>{value || '—'}</div>
    </div>
  )
}

export default function OnlineJoinSignups() {
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [locationFilter, setLocationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [opened, setOpened] = useState(null)
  const [locations, setLocations] = useState([])
  const LIMIT = 50

  async function load() {
    setLoading(true); setError(null)
    try {
      const params = { page, limit: LIMIT }
      if (locationFilter) params.location = locationFilter
      if (statusFilter) params.status = statusFilter
      if (startDate) params.start_date = startDate
      if (endDate) params.end_date = endDate
      const r = await onlineJoin.listSignups(params)
      setRows(r.signups || [])
      setTotal(r.total || 0)
    } catch (e) {
      setError(e.message || 'Failed to load signups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    onlineJoin.listLocations().then(r => setLocations(r.locations || [])).catch(() => {})
  }, [])
  useEffect(() => { load() }, [page, locationFilter, statusFilter, startDate, endDate])

  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="bg-surface border border-border rounded-xl p-3 flex flex-wrap items-center gap-2">
        <select value={locationFilter} onChange={e => { setLocationFilter(e.target.value); setPage(1) }} className="px-2 py-1 bg-bg border border-border rounded-lg text-xs">
          <option value="">All locations</option>
          {locations.map(l => <option key={l.wcs_location_id} value={l.wcs_location_id}>{l.display_name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} className="px-2 py-1 bg-bg border border-border rounded-lg text-xs">
          <option value="">All statuses</option>
          {Object.keys(STATUS_BADGES).map(s => <option key={s} value={s}>{STATUS_BADGES[s].label}</option>)}
        </select>
        <input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setPage(1) }} className="px-2 py-1 bg-bg border border-border rounded-lg text-xs" />
        <span className="text-xs text-text-muted">to</span>
        <input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setPage(1) }} className="px-2 py-1 bg-bg border border-border rounded-lg text-xs" />
        <span className="ml-auto text-xs text-text-muted">{loading ? 'Loading…' : `${total} signup${total === 1 ? '' : 's'}`}</span>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-semibold text-text-muted">Started</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Name</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Email</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Status</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Member ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">No signups match these filters yet.</td></tr>
            )}
            {rows.map(r => {
              const b = statusBadge(r.status)
              const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—'
              return (
                <tr key={r.id} onClick={() => setOpened(r)} className="border-b border-border last:border-0 hover:bg-bg/30 cursor-pointer">
                  <td className="px-4 py-2 text-xs text-text-muted whitespace-nowrap">{fmtDateTime(r.started_at)}</td>
                  <td className="px-3 py-2 text-xs text-text-muted">{r.wcs_location_id}</td>
                  <td className="px-3 py-2 text-sm text-text-primary">{name}</td>
                  <td className="px-3 py-2 text-xs text-text-muted truncate max-w-[200px]">{r.email || '—'}</td>
                  <td className="px-3 py-2"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${b.cls} whitespace-nowrap`}>{b.label}</span></td>
                  <td className="px-3 py-2 text-[11px] font-mono text-text-muted">{r.abc_member_id || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {total > LIMIT && (
          <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs">
            <span className="text-text-muted">Page {page} of {totalPages}</span>
            <div className="flex gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-2 py-1 rounded border border-border disabled:opacity-40">‹ Prev</button>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-2 py-1 rounded border border-border disabled:opacity-40">Next ›</button>
            </div>
          </div>
        )}
      </div>

      {opened && <SignupDetail signup={opened} onClose={() => setOpened(null)} />}
    </div>
  )
}
