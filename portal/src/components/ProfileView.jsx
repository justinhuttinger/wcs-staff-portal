import { useState } from 'react'
import { getPrefs, setPrefs } from '../lib/theme'
import AppearanceControls from './appearance/AppearanceControls'

/**
 * Everyone's own appearance settings. Unlike the admin panel's copy of these
 * controls, this page carries no role gate at all: it changes nothing but how
 * the portal looks to the person reading it.
 *
 * Changes apply the moment they are clicked (setPrefs writes the data-*
 * attributes onto <html> synchronously) and are pushed to the server by the
 * debounced listener in lib/uiPrefs.js. There is no Save button, on purpose.
 */
export default function ProfileView({ user }) {
  const [prefs, setLocalPrefs] = useState(getPrefs)
  const patch = (p) => setLocalPrefs(setPrefs(p))

  const name = user?.staff?.display_name || user?.staff?.email || ''

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
    </div>
  )
}
