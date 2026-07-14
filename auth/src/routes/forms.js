const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, roleLevel, ROLE_HIERARCHY } = require('../middleware/role')
const { canAccessForm, requireFormsBuilder } = require('../services/formsPermissions')
const { validateSchema, makeSlug, INPUT_TYPES } = require('../services/formsSchema')
const formsSheets = require('../services/formsSheets')
const formsAudit = require('../services/formsAudit')

const router = Router()
router.use(authenticate)
// The whole module is admin-only (or an explicit RBAC 'forms' grant) — per-form
// visibility/share rules below only scope what a permitted caller sees.
router.use(requireFormsBuilder)

// Validate + normalize an incoming settings object. Recognized keys only:
// success_message (string, trimmed, max 500) and allow_resubmit (boolean).
// Unrecognized keys are dropped. Returns { ok, error, settings }.
function normalizeSettings(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'settings must be an object' }
  }
  const out = {}
  if (input.success_message !== undefined) {
    if (typeof input.success_message !== 'string') {
      return { ok: false, error: 'success_message must be a string' }
    }
    const trimmed = input.success_message.trim()
    if (trimmed.length > 500) return { ok: false, error: 'success_message must be 500 characters or fewer' }
    out.success_message = trimmed
  }
  if (input.allow_resubmit !== undefined) {
    out.allow_resubmit = !!input.allow_resubmit
  }
  return { ok: true, settings: out }
}

const CORPORATE_LEVEL = ROLE_HIERARCHY.indexOf('corporate')
const isCorporate = (staff) => roleLevel(staff.role) >= CORPORATE_LEVEL

// Load a form + its shares and resolve the caller's access in one place.
async function loadFormAccess(req, formId) {
  const { data: form, error } = await supabaseAdmin.from('forms').select('*').eq('id', formId).maybeSingle()
  if (error) throw error
  if (!form) return { form: null, shares: [], access: { view: false, edit: false } }
  const { data: shares } = await supabaseAdmin.from('form_shares').select('*').eq('form_id', formId)
  return { form, shares: shares || [], access: canAccessForm(req.staff, form, shares || []) }
}

// GET /forms - every form the caller can see.
router.get('/', async (req, res) => {
  try {
    const { data: forms, error } = await supabaseAdmin.from('forms')
      .select('*').order('updated_at', { ascending: false })
    if (error) throw error
    const all = forms || []
    let visible
    if (isCorporate(req.staff)) {
      visible = all.map(f => ({ f, access: { view: true, edit: true } }))
    } else {
      const ids = all.map(f => f.id)
      const { data: shareRows } = ids.length
        ? await supabaseAdmin.from('form_shares').select('*').eq('staff_id', req.staff.id).in('form_id', ids)
        : { data: [] }
      const sharesByForm = {}
      for (const s of shareRows || []) (sharesByForm[s.form_id] ||= []).push(s)
      visible = all
        .map(f => ({ f, access: canAccessForm(req.staff, f, sharesByForm[f.id] || []) }))
        .filter(x => x.access.view)
    }
    const visibleIds = visible.map(x => x.f.id)
    // Owner names, location names, submission counts in three cheap queries.
    const ownerIds = [...new Set(visible.map(x => x.f.owner_id))]
    const locIds = [...new Set(visible.map(x => x.f.location_id).filter(Boolean))]
    const [{ data: owners }, { data: locs }] = await Promise.all([
      ownerIds.length ? supabaseAdmin.from('staff').select('id, display_name').in('id', ownerIds) : { data: [] },
      locIds.length ? supabaseAdmin.from('locations').select('id, name').in('id', locIds) : { data: [] },
    ])
    const counts = {}
    if (visibleIds.length) {
      const countResults = await Promise.all(visibleIds.map(id =>
        supabaseAdmin.from('form_submissions').select('id', { count: 'exact', head: true }).eq('form_id', id)))
      visibleIds.forEach((id, i) => { counts[id] = countResults[i].count || 0 })
    }
    const ownerName = Object.fromEntries((owners || []).map(o => [o.id, o.display_name]))
    const locName = Object.fromEntries((locs || []).map(l => [l.id, l.name]))
    let driveFolderId = null
    try { driveFolderId = await formsSheets.getFolderId() } catch { /* link is optional */ }
    res.json({
      drive_folder_id: driveFolderId,
      forms: visible.map(({ f, access }) => ({
        ...f, access,
        owner_name: ownerName[f.owner_id] || '',
        location_name: f.location_id ? (locName[f.location_id] || '') : 'All Locations',
        submission_count: counts[f.id] || 0,
      })),
    })
  } catch (err) {
    console.error('[forms] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load forms' })
  }
})

