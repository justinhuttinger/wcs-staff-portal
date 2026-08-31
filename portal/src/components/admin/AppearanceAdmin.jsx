import { useAppearancePrefs } from '../../lib/useAppearancePrefs'
import AppearanceControls from '../appearance/AppearanceControls'

export default function AppearanceAdmin() {
  const [prefs, patch] = useAppearancePrefs() // persist + apply to <html> live, stays in step with THEME_EVENT

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
