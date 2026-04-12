const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole, canSeeAllLocations } = require('../middleware/role')

const router = Router()
router.use(authenticate)

// ---------------------------------------------------------------------------
// POST /communication-notes  (team_member+)
// ---------------------------------------------------------------------------
router.post('/', requireRole('team_member'), async (req, res) => {
  const { title, category, body } = req.body

  if (!title || !category || !body) {
    return res.status(400).json({ error: 'title, category, and body are required' })
  }

  const validCategories = ['member', 'billing', 'cancel', 'equipment', 'other']
  if (!validCategories.includes(category)) {
    return res.status(400).json({ error: 'Invalid category. Must be one of: ' + validCategories.join(', ') })
  }

  try {
    const staffName = req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' ')
    const primaryLocation = req.staff.locations?.find(l => l.is_primary)
    const locationSlug = primaryLocation?.name?.toLowerCase() || null

    // Look up location_id from locations table by name
    let locationId = null
    if (locationSlug) {
      const { data: loc } = await supabaseAdmin
        .from('locations')
        .select('id')
        .ilike('name', locationSlug)
        .maybeSingle()
      locationId = loc?.id || null
    }

    const { data, error } = await supabaseAdmin
      .from('communication_notes')
      .insert({
        title,
        category,
        body,
        status: 'unresolved',
        location_id: locationId,
        location_slug: locationSlug,
        submitted_by: req.staff.id,
        submitted_by_name: staffName,
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json(data)
  } catch (err) {
    console.error('[CommunicationNotes] Error creating note:', err.message)
    res.status(500).json({ error: 'Failed to create note: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /communication-notes  (fd_lead+)
// ---------------------------------------------------------------------------
router.get('/', requireRole('fd_lead'), async (req, res) => {
  const { status, category, location_slug } = req.query

  try {
    let query = supabaseAdmin
      .from('communication_notes')
      .select('*, comment_count:communication_note_comments(count)')
      .order('created_at', { ascending: false })

    // Location scoping
    if (canSeeAllLocations(req.staff.role)) {
      if (location_slug) {
        query = query.eq('location_slug', location_slug)
      }
    } else {
      const primarySlug = req.staff.locations?.find(l => l.is_primary)?.name?.toLowerCase() || null
      query = query.eq('location_slug', primarySlug)
    }

    if (status) query = query.eq('status', status)
    if (category) query = query.eq('category', category)

    const { data, error } = await query

    if (error) throw error

    // Flatten the comment_count from Supabase's aggregate format
    const notes = (data || []).map(note => ({
      ...note,
      comment_count: note.comment_count?.[0]?.count || 0,
    }))

    res.json(notes)
  } catch (err) {
    console.error('[CommunicationNotes] Error listing notes:', err.message)
    res.status(500).json({ error: 'Failed to list notes: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// PUT /communication-notes/:id  (fd_lead+)
// ---------------------------------------------------------------------------
router.put('/:id', requireRole('fd_lead'), async (req, res) => {
  const { id } = req.params
  const { status, title, category, body } = req.body

  try {
    // Fetch current note to detect status transitions
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('communication_notes')
      .select('status')
      .eq('id', id)
      .maybeSingle()

    if (fetchErr) throw fetchErr
    if (!existing) return res.status(404).json({ error: 'Note not found' })

    const updates = { updated_at: new Date().toISOString() }
    if (title !== undefined) updates.title = title
    if (category !== undefined) updates.category = category
    if (body !== undefined) updates.body = body

    if (status !== undefined) {
      updates.status = status

      if (status === 'completed' && existing.status !== 'completed') {
        const staffName = req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' ')
        updates.completed_by = req.staff.id
        updates.completed_by_name = staffName
        updates.completed_at = new Date().toISOString()
      } else if (status !== 'completed' && existing.status === 'completed') {
        updates.completed_by = null
        updates.completed_by_name = null
        updates.completed_at = null
      }
    }

    const { data, error } = await supabaseAdmin
      .from('communication_notes')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    res.json(data)
  } catch (err) {
    console.error('[CommunicationNotes] Error updating note:', err.message)
    res.status(500).json({ error: 'Failed to update note: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// GET /communication-notes/:id/comments  (fd_lead+)
// ---------------------------------------------------------------------------
router.get('/:id/comments', requireRole('fd_lead'), async (req, res) => {
  const { id } = req.params

  try {
    const { data, error } = await supabaseAdmin
      .from('communication_note_comments')
      .select('*')
      .eq('note_id', id)
      .order('created_at', { ascending: true })

    if (error) throw error

    res.json(data || [])
  } catch (err) {
    console.error('[CommunicationNotes] Error listing comments:', err.message)
    res.status(500).json({ error: 'Failed to list comments: ' + err.message })
  }
})

// ---------------------------------------------------------------------------
// POST /communication-notes/:id/comments  (fd_lead+)
// ---------------------------------------------------------------------------
router.post('/:id/comments', requireRole('fd_lead'), async (req, res) => {
  const { id } = req.params
  const { body } = req.body

  if (!body) {
    return res.status(400).json({ error: 'body is required' })
  }

  try {
    const staffName = req.staff.display_name || [req.staff.first_name, req.staff.last_name].filter(Boolean).join(' ')

    const { data, error } = await supabaseAdmin
      .from('communication_note_comments')
      .insert({
        note_id: id,
        body,
        author_id: req.staff.id,
        author_name: staffName,
      })
      .select()
      .single()

    if (error) throw error

    res.status(201).json(data)
  } catch (err) {
    console.error('[CommunicationNotes] Error creating comment:', err.message)
    res.status(500).json({ error: 'Failed to create comment: ' + err.message })
  }
})

module.exports = router
