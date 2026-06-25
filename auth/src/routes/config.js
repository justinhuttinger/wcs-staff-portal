const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, refreshCustomRoleTiers } = require('../middleware/role')
const { validateRoleName, buildPermissionGrid, TIERS } = require('../services/rolesAdmin')

const router = Router()

router.use(authenticate)

// GET /config/locations
router.get('/locations', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('locations')
      .select('id, name, abc_url, booking_url, vip_survey_url')
      .order('name')

    if (error) return res.status(500).json({ error: 'Failed to fetch locations' })
    res.json({ locations: data })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch locations' })
  }
})

// PUT /config/locations/:id — admin only
router.put('/locations/:id', requireRole('admin'), async (req, res) => {
  try {
    const { abc_url, booking_url, vip_survey_url } = req.body
    const updates = {}
    if (abc_url !== undefined) updates.abc_url = abc_url
    if (booking_url !== undefined) updates.booking_url = booking_url
    if (vip_survey_url !== undefined) updates.vip_survey_url = vip_survey_url

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    const { data, error } = await supabaseAdmin
      .from('locations')
      .update(updates)
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return res.status(500).json({ error: 'Failed to update location' })
    res.json({ location: data })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update location' })
  }
})

// GET /config/tools — returns tools filtered by caller's role
router.get('/tools', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('role_tool_visibility')
      .select('tool_key, visible')
      .eq('role', req.staff.role)

    if (error) return res.status(500).json({ error: 'Failed to fetch tool visibility' })

    const visible_tools = (data || []).filter(t => t.visible).map(t => t.tool_key)
    res.json({ visible_tools })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tool visibility' })
  }
})

// GET /config/tiles?location_id=xxx
router.get('/tiles', async (req, res) => {
  try {
    if (req.query.location_id) {
      // Get tiles for a specific location (used by ToolGrid)
      const { data: tileLinks } = await supabaseAdmin
        .from('tile_locations')
        .select('tile_id')
        .eq('location_id', req.query.location_id)

      const tileIds = (tileLinks || []).map(tl => tl.tile_id)
      if (tileIds.length === 0) return res.json({ tiles: [] })

      const { data, error } = await supabaseAdmin
        .from('custom_tiles')
        .select('id, label, description, url, icon, parent_id, sort_order, section, created_by, created_at')
        .in('id', tileIds)
        .order('sort_order').order('label')

      if (error) return res.status(500).json({ error: 'Failed to fetch tiles' })
      return res.json({ tiles: data })
    }

    // Admin view — get all tiles with their locations
    const { data: tiles, error } = await supabaseAdmin
      .from('custom_tiles')
      .select('id, label, description, url, icon, parent_id, sort_order, section, created_by, created_at')
      .order('sort_order').order('label')

    if (error) return res.status(500).json({ error: 'Failed to fetch tiles' })

    // Attach locations to each tile
    const { data: allLinks } = await supabaseAdmin
      .from('tile_locations')
      .select('tile_id, location_id, locations(id, name)')

    const tilesWithLocations = (tiles || []).map(t => ({
      ...t,
      locations: (allLinks || [])
        .filter(tl => tl.tile_id === t.id)
        .map(tl => ({ id: tl.locations.id, name: tl.locations.name })),
    }))

    res.json({ tiles: tilesWithLocations })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tiles' })
  }
})

// POST /config/tiles — admin only
router.post('/tiles', requireRole('admin'), async (req, res) => {
  const { label, description, url, icon, parent_id, location_ids, sort_order, section } = req.body
  if (!label) {
    return res.status(400).json({ error: 'label is required' })
  }

  try {
    const { data: tile, error } = await supabaseAdmin
      .from('custom_tiles')
      .insert({ label, description, url, icon, created_by: req.staff.id, parent_id: parent_id || null, sort_order: sort_order || 0, section: section || 'management' })
      .select()
      .single()

    if (error) return res.status(500).json({ error: 'Failed to create tile' })

    // Link to locations
    if (location_ids && location_ids.length > 0) {
      const links = location_ids.map(lid => ({ tile_id: tile.id, location_id: lid }))
      await supabaseAdmin.from('tile_locations').insert(links)
    }

    // Auto-create role_tool_visibility rows for this tile (all roles, visible by default)
    const ROLES = ['team_member', 'lead', 'manager', 'marketing', 'corporate', 'admin']
    const visRows = ROLES.map(role => ({ role, tool_key: 'tile:' + tile.id, visible: true }))
    await supabaseAdmin.from('role_tool_visibility').upsert(visRows, { onConflict: 'role,tool_key' })

    res.status(201).json({ tile })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create tile' })
  }
})