// GET /forms/staff-directory - share picker. Must be declared before /:id.
router.get('/staff-directory', requireFormsBuilder, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('staff')
      .select('id, display_name, role').eq('is_active', true).order('display_name')
    if (error) throw error
    res.json({ staff: (data || []).filter(s => s.id !== req.staff.id) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load staff' })
  }
})

// Resolve staff display names for audit responses: actor_name on each event,
// plus staff_name inside detail for share-action events. Response-only
// enrichment, never written back to the database.
async function enrichAuditEvents(events) {
  const ids = new Set()
  for (const e of events) {
    if (e.actor_id) ids.add(e.actor_id)
    if (e.detail && typeof e.detail === 'object' && e.detail.staff_id) ids.add(e.detail.staff_id)
  }
  const idList = [...ids]
  const { data: staff } = idList.length
    ? await supabaseAdmin.from('staff').select('id, display_name').in('id', idList) : { data: [] }
  const names = Object.fromEntries((staff || []).map(s => [s.id, s.display_name]))
  return events.map(e => {
    const out = { ...e, actor_name: e.actor_id ? (names[e.actor_id] || 'Unknown') : 'Public' }
    if (e.detail && typeof e.detail === 'object' && e.detail.staff_id && names[e.detail.staff_id]) {
      out.detail = { ...e.detail, staff_name: names[e.detail.staff_id] }
    }
    return out
  })
}

// GET /forms/audit/all - cross-form audit for corporate/admin. Before /:id.
router.get('/audit/all', requireRole('corporate'), async (req, res) => {
  try {
    let q = supabaseAdmin.from('form_audit_log').select('*').order('created_at', { ascending: false }).limit(500)
    if (req.query.staff_id) q = q.eq('actor_id', req.query.staff_id)
    if (req.query.form_id) q = q.eq('form_id', req.query.form_id)
    const { data, error } = await q
    if (error) throw error
    res.json({ events: await enrichAuditEvents(data || []) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load audit log' })
  }
})

// POST /forms - create.
router.post('/', requireFormsBuilder, async (req, res) => {
  try {
    const { title, description, location_id, all_locations } = req.body || {}
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'Title is required' })
    let loc = location_id
    const myLocs = req.staff.location_ids || []
    // An all-locations form (location_id NULL) is a corporate/admin-only concept:
    // one form spanning every club. Non-corporate callers stay pinned to their
    // own club and the flag is ignored.
    if (all_locations && isCorporate(req.staff)) {
      loc = null
    } else if (!isCorporate(req.staff)) {
      if (!loc) loc = req.staff.primary_location_id || myLocs[0]
      if (!loc || !myLocs.includes(loc)) return res.status(403).json({ error: 'You can only create forms for your own location' })
    } else if (!loc) {
      loc = req.staff.primary_location_id || myLocs[0]
      if (!loc) return res.status(400).json({ error: 'location_id is required' })
    }
    const row = {
      slug: makeSlug(title), title: String(title).trim(),
      description: description || null, owner_id: req.staff.id, location_id: loc,
    }
    const { data, error } = await supabaseAdmin.from('forms').insert(row).select('*').single()
    if (error) throw error
    formsAudit.record(data.id, req.staff.id, 'created', { title: data.title, location_id: loc })
    res.json({ form: { ...data, access: { view: true, edit: true } } })
  } catch (err) {
    console.error('[forms] create failed:', err.message)
    res.status(500).json({ error: 'Failed to create form' })
  }
})

