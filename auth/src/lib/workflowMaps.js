// Input validation for the Workflow Maps API (routes/workflowMaps.js). Kept
// free of Supabase so it can be unit tested.

// Keep in sync with portal/src/components/workflowMaps/kinds.js.
const NODE_TYPES = new Set(['trigger', 'sms', 'email', 'wait', 'condition', 'call', 'action', 'goal', 'note'])
const STATUSES = new Set(['draft', 'live', 'paused', 'idea'])
const MAX_NODES = 500
const MAX_EDGES = 1000

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function cleanNode(n) {
  if (!isPlainObject(n) || typeof n.id !== 'string' || !n.id || n.id.length > 100) return null
  if (!NODE_TYPES.has(n.type)) return null
  const x = Number(n.position?.x)
  const y = Number(n.position?.y)
  return {
    id: n.id,
    type: n.type,
    position: { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 },
    data: isPlainObject(n.data) ? n.data : {},
  }
}

function cleanEdge(e, ids) {
  if (!isPlainObject(e) || !ids.has(e.source) || !ids.has(e.target)) return null
  const out = { id: String(e.id || `e-${e.source}-${e.target}`).slice(0, 200), source: e.source, target: e.target }
  if (typeof e.sourceHandle === 'string' && e.sourceHandle) out.sourceHandle = e.sourceHandle.slice(0, 100)
  return out
}

// Picks the writable fields out of a request body. Only fields present in the
// body are returned, so a rename doesn't have to resend the graph. Returns
// { fields } or { error }.
function sanitizeMapInput(body, { requireName = false } = {}) {
  const fields = {}
  if ('name' in body || requireName) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return { error: 'Name is required' }
    if (name.length > 200) return { error: 'Name is too long' }
    fields.name = name
  }
  for (const key of ['description', 'category', 'ghl_workflow_url']) {
    if (key in body) {
      if (body[key] != null && typeof body[key] !== 'string') return { error: `${key} must be text` }
      fields[key] = (body[key] || '').slice(0, key === 'description' ? 2000 : 500)
    }
  }
  if ('status' in body) {
    if (!STATUSES.has(body.status)) return { error: 'Invalid status' }
    fields.status = body.status
  }
  if ('clubs' in body) {
    if (!Array.isArray(body.clubs) || body.clubs.some(c => typeof c !== 'string')) return { error: 'clubs must be a list' }
    fields.clubs = body.clubs.slice(0, 50)
  }
  if ('viewport' in body) {
    const v = body.viewport
    fields.viewport = isPlainObject(v) && [v.x, v.y, v.zoom].every(Number.isFinite)
      ? { x: v.x, y: v.y, zoom: v.zoom } : null
  }
  if ('nodes' in body || 'edges' in body) {
    if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) return { error: 'nodes and edges must be sent together' }
    if (body.nodes.length > MAX_NODES) return { error: `A workflow map can have at most ${MAX_NODES} steps` }
    if (body.edges.length > MAX_EDGES) return { error: `A workflow map can have at most ${MAX_EDGES} connections` }
    const nodes = []
    const ids = new Set()
    for (const raw of body.nodes) {
      const n = cleanNode(raw)
      if (!n) return { error: 'A step is missing its id or has an unknown type' }
      if (ids.has(n.id)) return { error: 'Two steps share the same id' }
      ids.add(n.id)
      nodes.push(n)
    }
    fields.nodes = nodes
    fields.edges = body.edges.map(e => cleanEdge(e, ids)).filter(Boolean)
  }
  return { fields }
}

// A step linked to a GHL custom value stores { key, name }: key is the
// fieldKey ("custom_values.new_lead_sms_1"), the same in every club built from
// the snapshot; ids differ per club, so they are never stored on the step.
function normalizeCvKey(k) {
  return String(k || '').replace(/[{}\s]/g, '').toLowerCase()
}

// The club's value for a link: by key first, then by name (links made from
// a name only, e.g. the seeded flows).
function findLinkedValue(values, link) {
  if (!link) return null
  const key = normalizeCvKey(link.key)
  if (key) {
    const hit = values.find(v => normalizeCvKey(v.fieldKey) === key)
    if (hit) return hit
  }
  const name = String(link.name || '').trim().toLowerCase()
  return name ? values.find(v => String(v.name || '').trim().toLowerCase() === name) || null : null
}

// Workflow emails are stored as a pair of custom values, "<Name> HTML" and
// "<Name> Subject". Given the HTML value a step links to, find its subject.
function findEmailSubject(values, linked) {
  const m = String(linked?.name || '').trim().match(/^(.*\S)\s+html$/i)
  if (!m) return null
  const want = (m[1] + ' subject').toLowerCase()
  return values.find(v => String(v.name || '').trim().toLowerCase() === want) || null
}

module.exports = { sanitizeMapInput, NODE_TYPES, normalizeCvKey, findLinkedValue, findEmailSubject }
