const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()

router.use(authenticate)

// GET /admin/staff — manager+ (returns staff at caller's locations)
router.get('/staff', requireRole('manager'), async (req, res) => {
  try {
    const { data: locStaff } = await supabaseAdmin
      .from('staff_locations')
      .select('staff_id')
      .in('location_id', req.staff.location_ids)

    const staffIds = [...new Set((locStaff || []).map(ls => ls.staff_id))]

    if (staffIds.length === 0) return res.json({ staff: [] })

    const { data: staffList } = await supabaseAdmin
      .from('staff')
      .select('id, email, display_name, first_name, last_name, role, must_change_password, created_at')
      .in('id', staffIds)
      .order('display_name')

    const { data: allLocs } = await supabaseAdmin
      .from('staff_locations')
      .select('staff_id, location_id, is_primary, locations(id, name)')
      .in('staff_id', staffIds)

    const staffWithLocs = (staffList || []).map(s => ({
      ...s,
      locations: (allLocs || [])
        .filter(sl => sl.staff_id === s.id)
        .map(sl => ({ id: sl.locations.id, name: sl.locations.name, is_primary: sl.is_primary })),
    }))

    res.json({ staff: staffWithLocs })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff' })
  }
})

// POST /admin/staff — director+
router.post('/staff', requireRole('director'), async (req, res) => {
  const { email, display_name, first_name, last_name, role, location_ids, temp_password } = req.body

  if (!email || !role || !location_ids?.length || !temp_password) {
    return res.status(400).json({ error: 'email, role, location_ids, and temp_password are required' })
  }

  try {
    const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: temp_password,
      email_confirm: true,
    })

    if (authError) {
      return res.status(400).json({ error: authError.message })
    }

    const { error: staffError } = await supabaseAdmin.from('staff').insert({
      id: authUser.user.id,
      email,
      display_name: display_name || ((first_name || '') + ' ' + (last_name || '')).trim(),
      first_name: first_name || null,
      last_name: last_name || null,
      role,
      must_change_password: true,
    })

    if (staffError) {
      await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
      return res.status(500).json({ error: 'Failed to create staff record' })
    }

    const assignments = location_ids.map((locId, i) => ({
      staff_id: authUser.user.id,
      location_id: locId,
      is_primary: i === 0,
    }))

    const { error: assignError } = await supabaseAdmin.from('staff_locations').insert(assignments)
    if (assignError) {
      return res.status(500).json({ error: 'Staff created but location assignment failed' })
    }

    res.status(201).json({
      staff: {
        id: authUser.user.id,
        email,
        display_name,
        role,
        must_change_password: true,
      },
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create staff' })
  }
})

// PUT /admin/staff/:id — director+
router.put('/staff/:id', requireRole('director'), async (req, res) => {
  const { role, location_ids, display_name, first_name, last_name, email, temp_password } = req.body
  const staffId = req.params.id

  try {
    // Update auth user (email and/or password)
    const authUpdates = {}
    if (email) authUpdates.email = email
    if (temp_password) authUpdates.password = temp_password
    if (Object.keys(authUpdates).length > 0) {
      const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(staffId, authUpdates)
      if (authError) return res.status(500).json({ error: 'Failed to update auth: ' + authError.message })
    }

    const updates = {}
    if (email) updates.email = email
    if (role) updates.role = role
    if (first_name !== undefined) updates.first_name = first_name
    if (last_name !== undefined) updates.last_name = last_name
    if (first_name !== undefined || last_name !== undefined || display_name) {
      updates.display_name = display_name || ((first_name || '') + ' ' + (last_name || '')).trim()
    }

    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin.from('staff').update(updates).eq('id', staffId)
      if (error) return res.status(500).json({ error: 'Failed to update staff' })
    }

    if (location_ids) {
      await supabaseAdmin.from('staff_locations').delete().eq('staff_id', staffId)

      const assignments = location_ids.map((locId, i) => ({
        staff_id: staffId,
        location_id: locId,
        is_primary: i === 0,
      }))
      const { error } = await supabaseAdmin.from('staff_locations').insert(assignments)
      if (error) return res.status(500).json({ error: 'Failed to update location assignments' })
    }

    res.json({ message: 'Staff updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update staff' })
  }
})

// DELETE /admin/staff/:id — admin only
router.delete('/staff/:id', requireRole('admin'), async (req, res) => {
  const staffId = req.params.id

  try {
    const { error: staffError } = await supabaseAdmin.from('staff').delete().eq('id', staffId)
    if (staffError) return res.status(500).json({ error: 'Failed to delete staff record' })

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(staffId)
    if (authError) return res.status(500).json({ error: 'Staff record deleted but auth user removal failed' })

    res.json({ message: 'Staff deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete staff' })
  }
})

module.exports = router
