const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, resolveRole, ROLE_HIERARCHY } = require('../middleware/role')

const router = Router()
router.use(authenticate)

// Extract a Google Drive folder ID from various URL formats
// Accepts: raw ID, /folders/<id>, /drive/folders/<id>, ?id=<id>
function extractFolderId(input) {
  if (!input) return null
  const trimmed = input.trim()
  if (!/[/?=]/.test(trimmed)) return trimmed // looks like a raw ID
  const m = trimmed.match(/folders\/([a-zA-Z0-9_-]+)/) || trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

// GET /drive-folders — folders this user can see (filtered by role + location)
router.get('/', async (req, res) => {
  try {
    const userRole = resolveRole(req.staff.role)
    const userLevel = ROLE_HIERARCHY.indexOf(userRole)
    const userLocationIds = req.staff.location_ids || []

    const { data: folders, error } = await supabaseAdmin
      .from('drive_folders')
      .select('id, name, description, folder_id, min_role, sort_order')
      .eq('is_active', true)
      .order('sort_order')
      .order('name')
    if (error) throw error

    // Per-role gate
    const roleAllowed = (folders || []).filter(f => {
      const minLevel = ROLE_HIERARCHY.indexOf(resolveRole(f.min_role || 'team_member'))
      return userLevel >= minLevel
    })

    if (roleAllowed.length === 0) return res.json({ folders: [] })

    // Per-location gate: empty location list = visible everywhere
    const folderIds = roleAllowed.map(f => f.id)
    const { data: locRows } = await supabaseAdmin
      .from('drive_folder_locations')
      .select('folder_id, location_id')
      .in('folder_id', folderIds)

    const locsByFolder = {}
    for (const r of (locRows || [])) {
      if (!locsByFolder[r.folder_id]) locsByFolder[r.folder_id] = []
      locsByFolder[r.folder_id].push(r.location_id)
    }

    // admin/corporate can see all locations
    const seesAll = ['admin', 'corporate'].includes(userRole)

    const visible = roleAllowed.filter(f => {
      const restrictions = locsByFolder[f.id]
      if (!restrictions || restrictions.length === 0) return true // no restriction = visible everywhere
      if (seesAll) return true
      return restrictions.some(locId => userLocationIds.includes(locId))
    })

    res.json({ folders: visible })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch drive folders: ' + err.message })
  }
})

// Admin: list all (including inactive), with locations
router.get('/admin', requireRole('admin'), async (req, res) => {
  try {
    const { data: folders, error } = await supabaseAdmin
      .from('drive_folders')
      .select('*')
      .order('sort_order')
      .order('name')
    if (error) throw error

    const ids = (folders || []).map(f => f.id)
    const { data: locRows } = ids.length
      ? await supabaseAdmin.from('drive_folder_locations').select('folder_id, location_id').in('folder_id', ids)
      : { data: [] }

    const locsByFolder = {}
    for (const r of (locRows || [])) {
      if (!locsByFolder[r.folder_id]) locsByFolder[r.folder_id] = []
      locsByFolder[r.folder_id].push(r.location_id)
    }

    const enriched = (folders || []).map(f => ({ ...f, location_ids: locsByFolder[f.id] || [] }))
    res.json({ folders: enriched })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, description, folder_id_or_url, min_role, sort_order, is_active, location_ids } = req.body
  if (!name?.trim() || !folder_id_or_url?.trim()) {
    return res.status(400).json({ error: 'name and folder_id_or_url are required' })
  }
  const folderId = extractFolderId(folder_id_or_url)
  if (!folderId) return res.status(400).json({ error: 'Could not extract a Drive folder ID from input' })

  const role = resolveRole(min_role || 'team_member')
  if (ROLE_HIERARCHY.indexOf(role) === -1) return res.status(400).json({ error: 'Invalid min_role' })

  try {
    const { data, error } = await supabaseAdmin
      .from('drive_folders')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        folder_id: folderId,
        min_role: role,
        sort_order: sort_order ?? 0,
        is_active: is_active ?? true,
      })
      .select()
      .single()
    if (error) throw error

    if (Array.isArray(location_ids) && location_ids.length > 0) {
      await supabaseAdmin
        .from('drive_folder_locations')
        .insert(location_ids.map(locId => ({ folder_id: data.id, location_id: locId })))
    }
    res.status(201).json({ ...data, location_ids: location_ids || [] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to create folder: ' + err.message })
  }
})

router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, description, folder_id_or_url, min_role, sort_order, is_active, location_ids } = req.body
  if (!name?.trim() || !folder_id_or_url?.trim()) {
    return res.status(400).json({ error: 'name and folder_id_or_url are required' })
  }
  const folderId = extractFolderId(folder_id_or_url)
  if (!folderId) return res.status(400).json({ error: 'Could not extract a Drive folder ID from input' })

  const role = resolveRole(min_role || 'team_member')
  if (ROLE_HIERARCHY.indexOf(role) === -1) return res.status(400).json({ error: 'Invalid min_role' })

  try {
    const { data, error } = await supabaseAdmin
      .from('drive_folders')
      .update({
        name: name.trim(),
        description: description?.trim() || null,
        folder_id: folderId,
        min_role: role,
        sort_order: sort_order ?? 0,
        is_active: is_active ?? true,
      })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error

    // Replace location set
    await supabaseAdmin.from('drive_folder_locations').delete().eq('folder_id', req.params.id)
    if (Array.isArray(location_ids) && location_ids.length > 0) {
      await supabaseAdmin
        .from('drive_folder_locations')
        .insert(location_ids.map(locId => ({ folder_id: req.params.id, location_id: locId })))
    }
    res.json({ ...data, location_ids: location_ids || [] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to update folder: ' + err.message })
  }
})

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { error } = await supabaseAdmin.from('drive_folders').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete folder: ' + err.message })
  }
})

module.exports = router
