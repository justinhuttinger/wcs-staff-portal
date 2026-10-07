// Workflow Maps: visual maps of our marketing/ops automation workflows, built
// in the portal under Marketing -> Workflows. Each map is one workflow_maps row
// holding the React Flow graph (nodes/edges JSON); the editor autosaves the
// whole graph on every change.
//
// Gated on the 'workflows' marketing capability (migration 233), so the Roles
// grid controls it like the other Marketing tabs.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireMarketing, requireMarketingCapability } = require('../middleware/role')
const { sanitizeMapInput } = require('../lib/workflowMaps')

const router = Router()
router.use(authenticate)
router.use(requireMarketing)
router.use(requireMarketingCapability('workflows'))

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
    res.json({ maps: (data || []).map(listRow) })
  } catch (err) {
    console.error('[workflowMaps] list failed:', err.message)
    res.status(500).json({ error: 'Failed to load workflow maps' })
  }
})

// GET /:id — one map with its graph.
router.get('/:id', async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Workflow map not found' })
  try {
    const { data, error } = await supabaseAdmin.from('workflow_maps').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Workflow map not found' })
    res.json({ map: data })
  } catch (err) {
    console.error('[workflowMaps] get failed:', err.message)
    res.status(500).json({ error: 'Failed to load workflow map' })
  }
})

// POST / — create (blank, from a template, or from an imported file).
router.post('/', async (req, res) => {
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
router.put('/:id', async (req, res) => {
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
router.post('/:id/duplicate', async (req, res) => {
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
router.delete('/:id', async (req, res) => {
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
