// GHL's internal workflow API (backend.leadconnectorhq.com), the one the
// workflow builder itself uses. The public API can only list workflows, so
// reading a full definition and writing one needs the signed-in user's GHL
// session token. The portal sends it per request (X-GHL-Session); it is never
// stored or logged here.
//
// Endpoints and headers match what the builder sends (verified against the
// "Workflow Importer/Exporter for GHL" Chrome extension, v2.0.0):
//   GET  /workflow/{loc}/{id}?includeScheduledPauseInfo=true  full definition
//   GET  /workflow/{loc}/trigger?workflowId={id}              triggers
//   POST /workflow/{loc}                                      create (draft)
//   PUT  /workflow/{loc}/{id}                                 save steps + settings
//   PUT  /workflow/{loc}/only-triggers/{id}                   replace triggers
const { ghlFetch } = require('./ghlClient')

const BACKEND = 'https://backend.leadconnectorhq.com'

class GhlSessionError extends Error {}

function sessionHeaders(token, extra) {
  const bare = String(token || '').replace(/^Bearer\s+/i, '').trim()
  return {
    authorization: `Bearer ${bare}`,
    'token-id': bare,
    channel: 'APP',
    source: 'WEB_USER',
    version: '2021-07-28',
    accept: 'application/json, text/plain, */*',
    ...(extra || {}),
  }
}

