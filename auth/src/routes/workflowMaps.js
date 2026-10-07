// Workflow Maps: visual maps of our marketing/ops automation workflows, built
// in the portal under Marketing -> Workflows. Each map is one workflow_maps row
// holding the React Flow graph (nodes/edges JSON); the editor autosaves the
// whole graph on every change.
//
// Viewing is gated on the 'workflows' marketing capability (migration 233).
// Creating, saving and deleting maps is admin only; everyone else who can see
// the tab gets the read-only presentation view.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireMarketing, requireMarketingCapability, requireRole, roleLevel, ROLE_HIERARCHY } = require('../middleware/role')
const { LOCATIONS } = require('../config/ghlLocations')
const { ghlFetch } = require('../services/ghlClient')
const { isMediaKey } = require('../lib/dripMedia')
const { sanitizeMapInput, findLinkedValue } = require('../lib/workflowMaps')

const router = Router()
router.use(authenticate)
router.use(requireMarketing)
router.use(requireMarketingCapability('workflows'))

const canEditMaps = (staff) => roleLevel(staff?.role) >= ROLE_HIERARCHY.indexOf('admin')
const requireEditor = requireRole('admin')

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIST_COLUMNS = 'id, name, description, category, status, clubs, ghl_workflow_url, source, version, nodes, updated_at, updated_by_name, created_at'

function editor(staff) {
  return { updated_by: staff.id, updated_by_name: staff.display_name || staff.email || null }
}

// The list ships a step count instead of the full graph.
function listRow(row) {
  const { nodes, ...rest } = row
  return { ...rest, step_count: Array.isArray(nodes) ? nodes.filter(n => n.type !== 'note').length : 0 }
}

// GET / — every map, most recently edited first.
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('workflow_maps').select(LIST_COLUMNS)
      .order('updated_at', { ascending: false }).limit(1000)
    if (error) throw error
    res.json({ maps: (data || []).map(listRow), canEdit: canEditMaps(req.staff) })
  } catch (err) {
    console.error('[workflowMaps] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load workflow maps' })
  }
})

// ── GHL custom values ─────────────────────────────────────────────────────
// Steps can be linked to a GHL custom value (the SMS copy and call scripts the
// workflows send). The map shows the live value read from GHL; it never writes
// to GHL. Copy is edited in GHL or the Workflows & Scripts tile and shows up
// here on the next load. Values come from the base club's sub-account.
const BASE_CLUB = 'salem'

function baseLocation() {
  return LOCATIONS.find(l => l.slug === BASE_CLUB) || LOCATIONS[0] || null
}

const shapeCv = (cv) => ({
  id: cv.id,
  name: cv.name || '',
  fieldKey: cv.fieldKey || cv.key || null,
  value: cv.value == null ? '' : String(cv.value),
})

// GET /ghl-values?links=<json [{key,name}]>
// Every custom value (for the link picker), with the linked ones re-read by
// id: GHL's list endpoint lags writes by minutes, a GET by id doesn't.
router.get('/ghl-values', async (req, res) => {
  const loc = baseLocation()
  if (!loc) return res.status(503).json({ error: 'GHL is not configured' })
  let links = []
  try { links = JSON.parse(req.query.links || '[]') } catch { links = [] }
  if (!Array.isArray(links)) links = []
  try {
    const data = await ghlFetch(`/locations/${loc.id}/customValues`, loc.apiKey)
    const values = (data.customValues || data.customValue || [])
      .map(shapeCv)
      .filter(v => !(v.fieldKey && isMediaKey(v.fieldKey)))
    const linkedIds = [...new Set(links.slice(0, 200).map(l => findLinkedValue(values, l)?.id).filter(Boolean))]
    const fresh = await Promise.all(linkedIds.map(id =>
      ghlFetch(`/locations/${loc.id}/customValues/${id}`, loc.apiKey)
        .then(r => (r.customValue ? shapeCv(r.customValue) : null))
        .catch(() => null)))
    const byId = new Map(fresh.filter(Boolean).map(v => [v.id, v]))
    res.json({
      values: values
        .map(v => byId.get(v.id) || v)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    })
  } catch (err) {
    console.error('[workflowMaps] ghl values failed:', err.message)
    res.status(502).json({ error: 'Could not load custom values from GHL' })
  }
})

