// Hub > Tasks: the owner's private task list (categories, tasks, and the
// people attached to each). Owner-only. Emails to people live in later routes.
const { Router } = require('express')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')
const { cleanTaskInput, rowSignal, PERSON_LIST_COLS } = require('../services/hub/taskModel')
const dl = require('../services/hub/deliverables')

const router = Router()
router.use(ownerOnly)

const STATUSES = ['todo', 'waiting', 'done', 'dropped']

function sendError(res, e) {
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

async function ownCategory(req, id) {
  if (!id) return true
  const { data } = await supabaseAdmin.from('hub_categories').select('id')
    .eq('id', id).eq('owner_staff_id', req.staff.id).maybeSingle()
  return !!data
}

router.get('/tasks', async (req, res) => {
  try {
    const owner = req.staff.id
    const [{ data: tasks, error: tErr }, { data: categories, error: cErr }] = await Promise.all([
      supabaseAdmin.from('hub_tasks').select('*').eq('owner_staff_id', owner)
        .order('created_at', { ascending: false }).limit(2000),
      supabaseAdmin.from('hub_categories').select('*').eq('owner_staff_id', owner)
        .order('sort', { ascending: true }).order('name', { ascending: true }),
    ])
    if (tErr) throw tErr
    if (cErr) throw cErr
    const ids = (tasks || []).map(t => t.id)
    let people = []
    if (ids.length) {
      const { data, error } = await supabaseAdmin.from('hub_task_people')
        .select(PERSON_LIST_COLS)
        .in('task_id', ids)
      if (error) throw error
      people = data || []
    }
    // Only open tasks need the deliverables summary (keeps the list fast).
    const summary = await dl.summaryByTask((tasks || []).filter(t => t.status === 'todo' || t.status === 'waiting').map(t => t.id))
    const byTask = new Map()
    for (const p of people) {
      if (!byTask.has(p.task_id)) byTask.set(p.task_id, [])
      byTask.get(p.task_id).push(p)
    }
    res.json({
      tasks: (tasks || []).map(t => {
        const ps = byTask.get(t.id) || []
        return { ...t, people: ps, signal: rowSignal(t, ps, summary.get(t.id)) }
      }),
      categories: categories || [],
    })
  } catch (e) { sendError(res, e) }
})

router.post('/tasks', async (req, res) => {
  try {
    const { fields, error } = cleanTaskInput(req.body || {})
    if (error) return res.status(400).json({ error })
    if (!(await ownCategory(req, fields.category_id))) return res.status(400).json({ error: 'Unknown category' })
    const { data, error: insErr } = await supabaseAdmin.from('hub_tasks')
      .insert({ ...fields, owner_staff_id: req.staff.id }).select('*').single()
    if (insErr) throw insErr
    res.json({ task: { ...data, people: [], signal: rowSignal(data, []) } })
  } catch (e) { sendError(res, e) }
})

router.patch('/tasks/:id', async (req, res) => {
  try {
    const body = req.body || {}
    const { fields, error } = cleanTaskInput(body, { partial: true })
    if (error) return res.status(400).json({ error })
    if ('category_id' in fields && !(await ownCategory(req, fields.category_id))) {
      return res.status(400).json({ error: 'Unknown category' })
    }
    const patch = { ...fields, updated_at: new Date().toISOString() }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return res.status(400).json({ error: 'Bad status' })
      patch.status = body.status
      patch.completed_at = body.status === 'done' ? patch.updated_at : null
    }
    const { data, error: upErr } = await supabaseAdmin.from('hub_tasks').update(patch)
      .eq('id', req.params.id).eq('owner_staff_id', req.staff.id).select('*').maybeSingle()
    if (upErr) throw upErr
    if (!data) return res.status(404).json({ error: 'Not found' })
    const { data: people } = await supabaseAdmin.from('hub_task_people')
      .select(PERSON_LIST_COLS)
      .eq('task_id', data.id)
    if ('clubs' in fields) await dl.resyncSlots(data)
    const summary = await dl.summaryByTask([data.id])
    res.json({ task: { ...data, people: people || [], signal: rowSignal(data, people || [], summary.get(data.id)) } })
  } catch (e) { sendError(res, e) }
})

router.get('/categories', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('hub_categories').select('*')
      .eq('owner_staff_id', req.staff.id).order('sort').order('name')
    if (error) throw error
    res.json({ categories: data || [] })
  } catch (e) { sendError(res, e) }
})

function cleanCategory(body = {}) {
  const out = {}
  if (body.name !== undefined) {
    const name = String(body.name || '').trim().slice(0, 60)
    if (!name) return { error: 'Name is required' }
    out.name = name
  }
  if (body.sort !== undefined) out.sort = Number.isFinite(Number(body.sort)) ? Math.trunc(Number(body.sort)) : 0
  return { out }
}

function categoryError(res, e) {
  if (e.code === '23505') return res.status(409).json({ error: 'A category with that name already exists' })
  sendError(res, e)
}

router.post('/categories', async (req, res) => {
  try {
    const { out, error } = cleanCategory(req.body)
    if (error || !out.name) return res.status(400).json({ error: error || 'Name is required' })
    const { data, error: insErr } = await supabaseAdmin.from('hub_categories')
      .insert({ ...out, owner_staff_id: req.staff.id }).select('*').single()
    if (insErr) throw insErr
    res.json({ category: data })
  } catch (e) { categoryError(res, e) }
})

router.patch('/categories/:id', async (req, res) => {
  try {
    const { out, error } = cleanCategory(req.body)
    if (error) return res.status(400).json({ error })
    const { data, error: upErr } = await supabaseAdmin.from('hub_categories').update(out)
      .eq('id', req.params.id).eq('owner_staff_id', req.staff.id).select('*').maybeSingle()
    if (upErr) throw upErr
    if (!data) return res.status(404).json({ error: 'Not found' })
    res.json({ category: data })
  } catch (e) { categoryError(res, e) }
})

module.exports = router
