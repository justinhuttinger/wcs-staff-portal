const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { createClient } = require('@supabase/supabase-js')
const rateLimit = require('express-rate-limit')

const router = Router()

// Rate limit login attempts: 10 per 15 minutes per IP
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Rate limit refresh: 100 per 15 min per IP. Active sessions hit this on each
// access-token expiry, so the limit is generous compared to login.
const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many refresh attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

// Rate limit logout: 20 per minute per IP. Logout is a once-per-session op;
// 20/min is generous and prevents log flooding.
const logoutLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many logout attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
})

// POST /auth/kiosk — public, authenticates with shared secret
router.post('/kiosk', loginLimiter, async (req, res) => {
  try {
    const { key } = req.body
    const kioskSecret = process.env.KIOSK_SECRET
    const kioskEmail = process.env.KIOSK_EMAIL
    const kioskPassword = process.env.KIOSK_PASSWORD

    if (!kioskSecret || !kioskEmail || !kioskPassword) {
      return res.status(500).json({ error: 'Kiosk not configured' })
    }
    if (key !== kioskSecret) {
      return res.status(401).json({ error: 'Invalid kiosk key' })
    }

    const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
      email: kioskEmail,
      password: kioskPassword,
    })

    if (authError) {
      return res.status(500).json({ error: 'Kiosk auth failed' })
    }

    const { data: staff } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, first_name, last_name, role')
      .eq('id', authData.user.id)
      .single()

    const { data: staffLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('location_id, is_primary, locations(id, name)')
      .eq('staff_id', authData.user.id)

    const locations = (staffLocs || []).map(sl => ({
      id: sl.locations.id,
      name: sl.locations.name,
      is_primary: sl.is_primary,
    }))

    res.json({
      token: authData.session.access_token,
      refresh_token: authData.session.refresh_token,
      expires_at: authData.session.expires_at,
      staff: { ...(staff || {}), locations },
    })
  } catch (err) {
    console.error('[Auth] Kiosk login error:', err.message)
    res.status(500).json({ error: 'Kiosk login failed' })
  }
})

// POST /auth/login — public
router.post('/login', loginLimiter, async (req, res) => {
  try {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: authData, error: authError } = await anonClient.auth.signInWithPassword({
    email,
    password,
  })

  if (authError) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }

  const { data: staff, error: staffError } = await supabaseAdmin
    .from('staff')
    .select('id, email, display_name, first_name, last_name, role, must_change_password')
    .eq('id', authData.user.id)
    .single()

  if (staffError || !staff) {
    return res.status(401).json({ error: 'Staff account not found' })
  }

  const { data: staffLocs } = await supabaseAdmin
    .from('staff_locations')
    .select('location_id, is_primary, can_sign_in, can_view_reports, locations(id, name)')
    .eq('staff_id', staff.id)

  const locations = (staffLocs || []).map(sl => ({
    id: sl.locations.id,
    name: sl.locations.name,
    is_primary: sl.is_primary,
    can_sign_in: sl.can_sign_in,
    can_view_reports: sl.can_view_reports,
  }))

  // Set SSO session cookie so OIDC authorize can auto-authenticate
  res.cookie('wcs_session', authData.session.access_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days, matches Supabase refresh token lifetime
    path: '/',
  })

  res.json({
    token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
    expires_at: authData.session.expires_at,
    staff: {
      id: staff.id,
      email: staff.email,
      display_name: staff.display_name,
      first_name: staff.first_name,
      last_name: staff.last_name,
      role: staff.role,
      locations,
    },
    must_change_password: staff.must_change_password,
  })
  } catch (err) {
    console.error('[Auth] Login error:', err.message)
    res.status(500).json({ error: 'Login failed' })
  }
})

// POST /auth/change-password — authenticated
router.post('/change-password', authenticate, async (req, res) => {
  const { new_password } = req.body
  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(
    req.staff.id,
    { password: new_password }
  )

  if (updateError) {
    return res.status(500).json({ error: 'Failed to update password' })
  }

  await supabaseAdmin
    .from('staff')
    .update({ must_change_password: false })
    .eq('id', req.staff.id)

  res.json({ message: 'Password updated' })
})

// POST /auth/logout — clears the SSO session cookie and revokes the Supabase
// session so refresh tokens stop working. Best-effort: even if Supabase signout
// fails, the cookie still gets cleared.
router.post('/logout', logoutLimiter, async (req, res) => {
  res.clearCookie('wcs_session', {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/',
  })

  const authHeader = req.headers.authorization
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    try {
      await supabaseAdmin.auth.admin.signOut(token, 'local')
    } catch (err) {
      console.log('[Auth] Supabase signout failed (cookie still cleared):', err.message)
    }
  }

  res.json({ message: 'Logged out' })
})

// POST /auth/refresh — public; exchanges a refresh token for a new access token
router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    const { refresh_token } = req.body
    if (!refresh_token) {
      return res.status(400).json({ error: 'refresh_token required' })
    }

    const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { data, error } = await anonClient.auth.refreshSession({ refresh_token })

    if (error || !data?.session) {
      return res.status(401).json({ error: 'Invalid refresh token' })
    }

    res.cookie('wcs_session', data.session.access_token, {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: '/',
    })

    res.json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    })
  } catch (err) {
    console.error('[Auth] Refresh error:', err.message)
    res.status(500).json({ error: 'Refresh failed' })
  }
})

// POST /auth/reset-password — public
router.post('/reset-password', async (req, res) => {
  try {
    const { email } = req.body
    if (!email) {
      return res.status(400).json({ error: 'Email is required' })
    }

    const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email)
    if (error) {
      return res.status(500).json({ error: 'Failed to send reset email' })
    }

    res.json({ message: 'Password reset email sent' })
  } catch (err) {
    console.error('[Auth] Reset password error:', err.message)
    res.status(500).json({ error: 'Failed to send reset email' })
  }
})

// GET /auth/me — authenticated
router.get('/me', authenticate, async (req, res) => {
  const { data: staffLocs } = await supabaseAdmin
    .from('staff_locations')
    .select('location_id, is_primary, can_sign_in, can_view_reports, locations(id, name, abc_url, booking_url, vip_survey_url)')
    .eq('staff_id', req.staff.id)

  const locations = (staffLocs || []).map(sl => ({
    ...sl.locations,
    is_primary: sl.is_primary,
    can_sign_in: sl.can_sign_in,
    can_view_reports: sl.can_view_reports,
  }))

  const { data: visibility } = await supabaseAdmin
    .from('role_tool_visibility')
    .select('tool_key')
    .eq('role', req.staff.role)
    .eq('visible', true)

  const visible_tools = (visibility || []).map(v => v.tool_key)

  res.json({
    staff: {
      id: req.staff.id,
      email: req.staff.email,
      display_name: req.staff.display_name,
      first_name: req.staff.first_name,
      last_name: req.staff.last_name,
      role: req.staff.role,
      locations,
    },
    visible_tools,
  })
})

module.exports = router
