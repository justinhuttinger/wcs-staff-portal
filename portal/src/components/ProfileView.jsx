import { useState } from 'react'
import { useAppearancePrefs } from '../lib/useAppearancePrefs'
import AppearanceControls from './appearance/AppearanceControls'
import BackgroundPicker from './appearance/BackgroundPicker'
import { getBackgroundPrefs, setBackgroundPrefs } from '../lib/theme'

/**
 * Everyone's own appearance settings. Unlike the admin panel's copy of these
 * controls, this page carries no role gate at all: it changes nothing but how
 * the portal looks to the person reading it.
 *
 * Changes apply the moment they are clicked (setPrefs writes the data-*
 * attributes onto <html> synchronously) and are pushed to the server by the
 * debounced listener in lib/uiPrefs.js. There is no Save button, on purpose.
 */
export default function ProfileView({ user, onBackgroundUrlChange }) {
  const [prefs, patch] = useAppearancePrefs()
  const [bg, setBg] = useState(getBackgroundPrefs)
  const patchBg = (p) => setBg(setBackgroundPrefs(p))

  const name = user?.staff?.display_name || user?.staff?.email || ''

  // Press paints a white ground and drops the photo (see App.jsx shellBg), so
  // the control would do nothing there. The pref is still stored, so switching
  // back to another theme restores whatever was chosen.
  const themePaintsBackground = prefs.theme !== 'press'

  return (
    <div className="max-w-3xl mx-auto w-full px-6 py-6 space-y-6">
      <div>
        <h2 className="text-xl font-black text-text-primary">Profile</h2>
        <p className="text-sm text-text-muted mt-1">
          {name ? `Signed in as ${name}. ` : ''}
          These settings are yours alone and follow you to any computer you sign in on.
        </p>
      </div>

      <section className="bg-surface rounded-xl border border-border p-6">
        <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-4">Appearance</h3>
        <AppearanceControls prefs={prefs} onPatch={patch} />
      </section>

      {themePaintsBackground ? (
        <section className="bg-surface rounded-xl border border-border p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-4">Background</h3>
          <BackgroundPicker
            background={bg.background}
            backgroundDim={bg.backgroundDim}
            onPatch={patchBg}
            onBackgroundUrlChange={onBackgroundUrlChange}
            locationLabel={user?.staff?.locations?.find(l => l.is_primary)?.name}
          />
        </section>
      ) : (
        <section className="bg-surface rounded-xl border border-border p-6">
          <h3 className="text-sm font-bold uppercase tracking-wide text-text-muted mb-2">Background</h3>
          <p className="text-sm text-text-muted">
            The Press theme uses a plain white background. Switch to another theme to choose a photo.
          </p>
        </section>
      )}
    </div>
  )
}
