// Hub share links and submissions.
// - Owner routes (/hub/...): see a task's submissions (all or one club), get
//   or turn off the task's share link, and a "Copy for Claude" text block.
// - Public routes (/hub-share/...): the no-login share page data, and a
//   stable link per file that redirects to a fresh short-lived storage URL.
const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const dl = require('../services/hub/deliverables')
const { newUploadToken } = require('../services/hub/slots')
const { groupSubmissions, claudeBlock } = require('../services/hub/share')

const PORTAL_URL = process.env.PORTAL_URL || 'https://portal.wcstrength.com'
const API_URL = process.env.AUTH_API_URL || 'https://api.wcstrength.com'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/

const shareUrl = token => `${PORTAL_URL}/share.html?t=${encodeURIComponent(token)}`
const fileUrl = token => id => `${API_URL}/hub-share/${encodeURIComponent(token)}/files/${id}`

function must({ data, error }) {
  if (error) throw error
  return data
}
function fail(res, e) {
  const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500
  res.status(status).json({ error: status === 500 ? 'Something went wrong' : e.message })
  if (status === 500) console.error('[HubShare]', e.message)
}

async function submissionsFor(task, club = null, { withPaths = false } = {}) {
  const [deliverables, people, names] = await Promise.all([
    dl.loadTaskDeliverables(task),
    supabaseAdmin.from('hub_task_people').select('id, name').eq('task_id', task.id).then(must),
    dl.clubNames(),
  ])
  const groups = groupSubmissions({ deliverables, clubNames: names, people, clubOrder: task.clubs || [], club })
  if (!withPaths) return { groups }
  const paths = new Map()
  for (const d of deliverables) for (const s of d.slots) for (const i of s.items) if (i.storage_path) paths.set(i.id, i.storage_path)
  return { groups, paths }
}

async function tokenFor(taskId, create) {
  const row = must(await supabaseAdmin.from('hub_share_tokens').select('token').eq('task_id', taskId).maybeSingle())
  if (row || !create) return row?.token || null
  const token = newUploadToken()
  const { error } = await supabaseAdmin.from('hub_share_tokens').insert({ token, task_id: taskId })
  if (error) {
    // Created by a concurrent request: use that one.
    return must(await supabaseAdmin.from('hub_share_tokens').select('token').eq('task_id', taskId).single()).token
  }
  return token
}

// ---------- owner ----------
const owner = Router()
owner.use(ownerOnly)

async function ownTask(req) {
  if (!UUID_RE.test(String(req.params.id))) { const e = new Error('Not found'); e.status = 404; throw e }
  const t = must(await supabaseAdmin.from('hub_tasks').select('*').eq('id', req.params.id).eq('owner_staff_id', req.staff.id).maybeSingle())
  if (!t) { const e = new Error('Not found'); e.status = 404; throw e }
  return t
}

owner.get('/tasks/:id/submissions', async (req, res) => {
  try {
    const task = await ownTask(req)
    const club = req.query.club ? String(req.query.club) : null
    const { groups } = await submissionsFor(task, club)
    const token = await tokenFor(task.id, false)
    res.json({
      groups,
      shareUrl: token ? shareUrl(token) : null,
      claudeText: token ? claudeBlock({ taskTitle: task.title, shareUrl: shareUrl(token), groups, fileUrl: fileUrl(token) }) : null,
    })
  } catch (e) { fail(res, e) }
})

owner.post('/tasks/:id/share', async (req, res) => {
  try {
    const task = await ownTask(req)
    const token = await tokenFor(task.id, true)
    res.json({ url: shareUrl(token) })
  } catch (e) { fail(res, e) }
})

owner.delete('/tasks/:id/share', async (req, res) => {
  try {
    const task = await ownTask(req)
    must(await supabaseAdmin.from('hub_share_tokens').delete().eq('task_id', task.id))
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

// ---------- public ----------
const pub = Router()
pub.use(rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: true, legacyHeaders: false }))

async function taskForToken(token) {
  if (!TOKEN_RE.test(String(token))) return null
  const row = must(await supabaseAdmin.from('hub_share_tokens').select('task_id').eq('token', token).maybeSingle())
  if (!row) return null
  return must(await supabaseAdmin.from('hub_tasks').select('*').eq('id', row.task_id).maybeSingle())
}

pub.get('/:token', async (req, res) => {
  try {
    const task = await taskForToken(req.params.token)
    if (!task) return res.status(404).json({ error: 'This link is not valid' })
    const { groups, paths } = await submissionsFor(task, null, { withPaths: true })
    const link = fileUrl(req.params.token)
    // One batch of 1-hour URLs for inline images.
    const imageIds = groups.flatMap(g => g.items).filter(i => i.isFile && /^image\//.test(i.mime || '') && paths.has(i.id)).map(i => i.id)
    const signed = new Map()
    if (imageIds.length) {
      const { data } = await supabaseAdmin.storage.from(dl.BUCKET).createSignedUrls(imageIds.map(id => paths.get(id)), 60 * 60)
      ;(data || []).forEach((row, n) => { if (row?.signedUrl) signed.set(imageIds[n], row.signedUrl) })
    }
    res.json({
      taskTitle: task.title,
      groups: groups.map(g => ({ ...g, items: g.items.map(i => ({ ...i, url: i.isFile ? link(i.id) : null, imageUrl: signed.get(i.id) || null })) })),
    })
  } catch (e) { fail(res, e) }
})

pub.get('/:token/files/:itemId', async (req, res) => {
  try {
    const task = await taskForToken(req.params.token)
    if (!task || !UUID_RE.test(String(req.params.itemId))) return res.status(404).json({ error: 'Not found' })
    const item = must(await supabaseAdmin.from('hub_slot_items').select('id, slot_id, storage_path').eq('id', req.params.itemId).maybeSingle())
    if (!item?.storage_path) return res.status(404).json({ error: 'Not found' })
    const slot = must(await supabaseAdmin.from('hub_slots').select('deliverable_id').eq('id', item.slot_id).maybeSingle())
    const del = slot && must(await supabaseAdmin.from('hub_deliverables').select('task_id').eq('id', slot.deliverable_id).maybeSingle())
    if (!del || del.task_id !== task.id) return res.status(404).json({ error: 'Not found' })
    res.redirect(302, await dl.signedUrl(item.storage_path))
  } catch (e) { fail(res, e) }
})

module.exports = { owner, pub }
