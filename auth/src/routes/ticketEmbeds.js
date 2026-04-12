const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)

// GET /ticket-embeds — all users (except team_member, handled in frontend)
router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('ticket_embeds')
      .select('*')
      .order('sort_order')
      .order('name')
    if (error) throw error
    res.json({ embeds: data || [] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ticket embeds: ' + err.message })
  }
})

// POST /ticket-embeds — admin only
router.post('/', requireRole('admin'), async (req, res) => {
  const { name, description, iframe_url, sort_order } = req.body
  if (!name?.trim() || !iframe_url?.trim()) {
    return res.status(400).json({ error: 'name and iframe_url are required' })
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('ticket_embeds')
      .insert({ name: name.trim(), description: description?.trim() || null, iframe_url: iframe_url.trim(), sort_order: sort_order || 0 })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to create embed: ' + err.message })
  }
})

// PUT /ticket-embeds/:id — admin only
router.put('/:id', requireRole('admin'), async (req, res) => {
  const { name, description, iframe_url, sort_order } = req.body
  if (!name?.trim() || !iframe_url?.trim()) {
    return res.status(400).json({ error: 'name and iframe_url are required' })
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('ticket_embeds')
      .update({ name: name.trim(), description: description?.trim() || null, iframe_url: iframe_url.trim(), sort_order: sort_order ?? 0, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to update embed: ' + err.message })
  }
})

// DELETE /ticket-embeds/:id — admin only
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('ticket_embeds')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete embed: ' + err.message })
  }
})

module.exports = router