// PUT /config/tiles/:id — admin only
router.put('/tiles/:id', requireRole('admin'), async (req, res) => {
  const { label, description, url, icon, parent_id, location_ids, sort_order, section } = req.body
  const updates = {}
  if (label !== undefined) updates.label = label
  if (description !== undefined) updates.description = description
  if (url !== undefined) updates.url = url
  if (icon !== undefined) updates.icon = icon
  if (parent_id !== undefined) updates.parent_id = parent_id
  if (sort_order !== undefined) updates.sort_order = sort_order
  if (section !== undefined) updates.section = section

  try {
    if (Object.keys(updates).length > 0) {
      const { error } = await supabaseAdmin
        .from('custom_tiles')
        .update(updates)
        .eq('id', req.params.id)

      if (error) return res.status(500).json({ error: 'Failed to update tile' })
    }

    // Update location assignments if provided
    if (location_ids) {
      await supabaseAdmin.from('tile_locations').delete().eq('tile_id', req.params.id)
      if (location_ids.length > 0) {
        const links = location_ids.map(lid => ({ tile_id: req.params.id, location_id: lid }))
        await supabaseAdmin.from('tile_locations').insert(links)
      }
    }

    res.json({ message: 'Tile updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tile' })
  }
})

// DELETE /config/tiles/:id — admin only
router.delete('/tiles/:id', requireRole('admin'), async (req, res) => {
  try {
    // Clean up junction tables first
    await supabaseAdmin.from('tile_locations').delete().eq('tile_id', req.params.id)
    await supabaseAdmin.from('role_tool_visibility').delete().eq('tool_key', 'tile:' + req.params.id)

    const { error } = await supabaseAdmin
      .from('custom_tiles')
      .delete()
      .eq('id', req.params.id)

    if (error) return res.status(500).json({ error: 'Failed to delete tile' })
    res.json({ message: 'Tile deleted' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete tile' })
  }
})

// GET /config/role-visibility — admin only, returns all role/tool visibility settings
router.get('/role-visibility', requireRole('admin'), async (req, res) => {
  try {
    // Get existing visibility rows
    const { data: visibility, error } = await supabaseAdmin
      .from('role_tool_visibility')
      .select('id, role, tool_key, visible')
      .order('role')

    if (error) return res.status(500).json({ error: 'Failed to fetch role visibility' })

    // Get all custom tiles to ensure they have visibility rows
    const { data: tiles } = await supabaseAdmin
      .from('custom_tiles')
      .select('id, label, icon, parent_id')
      .order('label')

    // Auto-create missing visibility rows for tiles
    const ROLES = ['team_member', 'lead', 'manager', 'marketing', 'corporate', 'admin']
    const missing = []
    for (const tile of (tiles || [])) {
      const tileKey = 'tile:' + tile.id
      for (const role of ROLES) {
        if (!visibility.find(v => v.role === role && v.tool_key === tileKey)) {
          missing.push({ role, tool_key: tileKey, visible: true })
        }
      }
    }
    if (missing.length > 0) {
      await supabaseAdmin.from('role_tool_visibility').insert(missing)
    }

    // Re-fetch with any new rows
    const { data: allVisibility } = await supabaseAdmin
      .from('role_tool_visibility')
      .select('id, role, tool_key, visible')
      .order('tool_key')

    // Attach tile metadata for the frontend
    const tileMap = {}
    for (const tile of (tiles || [])) {
      tileMap['tile:' + tile.id] = { label: tile.label, icon: tile.icon, parent_id: tile.parent_id }
    }

    res.json({ visibility: allVisibility, tile_labels: tileMap })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch role visibility' })
  }
})

// PUT /config/role-visibility — admin only, batch update visibility
router.put('/role-visibility', requireRole('admin'), async (req, res) => {
  const { updates } = req.body
  if (!updates || !Array.isArray(updates)) {
    return res.status(400).json({ error: 'updates array is required' })
  }

  try {
    const rows = updates.map(({ role, tool_key, visible }) => ({ role, tool_key, visible }))
    const { error } = await supabaseAdmin
      .from('role_tool_visibility')
      .upsert(rows, { onConflict: 'role,tool_key' })
    if (error) return res.status(500).json({ error: 'Failed to update visibility' })
    res.json({ message: 'Visibility updated' })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update visibility' })
  }
})

// --- RBAC v2: custom roles manager ---

// GET /config/roles — admin: all roles, the permission grid (catalog + tiles),
// current per-role visibility, and the RBAC v2 flag.
router.get('/roles', requireRole('admin'), async (req, res) => {
  try {
    const [{ data: roles }, { data: catalog }, { data: tiles }, { data: visibility }] = await Promise.all([
      supabaseAdmin.from('roles').select('id, name, base_tier, is_builtin').order('is_builtin', { ascending: false }).order('name'),
      supabaseAdmin.from('permission_catalog').select('perm_key, label, category, min_tier'),
      supabaseAdmin.from('custom_tiles').select('id, label'),
      supabaseAdmin.from('role_tool_visibility').select('role, tool_key, visible'),
    ])
    const tileLabels = {}
    for (const t of (tiles || [])) tileLabels['tile:' + t.id] = { label: t.label }
    const { data: staffRows } = await supabaseAdmin.from('staff').select('role')
    const counts = {}
    for (const s of (staffRows || [])) counts[s.role] = (counts[s.role] || 0) + 1
    const rolesOut = (roles || []).map(r => ({ ...r, assigned_count: counts[r.name] || 0 }))
    res.json({
      rbac_v2_enabled: process.env.RBAC_V2_ENABLED === 'true',
      roles: rolesOut,
      grid: buildPermissionGrid(catalog || [], tileLabels),
      visibility: visibility || [],
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load roles' })
  }
})

// POST /config/roles — admin: create a named role anchored to a base tier.
router.post('/roles', requireRole('admin'), async (req, res) => {
  const { name, base_tier } = req.body || {}
  if (!TIERS.includes(base_tier)) return res.status(400).json({ error: 'Invalid base tier' })
  try {
    const { data: existing } = await supabaseAdmin.from('roles').select('name')
    const v = validateRoleName(name, (existing || []).map(r => r.name))
    if (!v.ok) return res.status(400).json({ error: v.error })
    const { data: role, error } = await supabaseAdmin
      .from('roles').insert({ name: name.trim(), base_tier, is_builtin: false }).select('id, name, base_tier, is_builtin').single()
    if (error) return res.status(500).json({ error: 'Failed to create role' })
    // Seed the new role's toggles from its base tier so it starts sensible.
    const { data: baseRows } = await supabaseAdmin
      .from('role_tool_visibility').select('tool_key, visible').eq('role', base_tier)
    if (baseRows && baseRows.length) {
      await supabaseAdmin.from('role_tool_visibility')
        .upsert(baseRows.map(r => ({ role: role.name, tool_key: r.tool_key, visible: r.visible })), { onConflict: 'role,tool_key' })
    }
    // Make the new role resolvable by the synchronous auth gates immediately.
    await refreshCustomRoleTiers().catch(() => {})
    res.status(201).json({ role })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create role' })
  }
})

// PATCH /config/roles/:id — admin: rename a non-builtin role; cascade the new
// name to its visibility rows and any staff assigned to it.
router.patch('/roles/:id', requireRole('admin'), async (req, res) => {
  const { name } = req.body || {}
  try {
    const { data: role } = await supabaseAdmin.from('roles').select('id, name, is_builtin').eq('id', req.params.id).single()
    if (!role) return res.status(404).json({ error: 'Role not found' })
    if (role.is_builtin) return res.status(400).json({ error: 'Built-in roles cannot be renamed' })
    const { data: existing } = await supabaseAdmin.from('roles').select('name').neq('id', req.params.id)
    const v = validateRoleName(name, (existing || []).map(r => r.name))
    if (!v.ok) return res.status(400).json({ error: v.error })
    const newName = name.trim()
    // Atomic rename: the roles row plus the cascade to role_tool_visibility and
    // staff all happen in one transaction (rename_role RPC), so a partial
    // failure can't strand assigned staff on the old name while we return 200.
    const { data: updated, error } = await supabaseAdmin
      .rpc('rename_role', { p_id: req.params.id, p_new_name: newName })
    if (error) return res.status(500).json({ error: 'Failed to rename role' })
    // The role name changed; refresh the sync gate map (and any assigned staff
    // now carry the new name via the rename_role cascade).
    await refreshCustomRoleTiers().catch(() => {})
    res.json({ role: Array.isArray(updated) ? updated[0] : updated })
  } catch (err) {
    res.status(500).json({ error: 'Failed to rename role' })
  }
})

// DELETE /config/roles/:id — admin: delete a non-builtin role with no members.
router.delete('/roles/:id', requireRole('admin'), async (req, res) => {
  try {
    const { data: role } = await supabaseAdmin.from('roles').select('id, name, is_builtin').eq('id', req.params.id).single()
    if (!role) return res.status(404).json({ error: 'Role not found' })
    if (role.is_builtin) return res.status(400).json({ error: 'Built-in roles cannot be deleted' })
    const { count } = await supabaseAdmin.from('staff').select('id', { count: 'exact', head: true }).eq('role', role.name)
    if (count && count > 0) return res.status(409).json({ error: `Reassign ${count} member(s) before deleting this role` })
    await supabaseAdmin.from('role_tool_visibility').delete().eq('role', role.name)
    await supabaseAdmin.from('roles').delete().eq('id', req.params.id)
    await refreshCustomRoleTiers().catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete role' })
  }
})

// --- App Config (key-value settings like Day One / VIP URLs) ---

// GET /config/app-settings?prefix=dayone_url — get all matching keys
router.get('/app-settings', async (req, res) => {
  try {
    const { prefix, key } = req.query
    let query = supabaseAdmin.from('app_config').select('key, value')
    if (key) {
      query = query.eq('key', key)
    } else if (prefix) {
      query = query.like('key', prefix + '%')
    }
    const { data, error } = await query
    if (error) throw error
    const settings = {}
    for (const row of (data || [])) settings[row.key] = row.value
    res.json(settings)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /config/app-settings — admin only, upsert key-value pairs
router.put('/app-settings', requireRole('admin'), async (req, res) => {
  try {
    const { settings } = req.body // { "dayone_url_salem": "https://...", ... }
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'settings object required' })
    }
    for (const [key, value] of Object.entries(settings)) {
      const { error } = await supabaseAdmin
        .from('app_config')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) throw error
    }
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Launcher version pinning ---
// Returns the minimum launcher version every kiosk should be running.
// The launcher polls this endpoint and if its own app.getVersion() is
// below the value, it calls app.relaunch() + app.exit(0) to apply any
// pending electron-updater download.
router.get('/launcher-version', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value')
      .eq('key', 'min_launcher_version')
      .maybeSingle()
    if (error) throw error
    res.json({ min_version: data?.value || null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// PUT /config/launcher-version — admin only. Sets min_launcher_version.
router.put('/launcher-version', requireRole('admin'), async (req, res) => {
  try {
    const { min_version } = req.body
    if (!min_version || typeof min_version !== 'string') {
      return res.status(400).json({ error: 'min_version (string) required' })
    }
    const { error } = await supabaseAdmin
      .from('app_config')
      .upsert(
        { key: 'min_launcher_version', value: min_version, updated_at: new Date().toISOString() },
        { onConflict: 'key' },
      )
    if (error) throw error
    res.json({ min_version })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// --- Portal force-refresh broadcast ---
// Bumps a timestamp in app_config that every open portal tab polls. When the
// stored timestamp is newer than the tab's own load time, the portal hard
// reloads. Effective lag is the portal's poll interval (currently 60s).

router.get('/portal-version', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('app_config')
      .select('value, updated_at')
      .eq('key', 'portal_force_refresh_at')
      .maybeSingle()
    if (error) throw error
    res.json({ refresh_at: data?.value || null, updated_at: data?.updated_at || null })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /config/portal-force-refresh — admin only. Sets the key to "now" so
// every polling tab reloads on its next tick. Body intentionally empty.
router.post('/portal-force-refresh', requireRole('admin'), async (req, res) => {
  try {
    const ts = new Date().toISOString()
    const { error } = await supabaseAdmin
      .from('app_config')
      .upsert(
        { key: 'portal_force_refresh_at', value: ts, updated_at: ts },
        { onConflict: 'key' },
      )
    if (error) throw error
    res.json({ refresh_at: ts })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
