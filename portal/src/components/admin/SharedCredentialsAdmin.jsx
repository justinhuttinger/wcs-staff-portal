import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

// Common services where a shared (master account) login makes sense.
// Free-form text is allowed too — the service field accepts any value.
const SUGGESTED_SERVICES = [
  { key: 'westcoaststrength', label: 'Send Notifications (Trainerize)' },
  { key: 'my-coke', label: 'MyCoke' },
  { key: 'sportlifedistribution', label: 'SportLife Distribution' },
]

export default function SharedCredentialsAdmin() {
  const [credentials, setCredentials] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { service, username, password, description } | null

  function load() {
    setLoading(true)
    api('/admin/shared-credentials')
      .then(res => setCredentials(res.credentials || []))
      .catch(err => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleSave(e) {
    e.preventDefault()
    if (!editing.service || !editing.username || !editing.password) {
      setError('Service, username, and password are all required')
      return
    }
    setError('')
    try {
      await api('/admin/shared-credentials', {
        method: 'POST',
        body: JSON.stringify({
          service: editing.service.trim(),
          username: editing.username,
          password: editing.password,
          description: editing.description || null,
        }),
      })
      setEditing(null)
      load()
    } catch (err) {
      setError(err.message || 'Save failed')
    }
  }

  async function handleDelete(id, service) {
    if (!confirm(`Delete shared credential for "${service}"?`)) return
    try {
      await api('/admin/shared-credentials/' + id, { method: 'DELETE' })
      load()
    } catch (err) {
      setError(err.message || 'Delete failed')
    }
  }

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-sm text-text-primary mb-1 font-semibold">What are shared credentials?</p>
        <p className="text-xs text-text-muted leading-relaxed">
          A master username + password that applies to <strong>all staff</strong> for a given service. The launcher's auto-fill picks them up automatically the first time anyone opens that service. Use for tools where the company has one shared vendor login (e.g. MyCoke, SportLife, Trainerize push notifications).
        </p>
        <p className="text-xs text-text-muted leading-relaxed mt-2">
          The <strong>service</strong> field must match what the launcher's credential capture uses for that domain. Defaults: hostname's first segment minus <code>www.</code> (e.g. <code>my-coke.com</code> → <code>my-coke</code>, <code>sportlifedistribution.com</code> → <code>sportlifedistribution</code>, <code>westcoaststrength.trainerize.com</code> → <code>westcoaststrength</code>).
        </p>
      </div>

      {error && <p className="text-sm text-wcs-red">{error}</p>}

      <div className="flex justify-end">
        <button
          onClick={() => setEditing({ service: '', username: '', password: '', description: '' })}
          className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 transition-colors"
        >
          + Add Shared Credential
        </button>
      </div>

      {loading ? (
        <p className="loading-card mx-auto block my-6">Loading...</p>
      ) : credentials.length === 0 ? (
        <p className="empty-card mx-auto block my-6">No shared credentials yet</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-bg/50">
              <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Description</th>
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map(c => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-4 py-3 font-mono text-xs text-text-primary">{c.service}</td>
                  <td className="px-4 py-3 text-text-primary">{c.username}</td>
                  <td className="px-4 py-3 text-text-muted">{c.description || '—'}</td>
                  <td className="px-4 py-3 text-text-muted text-xs">{new Date(c.updated_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => setEditing({ service: c.service, username: c.username, password: '', description: c.description || '' })}
                      className="text-xs text-text-muted hover:text-wcs-red"
                    >
                      Replace password
                    </button>
                    <button
                      onClick={() => handleDelete(c.id, c.service)}
                      className="text-xs text-text-muted hover:text-wcs-red"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-surface rounded-2xl border border-border p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-text-primary mb-4">
              {credentials.find(c => c.service === editing.service) ? 'Update' : 'Add'} Shared Credential
            </h3>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Service</label>
                <input
                  type="text"
                  list="suggested-services"
                  value={editing.service}
                  onChange={e => setEditing({ ...editing, service: e.target.value })}
                  placeholder="e.g. my-coke"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red font-mono"
                  required
                />
                <datalist id="suggested-services">
                  {SUGGESTED_SERVICES.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Username / Email</label>
                <input
                  type="text"
                  value={editing.username}
                  onChange={e => setEditing({ ...editing, username: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Password</label>
                <input
                  type="password"
                  value={editing.password}
                  onChange={e => setEditing({ ...editing, password: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Description (optional)</label>
                <input
                  type="text"
                  value={editing.description}
                  onChange={e => setEditing({ ...editing, description: e.target.value })}
                  placeholder="e.g. master beverage ordering account"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setEditing(null)} className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-bg text-text-muted hover:bg-bg/50">
                  Cancel
                </button>
                <button type="submit" className="flex-1 px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90">
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
