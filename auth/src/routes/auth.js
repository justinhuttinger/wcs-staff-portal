const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { createClient } = require('@supabase/supabase-js')

const router = Router()

// POST /auth/kiosk — public, authenticates with shared secret
router.post('/kiosk', async (req, res) => {
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

  // Login as the kiosk service account
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
    staff: { ...(staff || {}), locations },
  })
})

// POST /auth/login — public
router.post('/login', async (req, res) => {
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
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
  })

  res.json({
    token: authData.session.access_token,
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

// POST /auth/reset-password — public
router.post('/reset-password', async (req, res) => {
  const { email } = req.body
  if (!email) {
    return res.status(400).json({ error: 'Email is required' })
  }

  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email)
  if (error) {
    return res.status(500).json({ error: 'Failed to send reset email' })
  }

  res.json({ message: 'Password reset email sent' })
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
