import { useState, useEffect } from 'react'
import { api } from '../../lib/api'

const CURRENT_RELEASE_DEFAULT = ''

export default function LauncherVersionAdmin() {
  const [minVersion, setMinVersion] = useState(null)
  const [input, setInput] = useState(CURRENT_RELEASE_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  function load() {
    setLoading(true)
    api('/config/launcher-version')
      .then(res => {
        setMinVersion(res.min_version || null)
        setInput(res.min_version || '')
      })
      .catch(err => setError(err.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleSave(e) {
    e.preventDefault()
    if (!input || !input.match(/^\d+\.\d+\.\d+$/)) {
      setError('Enter a version like 1.4.10')
      return
    }
    setError('')
    setMessage('')
    setSaving(true)
    try {
      await api('/config/launcher-version', {
        method: 'PUT',
        body: JSON.stringify({ min_version: input.trim() }),
      })
      setMinVersion(input.trim())
      setMessage(`Saved. All kiosks will force-relaunch within 15 minutes if they're below ${input.trim()}.`)
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleClear() {
    if (!confirm('Clear the minimum required launcher version? Kiosks will no longer force-relaunch.')) return
    setError('')
    setMessage('')
    setSaving(true)
    try {
      await api('/config/launcher-version', {
        method: 'PUT',
        body: JSON.stringify({ min_version: '0.0.0' }),
      })
      setMinVersion('0.0.0')
      setInput('0.0.0')
      setMessage('Cleared. No version pin enforced.')
    } catch (err) {
      setError(err.message || 'Clear failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <div className="bg-surface border border-border rounded-xl p-5">
        <p className="text-sm text-text-primary mb-1 font-semibold">Force kiosks to update</p>
        <p className="text-xs text-text-muted leading-relaxed">
          Each kiosk's launcher polls this value every 15 minutes. If its installed version is below the value, it calls <code>app.relaunch()</code> + <code>app.exit(0)</code> so any pending electron-updater download is applied. Use after publishing a new launcher release to roll it out across all kiosks without remote access.
        </p>
        <p className="text-xs text-text-muted leading-relaxed mt-2">
          Set the value to the version of the release you just published (e.g. <code>1.4.10</code>). Older kiosks will restart within 15 minutes.
        </p>
      </div>

      {loading ? (
        <p className="loading-card mx-auto block my-6">Loading...</p>
      ) : (
        <div className="bg-surface border border-border rounded-xl p-5 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-text-muted mb-1">Current minimum required version</p>
            <p className="text-2xl font-bold text-text-primary">
              {minVersion && minVersion !== '0.0.0' ? minVersion : <span className="text-text-muted text-base font-normal">Not pinned</span>}
            </p>
          </div>

          <form onSubmit={handleSave} className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-1">Set required version</label>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="1.4.10"
                className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red font-mono"
              />
            </div>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg bg-wcs-red text-white hover:bg-wcs-red/90 disabled:opacity-40">
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" onClick={handleClear} disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg border border-border bg-bg text-text-muted hover:text-wcs-red disabled:opacity-40">
              Clear
            </button>
          </form>

          {message && <p className="text-sm text-green-700">{message}</p>}
          {error && <p className="text-sm text-wcs-red">{error}</p>}
        </div>
      )}
    </div>
  )
}