// GET /:id — one map with its graph.
router.get('/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Workflow map not found' })
  try {
    const { data, error } = await supabaseAdmin.from('workflow_maps').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Workflow map not found' })
    res.json({ map: data, canEdit: canEditMaps(req.staff) })
  } catch (err) {
    console.error('[workflowMaps] get failed:', err.message)
    res.status(500).json({ error: 'Failed to load workflow map' })
  }
})

// POST / — create (blank, from a template, or from an imported file).
router.post('/', requireEditor, async (req, res) => {
  const { fields, error: invalid } = sanitizeMapInput(req.body || {}, { requireName: true })
  if (invalid) return res.status(400).json({ error: invalid })
  try {
    const { data, error } = await supabaseAdmin
      .from('workflow_maps')
      .insert({ ...fields, ...editor(req.staff), created_by: req.staff.id })
      .select('*').single()
    if (error) throw error
    res.status(201).json({ map: data })
  } catch (err) {
    console.error('[workflowMaps] create failed:', err.message)
    res.status(500).json({ error: 'Failed to create workflow map' })
  }
})

// PUT /:id — save. Body carries the version the client last loaded; a save
// based on an older version returns 409 with the current row so the editor
// can tell the person someone else changed it.
router.put('/:id', requireEditor, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Workflow map not found' })
  const { fields, error: invalid } = sanitizeMapInput(req.body || {})
  if (invalid) return res.status(400).json({ error: invalid })
  const baseVersion = Number(req.body?.version)
  if (!Number.isInteger(baseVersion)) return res.status(400).json({ error: 'version is required' })
  try {
    const { data, error } = await supabaseAdmin
      .from('workflow_maps')
      .update({ ...fields, ...editor(req.staff), version: baseVersion + 1, updated_at: new Date().toISOString() })
      .eq('id', req.params.id).eq('version', baseVersion)
      .select('*').maybeSingle()
    if (error) throw error
    if (data) return res.json({ map: data })
    const { data: current } = await supabaseAdmin.from('workflow_maps').select('*').eq('id', req.params.id).maybeSingle()
    if (!current) return res.status(404).json({ error: 'Workflow map not found' })
    res.status(409).json({ error: 'Someone else changed this workflow', map: current })
  } catch (err) {
    console.error('[workflowMaps] save failed:', err.message)
    res.status(500).json({ error: 'Failed to save workflow map' })
  }
})

// POST /:id/duplicate — copy a map under a new name.
router.post('/:id/duplicate', requireEditor, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Workflow map not found' })
  try {
    const { data: src, error: readErr } = await supabaseAdmin.from('workflow_maps').select('*').eq('id', req.params.id).maybeSingle()
    if (readErr) throw readErr
    if (!src) return res.status(404).json({ error: 'Workflow map not found' })
    const { data, error } = await supabaseAdmin
      .from('workflow_maps')
      .insert({
        name: (src.name + ' (copy)').slice(0, 200),
        description: src.description, category: src.category, status: 'draft', clubs: src.clubs,
        ghl_workflow_url: src.ghl_workflow_url, nodes: src.nodes, edges: src.edges, viewport: src.viewport,
        ...editor(req.staff), created_by: req.staff.id,
      })
      .select('*').single()
    if (error) throw error
    res.status(201).json({ map: data })
  } catch (err) {
    console.error('[workflowMaps] duplicate failed:', err.message)
    res.status(500).json({ error: 'Failed to duplicate workflow map' })
  }
})

// DELETE /:id
router.delete('/:id', requireEditor, async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Workflow map not found' })
  try {
    const { error } = await supabaseAdmin.from('workflow_maps').delete().eq('id', req.params.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[workflowMaps] delete failed:', err.message)
    res.status(500).json({ error: 'Failed to delete workflow map' })
  }
})

module.exports = router
