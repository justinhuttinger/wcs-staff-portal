const { Router } = require('express')
const multer = require('multer')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireMarketing, marketingScope } = require('../middleware/role')
const { getAccessToken } = require('./googleBusiness')
const memoryCache = require('../services/memoryCache')

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } })

// Target Drive folder for Marketing Tracker uploads. Prefer an env override,
// else read app_config.marketing_upload_folder_id (set by an admin).
async function getUploadFolderId() {
  if (process.env.MARKETING_UPLOAD_FOLDER_ID) return process.env.MARKETING_UPLOAD_FOLDER_ID
  const { data } = await supabaseAdmin
    .from('app_config').select('value').eq('key', 'marketing_upload_folder_id').maybeSingle()
  return data?.value || null
}

// multer runs as middleware before the handler, so its errors (e.g. too-large)
// bypass the handler try/catch — translate them into clean responses here.
function uploadSingle(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE'
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'File exceeds the 50 MB limit' : 'Upload failed' })
    }
    next()
  })
}

const router = Router()
router.use(authenticate)
// Corporate/admin (full marketing) and anyone with the marketing add-on can
// open the tracker. Add-on members may be scoped to specific clubs/types —
// that scoping is enforced per-request below via marketingScope().
router.use(requireMarketing)

// Verify an existing effort falls within the caller's marketing scope before
// they can read its comments or mutate/delete it. Returns { effort } when in
// scope, { error, status } otherwise (404 to avoid leaking existence).
async function loadEffortInScope(id, staff) {
  const { data, error } = await supabaseAdmin
    .from('marketing_efforts')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (error) return { error: error.message, status: 500 }
  if (!data) return { error: 'Effort not found', status: 404 }
  const scope = marketingScope(staff)
  if (scope.types && !scope.types.includes(data.type)) return { error: 'Effort not found', status: 404 }
  if (scope.locations && !(data.locations || []).some(l => scope.locations.includes(l))) {
    return { error: 'Effort not found', status: 404 }
  }
  return { effort: data }
}

// Reject a create/update payload that targets clubs or a type outside the
// caller's scope. Returns an error string, or null when allowed.
function scopeViolation(row, staff) {
  const scope = marketingScope(staff)
  if (scope.types && !scope.types.includes(row.type)) {
    return 'You do not have access to that effort type'
  }
  if (scope.locations && (row.locations || []).some(l => !scope.locations.includes(l))) {
    return 'You do not have access to one or more of those clubs'
  }
  return null
}

// Allowed effort types — keep in sync with portal/src/config/marketingTypes.js
const TYPES = new Set([
  'meta_ad', 'social_post', 'flyer', 'facebook_event', 'event',
  'email', 'sms', 'app_blast', 'ad_tvs', 'website',
])
const STATUSES = new Set(['planned', 'approved', 'complete'])

// Canonical location slugs (matches portal/src/config/locations.js)
const LOCATION_SLUGS = new Set([
  'salem', 'keizer', 'eugene', 'springfield', 'clackamas', 'milwaukie', 'medford',
])

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Whitelist + normalize an incoming effort payload. Returns { row } or { error }.
function buildRow(body, staff) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { error: 'Title is required' }

  const type = String(body.type || '')
  if (!TYPES.has(type)) return { error: 'Invalid type' }

  const status = String(body.status || 'planned')
  if (!STATUSES.has(status)) return { error: 'Invalid status' }

  if (!body.start_at) return { error: 'Start date is required' }
  const start = new Date(body.start_at)
  if (isNaN(start.getTime())) return { error: 'Invalid start date' }

  let end = null
  if (body.end_at) {
    const d = new Date(body.end_at)
    if (isNaN(d.getTime())) return { error: 'Invalid end date' }
    if (d.getTime() < start.getTime()) return { error: 'End date must be after the start date' }
    end = d.toISOString()
  }

  const locations = Array.isArray(body.locations)
    ? [...new Set(body.locations.map(s => String(s).toLowerCase()).filter(s => LOCATION_SLUGS.has(s)))]
    : []
  if (locations.length === 0) return { error: 'At least one location is required' }

  const custom = (body.custom && typeof body.custom === 'object' && !Array.isArray(body.custom))
    ? body.custom : {}

  const notes = typeof body.notes === 'string' ? body.notes : null

  return {
    row: {
      title,
      type,
      status,
      start_at: start.toISOString(),
      end_at: end,
      locations,
      custom,
      notes,
    },
  }
}

