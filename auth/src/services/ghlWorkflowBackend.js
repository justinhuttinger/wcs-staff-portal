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
const { replaceIds } = require('../lib/ghlWorkflowRemap')

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

// ── Folders ────────────────────────────────────────────────────────────────
// Folders are workflow records with type 'directory'. Calls captured from the
// GHL workflows list page (2026-10-07):
//   GET  /workflow/{loc}/list?parentId=..&limit=50&offset=..&sortBy=name&sortOrder=asc
//        -> { rows, count, folderName, parentId (the folder's own parent) }
//   POST /workflow/{loc}/directory { type, name, parentId, company_id, company_age } -> { id }
//   PUT  /workflow/{loc}/move-directory/{workflowId} { parentId }
const ROOT = 'root'
const LIST_PAGE = 50

async function listFolder(token, loc, parentId) {
  const rows = []
  let first = null
  for (let offset = 0; offset < 5000; offset += LIST_PAGE) {
    const qs = new URLSearchParams({
      parentId: parentId || ROOT, limit: String(LIST_PAGE), offset: String(offset),
      sortBy: 'name', sortOrder: 'asc', includeCustomObjects: 'true', includeObjectiveBuilder: 'true',
    })
    const page = await backend(token, `/workflow/${enc(loc)}/list?${qs}`)
    if (!first) first = page || {}
    const got = (page?.rows || []).filter(r => !r.deleted)
    const before = rows.length
    for (const r of got) if (!rows.some(x => x.id === r.id)) rows.push(r)
    if (got.length < LIST_PAGE || rows.length === before || rows.length >= (page?.count || 0)) break
  }
  return {
    folderName: first?.folderName || null,
    parentId: first?.parentId || null,
    folders: rows.filter(r => r.type === 'directory').map(r => ({ id: r.id, name: r.name })),
    workflows: rows.filter(r => r.type !== 'directory').map(r => ({ id: r.id, name: r.name, status: r.status, parentId: r.parentId })),
  }
}

// Folder names from the top down to `folderId`, e.g. ['WCS', 'Lead Calls'].
async function folderPath(token, loc, folderId, cache = new Map()) {
  const path = []
  let id = folderId
  for (let depth = 0; id && id !== ROOT && depth < 10; depth++) {
    let info = cache.get(id)
    if (!info) {
      info = await listFolder(token, loc, id)
      cache.set(id, info)
    }
    if (!info.folderName) break
    path.unshift(info.folderName)
    id = info.parentId
  }
  return path
}

const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

// Finds (or creates) the folder path in a location; returns the deepest
// folder's id, or null for the top level. `company` = { companyId, companyAge }.
async function ensureFolderPath(token, loc, path, company) {
  let parent = null
  const created = []
  for (const name of path || []) {
    const here = await listFolder(token, loc, parent)
    const found = here.folders.find(f => sameName(f.name, name))
    if (found) { parent = found.id; continue }
    const body = { type: 'directory', name, parentId: parent }
    if (company?.companyId) body.company_id = company.companyId
    if (company?.companyAge !== undefined) body.company_age = company.companyAge
    const resp = await backend(token, `/workflow/${enc(loc)}/directory`, { method: 'POST', body })
    const id = resp?.id || resp?._id
    if (!id) throw new Error(`GHL did not return an id for new folder "${name}"`)
    created.push(name)
    parent = id
  }
  return { folderId: parent, created }
}

async function setStatus(token, loc, id, status) {
  const wf = await getWorkflow(token, loc, id)
  if (wf.status === status) return
  wf.status = status
  wf.createdSteps = []
  wf.modifiedSteps = []
  wf.deletedSteps = []
  wf.triggersChanged = false
  await backend(token, `/workflow/${enc(loc)}/${enc(id)}`, { method: 'PUT', body: wf })
}

async function moveToFolder(token, loc, workflowId, folderId) {
  await backend(token, `/workflow/${enc(loc)}/move-directory/${enc(workflowId)}`, {
    method: 'PUT', body: { parentId: folderId || null },
  })
}

const COPIED_SETTINGS = ['timezone', 'allowMultiple', 'allowMultipleOpportunity', 'stopOnResponse',
  'removeContactFromLastStep', 'autoMarkAsRead']

// Trigger fields copied into a new trigger. Ids, dates, origin and ownership
// are GHL's to assign.
const TRIGGER_FIELDS = ['type', 'name', 'active', 'conditions', 'masterType', 'schedule_config',
  'custom_date_reminder_config', 'reminder_trigger_config', 'match_year']

// Two triggers are the same when type and conditions match (ids already
// remapped, so a copied Custom Date Reminder matches the club's own one).
function triggerSignature(t) {
  const conds = (Array.isArray(t.conditions) ? t.conditions : [])
    .map(c => [c.id, c.operator, c.field, JSON.stringify(c.value ?? null)].join('~'))
    .sort()
  return `${t.type}|${conds.join('&')}`
}

function triggerIdOf(resp) {
  return resp?.id || resp?._id || resp?.trigger?.id || resp?.trigger?._id || resp?.data?.id || null
}

