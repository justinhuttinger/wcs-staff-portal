// Workflow Transfer: export GHL workflows as JSON (one or a whole club at
// once) and copy them into other clubs with every location-scoped id remapped.
// Owner-only tool under Marketing (see WORKFLOW_TRANSFER_EMAILS).
//
// Reads of the club's workflow list and the remap catalogs use the per-club
// private integration tokens. Reading a full workflow and writing one need the
// signed-in GHL user's session token, which the portal passes per request in
// X-GHL-Session (from the Agency Custom JS hand-off). It is never stored.
//
// Every overwrite saves the target's current definition to
// ghl_workflow_snapshots first (migration 234), so a push can be undone by
// pushing the snapshot back.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { LOCATIONS, getLocationBySlug, getLocationById } = require('../config/ghlLocations')
const ghl = require('../services/ghlWorkflowBackend')
const { buildIdMap, remapPayload, normalizePayload } = require('../lib/ghlWorkflowRemap')
const { keysIn, pickClubKey, maskKey } = require('../lib/webhookKeys')

const router = Router()

const OWNER_EMAILS = (process.env.WORKFLOW_TRANSFER_EMAILS || 'justin@wcstrength.com')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)

function requireOwner(req, res, next) {
  if (!OWNER_EMAILS.includes(String(req.staff?.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Not available' })
  }
  next()
}

router.use(authenticate)
router.use(requireRole('admin'))
router.use(requireOwner)

const EXPORT_FORMAT = 'wcs-ghl-workflow@1'
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/

function clubOr404(req, res, slug) {
  const loc = getLocationBySlug(String(slug || ''))
  if (!loc) res.status(404).json({ error: 'Unknown club' })
  return loc
}

function sessionToken(req) {
  const t = String(req.get('x-ghl-session') || '').replace(/^Bearer\s+/i, '').trim()
  // A GHL session token is a JWT; anything else is not worth sending on.
  return /^[\w-]+\.[\w-]+\.[\w-]+$/.test(t) ? t : null
}

function needSession(req, res) {
  const t = sessionToken(req)
  if (!t) res.status(409).json({ error: 'No GHL session. Use "Send to portal" in GHL first.', code: 'ghl_session' })
  return t
}

// Session problems are a 409 with a code, not a 401: the portal's api()
// treats a 401 as its own login expiring.
function fail(res, err, what) {
  if (err instanceof ghl.GhlSessionError) {
    return res.status(409).json({ error: err.message, code: 'ghl_session' })
  }
  console.error(`[ghlWorkflowTransfer] ${what}:`, err.message)
  res.status(502).json({ error: `${what}: ${err.message}` })
}

const clubOf = loc => ({ slug: loc.slug, name: loc.name })

// GET /clubs
router.get('/clubs', (req, res) => {
  res.json({ clubs: LOCATIONS.map(clubOf) })
})

// GET /clubs/:club/workflows — public API list, no session needed.
router.get('/clubs/:club/workflows', async (req, res) => {
  const loc = clubOr404(req, res, req.params.club)
  if (!loc) return
  try {
    const catalog = await ghl.loadCatalog(loc, { fresh: req.query.fresh === '1' })
    if (!catalog.workflows) throw new Error('GHL did not return the workflow list')
    const workflows = [...catalog.workflows]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    res.json({ club: clubOf(loc), workflows })
  } catch (err) {
    fail(res, err, 'Could not list workflows')
  }
})

// POST /session-check { club } — confirms the GHL session works for a club.
router.post('/session-check', async (req, res) => {
  const token = needSession(req, res)
  if (!token) return
  const loc = clubOr404(req, res, req.body?.club || LOCATIONS[0]?.slug)
  if (!loc) return
  try {
    const catalog = await ghl.loadCatalog(loc)
    await ghl.checkSession(token, loc.id, catalog.workflows?.[0]?.id)
    res.json({ ok: true })
  } catch (err) {
    fail(res, err, 'Session check failed')
  }
})

// GET /clubs/:club/folder?parentId= — one folder's subfolders and workflows
// (internal API, needs the session). No parentId = top level.
router.get('/clubs/:club/folder', async (req, res) => {
  const token = needSession(req, res)
  if (!token) return
  const loc = clubOr404(req, res, req.params.club)
  if (!loc) return
  const parentId = req.query.parentId ? String(req.query.parentId) : null
  if (parentId && !ID_RE.test(parentId)) return res.status(400).json({ error: 'Bad folder id' })
  try {
    const folder = await ghl.listFolder(token, loc.id, parentId)
    const path = parentId ? await ghl.folderPath(token, loc.id, parentId) : []
    res.json({ club: clubOf(loc), parentId, path, ...folder })
  } catch (err) {
    fail(res, err, 'Could not open folder')
  }
})

// GET /clubs/:club/workflows/:id/export — the full definition + triggers.
router.get('/clubs/:club/workflows/:id/export', async (req, res) => {
  const token = needSession(req, res)
  if (!token) return
  const loc = clubOr404(req, res, req.params.club)
  if (!loc) return
  if (!ID_RE.test(req.params.id)) return res.status(400).json({ error: 'Bad workflow id' })
  try {
    const { workflow, triggers } = await ghl.exportWorkflow(token, loc.id, req.params.id)
    // The folder it lives in, by name from the top, so copies can land in the
    // same folder in other clubs.
    const folderPath = workflow?.parentId ? await ghl.folderPath(token, loc.id, workflow.parentId).catch(() => []) : []
    res.json({
      folderPath,
      format: EXPORT_FORMAT,
      exportedAt: new Date().toISOString(),
      sourceClub: loc.slug,
      sourceLocationId: loc.id,
      name: workflow?.name || '',
      workflow,
      triggers,
    })
  } catch (err) {
    fail(res, err, 'Export failed')
  }
})

function parseTarget(t) {
  const loc = getLocationBySlug(String(t?.club || ''))
  if (!loc) throw Object.assign(new Error(`Unknown club "${t?.club}"`), { status: 400 })
  // 'fill' = write into a draft created moments ago by /prepare (new copy, no
  // backup needed). 'overwrite' = existing workflow, backed up first.
  const mode = ['overwrite', 'fill'].includes(t.mode) ? t.mode : 'new'
  const targetWorkflowId = mode !== 'new' ? String(t.targetWorkflowId || '') : null
  if (mode !== 'new' && !ID_RE.test(targetWorkflowId)) {
    throw Object.assign(new Error(`Pick the ${loc.name} workflow to overwrite`), { status: 400 })
  }
  const name = typeof t.name === 'string' ? t.name.trim().slice(0, 200) : ''
  const overrides = {}
  for (const [from, to] of Object.entries(t.overrides && typeof t.overrides === 'object' ? t.overrides : {})) {
    if (ID_RE.test(from) && ID_RE.test(String(to))) overrides[from] = String(to)
  }
  // folder: 'source' puts the copy in the same folder path as the source
  // (created if missing); 'keep' leaves an overwrite where it is and a new
  // copy at the top level. publish: new copies only, and only when nothing is
  // left unmatched.
  const folder = t.folder === 'keep' ? 'keep' : 'source'
  const publish = t.publish === true
  return { loc, mode, targetWorkflowId, name, overrides, folder, publish }
}

// Names a club's records carry besides its own name, ignored when matching.
const EXTRA_ALIASES = { milwaukie: ['East Side Athletic Club', 'East Side'] }
const aliasesFor = loc => [loc.name, loc.slug, ...(EXTRA_ALIASES[loc.slug] || [])]

// Everything needed to remap one payload into one club. No GHL writes.
async function plan(payload, target) {
  const sourceLoc = payload.sourceLocationId ? getLocationById(payload.sourceLocationId) : null
  const [srcCatalog, tgtCatalog] = await Promise.all([
    sourceLoc ? ghl.loadCatalog(sourceLoc) : null,
    ghl.loadCatalog(target.loc),
  ])
  const { map, unavailable } = srcCatalog
    ? buildIdMap(srcCatalog, tgtCatalog, { sourceAliases: aliasesFor(sourceLoc), targetAliases: aliasesFor(target.loc) })
    : { map: new Map(), unavailable: [] }
  // Overrides may only point at records that exist in the target club.
  const known = new Set(Object.values(tgtCatalog).flatMap(list => (list || []).map(r => r.id)))
  for (const [from, to] of Object.entries(target.overrides)) if (!known.has(to)) delete target.overrides[from]
  const name = target.name || payload.workflow.name || 'Imported workflow'
  const sameName = (tgtCatalog.workflows || []).filter(w => w.name.trim().toLowerCase() === name.trim().toLowerCase())
  const webhookKey = await planWebhookKey(payload, sourceLoc, target.loc)
  return { sourceLoc, map, unavailable, name, sameName, tgtCatalog, webhookKey }
}

// Webhook keys (see lib/webhookKeys): swap the source club's key for the
// target club's own, learned from that club's backups.
const keyHistoryCache = new Map()
const KEY_HISTORY_MS = 10 * 60 * 1000

async function clubKeyHistory(slug) {
  const hit = keyHistoryCache.get(slug)
  if (hit && Date.now() - hit.at < KEY_HISTORY_MS) return hit.rows
  const { data, error } = await supabaseAdmin.from('ghl_workflow_snapshots')
    .select('payload').eq('club_slug', slug)
    .order('created_at', { ascending: false }).limit(40)
  if (error) throw error
  const rows = (data || []).map(r => [...keysIn(r.payload)].join(' ')).filter(Boolean)
  keyHistoryCache.set(slug, { at: Date.now(), rows })
  return rows
}

async function planWebhookKey(payload, sourceLoc, targetLoc) {
  const sourceKeys = keysIn(payload.workflow)
  if (!sourceKeys.size) return { status: 'none', swaps: {} }
  if (sourceLoc && sourceLoc.id === targetLoc.id) return { status: 'same-club', swaps: {} }
  if (sourceKeys.size > 1) return { status: 'several', swaps: {} }
  const [src] = sourceKeys
  const { key } = pickClubKey(await clubKeyHistory(targetLoc.slug).catch(() => []), sourceKeys)
  if (!key) return { status: 'missing', swaps: {}, source: maskKey(src) }
  return { status: 'swapped', swaps: { [src]: key }, source: maskKey(src), target: maskKey(key) }
}

const CATEGORY_LABELS = {
  customFields: 'custom fields', customValues: 'custom values', tags: 'tags', users: 'users',
  calendars: 'calendars', pipelines: 'pipelines', stages: 'pipeline stages', forms: 'forms',
  surveys: 'surveys', workflows: 'workflows',
}

function warningsFor(p, payload) {
  const w = []
  const k = p.webhookKey || {}
  if (k.status === 'missing') w.push(`Custom webhooks use another club's key (${k.source}) and this club's own key is not known yet. Set it on those webhook steps in GHL after pushing.`)
  if (k.status === 'several') w.push('Custom webhooks use more than one key; check their keys in GHL after pushing.')
  if (!payload.sourceLocationId) w.push('The file does not say which sub-account it came from, so ids were not remapped.')
  else if (!p.sourceLoc) w.push('The file came from a sub-account outside the 7 clubs, so ids were not remapped.')
  for (const u of p.unavailable) {
    w.push(`Could not load ${CATEGORY_LABELS[u.category] || u.category} for the ${u.side} club, so those ids were not checked.`)
  }
  return w
}

// POST /preview { payload, targets: [{ club, mode, targetWorkflowId?, name? }] }
router.post('/preview', async (req, res) => {
  let payload
  try { payload = normalizePayload(req.body?.payload) } catch (err) { return res.status(400).json({ error: err.message }) }
  const targets = Array.isArray(req.body?.targets) ? req.body.targets.slice(0, 20) : []
  if (!targets.length) return res.status(400).json({ error: 'Pick at least one club' })
  // Names of workflows being created in the same copy: links to them resolve
  // once their drafts exist, so they are not "not found".
  const batchNames = new Set((Array.isArray(req.body?.batchNames) ? req.body.batchNames : [])
    .map(n => String(n).trim().toLowerCase()))
  try {
    const results = []
    for (const raw of targets) {
      const target = parseTarget(raw)
      const p = await plan(payload, target)
      const srcId = payload.workflow.id || payload.workflow._id
      const out = remapPayload(payload, {
        idMap: p.map,
        sourceLocationId: payload.sourceLocationId,
        targetLocationId: target.loc.id,
        extra: { ...(srcId && target.targetWorkflowId ? { [srcId]: target.targetWorkflowId } : {}), ...p.webhookKey.swaps },
        overrides: target.overrides,
      })
      // Target records to pick from for anything that did not match by name.
      const options = {}
      for (const u of [...out.unmatched, ...out.matched.filter(m => m.manual || m.ambiguous)]) {
        if (!options[u.category]) {
          options[u.category] = (p.tgtCatalog[u.category] || []).map(r => ({ id: r.id, name: r.email || r.fieldKey || r.name }))
        }
      }
      const inBatch = out.unmatched.filter(u => u.category === 'workflows' && batchNames.has(String(u.name).trim().toLowerCase()))
      out.unmatched = out.unmatched.filter(u => !inBatch.includes(u))
      out.matched.push(...inBatch.map(u => ({ ...u, inBatch: true })))
      results.push({
        club: clubOf(target.loc),
        mode: target.mode,
        folderPath: payload.folderPath || [],
        name: p.name,
        targetWorkflowId: target.targetWorkflowId,
        sameName: p.sameName.map(w => ({ id: w.id, name: w.name, status: w.status })),
        steps: (payload.workflow.workflowData?.templates || []).length,
        triggers: payload.triggers.length,
        matched: out.matched,
        unmatched: out.unmatched,
        options,
        webhookKey: { status: p.webhookKey.status, source: p.webhookKey.source, target: p.webhookKey.target },
        warnings: warningsFor(p, payload),
      })
    }
    res.json({ results })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    fail(res, err, 'Preview failed')
  }
})

async function saveSnapshot(token, loc, workflowId, staff, reason) {
  const { workflow, triggers } = await ghl.exportWorkflow(token, loc.id, workflowId)
  const { data, error } = await supabaseAdmin.from('ghl_workflow_snapshots').insert({
    location_id: loc.id,
    club_slug: loc.slug,
    workflow_id: workflowId,
    workflow_name: workflow?.name || '',
    reason,
    payload: {
      format: EXPORT_FORMAT, exportedAt: new Date().toISOString(),
      sourceClub: loc.slug, sourceLocationId: loc.id, name: workflow?.name || '', workflow, triggers,
    },
    created_by: staff.id,
    created_by_name: staff.display_name || staff.email || null,
  }).select('id').single()
  if (error) throw new Error(`Could not save the backup snapshot: ${error.message}`)
  return data.id
}

// POST /prepare { club, items: [{ name, folderPath }], folder: 'source'|'keep' }
// Creates an empty draft for every NEW workflow in a batch before any is
// filled in, so workflows that add/remove each other resolve to the club's
// new copies. Folders are created as needed. Returns [{ name, id }].
router.post('/prepare', async (req, res) => {
  const token = needSession(req, res)
  if (!token) return
  const loc = clubOr404(req, res, req.body?.club)
  if (!loc) return
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 100)
  const useFolders = req.body?.folder !== 'keep'
  const drafts = []
  try {
    const folders = new Map()
    let company = null
    for (const it of items) {
      const name = String(it?.name || '').trim().slice(0, 200)
      if (!name) continue
      const id = await ghl.createDraft(token, loc.id, name)
      drafts.push({ name, id })
      const path = useFolders && Array.isArray(it.folderPath) ? it.folderPath.map(String).slice(0, 10) : []
      if (path.length) {
        if (!company) {
          const wf = await ghl.getWorkflow(token, loc.id, id)
          company = { companyId: wf.companyId, companyAge: wf.companyAge }
        }
        const key = path.join('\u0000')
        if (!folders.has(key)) folders.set(key, await ghl.ensureFolderPath(token, loc.id, path, company))
        await ghl.moveToFolder(token, loc.id, id, folders.get(key).folderId)
      }
    }
    ghl.forgetCatalog(loc.id)
    const createdFolders = [...new Set([...folders.values()].flatMap(f => f.created))]
    console.log(`[ghlWorkflowTransfer] ${req.staff.email} prepared ${drafts.length} drafts in ${loc.slug}${createdFolders.length ? `, created folders: ${createdFolders.join(', ')}` : ''}`)
    res.json({ drafts, createdFolders })
  } catch (err) {
    if (drafts.length) err.message += ` (${drafts.length} empty draft(s) already created in ${loc.name}: ${drafts.map(d => d.name).join(', ')})`
    fail(res, err, `Preparing drafts in ${loc.name} failed`)
  }
})

// POST /push { payload, target: { club, mode, targetWorkflowId?, name? } }
// One club per call; the portal loops so each club reports on its own.
router.post('/push', async (req, res) => {
  const token = needSession(req, res)
  if (!token) return
  let payload, target
  try {
    payload = normalizePayload(req.body?.payload)
    target = parseTarget(req.body?.target)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }
  try {
    const p = await plan(payload, target)
    let workflowId = target.targetWorkflowId
    let snapshotId = null
    if (target.mode === 'overwrite') {
      // Never overwrite without a backup.
      snapshotId = await saveSnapshot(token, target.loc, workflowId, req.staff, 'pre_overwrite')
    } else if (target.mode === 'new') {
      workflowId = await ghl.createDraft(token, target.loc.id, p.name)
    }

    const srcId = payload.workflow.id || payload.workflow._id
    const out = remapPayload(payload, {
      idMap: p.map,
      sourceLocationId: payload.sourceLocationId,
      targetLocationId: target.loc.id,
      extra: { ...(srcId ? { [srcId]: workflowId } : {}), ...p.webhookKey.swaps },
      overrides: target.overrides,
    })
    const isNew = target.mode !== 'overwrite'
    // Publish only a new copy with nothing left unmatched.
    const publishBlocked = target.publish && isNew && out.unmatched.length
      ? `${out.unmatched.length} item(s) not found`
      : null
    const publish = target.publish && isNew && !publishBlocked
    let written
    try {
      written = await ghl.writeWorkflow(token, target.loc.id, workflowId, out, {
        name: isNew || target.name ? p.name : undefined,
        publish,
      })
    } catch (err) {
      if (target.mode !== 'overwrite') {
        err.message += ` (an empty draft "${p.name}" was left in ${target.loc.name}; overwrite it or delete it in GHL)`
      } else {
        err.message += ` (backup snapshot saved first)`
      }
      throw err
    }
    // Anything that went wrong with triggers means it should not be live.
    let published = publish
    let unpublishReason = publishBlocked
    if (publish && (written.droppedTriggers.length || written.unlinkedTriggerChecks.length)) {
      await ghl.setStatus(token, target.loc.id, workflowId, 'draft')
      published = false
      unpublishReason = 'a trigger did not copy'
    }

    // Folder: same path as the source, created if missing. A fresh draft from
    // /prepare is already there; this is a no-op for it.
    let folder = null
    if (target.folder === 'source' && payload.folderPath?.length) {
      const now = await ghl.getWorkflow(token, target.loc.id, workflowId)
      const { folderId, created } = await ghl.ensureFolderPath(token, target.loc.id, payload.folderPath,
        { companyId: now.companyId, companyAge: now.companyAge })
      if (now.parentId !== folderId) await ghl.moveToFolder(token, target.loc.id, workflowId, folderId)
      const after = await ghl.getWorkflow(token, target.loc.id, workflowId)
      folder = { path: payload.folderPath, created, ok: after.parentId === folderId }
    }
    if (published) {
      const after = await ghl.getWorkflow(token, target.loc.id, workflowId)
      published = after.status === 'published'
      if (!published) unpublishReason = 'GHL kept it as a draft'
    }

    ghl.forgetCatalog(target.loc.id)
    console.log(`[ghlWorkflowTransfer] ${req.staff.email} ${target.mode} "${p.name}" -> ${target.loc.slug} ${workflowId} (${written.steps} steps, ${written.triggers} triggers added, ${written.triggersAlreadyThere} already there, ${written.removedTriggers.length} removed${written.droppedTriggers.length ? `, GHL DROPPED: ${written.droppedTriggers.map(t => t.type + ' "' + t.name + '"').join(', ')}` : ''})`)
    res.json({
      club: clubOf(target.loc),
      mode: target.mode,
      workflowId,
      name: p.name,
      snapshotId,
      steps: written.steps,
      triggers: written.triggers,
      droppedTriggers: written.droppedTriggers,
      triggersAlreadyThere: written.triggersAlreadyThere,
      removedTriggers: written.removedTriggers,
      notRemovedTriggers: written.notRemovedTriggers,
      triggersUntouched: written.triggersUntouched,
      unlinkedTriggerChecks: written.unlinkedTriggerChecks,
      unmatched: out.unmatched,
      folder,
      webhookKey: { status: p.webhookKey.status, target: p.webhookKey.target },
      published,
      unpublishReason: target.publish && isNew ? unpublishReason : null,
    })
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message })
    fail(res, err, `Push to ${target.loc.name} failed`)
  }
})