// --- Activity feed (comments + edit history) ---

function blank(v) {
  if (v == null) return true
  if (Array.isArray(v)) return v.length === 0
  return String(v).trim() === ''
}

// Keep stored from/to values bounded so a long URL/copy doesn't bloat the row.
function trunc(v) {
  if (v == null || Array.isArray(v)) return v
  const s = String(v)
  return s.length > 140 ? s.slice(0, 140) + '…' : s
}

// Diff two effort rows → [{ field, action, from, to }]. `field` is a base
// column or `custom.<key>`; display labels are resolved UI-side. `action` is
// added | removed | edited.
function diffEffort(oldRow, newRow) {
  const changes = []
  const pushChange = (field, o, n) => {
    if (blank(o) && blank(n)) return
    if (String(o ?? '') === String(n ?? '')) return
    changes.push({ field, action: blank(o) ? 'added' : blank(n) ? 'removed' : 'edited', from: trunc(o), to: trunc(n) })
  }

  for (const f of ['title', 'type', 'status', 'start_at', 'end_at', 'notes']) {
    pushChange(f, oldRow[f], newRow[f])
  }

  // locations: order-insensitive array compare
  const oLoc = [...(oldRow.locations || [])].sort()
  const nLoc = [...(newRow.locations || [])].sort()
  if (oLoc.join('|') !== nLoc.join('|')) {
    changes.push({ field: 'locations', action: oLoc.length === 0 ? 'added' : nLoc.length === 0 ? 'removed' : 'edited', from: oLoc, to: nLoc })
  }

  // custom fields: union of keys
  const oc = oldRow.custom || {}, nc = newRow.custom || {}
  for (const key of new Set([...Object.keys(oc), ...Object.keys(nc)])) {
    pushChange(`custom.${key}`, oc[key], nc[key])
  }

  return changes
}

// Plain-text summary for the row body (fallback; the UI renders from meta).
function summarizeChanges(changes) {
  return changes
    .map(c => `${c.action} ${c.field.startsWith('custom.') ? c.field.slice(7) : c.field}`)
    .join(', ')
}

// Insert an activity row. Never throws — an audit-log failure must not fail the
// parent mutation.
async function recordActivity(effortId, staff, kind, changes) {
  if (kind === 'edit' && (!changes || changes.length === 0)) return
  try {
    await supabaseAdmin.from('marketing_effort_comments').insert({
      effort_id: effortId,
      kind,
      body: kind === 'edit' ? summarizeChanges(changes) : null,
      meta: kind === 'edit' ? { changes } : null,
      created_by: staff.id,
      created_by_name: staff.display_name || staff.email || null,
    })
  } catch (e) {
    console.warn('[MarketingTracker] activity log failed:', e.message)
  }
}