// Writes `source` (an already-remapped { workflow, triggers }) over the target
// workflow `id`. The target keeps its own id, version, folder and publish status.
//
// Triggers go FIRST, because steps can point at them: an if/else "Workflow
// Trigger is ..." condition stores the trigger's id (conditionType 'trigger',
// conditionValue = trigger id). Once every source trigger has a target trigger,
// the source trigger ids inside the steps are swapped for the target's, and
// only then are the steps saved.
//
// Triggers are MERGED, not replaced: a source trigger the target already has
// (same type and conditions) is reused, a missing one is added, and a target
// trigger the source lacks is left in place and reported. Adding works the way
// the builder does it (captured 2026-10-07): POST /workflow/{loc}/trigger
// creates the record, then PUT /only-triggers/{id} saves the trigger list with
// newTriggers = old + created, oldTriggers = old. Sending made-up ids to
// only-triggers alone (the Chrome extension's way) is accepted and ignored.
async function writeWorkflow(token, loc, id, source, { name, publish } = {}) {
  const oldTriggers = (await getTriggers(token, loc, id)).filter(t => !t.deleted)
  const srcTriggers = (source.triggers || []).filter(t => !t.deleted)

  // Source trigger id -> target trigger id.
  const triggerIds = {}
  const bySig = new Map()
  for (const t of oldTriggers) if (!bySig.has(triggerSignature(t))) bySig.set(triggerSignature(t), t)
  const toCreate = []
  for (const t of srcTriggers) {
    const match = bySig.get(triggerSignature(t))
    if (match) triggerIds[t.id] = match.id
    else toCreate.push(t)
  }
  const alreadyThere = srcTriggers.length - toCreate.length
  const srcSigs = new Set(srcTriggers.map(triggerSignature))
  const extraTriggers = oldTriggers
    .filter(t => !srcSigs.has(triggerSignature(t)))
    .map(t => ({ type: t.type, name: t.name || t.type }))

  if (toCreate.length) {
    let base = await getWorkflow(token, loc, id)
    const created = []
    for (const t of toCreate) {
      const body = {}
      for (const k of TRIGGER_FIELDS) if (k in t) body[k] = t[k]
      if (!body.schedule_config) body.schedule_config = {}
      body.actions = (Array.isArray(t.actions) && t.actions.length ? t.actions : [{ type: 'add_to_workflow' }])
        .map(a => ({ ...a, workflow_id: id }))
      body.location_id = loc
      body.workflowId = id
      body.status = base.status
      body.company_id = base.companyId
      if (base.companyAge !== undefined) body.company_age = base.companyAge
      body.triggersChanged = true
      const resp = await backend(token, `/workflow/${enc(loc)}/trigger`, { method: 'POST', body })
      created.push({ src: t, sig: triggerSignature(t), resp, triggerId: triggerIdOf(resp) })
    }

    // Resolve the created records: the id GHL returned, else find the new
    // trigger in the list by signature.
    const listed = (await getTriggers(token, loc, id)).filter(t => !t.deleted)
    const oldIds = new Set(oldTriggers.map(t => t.id))
    const fresh = listed.filter(t => !oldIds.has(t.id))
    const records = created.map(c =>
      (c.triggerId && listed.find(t => t.id === c.triggerId)) ||
      (c.triggerId && typeof c.resp === 'object' && c.resp?.type ? c.resp : null) ||
      fresh.find(t => triggerSignature(t) === c.sig) ||
      null)
    created.forEach((c, i) => {
      const recId = records[i]?.id || c.triggerId
      if (recId && c.src.id) triggerIds[c.src.id] = recId
    })
    if (records.some(r => !r)) {
      console.warn('[ghlWorkflowBackend] trigger POST gave no usable record:',
        JSON.stringify(created.filter((c, i) => !records[i]).map(c => c.resp)).slice(0, 500))
    }

    // Save the trigger list, exactly as the builder does after adding one.
    base = await getWorkflow(token, loc, id)
    await backend(token, `/workflow/${enc(loc)}/only-triggers/${enc(id)}`, {
      method: 'PUT',
      body: { ...base, newTriggers: [...oldTriggers, ...records.filter(Boolean)], oldTriggers, triggersChanged: true },
    })
  }

  // Steps: swap source trigger ids for the target's, then save.
  const swaps = new Map(Object.entries(triggerIds).filter(([from, to]) => from && to && from !== to))
  const { value: workflowData } = replaceIds(source.workflow.workflowData || { templates: [] }, swaps)
  const unresolved = srcTriggers.filter(t => !triggerIds[t.id] && JSON.stringify(workflowData).includes(t.id))

  const target = await getWorkflow(token, loc, id)
  target.workflowData = workflowData
  if (source.workflow.meta) target.meta = source.workflow.meta
  if (name) target.name = name
  for (const k of COPIED_SETTINGS) if (k in source.workflow) target[k] = source.workflow[k]
  target.createdSteps = []
  target.modifiedSteps = []
  target.deletedSteps = []
  target.triggersChanged = false
  // Publishing is the same save with status 'published' (the builder's toggle).
  if (publish) target.status = 'published'
  await backend(token, `/workflow/${enc(loc)}/${enc(id)}`, { method: 'PUT', body: target })

  // Read back: every trigger we meant to add must now be there.
  let droppedTriggers = []
  if (toCreate.length) {
    const after = (await getTriggers(token, loc, id).catch(() => [])).filter(t => !t.deleted)
    const afterSigs = after.map(triggerSignature)
    droppedTriggers = toCreate
      .filter(t => !afterSigs.includes(triggerSignature(t)))
      .map(t => ({ type: t.type, name: t.name || t.type }))
  }

  return {
    steps: (workflowData.templates || []).length,
    triggers: toCreate.length - droppedTriggers.length,
    triggersAlreadyThere: alreadyThere,
    droppedTriggers,
    extraTriggers,
    // Steps that check "Workflow Trigger is ..." against a trigger we could not
    // place in the target; those branches need fixing by hand.
    unlinkedTriggerChecks: unresolved.map(t => ({ type: t.type, name: t.name || t.type })),
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
  createDraft, writeWorkflow, loadCatalog, forgetCatalog, triggerSignature,
  listFolder, folderPath, ensureFolderPath, moveToFolder, setStatus,
}
