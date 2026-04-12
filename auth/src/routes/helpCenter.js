const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

// GET /help-center/categories — all users
router.get('/categories', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('help_categories')
      .select('*')
      .order('sort_order')
      .order('name')
    if (error) throw error
    res.json({ categories: data || [] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories: ' + err.message })
  }
})

// POST /help-center/categories — admin only
router.post('/categories', requireRole('admin'), async (req, res) => {
  const { name, description, sort_order } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  try {
    const { data, error } = await supabaseAdmin
      .from('help_categories')
      .insert({ name: name.trim(), description: description?.trim() || null, sort_order: sort_order || 0 })
      .select()
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to create category: ' + err.message })
  }
})

// PUT /help-center/categories/:id — admin only
router.put('/categories/:id', requireRole('admin'), async (req, res) => {
  const { name, description, sort_order } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  try {
    const { data, error } = await supabaseAdmin
      .from('help_categories')
      .update({ name: name.trim(), description: description?.trim() || null, sort_order: sort_order ?? 0, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select()
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to update category: ' + err.message })
  }
})

// DELETE /help-center/categories/:id — admin only
router.delete('/categories/:id', requireRole('admin'), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('help_categories')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete category: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------

// GET /help-center/articles — all users, optional ?category_id= filter
router.get('/articles', async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('help_articles')
      .select('*, help_categories(name)')
      .order('sort_order')
      .order('title')
    if (req.query.category_id) {
      query = query.eq('category_id', req.query.category_id)
    }
    const { data, error } = await query
    if (error) throw error
    res.json({ articles: data || [] })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch articles: ' + err.message })
  }
})

// GET /help-center/articles/:id — all users
router.get('/articles/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('help_articles')
      .select('*, help_categories(name)')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Article not found' })
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch article: ' + err.message })
  }
})

// POST /help-center/articles — admin only
router.post('/articles', requireRole('admin'), async (req, res) => {
  const { category_id, title, body, sort_order } = req.body
  if (!category_id || !title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'category_id, title, and body are required' })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('help_articles')
      .insert({ category_id, title: title.trim(), body: body.trim(), sort_order: sort_order || 0, created_by: req.staff.id })
      .select('*, help_categories(name)')
      .single()
    if (error) throw error
    res.status(201).json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to create article: ' + err.message })
  }
})

// PUT /help-center/articles/:id — admin only
router.put('/articles/:id', requireRole('admin'), async (req, res) => {
  const { category_id, title, body, sort_order } = req.body
  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'title and body are required' })
  }

  try {
    const updates = { title: title.trim(), body: body.trim(), sort_order: sort_order ?? 0, updated_at: new Date().toISOString() }
    if (category_id) updates.category_id = category_id

    const { data, error } = await supabaseAdmin
      .from('help_articles')
      .update(updates)
      .eq('id', req.params.id)
      .select('*, help_categories(name)')
      .single()
    if (error) throw error
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to update article: ' + err.message })
  }
})

// DELETE /help-center/articles/:id — admin only
router.delete('/articles/:id', requireRole('admin'), async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('help_articles')
      .delete()
      .eq('id', req.params.id)
    if (error) throw error
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete article: ' + err.message })
  }
})

module.exports = router
