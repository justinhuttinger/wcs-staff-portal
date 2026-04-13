const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, ROLE_HIERARCHY } = require('../middleware/role')

const router = Router()
router.use(authenticate)

/**
 * Filter items by min_role — returns only items the user's role can see.
 * null min_role = visible to everyone.
 */
function filterByRole(items, userRole) {
  const userLevel = ROLE_HIERARCHY.indexOf(userRole)
  return items.filter(item => {
    if (!item.min_role) return true
    const minLevel = ROLE_HIERARCHY.indexOf(item.min_role)
    return minLevel === -1 || userLevel >= minLevel
  })
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

// GET /help-center/categories — all users (filtered by role)
router.get('/categories', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('help_categories')
      .select('*')
      .order('sort_order')
      .order('name')
    if (error) throw error
    const filtered = filterByRole(data || [], req.staff.role)
    res.json({ categories: filtered })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories: ' + err.message })
  }
})

// POST /help-center/categories — admin only
router.post('/categories', requireRole('admin'), async (req, res) => {
  const { name, description, sort_order, min_role } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  try {
    const { data, error } = await supabaseAdmin
      .from('help_categories')
      .insert({ name: name.trim(), description: description?.trim() || null, sort_order: sort_order || 0, min_role: min_role || null })
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
  const { name, description, sort_order, min_role } = req.body
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' })

  try {
    const { data, error } = await supabaseAdmin
      .from('help_categories')
      .update({ name: name.trim(), description: description?.trim() || null, sort_order: sort_order ?? 0, min_role: min_role || null, updated_at: new Date().toISOString() })
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

// GET /help-center/articles — all users (filtered by role), optional ?category_id= filter
router.get('/articles', async (req, res) => {
  try {
    let query = supabaseAdmin
      .from('help_articles')
      .select('*, help_categories(name, min_role)')
      .order('sort_order')
      .order('title')
    if (req.query.category_id) {
      query = query.eq('category_id', req.query.category_id)
    }
    const { data, error } = await query
    if (error) throw error
    // Filter by article's own min_role AND parent category's min_role
    const { resolveRole } = require('../middleware/role')
    const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
    const filtered = (data || []).filter(article => {
      // Check article-level role
      if (article.min_role) {
        const artLevel = ROLE_HIERARCHY.indexOf(article.min_role)
        if (artLevel !== -1 && userLevel < artLevel) return false
      }
      // Check category-level role
      if (article.help_categories?.min_role) {
        const catLevel = ROLE_HIERARCHY.indexOf(article.help_categories.min_role)
        if (catLevel !== -1 && userLevel < catLevel) return false
      }
      return true
    })
    res.json({ articles: filtered })
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch articles: ' + err.message })
  }
})

// GET /help-center/articles/:id — all users (respects min_role)
router.get('/articles/:id', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('help_articles')
      .select('*, help_categories(name)')
      .eq('id', req.params.id)
      .maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Article not found' })

    // Enforce min_role access check (same as list endpoint)
    if (data.min_role) {
      const { ROLE_HIERARCHY, resolveRole } = require('../middleware/role')
      const userLevel = ROLE_HIERARCHY.indexOf(resolveRole(req.staff.role))
      const minLevel = ROLE_HIERARCHY.indexOf(data.min_role)
      if (minLevel !== -1 && userLevel < minLevel) {
        return res.status(403).json({ error: 'Insufficient role to view this article' })
      }
    }

    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch article: ' + err.message })
  }
})

// POST /help-center/articles — admin only
router.post('/articles', requireRole('admin'), async (req, res) => {
  const { category_id, title, body, sort_order, min_role } = req.body
  if (!category_id || !title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'category_id, title, and body are required' })
  }

  try {
    const { data, error } = await supabaseAdmin
      .from('help_articles')
      .insert({ category_id, title: title.trim(), body: body.trim(), sort_order: sort_order || 0, min_role: min_role || null, created_by: req.staff.id })
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
  const { category_id, title, body, sort_order, min_role } = req.body
  if (!title?.trim() || !body?.trim()) {
    return res.status(400).json({ error: 'title and body are required' })
  }

  try {
    const updates = { title: title.trim(), body: body.trim(), sort_order: sort_order ?? 0, min_role: min_role || null, updated_at: new Date().toISOString() }
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

// ---------------------------------------------------------------------------
// POST /help-center/upload-image — admin only
// Downloads an external image and uploads to Supabase Storage
// ---------------------------------------------------------------------------
router.post('/upload-image', requireRole('admin'), async (req, res) => {
  const { url } = req.body
  if (!url) return res.status(400).json({ error: 'url is required' })

  // SSRF protection: only allow https URLs, block internal/private IPs
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'Only HTTPS URLs are allowed' })
    }
    // Block common internal hostnames
    const host = parsed.hostname.toLowerCase()
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.startsWith('169.254.') || host.startsWith('10.') || host.startsWith('192.168.') || host.endsWith('.internal') || host.endsWith('.local')) {
      return res.status(400).json({ error: 'Internal URLs are not allowed' })
    }
  } catch {
    return res.status(400).json({ error: 'Invalid URL' })
  }

  try {
    // Download the image
    const imgResp = await fetch(url)
    if (!imgResp.ok) throw new Error(`Failed to download image: ${imgResp.status}`)

    const contentType = imgResp.headers.get('content-type') || 'image/jpeg'
    const buffer = Buffer.from(await imgResp.arrayBuffer())

    // Generate a unique filename
    const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const fileName = `articles/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

    // Upload to Supabase Storage
    const { error: uploadErr } = await supabaseAdmin.storage
      .from('help-center')
      .upload(fileName, buffer, { contentType, upsert: false })

    if (uploadErr) throw uploadErr

    // Get public URL
    const { data: urlData } = supabaseAdmin.storage
      .from('help-center')
      .getPublicUrl(fileName)

    res.json({ publicUrl: urlData.publicUrl })
  } catch (err) {
    console.error('[HelpCenter] Image upload failed:', err.message)
    res.status(500).json({ error: 'Failed to upload image: ' + err.message })
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
