import { useAppearancePrefs } from '../../lib/useAppearancePrefs'
import AppearanceControls from '../appearance/AppearanceControls'
import SharedBackgroundsAdmin from './SharedBackgroundsAdmin'
import OrgAppearanceDefault from './OrgAppearanceDefault'

export default function AppearanceAdmin() {
  const [prefs, patch] = useAppearancePrefs() // persist + apply to <html> live, stays in step with THEME_EVENT

  return (
    <div className="bg-surface rounded-xl border border-border p-6 max-w-3xl space-y-8">
      <div>
        <p className="text-sm text-text-muted mb-1">
          Choose how the portal looks for you. The change applies instantly and
          follows you to any computer you sign in on. This is the same control
          everyone gets from their own Profile page, and it only ever changes
          your own view.
        </p>
        <p className="text-xs text-text-muted mb-6">
          This sets your own view. Everyone can change theirs from Profile.
        </p>
        <AppearanceControls prefs={prefs} onPatch={patch} />
      </div>

      <div className="pt-8 border-t border-border space-y-8">
        <p className="text-xs text-text-muted -mt-2">
          The two panels below affect other staff, not you.
        </p>
        <SharedBackgroundsAdmin />
        <div className="pt-8 border-t border-border">
          <OrgAppearanceDefault />
        </div>
      </div>
    </div>
  )
}