async function backend(token, path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BACKEND}${path}`, {
    method,
    headers: sessionHeaders(token, body ? { 'content-type': 'application/json' } : null),
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (res.status === 401 || res.status === 403) {
    throw new GhlSessionError(`GHL session rejected (${res.status}). Send a fresh session from GHL.`)
  }
  if (!res.ok) throw new Error(`GHL ${method} ${path.split('?')[0]} -> ${res.status}: ${text.slice(0, 300)}`)
  try { return text ? JSON.parse(text) : null } catch { return text }
}

// Some responses wrap the workflow ({ workflow }, { data }); return the object
// that holds workflowData.
function unwrapWorkflow(obj) {
  if (obj?.workflowData) return obj
  if (obj?.workflow?.workflowData) return obj.workflow
  if (obj?.data?.workflowData) return obj.data
  return obj
}

function unwrapTriggers(obj) {
  if (Array.isArray(obj)) return obj
  if (Array.isArray(obj?.triggers)) return obj.triggers
  if (Array.isArray(obj?.data)) return obj.data
  return []
}

const enc = encodeURIComponent

async function getWorkflow(token, loc, id) {
  return unwrapWorkflow(await backend(token, `/workflow/${enc(loc)}/${enc(id)}?includeScheduledPauseInfo=true&_=${Date.now()}`))
}

async function getTriggers(token, loc, id) {
  return unwrapTriggers(await backend(token, `/workflow/${enc(loc)}/trigger?workflowId=${enc(id)}`))
}

async function exportWorkflow(token, loc, id) {
  const [workflow, triggers] = await Promise.all([getWorkflow(token, loc, id), getTriggers(token, loc, id)])
  return { workflow, triggers }
}

// Cheap call to confirm a token works for a location before a long run.
async function checkSession(token, loc, anyWorkflowId) {
  if (anyWorkflowId) await getTriggers(token, loc, anyWorkflowId)
  else await backend(token, `/workflow/${enc(loc)}/list?parentId=root&limit=1`)
  return true
}

async function createDraft(token, loc, name) {
  const created = await backend(token, `/workflow/${enc(loc)}`, {
    method: 'POST',
    body: { name, status: 'draft', parentId: null, workflowData: { templates: [] } },
  })
  const id = created?.id || created?._id || created?.workflow?.id || created?.data?.id
  if (!id) throw new Error('GHL created the workflow but returned no id')
  return id
}

// GHL-style 20-character id for fresh trigger records.
function genId(len = 20) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let s = ''
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)]
  return s
}

const COPIED_SETTINGS = ['timezone', 'allowMultiple', 'allowMultipleOpportunity', 'stopOnResponse',
  'removeContactFromLastStep', 'autoMarkAsRead']

// Writes `source` (an already-remapped { workflow, triggers }) over the target
// workflow `id`: steps and settings first, then triggers. The target keeps its
// own id, version, folder and publish status.
async function writeWorkflow(token, loc, id, source, { name } = {}) {
  const target = await getWorkflow(token, loc, id)
  const oldTriggers = await getTriggers(token, loc, id)

  target.workflowData = source.workflow.workflowData || { templates: [] }
  if (source.workflow.meta) target.meta = source.workflow.meta
  if (name) target.name = name
  for (const k of COPIED_SETTINGS) if (k in source.workflow) target[k] = source.workflow[k]
  target.createdSteps = []
  target.modifiedSteps = []
  target.deletedSteps = []
  target.triggersChanged = false
  await backend(token, `/workflow/${enc(loc)}/${enc(id)}`, { method: 'PUT', body: target })

  const srcTriggers = source.triggers || []
  let triggersWritten = 0
  if (srcTriggers.length || oldTriggers.length) {
    // The PUT above bumped the version; the triggers write must carry the
    // current one or GHL answers 422 "Your version is outdated".
    const base = await getWorkflow(token, loc, id)
    const now = new Date().toISOString()
    const newTriggers = srcTriggers.map((t) => {
      const nt = { ...t }
      delete nt._id
      nt.id = genId()
      nt.workflow_id = id
      nt.location_id = loc
      nt.deleted = false
      nt.date_added = now
      nt.date_updated = now
      nt.actions = (Array.isArray(nt.actions) && nt.actions.length ? nt.actions : [{ type: 'add_to_workflow' }])
        .map(a => ({ ...a, workflow_id: id }))
      return nt
    })
    const resp = await backend(token, `/workflow/${enc(loc)}/only-triggers/${enc(id)}`, {
      method: 'PUT',
      body: { ...base, newTriggers, oldTriggers, triggersChanged: true },
    })
    // GHL answered 2xx yet applied nothing on the first live run (2026-10-07),
    // so keep the shape of its answer for diagnosis. No token is in it.
    console.log('[ghlWorkflowBackend] only-triggers response:', JSON.stringify(resp)?.slice(0, 500))
    triggersWritten = newTriggers.length
  }

  // GHL can accept a triggers write and still not keep every trigger, without
  // an error. Read them back so a dropped trigger is reported, not silent.
  let droppedTriggers = []
  if (srcTriggers.length) {
    const kept = await getTriggers(token, loc, id).catch(() => null)
    if (kept) {
      // Triggers that were there before the write don't count as copied: if
      // GHL ignores the whole triggers call, the old ones are all still there.
      const oldIds = new Set(oldTriggers.map(t => t.id))
      const pool = kept.filter(t => !t.deleted && !oldIds.has(t.id)).map(t => `${t.type}|${t.name}`)
      for (const t of srcTriggers) {
        const i = pool.indexOf(`${t.type}|${t.name}`)
        if (i === -1) droppedTriggers.push({ type: t.type, name: t.name || t.type })
        else pool.splice(i, 1)
      }
    }
  }
  return {
    steps: (target.workflowData.templates || []).length,
    triggers: triggersWritten - droppedTriggers.length,
    droppedTriggers,
  }
}

// ── Catalog (public API, per-location private integration token) ─────────
// Everything a workflow can reference by id, keyed for remapping. A category
// that fails to load (missing scope, GHL hiccup) comes back null so the
// preview can say it could not be checked.

const CATALOG_TTL = 5 * 60 * 1000
const catalogCache = new Map()

async function safe(fn) {
  try { return await fn() } catch (err) {
    console.warn('[ghlWorkflowBackend] catalog part failed:', err.message.slice(0, 200))
    return null
  }
}

async function pagedForms(loc, apiKey, path, listKey) {
  const out = []
  for (let skip = 0; skip < 2000; skip += 50) {
    const body = await ghlFetch(path, apiKey, { params: { locationId: loc.id, limit: 50, skip } })
    const page = body?.[listKey] || []
    out.push(...page)
    if (page.length < 50) break
  }
  return out
}

async function loadCatalog(loc, { fresh = false } = {}) {
  const hit = catalogCache.get(loc.id)
  if (!fresh && hit && Date.now() - hit.at < CATALOG_TTL) return hit.catalog
  const key = loc.apiKey
  const pick = (arr, f) => (arr || []).map(f)

  const [customFields, customValues, tags, users, calendars, pipelines, forms, surveys, workflows] = await Promise.all([
    safe(async () => pick((await ghlFetch(`/locations/${loc.id}/customFields`, key))?.customFields, r => ({ id: r.id, name: r.name, fieldKey: r.fieldKey }))),
    safe(async () => pick((await ghlFetch(`/locations/${loc.id}/customValues`, key))?.customValues, r => ({ id: r.id, name: r.name }))),
    safe(async () => pick((await ghlFetch(`/locations/${loc.id}/tags`, key))?.tags, r => ({ id: r.id, name: r.name }))),
    safe(async () => pick((await ghlFetch('/users/', key, { params: { locationId: loc.id } }))?.users, r => ({ id: r.id, name: r.name, email: r.email }))),
    safe(async () => pick((await ghlFetch('/calendars/', key, { params: { locationId: loc.id }, version: '2021-04-15' }))?.calendars, r => ({ id: r.id, name: r.name }))),
    safe(async () => (await ghlFetch('/opportunities/pipelines', key, { params: { locationId: loc.id } }))?.pipelines || []),
    safe(async () => pick(await pagedForms(loc, key, '/forms/', 'forms'), r => ({ id: r.id, name: r.name }))),
    safe(async () => pick(await pagedForms(loc, key, '/surveys/', 'surveys'), r => ({ id: r.id, name: r.name }))),
    safe(async () => pick((await ghlFetch('/workflows/', key, { params: { locationId: loc.id } }))?.workflows, r => ({ id: r.id, name: r.name, status: r.status, updatedAt: r.updatedAt }))),
  ])

  const catalog = {
    customFields, customValues, tags, users, calendars, forms, surveys, workflows,
    pipelines: pipelines && pipelines.map(p => ({ id: p.id, name: p.name })),
    // Stage names repeat across pipelines, so a stage is identified by both.
    stages: pipelines && pipelines.flatMap(p => (p.stages || []).map(s => ({ id: s.id, name: `${p.name} / ${s.name}` }))),
  }
  catalogCache.set(loc.id, { at: Date.now(), catalog })
  return catalog
}

function forgetCatalog(locId) {
  catalogCache.delete(locId)
}

module.exports = {
  GhlSessionError, exportWorkflow, getWorkflow, getTriggers, checkSession,
  createDraft, writeWorkflow, loadCatalog, forgetCatalog,
}
