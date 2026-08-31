import { useState } from 'react'
import { getPrefs, setPrefs } from '../../lib/theme'
import AppearanceControls from '../appearance/AppearanceControls'

export default function AppearanceAdmin() {
  const [prefs, setLocalPrefs] = useState(getPrefs)
  const patch = (p) => setLocalPrefs(setPrefs(p)) // persist + apply to <html> live

  return (
    <div className="bg-surface rounded-xl border border-border p-6 max-w-3xl">
      <p className="text-sm text-text-muted mb-1">
        Choose how the portal looks for you. The change applies instantly and
        follows you to any computer you sign in on.
      </p>
      <p className="text-xs text-text-muted mb-6">
        This sets your own view. Everyone can change theirs from Profile.
      </p>
      <AppearanceControls prefs={prefs} onPatch={patch} />
    </div>
  )
}