// GET /forms/:id - for the builder.
router.get('/:id', async (req, res) => {
  try {
    const { form, shares, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    let shareList
    if (access.edit) {
      const ids = shares.map(s => s.staff_id)
      const { data: staffRows } = ids.length
        ? await supabaseAdmin.from('staff').select('id, display_name').in('id', ids) : { data: [] }
      const names = Object.fromEntries((staffRows || []).map(s => [s.id, s.display_name]))
      shareList = shares.map(s => ({ ...s, display_name: names[s.staff_id] || '' }))
    }
    res.json({ form: { ...form, access }, shares: shareList })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load form' })
  }
})

// PATCH /forms/:id - save with last-write protection.
router.patch('/:id', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { known_updated_at, title, description, schema, visibility, location_can_edit, settings, location_id, all_locations } = req.body || {}
    if (!known_updated_at) return res.status(400).json({ error: 'known_updated_at is required' })
    if (new Date(form.updated_at).getTime() > new Date(known_updated_at).getTime()) {
      return res.status(409).json({
        error: 'This form changed since you opened it. Reload to get the latest version.',
        server_updated_at: form.updated_at,
      })
    }
    const patch = { updated_at: new Date().toISOString() }
    const detail = {}
    if (title !== undefined) {
      if (!String(title).trim()) return res.status(400).json({ error: 'Title is required' })
      patch.title = String(title).trim(); detail.title = patch.title
    }
    if (description !== undefined) { patch.description = description || null; detail.description = true }
    if (schema !== undefined) {
      const v = validateSchema(schema)
      if (!v.ok) return res.status(400).json({ error: v.error })
      patch.schema = schema; detail.field_count = schema.length
    }
    if (visibility !== undefined) {
      if (!['private', 'location', 'shared'].includes(visibility)) return res.status(400).json({ error: 'Invalid visibility' })
      patch.visibility = visibility
    }
    if (location_can_edit !== undefined) patch.location_can_edit = !!location_can_edit
    // Location change. all_locations:true (corporate only) → NULL; otherwise a
    // specific club the caller is allowed to use. Mirrors the create-route rules.
    let locationChanged = false
    if (all_locations === true && form.location_id !== null) {
      if (!isCorporate(req.staff)) return res.status(403).json({ error: 'Only admins can set a form to all locations' })
      patch.location_id = null; locationChanged = true
    } else if (all_locations !== true && location_id !== undefined && location_id !== form.location_id) {
      if (!location_id) return res.status(400).json({ error: 'location_id is required' })
      if (!isCorporate(req.staff) && !(req.staff.location_ids || []).includes(location_id)) {
        return res.status(403).json({ error: 'You can only assign forms to your own location' })
      }
      patch.location_id = location_id; locationChanged = true
    }
    if (locationChanged) detail.location_id = patch.location_id
    if (settings !== undefined) {
      const v = normalizeSettings(settings)
      if (!v.ok) return res.status(400).json({ error: v.error })
      // Merge over existing settings so unrelated keys are preserved.
      patch.settings = { ...(form.settings || {}), ...v.settings }
      detail.settings = true
    }
    const { data, error } = await supabaseAdmin.from('forms').update(patch).eq('id', form.id).select('*').single()
    if (error) throw error
    // Published forms with a sheet get new columns appended right away.
    if (patch.schema && data.sheet_id) {
      try { await formsSheets.ensureSheet(data) } catch (e) { console.error('[forms] column sync failed:', e.message) }
    }
    // A title change renames the Drive file too, so the sheet stays findable.
    if (patch.title && patch.title !== form.title && data.sheet_id) {
      try { await formsSheets.renameSheet(data) } catch (e) { console.error('[forms] sheet rename failed:', e.message) }
    }
    // A location change re-titles the sheet ("Title (New Location)") and refiles
    // it into the new location's Drive subfolder so it stays where staff expect.
    if (locationChanged && data.sheet_id) {
      try {
        await formsSheets.renameSheet(data)
        await formsSheets.organizeSheet(data)
      } catch (e) { console.error('[forms] sheet relocation failed:', e.message) }
    }
    if (locationChanged) {
      formsAudit.record(form.id, req.staff.id, 'location_changed', { location_id: data.location_id })
    }
    if (patch.visibility !== undefined || patch.location_can_edit !== undefined) {
      formsAudit.record(form.id, req.staff.id, 'visibility_changed', {
        visibility: data.visibility, location_can_edit: data.location_can_edit,
      })
    }
    if (patch.title || patch.schema || detail.description || detail.settings) {
      formsAudit.record(form.id, req.staff.id, 'edited', detail)
    }
    const fresh = await loadFormAccess(req, form.id)
    res.json({ form: { ...fresh.form, access: fresh.access } })
  } catch (err) {
    console.error('[forms] update failed:', err.message)
    res.status(500).json({ error: 'Failed to save form' })
  }
})

// POST /forms/:id/publish - creates/syncs the Google Sheet.
router.post('/:id/publish', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const inputCount = (form.schema || []).filter(f => INPUT_TYPES.includes(f.type)).length
    if (inputCount === 0) return res.status(400).json({ error: 'Add at least one input field before publishing' })
    let sheet = { sheet_id: form.sheet_id, sheet_tab: form.sheet_tab, sheet_columns: form.sheet_columns }
    let sheetError = null
    try {
      sheet = await formsSheets.ensureSheet(form)
    } catch (err) {
      // Publish anyway; submissions are backed up in Supabase and the retry
      // sweep will fail loudly. Surface the warning to the UI.
      sheetError = err.message
      console.error('[forms] sheet create failed on publish:', err.message)
    }
    const { data, error } = await supabaseAdmin.from('forms')
      .update({ status: 'published', updated_at: new Date().toISOString() })
      .eq('id', form.id).select('*').single()
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, 'published', { sheet_id: sheet.sheet_id || null, sheet_error: sheetError })
    res.json({ form: { ...data, access }, sheet_error: sheetError })
  } catch (err) {
    console.error('[forms] publish failed:', err.message)
    res.status(500).json({ error: 'Failed to publish form' })
  }
})

