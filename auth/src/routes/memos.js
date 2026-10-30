// Monthly club memo. Company editors ('memos:company-edit') write the month's
// company section and mark it ready; each club's managers then add notes and
// publish that club's memo. Everyone with the tile reads their club's live memo.
// See docs/superpowers/specs/2026-10-30-monthly-memo-design.md.
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireTile } = require('../middleware/tile')
const { canSeeAllLocations, roleLevel, ROLE_HIERARCHY } = require('../middleware/role')
const { getVisibleTools } = require('../services/visibleTools')
const { CLUBS } = require('../config/clubs')
const {
  LOCK_SCREEN_MAX, monthKey, pickLiveMemo, clubStatus, parseDates, canEditClub, canPublish, cleanText,
} = require('../lib/memoRules')

const router = Router()
router.use(authenticate)
router.use(requireTile('memos'))

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COMPANY_PERM = 'memos:company-edit'

// The clubs this caller belongs to. null = every club (corporate+).
async function clubScope(staff) {
  if (canSeeAllLocations(staff.role)) return null
  const ids = staff.location_ids || []
  if (ids.length === 0) return []
  const { data } = await supabaseAdmin.from('locations').select('name').in('id', ids)
  return (data || []).map(l => l.name?.toLowerCase()).filter(Boolean)
}

async function enabledClubs() {
  const { data, error } = await supabaseAdmin.from('memo_clubs').select('club_slug').eq('enabled', true)
  if (error) throw error
  const on = new Set((data || []).map(r => r.club_slug))
  return CLUBS.filter(c => on.has(c.slug)).map(c => ({ slug: c.slug, name: c.name }))
}

async function canEditCompany(staff) {
  return (await getVisibleTools(staff)).includes(COMPANY_PERM)
}

function isManagerPlus(staff) {
  return roleLevel(staff.role) >= ROLE_HIERARCHY.indexOf('manager')
}

async function requireCompanyEditor(req, res, next) {
  try {
    if (await canEditCompany(req.staff)) return next()
    res.status(403).json({ error: 'Only company memo editors can do this' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}

// Manager+ of this club, on a real enabled club and an existing edition.
async function loadClubContext(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid memo id' })
    if (!isManagerPlus(req.staff)) return res.status(403).json({ error: 'Only managers can edit club memos' })
    const scope = await clubScope(req.staff)
    if (!canEditClub(scope, req.params.slug)) return res.status(403).json({ error: 'That club is not one of yours' })
    const clubs = await enabledClubs()
    if (!clubs.some(c => c.slug === req.params.slug)) return res.status(404).json({ error: 'Club not found' })
    const { data: edition, error } = await supabaseAdmin
      .from('memo_editions').select('*').eq('id', req.params.id).maybeSingle()
    if (error) throw error
    if (!edition) return res.status(404).json({ error: 'Memo not found' })
    if (!canPublish(edition)) return res.status(409).json({ error: 'The company section is not ready yet' })
    req.edition = edition
    next()
  } catch (err) {
    console.error('[Memos] club context error:', err.message)
    res.status(500).json({ error: err.message })
  }
}

function fail(res, label, err) {
  console.error(`[Memos] ${label} error:`, err.message)
  res.status(500).json({ error: err.message })
}

// Only the fields present in the request change, so saving dates can't blank notes.
function textFields(body) {
  const out = {}
  if (body?.notes !== undefined) out.notes = cleanText(body.notes)
  if (body?.lock_screen_text !== undefined) out.lock_screen_text = cleanText(body.lock_screen_text, LOCK_SCREEN_MAX)
  return out
}

// GET /live?club=salem — the caller's clubs and the club's live memo.
router.get('/live', async (req, res) => {
  try {
    const scope = await clubScope(req.staff)
    const clubs = (await enabledClubs()).filter(c => canEditClub(scope, c.slug))
    const club = clubs.find(c => c.slug === req.query.club) || clubs[0] || null
    if (!club) return res.json({ clubs: [], club: null, memo: null })

    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .select('id, status, notes, starts_at, ends_at, memo_editions(month, company_body)')
      .eq('club_slug', club.slug)
      .eq('status', 'published')
    if (error) throw error
    const live = pickLiveMemo(data || [])
    res.json({
      clubs,
      club,
      memo: live && {
        month: live.memo_editions?.month,
        company_body: live.memo_editions?.company_body || '',
        notes: live.notes,
        starts_at: live.starts_at,
        ends_at: live.ends_at,
      },
    })
  } catch (err) {
    fail(res, 'live', err)
  }
})

// GET /manage — editions and per-club status. Company editors see every club and
// draft editions; managers see their clubs and only editions that are ready.
router.get('/manage', async (req, res) => {
  try {
    const company = await canEditCompany(req.staff)
    const manager = isManagerPlus(req.staff)
    if (!company && !manager) return res.status(403).json({ error: 'Not allowed' })

    const scope = await clubScope(req.staff)
    const all = await enabledClubs()
    const clubs = all
      .filter(c => company || canEditClub(scope, c.slug))
      .map(c => ({ ...c, editable: manager && canEditClub(scope, c.slug) }))

    let q = supabaseAdmin.from('memo_editions').select('*').order('month', { ascending: false }).limit(24)
    if (!company) q = q.eq('status', 'ready')
    const { data: editions, error } = await q
    if (error) throw error

    // Live is per club across ALL months, so read every published row, not just
    // the months listed.
    const slugs = clubs.map(c => c.slug)
    const { data: rows, error: rowsErr } = slugs.length
      ? await supabaseAdmin.from('club_memos').select('*').in('club_slug', slugs)
      : { data: [], error: null }
    if (rowsErr) throw rowsErr

    const now = new Date()
    const liveByClub = {}
    for (const slug of slugs) {
      liveByClub[slug] = pickLiveMemo((rows || []).filter(r => r.club_slug === slug), now)?.id || null
    }
    res.json({
      can: { company, clubs: manager && clubs.some(c => c.editable) },
      clubs,
      lock_screen_max: LOCK_SCREEN_MAX,
      editions: (editions || []).map(e => ({
        ...e,
        club_memos: Object.fromEntries(slugs.map(slug => {
          const row = (rows || []).find(r => r.edition_id === e.id && r.club_slug === slug) || null
          return [slug, { ...(row || {}), state: clubStatus(row, liveByClub[slug], now) }]
        })),
      })),
    })
  } catch (err) {
    fail(res, 'manage', err)
  }
})

// POST /editions { month: 'YYYY-MM' } — start a month.
router.post('/editions', requireCompanyEditor, async (req, res) => {
  try {
    const month = monthKey(req.body?.month)
    if (!month) return res.status(400).json({ error: 'Pick a month' })
    const { data, error } = await supabaseAdmin
      .from('memo_editions')
      .insert({ month, created_by: req.staff.id, updated_by: req.staff.id })
      .select()
      .single()
    if (error?.code === '23505') return res.status(409).json({ error: 'That month already exists' })
    if (error) throw error
    res.status(201).json({ edition: data })
  } catch (err) {
    fail(res, 'create edition', err)
  }
})

// PUT /editions/:id { company_body?, ready? } — edit the company section. Live
// memos read it directly, so edits after publishing show right away.
router.put('/editions/:id', requireCompanyEditor, async (req, res) => {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid memo id' })
    const update = { updated_by: req.staff.id, updated_at: new Date().toISOString() }
    if (req.body?.company_body !== undefined) update.company_body = cleanText(req.body.company_body)

    if (req.body?.ready === true) {
      const { data: current, error: readErr } = await supabaseAdmin
        .from('memo_editions').select('company_body').eq('id', req.params.id).maybeSingle()
      if (readErr) throw readErr
      if (!current) return res.status(404).json({ error: 'Memo not found' })
      if (!(update.company_body ?? current.company_body)) {
        return res.status(400).json({ error: 'Write the company section first' })
      }
      update.status = 'ready'
      update.ready_at = update.updated_at
    } else if (req.body?.ready === false) {
      const { count, error: countErr } = await supabaseAdmin
        .from('club_memos').select('id', { count: 'exact', head: true })
        .eq('edition_id', req.params.id).eq('status', 'published')
      if (countErr) throw countErr
      if (count > 0) return res.status(409).json({ error: 'Clubs have already published this month' })
      update.status = 'draft'
      update.ready_at = null
    }

    const { data, error } = await supabaseAdmin
      .from('memo_editions').update(update).eq('id', req.params.id).select().maybeSingle()
    if (error) throw error
    if (!data) return res.status(404).json({ error: 'Memo not found' })
    res.json({ edition: data })
  } catch (err) {
    fail(res, 'update edition', err)
  }
})

// PUT /editions/:id/clubs/:slug { notes?, lock_screen_text? } — save without
// changing whether it's published.
router.put('/editions/:id/clubs/:slug', loadClubContext, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .upsert({
        edition_id: req.edition.id,
        club_slug: req.params.slug,
        ...textFields(req.body),
        updated_by: req.staff.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'edition_id,club_slug' })
      .select()
      .single()
    if (error) throw error
    res.json({ memo: data })
  } catch (err) {
    fail(res, 'save club memo', err)
  }
})

