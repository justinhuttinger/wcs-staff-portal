// Hub > saved people: name, email and the clubs each person covers, reused
// when adding people to tasks. Owner-only.
const { Router } = require('express')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(ownerOnly)

const EMAIL_RE = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/
const SLUG_RE = /^[a-z0-9-]{2,40}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function sendError(res, e) {
  if (e.code === '23505') return res.status(409).json({ error: 'Someone with that email is already saved' })
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

// { fields } or { error }; partial for PATCH.
function cleanContact(body = {}, partial = false) {
  const has = k => Object.prototype.hasOwnProperty.call(body, k)
  const out = {}
  if (!partial || has('name')) {
    const name = String(body.name || '').trim().slice(0, 120)
    if (!name) return { error: 'Name is required' }
    out.name = name
  }
  if (!partial || has('email')) {
    const email = String(body.email || '').trim().toLowerCase().slice(0, 200)
    if (!EMAIL_RE.test(email)) return { error: 'A valid email is required' }
    out.email = email
  }
  if (!partial || has('clubs')) {
    const list = Array.isArray(body.clubs) ? body.clubs : []
    out.clubs = [...new Set(list.map(String).filter(s => SLUG_RE.test(s)))]
  }
  return { fields: out }
}

router.get('/contacts', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin.from('hub_contacts').select('*')
      .eq('owner_staff_id', req.staff.id).order('name')
    if (error) throw error
    res.json({ contacts: data || [] })
  } catch (e) { sendError(res, e) }
})

router.post('/contacts', async (req, res) => {
  try {
    const { fields, error } = cleanContact(req.body)
    if (error) return res.status(400).json({ error })
    const { data, error: insErr } = await supabaseAdmin.from('hub_contacts')
      .insert({ ...fields, owner_staff_id: req.staff.id }).select('*').single()
    if (insErr) throw insErr
    res.json({ contact: data })
  } catch (e) { sendError(res, e) }
})

router.patch('/contacts/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const { fields, error } = cleanContact(req.body, true)
    if (error) return res.status(400).json({ error })
    const { data, error: upErr } = await supabaseAdmin.from('hub_contacts').update(fields)
      .eq('id', req.params.id).eq('owner_staff_id', req.staff.id).select('*').maybeSingle()
    if (upErr) throw upErr
    if (!data) return res.status(404).json({ error: 'Not found' })
    res.json({ contact: data })
  } catch (e) { sendError(res, e) }
})

// People already on tasks keep their own copy of name, email and clubs.
router.delete('/contacts/:id', async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(404).json({ error: 'Not found' })
    const { error } = await supabaseAdmin.from('hub_contacts').delete()
      .eq('id', req.params.id).eq('owner_staff_id', req.staff.id)
    if (error) throw error
    res.json({ ok: true })
  } catch (e) { sendError(res, e) }
})

module.exports = { router, cleanContact }