// POST /forms/:id/archive
router.post('/:id/archive', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { data, error } = await supabaseAdmin.from('forms')
      .update({ status: 'archived', updated_at: new Date().toISOString() })
      .eq('id', form.id).select('*').single()
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, 'archived', null)
    res.json({ form: { ...data, access } })
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive form' })
  }
})

// DELETE /forms/:id - drafts with zero submissions only.
router.delete('/:id', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form) return res.status(404).json({ error: 'Not found' })
    const mayDelete = access.edit && (form.owner_id === req.staff.id || isCorporate(req.staff))
    if (!mayDelete) return res.status(403).json({ error: 'Only the owner or a director can delete a form' })
    const { count } = await supabaseAdmin.from('form_submissions')
      .select('id', { count: 'exact', head: true }).eq('form_id', form.id)
    if (form.status !== 'draft' || (count || 0) > 0) {
      return res.status(409).json({ error: 'Forms with submissions cannot be deleted. Archive it instead.' })
    }
    formsAudit.record(form.id, req.staff.id, 'deleted', { title: form.title })
    await supabaseAdmin.from('form_shares').delete().eq('form_id', form.id)
    const { error } = await supabaseAdmin.from('forms').delete().eq('id', form.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete form' })
  }
})

// POST /forms/:id/shares - upsert one person's access.
router.post('/:id/shares', async (req, res) => {
  try {
    const { form, shares, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { staff_id, permission } = req.body || {}
    if (!staff_id || !['viewer', 'editor'].includes(permission)) {
      return res.status(400).json({ error: 'staff_id and permission (viewer or editor) required' })
    }
    const existing = shares.find(s => s.staff_id === staff_id)
    const { error } = await supabaseAdmin.from('form_shares').upsert(
      { form_id: form.id, staff_id, permission, granted_by: req.staff.id },
      { onConflict: 'form_id,staff_id' }
    )
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, existing ? 'permission_changed' : 'shared', { staff_id, permission })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to share form' })
  }
})

// DELETE /forms/:id/shares/:staffId
router.delete('/:id/shares/:staffId', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { error } = await supabaseAdmin.from('form_shares')
      .delete().eq('form_id', form.id).eq('staff_id', req.params.staffId)
    if (error) throw error
    formsAudit.record(form.id, req.staff.id, 'unshared', { staff_id: req.params.staffId })
    res.json({ ok: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove share' })
  }
})

// GET /forms/:id/audit - per-form timeline.
router.get('/:id/audit', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const { data, error } = await supabaseAdmin.from('form_audit_log')
      .select('*').eq('form_id', form.id).order('created_at', { ascending: false }).limit(300)
    if (error) throw error
    res.json({ events: await enrichAuditEvents(data || []) })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load audit log' })
  }
})

// GET /forms/:id/submissions - in-portal peek; Sheets is the primary surface.
router.get('/:id/submissions', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.view) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
    const offset = parseInt(req.query.offset, 10) || 0
    const { data, error, count } = await supabaseAdmin.from('form_submissions')
      .select('id, data, submitted_at, synced_to_sheet, sync_error', { count: 'exact' })
      .eq('form_id', form.id).order('submitted_at', { ascending: false })
      .range(offset, offset + limit - 1)
    if (error) throw error
    res.json({ submissions: data || [], total: count || 0 })
  } catch (err) {
    res.status(500).json({ error: 'Failed to load submissions' })
  }
})

// POST /forms/:id/retry-sync - manual retry of unsynced submissions.
router.post('/:id/retry-sync', async (req, res) => {
  try {
    const { form, access } = await loadFormAccess(req, req.params.id)
    if (!form || !access.edit) return res.status(form ? 403 : 404).json({ error: form ? 'No access' : 'Not found' })
    const result = await formsSheets.retryFormSync(form.id)
    formsAudit.record(form.id, req.staff.id, 'sheet_retry', result)
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: 'Retry failed' })
  }
})

module.exports = router
