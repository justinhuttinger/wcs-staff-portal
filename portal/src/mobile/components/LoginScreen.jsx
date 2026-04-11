import React, { useState } from 'react'
import { login, getMe, changePassword, resetPassword } from '../../lib/api'

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showForgotPassword, setShowForgotPassword] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMessage, setForgotMessage] = useState('')

  async function handleLogin(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await login(email, password)
      if (data.must_change_password) {
        setMustChangePassword(true)
        setLoading(false)
        return
      }
      const me = await getMe()
      onLogin(me)
    } catch (err) {
      setError(err.message || 'Login failed')
    }
    setLoading(false)
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
      const me = await getMe()
      onLogin(me)
    } catch (err) {
      setError(err.message || 'Failed to change password')
    }
    setLoading(false)
  }

  async function handleForgotPassword(e) {
    e.preventDefault()
    setError('')
    setForgotMessage('')
    if (!forgotEmail) {
      setError('Please enter your email')
      return
    }
    setLoading(true)
    try {
      await resetPassword(forgotEmail)
      setForgotMessage('If an account exists with that email, a reset link has been sent.')
    } catch (err) {
      setError(err.message || 'Failed to send reset email')
    }
    setLoading(false)
  }

  // Forgot password view
  if (showForgotPassword) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <img src="/wcs-logo.png" alt="WCS" className="w-20 h-20 mx-auto mb-2 rounded-full" />
            <p className="text-text-secondary mt-1 text-lg">Reset Password</p>
          </div>

          <form onSubmit={handleForgotPassword} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Email</label>
              <input
                type="email"
                value={forgotEmail}
                onChange={e => setForgotEmail(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red focus:border-transparent text-base"
                style={{ minHeight: '48px' }}
                placeholder="your@email.com"
                autoComplete="email"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            {forgotMessage && (
              <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">
                {forgotMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-wcs-red text-white font-semibold rounded-xl py-4 text-base hover:bg-red-600 active:scale-[0.98] transition-all disabled:opacity-50"
              style={{ minHeight: '48px' }}
            >
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
          </form>

          <button
            onClick={() => { setShowForgotPassword(false); setError(''); setForgotMessage('') }}
            className="mt-6 text-text-muted text-sm w-full text-center"
          >
            Back to login
          </button>
        </div>
      </div>
    )
  }

  // Change password view
  if (mustChangePassword) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-10">
            <img src="/wcs-logo.png" alt="WCS" className="w-20 h-20 mx-auto mb-2 rounded-full" />
            <p className="text-text-secondary mt-1 text-lg">Change Password</p>
            <p className="text-text-muted mt-2 text-sm">You must set a new password before continuing.</p>
          </div>

          <form onSubmit={handleChangePassword} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red focus:border-transparent text-base"
                style={{ minHeight: '48px' }}
                placeholder="Minimum 8 characters"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1.5">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red focus:border-transparent text-base"
                style={{ minHeight: '48px' }}
                placeholder="Re-enter password"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-wcs-red text-white font-semibold rounded-xl py-4 text-base hover:bg-red-600 active:scale-[0.98] transition-all disabled:opacity-50"
              style={{ minHeight: '48px' }}
            >
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  // Main login view
  return (
    <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <img src="/wcs-logo.png" alt="WCS" className="w-24 h-24 mx-auto mb-3 rounded-full" />
          <p className="text-text-secondary mt-1 text-lg">Staff Portal</p>
        </div>

        {/* Login form */}
        <form onSubmit={handleLogin} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red focus:border-transparent text-base"
              style={{ minHeight: '48px' }}
              placeholder="your@email.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-surface border border-border rounded-xl px-4 py-3 pr-12 text-text-primary focus:outline-none focus:ring-2 focus:ring-wcs-red focus:border-transparent text-base"
                style={{ minHeight: '48px' }}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted p-1"
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-wcs-red text-white font-semibold rounded-xl py-4 text-base hover:bg-red-600 active:scale-[0.98] transition-all disabled:opacity-50"
            style={{ minHeight: '48px' }}
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Forgot password */}
        <button
          onClick={() => { setShowForgotPassword(true); setError('') }}
          className="mt-6 text-text-muted text-sm w-full text-center hover:text-text-secondary transition-colors"
        >
          Forgot password?
        </button>
      </div>
    </div>
  )
}