// GET / — list efforts. Optional filters: type, location (slug), from, to (ISO).
router.get('/', async (req, res) => {
  try {
    let q = supabaseAdmin
      .from('marketing_efforts')
      .select('*')
      .order('start_at', { ascending: false })
      .limit(2000)

    // Enforce the caller's marketing scope (add-on members limited to certain
    // clubs/types). Full-marketing members get null scope = no restriction.
    const scope = marketingScope(req.staff)
    if (scope.types) q = q.in('type', scope.types)
    if (scope.locations) q = q.overlaps('locations', scope.locations)

    if (req.query.type && TYPES.has(req.query.type)) q = q.eq('type', req.query.type)
    if (req.query.location && LOCATION_SLUGS.has(String(req.query.location).toLowerCase())) {
      q = q.contains('locations', [String(req.query.location).toLowerCase()])
    }
    if (req.query.from) q = q.gte('start_at', req.query.from)
    if (req.query.to) q = q.lte('start_at', req.query.to)

    const { data, error } = await q
    if (error) throw error
    res.json({ efforts: data || [] })
  } catch (err) {
    console.error('[MarketingTracker] list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /drive-folder?folder_id=xxx — list media files (images/video/pdf) inside a
// Google Drive folder, for the inline carousel in the effort view. Role-gated by
// the router-level requireMarketing gate; uses the shared Drive token. The
// folder must be accessible to the connected Google account (shared / public).
const DRIVE_FOLDER_TTL_MS = 5 * 60 * 1000
router.get('/drive-folder', async (req, res) => {
  const folderId = String(req.query.folder_id || '')
  if (!/^[a-zA-Z0-9_-]+$/.test(folderId)) {
    return res.status(400).json({ error: 'Invalid folder id' })
  }
  try {
    const cacheKey = `mkt:drive-folder:${folderId}`
    if (req.query.refresh === '1') memoryCache.del(cacheKey)
    const files = await memoryCache.wrap(cacheKey, DRIVE_FOLDER_TTL_MS, async () => {
      const token = await getAccessToken()
      const params = new URLSearchParams({
        q: `'${folderId}' in parents and trashed=false and (mimeType contains 'image/' or mimeType contains 'video/' or mimeType='application/pdf')`,
        fields: 'files(id,name,mimeType)',
        orderBy: 'name',
        pageSize: '200',
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        corpora: 'allDrives',
      })
      const r = await fetch('https://www.googleapis.com/drive/v3/files?' + params, {
        headers: { Authorization: 'Bearer ' + token },
      })
      const data = await r.json()
      if (data.error) {
        const err = new Error(data.error.message || 'Drive API error')
        err.status = r.status || 500
        throw err
      }
      return (data.files || []).map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType }))
    })
    res.json({ files })
  } catch (err) {
    console.error('[MarketingTracker] drive-folder error:', err.message)
    res.status(err.status || 500).json({ error: err.message })
  }
})

// POST /upload — upload a photo/video/pdf to the shared Drive folder and return
// a viewable Drive link (so the original quality is preserved and the inline
// preview works). Uses the shared Google connection (needs drive.file scope).
router.post('/upload', uploadSingle, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
    const mime = req.file.mimetype || 'application/octet-stream'
    // Allow raster images/videos/pdf; exclude SVG (can carry scripts).
    if (!/^image\/(?!svg)|^video\/|^application\/pdf$/.test(mime)) {
      return res.status(400).json({ error: 'Only photo, video, or PDF files are allowed' })
    }
    const folderId = await getUploadFolderId()
    if (!folderId) return res.status(400).json({ error: 'Upload folder is not configured yet' })

    const token = await getAccessToken()
    const name = (req.file.originalname || 'marketing-upload').replace(/[\r\n"]/g, '').slice(0, 200)
    const boundary = '----wcsMarketingUploadBoundary'
    const metadata = JSON.stringify({ name, parents: [folderId] })
    const pre = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
      `--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`, 'utf8')
    const post = Buffer.from(`\r\n--${boundary}--`, 'utf8')
    const body = Buffer.concat([pre, req.file.buffer, post])

    const up = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    })
    const created = await up.json()
    if (created.error) {
      const msg = created.error.message || 'Drive upload failed'
      const scopeIssue = /insufficient|scope|permission/i.test(msg)
      return res.status(scopeIssue ? 403 : (up.status || 500)).json({
        error: scopeIssue
          ? 'Drive upload was rejected. Reconnect Google in Admin → Google Connections to grant write access, and make sure that Google account has edit access to the upload folder.'
          : msg,
      })
    }

    // Anyone-with-link can view, so the inline Drive preview renders.
    await fetch(`https://www.googleapis.com/drive/v3/files/${created.id}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    }).catch((e) => { console.warn('[MarketingTracker] set-permission failed:', e?.message) /* file still uploaded; link may need manual share */ })

    res.status(201).json({ id: created.id, name: created.name, link: `https://drive.google.com/file/d/${created.id}/view` })
  } catch (err) {
    console.error('[MarketingTracker] upload error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST / — create an effort.
router.post('/', async (req, res) => {
  try {
    const { row, error: vErr } = buildRow(req.body, req.staff)
    if (vErr) return res.status(400).json({ error: vErr })
    const sErr = scopeViolation(row, req.staff)
    if (sErr) return res.status(403).json({ error: sErr })

    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .insert({
        ...row,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ effort: data })
  } catch (err) {
    console.error('[MarketingTracker] create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PUT /:id — update an effort.
router.put('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const { row, error: vErr } = buildRow(req.body, req.staff)
    if (vErr) return res.status(400).json({ error: vErr })

    // Must already be allowed to touch this effort, and the new values must
    // also stay within scope (so a scoped member can't move it out of reach).
    const scoped = await loadEffortInScope(req.params.id, req.staff)
    if (scoped.error) return res.status(scoped.status).json({ error: scoped.error })
    const sErr = scopeViolation(row, req.staff)
    if (sErr) return res.status(403).json({ error: sErr })

    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .update(row)
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Effort not found' })
    // Record what changed for the activity feed (old = scoped.effort).
    await recordActivity(req.params.id, req.staff, 'edit', diffEffort(scoped.effort, data))
    res.json({ effort: data })
  } catch (err) {
    console.error('[MarketingTracker] update error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /:id/status — lightweight status-only update (from the read-only view).
router.patch('/:id/status', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const status = String(req.body.status || '')
    if (!STATUSES.has(status)) return res.status(400).json({ error: 'Invalid status' })

    const scoped = await loadEffortInScope(req.params.id, req.staff)
    if (scoped.error) return res.status(scoped.status).json({ error: scoped.error })

    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .update({ status })
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Effort not found' })
    if (scoped.effort.status !== status) {
      await recordActivity(req.params.id, req.staff, 'edit', [
        { field: 'status', action: 'edited', from: scoped.effort.status, to: status },
      ])
    }
    res.json({ effort: data })
  } catch (err) {
    console.error('[MarketingTracker] status error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /:id/comments — list comments for an effort (oldest first).
router.get('/:id/comments', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const scoped = await loadEffortInScope(req.params.id, req.staff)
    if (scoped.error) return res.status(scoped.status).json({ error: scoped.error })
    const { data, error } = await supabaseAdmin
      .from('marketing_effort_comments')
      .select('*')
      .eq('effort_id', req.params.id)
      .order('created_at', { ascending: true })
    if (error) throw error
    res.json({ comments: data || [] })
  } catch (err) {
    console.error('[MarketingTracker] comments list error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /:id/comments — add a comment (author taken from the session).
router.post('/:id/comments', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const body = typeof req.body.body === 'string' ? req.body.body.trim() : ''
    if (!body) return res.status(400).json({ error: 'Comment cannot be empty' })

    const scoped = await loadEffortInScope(req.params.id, req.staff)
    if (scoped.error) return res.status(scoped.status).json({ error: scoped.error })

    const { data, error } = await supabaseAdmin
      .from('marketing_effort_comments')
      .insert({
        effort_id: req.params.id,
        body,
        created_by: req.staff.id,
        created_by_name: req.staff.display_name || req.staff.email || null,
      })
      .select()
      .single()
    if (error) throw error
    res.status(201).json({ comment: data })
  } catch (err) {
    // FK violation = parent effort doesn't exist → clean 404 instead of 500.
    if (err && err.code === '23503') return res.status(404).json({ error: 'Effort not found' })
    console.error('[MarketingTracker] comment create error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// DELETE /:id — remove an effort.
router.delete('/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid effort id' })
    const scoped = await loadEffortInScope(req.params.id, req.staff)
    if (scoped.error) return res.status(scoped.status).json({ error: scoped.error })
    const { data, error } = await supabaseAdmin
      .from('marketing_efforts')
      .delete()
      .eq('id', req.params.id)
      .select()
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Effort not found' })
    res.json({ success: true })
  } catch (err) {
    console.error('[MarketingTracker] delete error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
