import { useState, useEffect } from 'react'
import { getAppSettings, saveAppSettings } from '../../lib/api'
import { THEME_OPTIONS } from '../appearance/themeOptions'

/**
 * Sets the theme a brand-new staff member sees before they have ever opened
 * Profile and picked their own. `uiPrefs.js` reads `appearance_default_theme`
 * and applies it only when a person has no saved preferences row at all, so
 * this can never restyle someone who has already made a choice.
 */
export default function OrgAppearanceDefault() {
  const [theme, setTheme] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState(null)

  useEffect(() => {
    getAppSettings('appearance_default_')
      .then(settings => setTheme(settings?.appearance_default_theme || THEME_OPTIONS[0].key))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setSaving(true)
    setMessage(null)
    try {
      await saveAppSettings({ appearance_default_theme: theme })
      setMessage({ type: 'success', text: 'Saved!' })
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Save failed.' })
    }
    setSaving(false)
  }

  if (loading) return <p className="text-sm text-text-muted">Loading...</p>

  return (
    <div>
      <h3 className="text-sm font-bold text-text-primary">Default for new staff</h3>
      <p className="text-xs text-text-muted mt-1 mb-4">
        This only sets the theme a person sees before they have ever opened
        Profile and chosen their own. It does not change the look for anyone
        who already has, even if they picked it a long time ago. To restyle
        someone specific, they still need to change it themselves in Profile.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <select
          value={theme}
          onChange={(e) => setTheme(e.target.value)}
          className="text-sm rounded-lg border border-border bg-surface px-3 py-1.5"
        >
          {THEME_OPTIONS.map(opt => (
            <option key={opt.key} value={opt.key}>{opt.name}</option>
          ))}
        </select>
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-wcs-red text-white rounded-lg px-4 py-1.5 font-medium hover:bg-wcs-red/90 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {message && (
          <span className={`text-xs font-medium ${message.type === 'success' ? 'text-green-600' : 'text-red-500'}`}>
            {message.text}
          </span>
        )}
      </div>
    </div>
  )
}
