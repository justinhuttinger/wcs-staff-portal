const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')

const router = Router()

router.use(authenticate)

// GET /admin/staff — manager+ (returns staff at caller's locations)
router.get('/staff', requireRole('manager'), async (req, res) => {
  try {
    if (!req.staff.location_ids.length) return res.json({ staff: [] })

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
      .select('staff_id, location_id, is_primary, can_sign_in, can_view_reports, locations(id, name)')
      .in('staff_id', staffIds)

    const staffWithLocs = (staffList || []).map(s => ({
      ...s,
      locations: (allLocs || [])
        .filter(sl => sl.staff_id === s.id)
        .map(sl => ({
          id: sl.locations.id,
          name: sl.locations.name,
          is_primary: sl.is_primary,
          can_sign_in: sl.can_sign_in,
          can_view_reports: sl.can_view_reports,
        })),
    }))

    res.json({ staff: staffWithLocs })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch staff' })
  }
})

// POST /admin/staff — director+
router.post('/staff', requireRole('admin'), async (req, res) => {
  const { email, display_name, first_name, last_name, role, location_ids, temp_password } = req.body

  if (!email || !role || !location_ids?.length || !temp_password) {
    return res.status(400).json({ error: 'email, role, location_ids, and temp_password are required' })
  }

  // Validate role exists and prevent privilege escalation
  if (!ROLE_HIERARCHY.includes(role)) {
    return res.status(400).json({ error: 'Invalid role. Must be one of: ' + ROLE_HIERARCHY.join(', ') })
  }
  const callerLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
  const requestedLevel = ROLE_HIERARCHY.indexOf(role)
  if (requestedLevel > callerLevel) {
    return res.status(403).json({ error: 'Cannot assign a role higher than your own' })
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

    const assignments = location_ids.map((locId, i) => {
      const perms = (req.body.location_permissions || {})[locId] || {}
      return {
        staff_id: authUser.user.id,
        location_id: locId,
        is_primary: i === 0,
        can_sign_in: perms.can_sign_in !== false,
        can_view_reports: perms.can_view_reports !== false,
      }
    })

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
router.put('/staff/:id', requireRole('admin'), async (req, res) => {
  const { role, location_ids, display_name, first_name, last_name, email, temp_password } = req.body
  const staffId = req.params.id

  // Validate role if being changed
  if (role) {
    if (!ROLE_HIERARCHY.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be one of: ' + ROLE_HIERARCHY.join(', ') })
    }
    const callerLevel = ROLE_HIERARCHY.indexOf(req.staff.role)
    if (ROLE_HIERARCHY.indexOf(role) > callerLevel) {
      return res.status(403).json({ error: 'Cannot assign a role higher than your own' })
    }
  }

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

      const assignments = location_ids.map((locId, i) => {
        const perms = (req.body.location_permissions || {})[locId] || {}
        return {
          staff_id: staffId,
          location_id: locId,
          is_primary: i === 0,
          can_sign_in: perms.can_sign_in !== false,
          can_view_reports: perms.can_view_reports !== false,
        }
      })
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

  if (staffId === req.staff.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' })
  }

  try {
    // Delete in order: junction table first, then staff record, then auth user
    await supabaseAdmin.from('staff_locations').delete().eq('staff_id', staffId)

    const { error: staffError } = await supabaseAdmin.from('staff').delete().eq('id', staffId)
    if (staffError) return res.status(500).json({ error: 'Failed to delete staff record' })

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(staffId)
    if (authError) return res.status(500).json({ error: 'Staff record deleted but auth user removal failed' })

    res.json({ message: 'Staff deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete staff' })
  }
})

// GET /admin/webhook-logs — manager+ (webhook send history)
router.get('/webhook-logs', requireRole('admin'), async (req, res) => {
  try {
    const { location_slug, status, start_date, end_date } = req.query
    const page = Math.max(1, parseInt(req.query.page, 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25))
    const offset = (page - 1) * limit

    let query = supabaseAdmin
      .from('ghl_dayone_webhooks')
      .select('*', { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (location_slug) query = query.eq('payload->>locationSlug', location_slug)
    if (status) query = query.eq('status', status)
    if (start_date) query = query.gte('sent_at', start_date + 'T00:00:00Z')
    if (end_date) query = query.lte('sent_at', end_date + 'T23:59:59Z')

    const { data, count, error } = await query
    if (error) throw error

    res.json({ logs: data || [], total: count || 0 })
  } catch (err) {
    console.error('[Admin] webhook-logs error:', err.message)
    res.status(500).json({ error: 'Failed to fetch webhook logs' })
  }
})

// GET /admin/staff/template — director+ (download Excel template)
router.get('/staff/template', requireRole('admin'), async (req, res) => {
  const XLSX = require('xlsx')

  try {
    const { data: locations } = await supabaseAdmin.from('locations').select('name')
    const locationNames = (locations || []).map(l => l.name).join(', ')

    const wb = XLSX.utils.book_new()

    const headers = ['first_name', 'last_name', 'email', 'role', 'locations', 'temporary_password']
    const example = ['Jane', 'Doe', 'jane@wcstrength.com', 'front_desk', 'Salem, Keizer', 'changeme123']
    const ws = XLSX.utils.aoa_to_sheet([headers, example])
    ws['!cols'] = [{ wch: 15 }, { wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 40 }, { wch: 20 }]

    const instrWs = XLSX.utils.aoa_to_sheet([
      ['WCS Staff Import Template — Instructions'],
      [],
      ['Column', 'Required', 'Description'],
      ['first_name', 'Yes', 'Staff member first name'],
      ['last_name', 'Yes', 'Staff member last name'],
      ['email', 'Yes', 'Unique email address'],
      ['role', 'Yes', 'One of: front_desk, personal_trainer, lead, manager, director, admin'],
      ['locations', 'Yes', 'Comma-separated location names: ' + locationNames],
      ['temporary_password', 'Yes', 'Initial password (staff must change on first login)'],
      [],
      ['Available Locations: ' + locationNames],
      ['Available Roles: front_desk, personal_trainer, lead, manager, director, admin'],
    ])
    instrWs['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 70 }]

    XLSX.utils.book_append_sheet(wb, ws, 'Staff')
    XLSX.utils.book_append_sheet(wb, instrWs, 'Instructions')

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })

    res.setHeader('Content-Disposition', 'attachment; filename="wcs-staff-import-template.xlsx"')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.send(buf)
  } catch (err) {
    console.error('[Admin] template error:', err.message)
    res.status(500).json({ error: 'Failed to generate template' })
  }
})

// POST /admin/staff/import — director+ (bulk import from Excel)
router.post('/staff/import', requireRole('admin'), async (req, res) => {
  const XLSX = require('xlsx')
  const VALID_ROLES = ['front_desk', 'personal_trainer', 'lead', 'manager', 'director', 'admin']

  try {
    const wb = XLSX.read(req.body, { type: 'buffer' })
    const sheet = wb.Sheets[wb.SheetNames[0]]
    if (!sheet) return res.status(400).json({ error: 'No sheets found in workbook' })

    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
    if (!rows.length) return res.status(400).json({ error: 'No data rows found' })

    // Fetch locations for validation
    const { data: dbLocations } = await supabaseAdmin.from('locations').select('id, name')
    const locMap = {}
    for (const loc of (dbLocations || [])) {
      locMap[loc.name.toLowerCase().trim()] = loc.id
    }

    // Validate all rows
    const errors = []
    const parsed = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const rowErrors = []

      const firstName = (row.first_name || '').toString().trim()
      const lastName = (row.last_name || '').toString().trim()
      const email = (row.email || '').toString().trim().toLowerCase()
      const role = (row.role || '').toString().trim().toLowerCase()
      const locationsStr = (row.locations || '').toString().trim()
      const tempPassword = (row.temporary_password || '').toString().trim()

      if (!firstName) rowErrors.push('first_name is required')
      if (!lastName) rowErrors.push('last_name is required')
      if (!email) rowErrors.push('email is required')
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rowErrors.push('invalid email format')
      if (!role) rowErrors.push('role is required')
      else if (!VALID_ROLES.includes(role)) rowErrors.push('invalid role: ' + role)
      if (!locationsStr) rowErrors.push('locations is required')
      if (!tempPassword) rowErrors.push('temporary_password is required')
      else if (tempPassword.length < 8) rowErrors.push('password must be at least 8 characters')

      const locationIds = []
      if (locationsStr) {
        const locNames = locationsStr.split(',').map(s => s.trim().toLowerCase())
        for (const name of locNames) {
          if (locMap[name]) {
            locationIds.push(locMap[name])
          } else if (name) {
            rowErrors.push('unknown location: ' + name)
          }
        }
        if (locNames.length > 0 && locationIds.length === 0 && !rowErrors.some(e => e.includes('locations is required'))) {
          rowErrors.push('no valid locations found')
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: rowNum, errors: rowErrors })
      } else {
        parsed.push({ firstName, lastName, email, role, locationIds, tempPassword })
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed for ' + errors.length + ' row(s)',
        row_errors: errors,
        valid_count: parsed.length,
        total_count: rows.length,
      })
    }

    // Check for duplicate emails within the file
    const emailSet = new Set()
    for (const p of parsed) {
      if (emailSet.has(p.email)) {
        return res.status(400).json({ error: 'Duplicate email in file: ' + p.email })
      }
      emailSet.add(p.email)
    }

    // Import all valid rows
    const results = { created: 0, failed: 0, failures: [] }

    for (const staff of parsed) {
      try {
        const { data: authUser, error: authError } = await supabaseAdmin.auth.admin.createUser({
          email: staff.email,
          password: staff.tempPassword,
          email_confirm: true,
        })

        if (authError) {
          results.failed++
          results.failures.push({ email: staff.email, error: authError.message })
          continue
        }

        const { error: staffError } = await supabaseAdmin.from('staff').insert({
          id: authUser.user.id,
          email: staff.email,
          display_name: (staff.firstName + ' ' + staff.lastName).trim(),
          first_name: staff.firstName,
          last_name: staff.lastName,
          role: staff.role,
          must_change_password: true,
        })

        if (staffError) {
          await supabaseAdmin.auth.admin.deleteUser(authUser.user.id)
          results.failed++
          results.failures.push({ email: staff.email, error: 'Failed to create staff record' })
          continue
        }

        const assignments = staff.locationIds.map((locId, i) => ({
          staff_id: authUser.user.id,
          location_id: locId,
          is_primary: i === 0,
        }))

        const { error: locError } = await supabaseAdmin.from('staff_locations').insert(assignments)
        if (locError) {
          results.failed++
          results.failures.push({ email: staff.email, error: 'Created but location assignment failed' })
          continue
        }

        results.created++
      } catch (err) {
        results.failed++
        results.failures.push({ email: staff.email, error: err.message })
      }
    }

    res.json({
      message: results.created + ' staff imported, ' + results.failed + ' failed',
      created: results.created,
      failed: results.failed,
      failures: results.failures,
    })
  } catch (err) {
    console.error('[Admin] import error:', err.message)
    res.status(500).json({ error: 'Failed to process import file' })
  }
})

module.exports = router
