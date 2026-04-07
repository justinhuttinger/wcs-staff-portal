import { useState } from 'react'
import { login, changePassword } from '../lib/api'

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  // Change password state
  const [mustChange, setMustChange] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [staffData, setStaffData] = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const data = await login(email, password)
      if (data.must_change_password) {
        setMustChange(true)
        setStaffData(data)
      } else {
        onLogin(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    setLoading(true)
    try {
      await changePassword(newPassword)
      onLogin({ ...staffData, must_change_password: false })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (mustChange) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="bg-surface rounded-2xl border border-border p-8 w-full max-w-sm">
          <h1 className="text-xl font-bold text-text-primary mb-1">Change Password</h1>
          <p className="text-sm text-text-muted mb-6">You must set a new password before continuing.</p>

          <form onSubmit={handleChangePassword} className="flex flex-col gap-4">
            <input
              type="password"
              placeholder="New password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
              autoFocus
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            />
            {error && <p className="text-sm text-wcs-red">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold text-sm hover:bg-wcs-red-hover transition-colors disabled:opacity-50"
            >
              {loading ? 'Updating...' : 'Set Password'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center">
      <div className="bg-surface rounded-2xl border border-border p-8 w-full max-w-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black text-text-primary">
            <span className="bg-gradient-to-r from-wcs-red to-[#fc8181] bg-clip-text text-transparent">WCS</span>
            {' '}Staff Portal
          </h1>
          <p className="text-sm text-text-muted mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
            autoFocus
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg border border-border bg-bg text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-wcs-red"
          />
          {error && <p className="text-sm text-wcs-red">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-lg bg-wcs-red text-white font-semibold text-sm hover:bg-wcs-red-hover transition-colors disabled:opacity-50"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  )
}