// POST /snapshots { club, workflowId } — manual backup.
router.post('/snapshots', async (req, res) => {
  const token = needSession(req, res)
  if (!token) return
  const loc = clubOr404(req, res, req.body?.club)
  if (!loc) return
  const workflowId = String(req.body?.workflowId || '')
  if (!ID_RE.test(workflowId)) return res.status(400).json({ error: 'Bad workflow id' })
  try {
    const id = await saveSnapshot(token, loc, workflowId, req.staff, 'manual')
    res.json({ id })
  } catch (err) {
    fail(res, err, 'Snapshot failed')
  }
})

// GET /snapshots?club=&workflowId= — newest first, without payloads.
router.get('/snapshots', async (req, res) => {
  try {
    let q = supabaseAdmin.from('ghl_workflow_snapshots')
      .select('id, club_slug, location_id, workflow_id, workflow_name, reason, created_by_name, created_at')
      .order('created_at', { ascending: false }).limit(200)
    if (req.query.club) q = q.eq('club_slug', String(req.query.club))
    if (req.query.workflowId) q = q.eq('workflow_id', String(req.query.workflowId))
    const { data, error } = await q
    if (error) throw error
    res.json({ snapshots: data || [] })
  } catch (err) {
    console.error('[ghlWorkflowTransfer] snapshots list:', err.message)
    res.status(500).json({ error: 'Could not load snapshots' })
  }
})

// GET /snapshots/:id — one snapshot with its payload (restorable / downloadable).
router.get('/snapshots/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('ghl_workflow_snapshots')
      .select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Snapshot not found' })
    res.json({ snapshot: data })
  } catch (err) {
    console.error('[ghlWorkflowTransfer] snapshot get:', err.message)
    res.status(500).json({ error: 'Could not load snapshot' })
  }
})

module.exports = router
