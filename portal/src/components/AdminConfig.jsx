import { useState, useEffect } from 'react'
import { LOCATION_NAMES as LOCATIONS } from '../config/locations'

export default function AdminConfig({ isElectron, onClose }) {
  const [location, setLocation] = useState('')
  const [abcUrl, setAbcUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (isElectron && window.wcsElectron) {
      window.wcsElectron.getConfig().then(config => {
        setLocation(config.location || '')
        setAbcUrl(config.abc_url || '')
      })
    }
  }, [isElectron])

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setMessage('')

    try {
      if (isElectron && window.wcsElectron) {
        await window.wcsElectron.setConfig({ location, abc_url: abcUrl })
        setMessage('Saved! Reloading portal...')
      }
    } catch {
      setMessage('Failed to save configuration.')
    }

    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface rounded-2xl border border-border p-8 w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-text-primary">Kiosk Configuration</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl">&times;</button>
        </div>

        <form onSubmit={handleSave} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Location</label>
            <select
              value={location}
              onChange={e => setLocation(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            >
              <option value="">Select location...</option>
              {LOCATIONS.map(loc => (
                <option key={loc} value={loc}>{loc}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">ABC Financial URL</label>
            <input
              type="url"
              placeholder="https://prod02.abcfinancial.com/..."
              value={abcUrl}
              onChange={e => setAbcUrl(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
          </div>

          {message && <p className="text-sm text-text-muted">{message}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold text-sm hover:bg-wcs-red-hover transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </form>
      </div>
    </div>
  )
}
