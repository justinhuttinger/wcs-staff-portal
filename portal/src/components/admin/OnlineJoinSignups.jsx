import { useState, useEffect } from 'react'
import { onlineJoin } from '../../lib/api'

const STATUS_BADGE = {
  started:           { label: 'Started',        cls: 'bg-gray-100 text-gray-700' },
  payment_pending:   { label: 'Payment pending', cls: 'bg-amber-100 text-amber-800' },
  submitted_to_abc:  { label: 'Submitting',     cls: 'bg-blue-100 text-blue-800' },
  agreement_created: { label: 'Member created', cls: 'bg-green-100 text-green-800' },
  failed:            { label: 'Failed',         cls: 'bg-red-100 text-red-800' },
}

function StatusBadge({ status }) {
  const meta = STATUS_BADGE[status] || { label: status, cls: 'bg-gray-100 text-gray-700' }
  return <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${meta.cls}`}>{meta.label}</span>
}

function formatDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function SignupDetail({ id, onClose }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const r = await onlineJoin.getSignup(id)
        if (!cancelled) setData(r)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const s = data?.signup
  const errors = data?.errors || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-border shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-border flex items-center justify-between sticky top-0 bg-surface z-10">
          <div>
            <h3 className="text-lg font-bold text-text-primary">Signup detail</h3>
            <p className="text-xs text-text-muted font-mono">{id}</p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {loading && <p className="text-sm text-text-muted text-center py-8">Loading…</p>}
          {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

          {s && (
            <>
              <section className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xl font-bold text-text-primary">{[s.first_name, s.last_name].filter(Boolean).join(' ') || '(no name)'}</div>
                  <div className="text-xs text-text-muted">{s.email || '(no email)'}{s.cell_phone ? ` · ${s.cell_phone}` : ''}</div>
                </div>
                <StatusBadge status={s.status} />
              </section>

              <section className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-text-muted">Location:</span> <span className="font-semibold">{s.wcs_location_id}</span></div>
                <div><span className="text-text-muted">Club #:</span> <span className="font-mono">{s.abc_club_number}</span></div>
                <div><span className="text-text-muted">Plan:</span> <span className="font-mono">{s.payment_plan_id}</span></div>
                <div><span className="text-text-muted">Pay method:</span> <span>{s.payment_method_choice || '—'}</span></div>
                <div><span className="text-text-muted">Started:</span> {formatDate(s.started_at)}</div>
                <div><span className="text-text-muted">Completed:</span> {formatDate(s.completed_at)}</div>
                <div><span className="text-text-muted">ABC member ID:</span> <span className="font-mono">{s.abc_member_id || '—'}</span></div>
                <div><span className="text-text-muted">ABC agreement ID:</span> <span className="font-mono">{s.abc_agreement_id || '—'}</span></div>
                <div><span className="text-text-muted">GHL contact:</span> <span className="font-mono">{s.ghl_contact_id || '—'}</span></div>
                <div><span className="text-text-muted">Welcome email:</span> <span>{s.confirmation_email_sent ? '✓ sent' : '—'}</span></div>
              </section>

              <section>
                <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Contact</p>
                <div className="bg-bg border border-border rounded-lg px-3 py-2 text-xs space-y-0.5">
                  <div>{s.address_line1}{s.address_line2 ? `, ${s.address_line2}` : ''}</div>
                  <div>{[s.city, s.state, s.zip_code].filter(Boolean).join(', ')}</div>
                  <div className="text-text-muted">DOB: {s.birthday || '—'} · Gender: {s.gender || '—'}</div>
                </div>
              </section>

              {s.emergency_contact && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Emergency contact</p>
                  <div className="bg-bg border border-border rounded-lg px-3 py-2 text-xs">
                    {[s.emergency_contact.first_name, s.emergency_contact.last_name].filter(Boolean).join(' ') || '—'} · {s.emergency_contact.phone || '—'}
                  </div>
                </section>
              )}

              {(s.utm_source || s.utm_campaign || s.fbclid) && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">Attribution</p>
                  <div className="bg-bg border border-border rounded-lg px-3 py-2 text-xs font-mono space-y-0.5">
                    {s.utm_source && <div>utm_source: {s.utm_source}</div>}
                    {s.utm_medium && <div>utm_medium: {s.utm_medium}</div>}
                    {s.utm_campaign && <div>utm_campaign: {s.utm_campaign}</div>}
                    {s.fbclid && <div>fbclid: {s.fbclid}</div>}
                    {s.client_ip && <div className="text-text-muted">ip: {s.client_ip}</div>}
                  </div>
                </section>
              )}

              {errors.length > 0 && (
                <section>
                  <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-1">Errors ({errors.length})</p>
                  <div className="space-y-2">
                    {errors.map(err => (
                      <details key={err.id} className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs">
                        <summary className="cursor-pointer">
                          <span className="font-semibold text-red-900">[{err.step}]</span>
                          <span className="text-red-800 ml-1">{err.error_type}</span>
                          <span className="text-red-700/70 ml-2">{formatDate(err.occurred_at)}</span>
                        </summary>
                        <div className="mt-2 text-red-900/90 space-y-1">
                          <div><span className="font-semibold">Message:</span> {err.error_message}</div>
                          {err.error_payload && (
                            <pre className="bg-white border border-red-200 rounded p-2 overflow-x-auto text-[10px]">{JSON.stringify(err.error_payload, null, 2)}</pre>
                          )}
                          {err.request_payload && (
                            <details>
                              <summary className="cursor-pointer text-red-800">Request payload (PayPage tokens redacted)</summary>
                              <pre className="bg-white border border-red-200 rounded p-2 overflow-x-auto text-[10px] mt-1">{JSON.stringify(err.request_payload, null, 2)}</pre>
                            </details>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                </section>
              )}

              {s.abc_response && (
                <section>
                  <details className="bg-bg border border-border rounded-lg px-3 py-2 text-xs">
                    <summary className="cursor-pointer text-text-muted font-semibold">ABC response</summary>
                    <pre className="mt-2 bg-surface border border-border rounded p-2 overflow-x-auto text-[10px]">{JSON.stringify(s.abc_response, null, 2)}</pre>
                  </details>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OnlineJoinSignups() {
  const [signups, setSignups] = useState([])
  const [locations, setLocations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [filters, setFilters] = useState({ location: '', status: '', start_date: '', end_date: '' })
  const [detailId, setDetailId] = useState(null)

  async function load() {
    setLoading(true); setError(null)
    try {
      const params = { page, limit: 50 }
      if (filters.location) params.location = filters.location
      if (filters.status) params.status = filters.status
      if (filters.start_date) params.start_date = filters.start_date
      if (filters.end_date) params.end_date = filters.end_date
      const [signupsR, locsR] = await Promise.all([
        onlineJoin.listSignups(params),
        locations.length === 0 ? onlineJoin.listLocations() : Promise.resolve({ locations }),
      ])
      setSignups(signupsR.signups || [])
      setTotal(signupsR.total || 0)
      if (locsR.locations) setLocations(locsR.locations)
    } catch (e) {
      setError(e.message || 'Failed to load signups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page, filters.location, filters.status, filters.start_date, filters.end_date])

  const totalPages = Math.max(1, Math.ceil(total / 50))

  return (
    <div className="space-y-3">
      <div className="bg-surface border border-border rounded-xl p-3 flex flex-wrap items-end gap-3">
        <label className="text-xs">
          <span className="block text-text-muted mb-0.5">Location</span>
          <select
            value={filters.location}
            onChange={e => { setPage(1); setFilters(f => ({ ...f, location: e.target.value })) }}
            className="px-2.5 py-1 bg-bg border border-border rounded-lg text-xs focus:outline-none focus:border-wcs-red"
          >
            <option value="">All</option>
            {locations.map(l => <option key={l.wcs_location_id} value={l.wcs_location_id}>{l.display_name}</option>)}
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
            {Object.entries(STATUS_BADGE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
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
        {(filters.location || filters.status || filters.start_date || filters.end_date) && (
          <button
            onClick={() => { setPage(1); setFilters({ location: '', status: '', start_date: '', end_date: '' }) }}
            className="text-xs text-wcs-red hover:underline"
          >
            Clear filters
          </button>
        )}
        <div className="ml-auto text-xs text-text-muted self-center">{loading ? 'Loading…' : `${total} result${total === 1 ? '' : 's'}`}</div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">{error}</div>}

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-bg/50">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Started</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Location</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Customer</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Status</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-text-muted">Member #</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {signups.length === 0 && !loading && (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-text-muted">No signups yet.</td></tr>
            )}
            {signups.map(s => (
              <tr key={s.id} className="border-b border-border last:border-0 hover:bg-bg/30 cursor-pointer" onClick={() => setDetailId(s.id)}>
                <td className="px-3 py-2 text-xs text-text-muted whitespace-nowrap">{formatDate(s.started_at)}</td>
                <td className="px-3 py-2 text-xs">{s.wcs_location_id}</td>
                <td className="px-3 py-2">
                  <div className="text-xs font-semibold text-text-primary">{[s.first_name, s.last_name].filter(Boolean).join(' ') || '—'}</div>
                  <div className="text-[10px] text-text-muted">{s.email || ''}</div>
                </td>
                <td className="px-3 py-2"><StatusBadge status={s.status} /></td>
                <td className="px-3 py-2 text-xs font-mono text-text-muted">{s.abc_member_id || '—'}</td>
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
            ← Prev
          </button>
          <span className="text-text-muted">Page {page} of {totalPages}</span>
          <button
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 rounded-lg border border-border text-text-muted disabled:opacity-50"
          >
            Next →
          </button>
        </div>
      )}

      {detailId && <SignupDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
