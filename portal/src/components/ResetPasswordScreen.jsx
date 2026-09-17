import { useState } from 'react'
import { completePasswordReset } from '../lib/api'

/**
 * Where the emailed reset link lands.
 *
 * Supabase sends people back to the portal with a recovery access token in the
 * URL hash. The portal has no Supabase client of its own, so the token is
 * posted to /auth/reset-password/complete, which verifies it and sets the
 * password with the service role.
 *
 * The token is read once, by App, and handed in — it is stripped from the
 * address bar immediately so it cannot be left in a shared link or in history.
 */
export default function ResetPasswordScreen({ accessToken, linkError, bgImage, onDone }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setError('')
    if (password.length < 8) return setError('Password must be at least 8 characters')
    if (password !== confirm) return setError('Passwords do not match')
    setSaving(true)
    try {
      await completePasswordReset(accessToken, password)
      setDone(true)
    } catch (err) {
      setError(err.message || 'Could not set your password. Request a new link.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg bg-cover bg-center flex items-center justify-center px-4"
      style={bgImage ? { backgroundImage: `url(${bgImage})` } : undefined}>
      <div className="w-full max-w-sm bg-surface rounded-2xl border border-border p-6 shadow-xl">
        <h1 className="text-lg font-bold text-text-primary">Set a new password</h1>
        {!accessToken ? (
          <>
            <p className="text-sm text-text-muted mt-2">
              This reset link is no longer valid{linkError ? ' (' + linkError + ')' : ''}. Reset links
              expire and can only be used once. Ask for a new one on the sign-in screen.
            </p>
            <button onClick={onDone}
              className="mt-4 w-full bg-wcs-red text-white rounded-lg py-2 font-medium">
              Back to sign in
            </button>
          </>
        ) : done ? (
          <>
            <p className="text-sm text-text-muted mt-2">
              Your password is set. Signing in again also signs you out on your other devices.
            </p>
            <button onClick={onDone}
              className="mt-4 w-full bg-wcs-red text-white rounded-lg py-2 font-medium">
              Go to sign in
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="mt-3 space-y-3">
            <p className="text-sm text-text-muted">Choose a password of at least 8 characters.</p>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              placeholder="New password" autoComplete="new-password" autoFocus
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
              placeholder="Confirm password" autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:border-wcs-red" />
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={saving}
              className="w-full bg-wcs-red text-white rounded-lg py-2 font-medium disabled:opacity-50">
              {saving ? 'Saving…' : 'Set password'}
            </button>
            <button type="button" onClick={onDone}
              className="w-full text-xs text-text-muted hover:text-text-primary">
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
