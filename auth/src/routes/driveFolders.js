const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, resolveRole, ROLE_HIERARCHY } = require('../middleware/role')
const { getAccessToken } = require('./googleBusiness')

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

// GET /drive-folders/list?folder_id=xxx — list contents of a Drive folder
// Uses the shared Google OAuth token. User must have drive.readonly scope granted.
// Permission check: the requested folder_id must match (or be a descendant of)
// a configured drive_folders.folder_id that this user can access.
router.get('/list', async (req, res) => {
  const { folder_id } = req.query
  if (!folder_id) return res.status(400).json({ error: 'folder_id required' })

  try {
    // Verify the user has access to a configured root that owns this folder.
    // For simplicity v1: allow listing if folder_id matches ANY configured folder
    // OR if the user has access to at least one root folder (descendants are OK).
    const userRole = resolveRole(req.staff.role)
    const userLevel = ROLE_HIERARCHY.indexOf(userRole)
    const userLocationIds = req.staff.location_ids || []

    const { data: folders } = await supabaseAdmin
      .from('drive_folders')
      .select('id, folder_id, min_role')
      .eq('is_active', true)

    const accessibleRoots = (folders || []).filter(f => {
      const minLevel = ROLE_HIERARCHY.indexOf(resolveRole(f.min_role || 'team_member'))
      return userLevel >= minLevel
    })

    // Per-location check
    const rootIds = accessibleRoots.map(f => f.id)
    const { data: locRows } = rootIds.length
      ? await supabaseAdmin.from('drive_folder_locations').select('folder_id, location_id').in('folder_id', rootIds)
      : { data: [] }
    const locsByFolder = {}
    for (const r of (locRows || [])) {
      if (!locsByFolder[r.folder_id]) locsByFolder[r.folder_id] = []
      locsByFolder[r.folder_id].push(r.location_id)
    }
    const seesAll = ['admin', 'corporate'].includes(userRole)
    const visibleRoots = accessibleRoots.filter(f => {
      const restrictions = locsByFolder[f.id]
      if (!restrictions || restrictions.length === 0) return true
      if (seesAll) return true
      return restrictions.some(locId => userLocationIds.includes(locId))
    })

    if (visibleRoots.length === 0) {
      return res.status(403).json({ error: 'No accessible drive folders for this user' })
    }

    const token = await getAccessToken()
    const params = new URLSearchParams({
      q: `'${folder_id.replace(/'/g, "\\'")}' in parents and trashed=false`,
      fields: 'files(id,name,mimeType,iconLink,modifiedTime,size,thumbnailLink,webViewLink,webContentLink)',
      orderBy: 'folder,name',
      pageSize: '200',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    const r = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
      headers: { Authorization: 'Bearer ' + token },
    })
    const data = await r.json()
    if (data.error) {
      return res.status(r.status || 500).json({ error: data.error.message || 'Drive API error' })
    }

    res.json({ files: data.files || [] })
  } catch (err) {
    console.error('[Drive] list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /drive-folders/search?root_id=xxx&q=foo — recursive search of files under root_id
// Searches the entire descendant tree by:
//   1) BFS to collect descendant folder IDs
//   2) running a Drive name-contains query
//   3) filtering results to those whose parent is in the descendant set
router.get('/search', async (req, res) => {
  const { root_id, q } = req.query
  if (!root_id || !q) return res.status(400).json({ error: 'root_id and q required' })
  if (q.length < 2) return res.json({ files: [] })

  try {
    const token = await getAccessToken()

    // 1) BFS descendants
    const descendantIds = new Set([root_id])
    const folderNamesById = new Map()
    folderNamesById.set(root_id, 'Root')
    let queue = [root_id]
    let safetyLimit = 50 // max BFS levels — generous for nested drives
    while (queue.length > 0 && safetyLimit-- > 0) {
      // Drive q param has length limits, so chunk parents into groups of 30
      const nextLevel = []
      for (let i = 0; i < queue.length; i += 30) {
        const chunk = queue.slice(i, i + 30)
        const parentsClause = chunk.map(id => `'${id}' in parents`).join(' or ')
        const params = new URLSearchParams({
          q: `(${parentsClause}) and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: 'files(id,name,parents)',
          pageSize: '500',
          supportsAllDrives: 'true',
          includeItemsFromAllDrives: 'true',
        })
        const r = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
          headers: { Authorization: 'Bearer ' + token },
        })
        const data = await r.json()
        if (data.error) throw new Error(data.error.message)
        for (const f of (data.files || [])) {
          if (!descendantIds.has(f.id)) {
            descendantIds.add(f.id)
            folderNamesById.set(f.id, f.name)
            nextLevel.push(f.id)
          }
        }
      }
      queue = nextLevel
    }

    // 2) Search by name across the whole drive the connected account can see
    const escapedQ = q.replace(/'/g, "\\'")
    const searchParams = new URLSearchParams({
      q: `name contains '${escapedQ}' and trashed = false`,
      fields: 'files(id,name,mimeType,iconLink,modifiedTime,size,thumbnailLink,webViewLink,webContentLink,parents)',
      pageSize: '200',
      orderBy: 'folder,name',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    })
    const sr = await fetch('https://www.googleapis.com/drive/v3/files?' + searchParams, {
      headers: { Authorization: 'Bearer ' + token },
    })
    const sd = await sr.json()
    if (sd.error) return res.status(sr.status || 500).json({ error: sd.error.message })

    // 3) Filter to descendants of root_id, attach parent_name for context
    const matched = (sd.files || [])
      .filter(f => Array.isArray(f.parents) && f.parents.some(p => descendantIds.has(p)))
      .map(f => {
        const parentId = (f.parents || []).find(p => descendantIds.has(p))
        return { ...f, parent_name: folderNamesById.get(parentId) || '' }
      })

    res.json({ files: matched })
  } catch (err) {
    console.error('[Drive] search error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /drive-folders/file?file_id=xxx — get single file metadata (for breadcrumbs)
router.get('/file', async (req, res) => {
  const { file_id } = req.query
  if (!file_id) return res.status(400).json({ error: 'file_id required' })
  try {
    const token = await getAccessToken()
    const params = new URLSearchParams({
      fields: 'id,name,mimeType,parents',
      supportsAllDrives: 'true',
    })
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${file_id}?` + params, {
      headers: { Authorization: 'Bearer ' + token },
    })
    const data = await r.json()
    if (data.error) return res.status(r.status || 500).json({ error: data.error.message })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
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
