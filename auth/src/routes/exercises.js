// auth/src/routes/exercises.js
// The Coaching exercise library (memberapp_exercises): search for the program
// builder's picker, trainer-made custom exercises, and playable video.
//
// Gate: manager+ for now, like /member-app. Coaching PR 3 opens this to
// personal trainers through the coaching permission. Sync is admin-only.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const ymoveClient = require('../services/ymoveClient')
const { syncYmove } = require('../services/exerciseSync')
const { MUSCLES } = require('../lib/exerciseLibrary')
const { searchPattern, validateCustom, canEdit, createVideoResolver } = require('./exercisesHelpers')

const router = Router()
router.use(authenticate)

const TABLE = 'memberapp_exercises'
const LIST_COLS = 'id, source, name, primary_muscle, secondary_muscles, equipment, category, difficulty, thumbnail_url, has_video'
const DETAIL_COLS = `${LIST_COLS}, instructions, cues, created_by, updated_at`

const actor = (req) => req.staff?.email || req.staff?.id || 'unknown'
const fail = (res, status, message) => res.status(status).json({ error: message })
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const resolveVideo = createVideoResolver({ client: ymoveClient })

// POST /exercises/sync — pull YMove metadata now (also runs nightly).
router.post('/sync', requireRole('admin'), async (req, res) => {
  try {
    res.json(await syncYmove())
  } catch (err) {
    fail(res, 502, err.message)
  }
})

router.use(requireRole('manager'))

// GET /exercises?q=&muscle=&equipment=&source=&page=1&pageSize=24
router.get('/', async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize, 10) || 24))
  let query = supabaseAdmin.from(TABLE).select(LIST_COLS, { count: 'exact' }).eq('is_active', true)

  const pattern = searchPattern(req.query.q)
  if (pattern) query = query.ilike('name', pattern)
  const muscle = String(req.query.muscle || '').toLowerCase()
  if (muscle) query = query.eq('primary_muscle', muscle)
  const equipment = String(req.query.equipment || '').toLowerCase()
  if (equipment) query = query.eq('equipment', equipment)
  const source = String(req.query.source || '')
  if (['free', 'ymove', 'custom'].includes(source)) query = query.eq('source', source)

  const from = (page - 1) * pageSize
  const { data, count, error } = await query.order('name').range(from, from + pageSize - 1)
  if (error) return fail(res, 502, error.message)
  res.json({ exercises: data || [], total: count || 0, page, pageSize })
})

// GET /exercises/facets — filter options for the picker.
router.get('/facets', async (req, res) => {
  const { data, error } = await supabaseAdmin.from(TABLE).select('equipment').eq('is_active', true).not('equipment', 'is', null).limit(5000)
  if (error) return fail(res, 502, error.message)
  const equipment = [...new Set((data || []).map(r => r.equipment))].sort()
  res.json({ muscles: MUSCLES, equipment })
})

async function loadRow(id) {
  if (!UUID_RE.test(String(id))) return null
  const { data, error } = await supabaseAdmin.from(TABLE).select(`${DETAIL_COLS}, source_id, video_url`).eq('id', id).maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

// GET /exercises/:id
router.get('/:id', async (req, res) => {
  try {
    const row = await loadRow(req.params.id)
    if (!row) return fail(res, 404, 'Exercise not found.')
    const { source_id, video_url, ...exercise } = row
    res.json({ exercise })
  } catch (err) {
    fail(res, 502, err.message)
  }
})

// GET /exercises/:id/video — a playable URL, fetched fresh (YMove URLs expire).
router.get('/:id/video', async (req, res) => {
  try {
    const row = await loadRow(req.params.id)
    if (!row) return fail(res, 404, 'Exercise not found.')
    const video = await resolveVideo(row)
    if (!video) return fail(res, 503, 'Video not available yet')
    res.json(video)
  } catch (err) {
    fail(res, 502, err.message)
  }
})

// POST /exercises — a trainer-made exercise.
router.post('/', async (req, res) => {
  const { row, error } = validateCustom(req.body)
  if (error) return fail(res, 400, error)
  const { data, error: dbError } = await supabaseAdmin
    .from(TABLE)
    .insert({ ...row, source: 'custom', created_by: actor(req) })
    .select(DETAIL_COLS)
    .single()
  if (dbError) return fail(res, 502, dbError.message)
  res.status(201).json({ exercise: data })
})

// PUT /exercises/:id — custom exercises only; vendor rows are read-only.
router.put('/:id', async (req, res) => {
  try {
    const existing = await loadRow(req.params.id)
    if (!existing) return fail(res, 404, 'Exercise not found.')
    if (!canEdit(existing)) return fail(res, 403, 'Library exercises can’t be edited. Add your own instead.')
    const { row, error } = validateCustom(req.body)
    if (error) return fail(res, 400, error)
    const { data, error: dbError } = await supabaseAdmin
      .from(TABLE)
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select(DETAIL_COLS)
      .single()
    if (dbError) return fail(res, 502, dbError.message)
    res.json({ exercise: data })
  } catch (err) {
    fail(res, 502, err.message)
  }
})

module.exports = router