// POST /editions/:id/clubs/:slug/publish { notes?, lock_screen_text?, starts_at?, ends_at? }
// Publish, or change the dates of a published memo. No start = show now.
router.post('/editions/:id/clubs/:slug/publish', loadClubContext, async (req, res) => {
  try {
    const now = new Date()
    const dates = parseDates(req.body, now)
    if (dates.error) return res.status(400).json({ error: dates.error })
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .upsert({
        edition_id: req.edition.id,
        club_slug: req.params.slug,
        ...textFields(req.body),
        status: 'published',
        starts_at: dates.starts_at,
        ends_at: dates.ends_at,
        published_at: now.toISOString(),
        published_by: req.staff.id,
        updated_by: req.staff.id,
        updated_at: now.toISOString(),
      }, { onConflict: 'edition_id,club_slug' })
      .select()
      .single()
    if (error) throw error
    res.json({ memo: data })
  } catch (err) {
    fail(res, 'publish', err)
  }
})

// POST /editions/:id/clubs/:slug/end — pull a memo now. One that hasn't started
// goes back to draft: an end before its start would otherwise block whatever is
// live once that start date arrives.
router.post('/editions/:id/clubs/:slug/end', loadClubContext, async (req, res) => {
  try {
    const { data: row, error: readErr } = await supabaseAdmin
      .from('club_memos').select('id, status, starts_at')
      .eq('edition_id', req.edition.id).eq('club_slug', req.params.slug).maybeSingle()
    if (readErr) throw readErr
    if (!row || row.status !== 'published') return res.status(409).json({ error: 'This memo is not published' })

    const now = new Date()
    const update = new Date(row.starts_at) > now
      ? { status: 'draft', starts_at: null, ends_at: null }
      : { ends_at: now.toISOString() }
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .update({ ...update, updated_by: req.staff.id, updated_at: now.toISOString() })
      .eq('id', row.id)
      .select()
      .single()
    if (error) throw error
    res.json({ memo: data })
  } catch (err) {
    fail(res, 'end', err)
  }
})

module.exports = router
