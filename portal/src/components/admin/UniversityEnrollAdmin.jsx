import { useState, useEffect, useMemo, useCallback } from 'react'
import { getUniversityUsers, enrollUniversityUser } from '../../lib/api'

const btnPrimary = 'px-3 py-1.5 rounded-lg bg-wcs-red text-white text-xs font-semibold hover:bg-wcs-red/90 transition-colors disabled:opacity-50'
const btnGhost = 'px-3 py-1.5 rounded-lg border border-border bg-surface text-xs font-semibold text-text-muted hover:text-text-primary hover:border-text-muted transition-colors disabled:opacity-50'
const inputCls = 'px-3 py-2 rounded-lg border border-border bg-bg text-sm text-text-primary focus:outline-none focus:border-wcs-red w-full'

const STATUS_BADGE = {
  complete: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  partial: 'text-amber-700 bg-amber-50 border-amber-200',
  failed: 'text-red-700 bg-red-50 border-red-200',
  pending: 'text-text-muted bg-bg border-border',
}

export default function UniversityEnrollAdmin() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notConfigured, setNotConfigured] = useState(false)
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [result, setResult] = useState(null) // { userId, status, error }

  const load = useCallback(() => {
    setLoading(true); setError(''); setNotConfigured(false)
    getUniversityUsers()
      .then(res => setUsers(res.users || []))
      .catch(err => {
        if (/not configured/i.test(err.message)) setNotConfigured(true)
        else setError(err.message)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return users
    return users.filter(u =>
      (u.name || '').toLowerCase().includes(term) || (u.email || '').toLowerCase().includes(term))
  }, [users, search])

  async function enroll(u) {
    setBusyId(u.id); setResult(null); setError('')
    try {
      const res = await enrollUniversityUser(u.id, { email: u.email, name: u.name })
      const e = res.enrollment || {}
      setResult({ userId: u.id, status: e.status, error: e.error, contacts: (e.created_contacts || []).length })
      // Patch the row in place so the badge updates without a full reload.
      setUsers(list => list.map(x => x.id === u.id
        ? { ...x, enrolled: true, enrollment_status: e.status, contacts_created: (e.created_contacts || []).length }
        : x))
    } catch (err) {
      setResult({ userId: u.id, status: 'failed', error: err.message })
    } finally {
      setBusyId(null)
    }
  }

  if (notConfigured) {
    return (
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-6">
        <p className="text-sm text-text-primary font-semibold mb-2">University enrollment isn’t configured yet</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Set <code className="bg-bg px-1 rounded">GHL_UNIVERSITY_LOCATION_ID</code> and{' '}
          <code className="bg-bg px-1 rounded">GHL_UNIVERSITY_API_KEY</code> (a University sub-account private-integration
          token with <code className="bg-bg px-1 rounded">contacts.write</code> + <code className="bg-bg px-1 rounded">users.write</code>),
          plus <code className="bg-bg px-1 rounded">UNIVERSITY_ENROLL_ENABLED=true</code>, on the auth service and redeploy.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <h3 className="text-base font-bold text-text-primary">Enroll a trainee in WCS University</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Enroll grants the user access to the University sub-account (assigned-data-only) and creates their own 5 practice contacts, assigned to them.
            </p>
          </div>
          <button onClick={load} disabled={loading} className={btnGhost}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search users by name or email…" className={inputCls} />
      </div>

      {error && <p className="text-sm text-wcs-red bg-surface border border-border rounded-lg px-3 py-2">{error}</p>}

      {result && (
        <div className={`rounded-lg border px-3 py-2 text-xs font-medium ${STATUS_BADGE[result.status] || STATUS_BADGE.pending}`}>
          {result.status === 'complete' && `Enrolled — ${result.contacts} practice contacts created.`}
          {result.status === 'partial' && `Partially enrolled (${result.contacts} contacts). ${result.error || ''}`}
          {result.status === 'failed' && `Enrollment failed. ${result.error || ''}`}
        </div>
      )}

      <div className="bg-surface/95 backdrop-blur-sm rounded-xl border border-border overflow-hidden">
        {loading ? (
          <p className="text-sm text-text-muted p-6 text-center">Loading GHL users…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-text-muted p-8 text-center">{users.length === 0 ? 'No GHL users found.' : 'No users match your search.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted border-b border-border bg-bg/50">
                  <th className="py-2.5 px-4">Name</th>
                  <th className="py-2.5 px-2">Email</th>
                  <th className="py-2.5 px-2 text-center">Sub-accounts</th>
                  <th className="py-2.5 px-2">Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(u => (
                  <tr key={u.id} className="border-b border-border/50 hover:bg-bg/40">
                    <td className="py-2 px-4 font-medium text-text-primary">{u.name || '—'}</td>
                    <td className="py-2 px-2 text-text-muted">{u.email || '—'}</td>
                    <td className="py-2 px-2 text-center text-text-muted">{(u.locationIds || []).length}</td>
                    <td className="py-2 px-2">
                      {u.enrollment_status ? (
                        <span className={`text-[10px] font-bold uppercase border rounded-full px-1.5 py-0.5 ${STATUS_BADGE[u.enrollment_status] || STATUS_BADGE.pending}`}>
                          {u.enrollment_status}{u.contacts_created ? ` · ${u.contacts_created}` : ''}
                        </span>
                      ) : u.enrolled ? (
                        <span className="text-[10px] font-bold uppercase text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5">In University</span>
                      ) : (
                        <span className="text-[10px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <button
                        onClick={() => enroll(u)}
                        disabled={busyId === u.id}
                        className={u.enrollment_status === 'complete' ? btnGhost : btnPrimary}
                      >
                        {busyId === u.id ? 'Enrolling…' : u.enrollment_status ? 'Re-run' : 'Enroll'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
