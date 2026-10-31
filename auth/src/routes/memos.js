// Monthly club memo. Company editors ('memos:company-edit') write and publish Main
// with its own dates, and it goes live at every club by itself. Each club's managers
// publish notes whenever they like. Every note has its own dates, which can run
// across months. Everyone with the tile reads their club's live memo.
// See docs/superpowers/specs/2026-10-30-monthly-memo-design.md.
const { Router, raw } = require('express')
const memoIpad = require('../services/memoIpad/sync')
const { supabaseAdmin } = require('../services/supabase')
const { loadEditions, loadNotes } = require('../services/memoData')
const authenticate = require('../middleware/auth')
const { requireTile } = require('../middleware/tile')
const { canSeeAllLocations, roleLevel, ROLE_HIERARCHY } = require('../middleware/role')
const { getVisibleTools } = require('../services/visibleTools')
const { CLUBS } = require('../config/clubs')
const {
  monthKey, pickLiveMemo, composeMemo, memoPlan, fullMemoPlan, newestMainMonth, noteStatus, notesSummary,
  editionStatus, parseDates, canEditClub, cleanNotes,
  cleanItems, itemsError, monthOptions, currentMonth,
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

// The month's row, created the first time a club writes notes for it.
async function findEdition(param, staffId) {
  const month = monthKey(param)
  if (!month) {
    const { data, error } = await supabaseAdmin.from('memo_editions').select('*').eq('id', param).maybeSingle()
    if (error) throw error
    return data
  }
  const { error: createErr } = await supabaseAdmin
    .from('memo_editions').upsert({ month, created_by: staffId }, { onConflict: 'month', ignoreDuplicates: true })
  if (createErr) throw createErr
  const { data, error } = await supabaseAdmin.from('memo_editions').select('*').eq('month', month).maybeSingle()
  if (error) throw error
  return data
}

// Manager+ of this club, on a real enabled club and a real month.
async function loadClubContext(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id) && !monthKey(req.params.id)) return res.status(400).json({ error: 'Invalid memo id' })
    if (!isManagerPlus(req.staff)) return res.status(403).json({ error: 'Only managers can edit club memos' })
    const scope = await clubScope(req.staff)
    if (!canEditClub(scope, req.params.slug)) return res.status(403).json({ error: 'That club is not one of yours' })
    const clubs = await enabledClubs()
    if (!clubs.some(c => c.slug === req.params.slug)) return res.status(404).json({ error: 'Club not found' })
    const edition = await findEdition(req.params.id, req.staff.id)
    if (!edition) return res.status(404).json({ error: 'Memo not found' })
    req.edition = edition
    next()
  } catch (err) {
    console.error('[Memos] club context error:', err.message)
    res.status(500).json({ error: err.message })
  }
}

// Who can send a club's iPad image: a company editor (Main edits redraw every
// club) or a manager of that club.
async function loadImageContext(req, res, next) {
  try {
    if (!(await canEditCompany(req.staff))) {
      if (!isManagerPlus(req.staff)) return res.status(403).json({ error: 'Not allowed' })
      if (!canEditClub(await clubScope(req.staff), req.params.slug)) return res.status(403).json({ error: 'That club is not one of yours' })
    }
    if (!(await enabledClubs()).some(c => c.slug === req.params.slug)) return res.status(404).json({ error: 'Club not found' })
    const editions = await loadEditions()
    const notes = await loadNotes([req.params.slug])
    req.plan = memoPlan(editions, notes)
    req.planTotal = fullMemoPlan(editions, notes).length
    next()
  } catch (err) {
    console.error('[Memos] image context error:', err.message)
    res.status(500).json({ error: err.message })
  }
}

function fail(res, label, err) {
  console.error(`[Memos] ${label} error:`, err.message)
  res.status(500).json({ error: err.message })
}

async function savedNotes(editionId, slug) {
  const { data, error } = await supabaseAdmin
    .from('club_memos').select('id, status, items')
    .eq('edition_id', editionId).eq('club_slug', slug).maybeSingle()
  if (error) throw error
  return data
}

// GET /live?club=salem — the caller's clubs and the club's live memo.
router.get('/live', async (req, res) => {
  try {
    const scope = await clubScope(req.staff)
    const clubs = (await enabledClubs()).filter(c => canEditClub(scope, c.slug))
    const club = clubs.find(c => c.slug === req.query.club) || clubs[0] || null
    if (!club) return res.json({ clubs: [], club: null, memo: null })

    const live = composeMemo(await loadEditions(), await loadNotes([club.slug]))
    res.json({
      clubs,
      club,
      memo: live && { month: live.month, main_items: live.main_items, club_items: live.club_items },
    })
  } catch (err) {
    fail(res, 'live', err)
  }
})

// GET /manage — every month in the selector with its per-club status. A month
// nobody has written yet comes back with id null; it is created on first save.
// Only company editors see Main items before they're published.
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

    const { data: editions, error } = await supabaseAdmin
      .from('memo_editions').select('*').order('month', { ascending: false })
    if (error) throw error

    // Live is per club across ALL months, so read every row, not just one month.
    const slugs = clubs.map(c => c.slug)
    const { data: rows, error: rowsErr } = slugs.length
      ? await supabaseAdmin.from('club_memos').select('*').in('club_slug', slugs)
      : { data: [], error: null }
    if (rowsErr) throw rowsErr

    const now = new Date()
    const newestMonth = newestMainMonth(editions, now)
    const monthById = new Map((editions || []).map(e => [e.id, e.month]))
    const liveMainId = pickLiveMemo(editions, now)?.id || null
    const byMonth = new Map((editions || []).map(e => [e.month, e]))

    const { data: ipadRows, error: ipadErr } = await supabaseAdmin
      .from('memo_clubs').select('club_slug, ipad_target, ipad_status, ipad_error, ipad_pushed_at')
    if (ipadErr) throw ipadErr
    const ipadBySlug = new Map((ipadRows || []).map(r => [r.club_slug, r]))

    res.json({
      can: { company, clubs: manager && clubs.some(c => c.editable) },
      clubs: clubs.map(c => {
        const ipad = ipadBySlug.get(c.slug)
        return {
          ...c,
          ipad: ipad?.ipad_target ? { status: ipad.ipad_status, error: ipad.ipad_error, sent_at: ipad.ipad_pushed_at } : null,
        }
      }),
      current_month: currentMonth(now),
      editions: monthOptions([...byMonth.keys()], now).map(month => {
        const e = byMonth.get(month) || { id: null, month, status: 'draft', items: [] }
        return {
          id: e.id,
          month,
          status: e.status,
          starts_at: e.starts_at || null,
          ends_at: e.ends_at || null,
          state: editionStatus(e, liveMainId, now),
          items: company || e.status === 'ready' ? e.items || [] : [],
          club_memos: Object.fromEntries(slugs.map(slug => {
            const row = (rows || []).find(r => e.id && r.edition_id === e.id && r.club_slug === slug) || null
            // Notes from earlier months whose end date reaches into this one.
            const carried = (rows || [])
              .filter(r => r.club_slug === slug && r.status === 'published' && (monthById.get(r.edition_id) || '') < month)
              .flatMap(r => (r.items || []).map(n => ({ ...n, month: monthById.get(r.edition_id), state: noteStatus(n, monthById.get(r.edition_id), newestMonth, now) })))
              .filter(n => n.ends_at && n.ends_at.slice(0, 10) >= month && ['live', 'scheduled'].includes(n.state))
            return [slug, {
              ...(row || {}),
              items: (row?.items || []).map(n => ({ ...n, state: noteStatus(n, month, newestMonth, now) })),
              state: notesSummary(row, month, newestMonth, now),
              carried,
            }]
          })),
        }
      }),
    })
  } catch (err) {
    fail(res, 'manage', err)
  }
})

// PUT /editions/:month { items?, ready?, starts_at?, ends_at? } — save Main for a
// month, creating its row the first time. ready=true publishes it with those dates:
// no start = show now, no end = until the next Main starts. ready=false takes it
// down. Live memos read Main directly, so edits after publishing show right away.
router.put('/editions/:month', requireCompanyEditor, async (req, res) => {
  try {
    const month = monthKey(req.params.month)
    if (!month) return res.status(400).json({ error: 'Invalid month' })
    const { data: current, error: readErr } = await supabaseAdmin
      .from('memo_editions').select('id, items, status, starts_at').eq('month', month).maybeSingle()
    if (readErr) throw readErr

    const nowDate = new Date()
    const now = nowDate.toISOString()
    const items = req.body?.items !== undefined ? cleanItems(req.body.items) : (current?.items || [])
    const row = { month, items, updated_by: req.staff.id, updated_at: now }

    // Whatever can already be seen has to stay complete.
    const publishing = req.body?.ready === true || (current?.status === 'ready' && req.body?.ready !== false)
    if (publishing) {
      if (items.length === 0) return res.status(400).json({ error: 'Add at least one item first' })
      const invalid = itemsError(items)
      if (invalid) return res.status(400).json({ error: invalid })
    }
    if (req.body?.ready === true) {
      const dates = parseDates(req.body, nowDate)
      if (dates.error) return res.status(400).json({ error: dates.error })
      row.status = 'ready'
      row.ready_at = now
      row.starts_at = dates.starts_at
      row.ends_at = dates.ends_at
    } else if (req.body?.ready === false) {
      // Ended rather than unpublished once started, so last month's doesn't come back.
      if (current?.status === 'ready' && current.starts_at && new Date(current.starts_at) <= nowDate) {
        row.ends_at = now
      } else {
        row.status = 'draft'
        row.ready_at = null
        row.starts_at = null
        row.ends_at = null
      }
    }
    if (!current) row.created_by = req.staff.id

    const { data, error } = await supabaseAdmin
      .from('memo_editions').upsert(row, { onConflict: 'month' }).select().single()
    if (error) throw error
    memoIpad.kick()
    res.json({ edition: data })
  } catch (err) {
    fail(res, 'save main', err)
  }
})

// PUT /editions/:month/clubs/:slug { items } — save. A new note stays a draft until
// Publish; a published note's changes show right away, so it has to stay complete.
router.put('/editions/:id/clubs/:slug', loadClubContext, async (req, res) => {
  try {
    const current = await savedNotes(req.edition.id, req.params.slug)
    const { notes, error: notesErr } = cleanNotes(req.body?.items, current?.items)
    if (notesErr) return res.status(400).json({ error: notesErr })
    const invalid = itemsError(notes.filter(n => n.published))
    if (invalid) return res.status(400).json({ error: invalid })
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .upsert({
        edition_id: req.edition.id,
        club_slug: req.params.slug,
        items: notes,
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

// POST /editions/:month/clubs/:slug/publish { items } — publish every note, each on
// its own dates. Main doesn't wait for this. No start = show now; no end = until a
// later month's Main starts.
router.post('/editions/:id/clubs/:slug/publish', loadClubContext, async (req, res) => {
  try {
    const now = new Date()
    const current = await savedNotes(req.edition.id, req.params.slug)
    const { notes, error: notesErr } = cleanNotes(req.body?.items, current?.items)
    if (notesErr) return res.status(400).json({ error: notesErr })
    if (notes.length === 0) return res.status(400).json({ error: 'Add at least one note first' })
    const invalid = itemsError(notes)
    if (invalid) return res.status(400).json({ error: invalid })
    const items = notes.map(n => ({ ...n, published: true, starts_at: n.starts_at || now.toISOString() }))
    const late = items.find(n => n.ends_at && new Date(n.ends_at) <= new Date(n.starts_at))
    if (late) return res.status(400).json({ error: `The end date must be after the start date on "${late.title}"` })
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .upsert({
        edition_id: req.edition.id,
        club_slug: req.params.slug,
        items,
        status: 'published',
        published_at: now.toISOString(),
        published_by: req.staff.id,
        updated_by: req.staff.id,
        updated_at: now.toISOString(),
      }, { onConflict: 'edition_id,club_slug' })
      .select()
      .single()
    if (error) throw error
    memoIpad.kick()
    res.json({ memo: data })
  } catch (err) {
    fail(res, 'publish', err)
  }
})

// POST /editions/:month/clubs/:slug/end { note_id } — pull one note now. One that
// hasn't started goes back to draft.
router.post('/editions/:id/clubs/:slug/end', loadClubContext, async (req, res) => {
  try {
    const row = await savedNotes(req.edition.id, req.params.slug)
    const note = (row?.items || []).find(n => n.id === req.body?.note_id)
    if (!note || !note.published) return res.status(409).json({ error: 'This note is not published' })

    const now = new Date()
    const update = new Date(note.starts_at) > now
      ? { published: false, starts_at: null, ends_at: null }
      : { ends_at: now.toISOString() }
    const items = row.items.map(n => (n.id === note.id ? { ...n, ...update } : n))
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .update({ items, updated_by: req.staff.id, updated_at: now.toISOString() })
      .eq('id', row.id)
      .select()
      .single()
    if (error) throw error
    memoIpad.kick()
    res.json({ memo: data })
  } catch (err) {
    fail(res, 'end', err)
  }
})

// GET /clubs/:slug/image-plan — what to draw for this club's iPads: everything it
// will show from now on. Empty when the club has no iPads set up.
router.get('/clubs/:slug/image-plan', loadImageContext, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('memo_clubs').select('ipad_target').eq('club_slug', req.params.slug).maybeSingle()
    if (error) throw error
    const planned = !!data?.ipad_target
    res.json({ memos: planned ? req.plan : [], left_out: planned ? req.planTotal - req.plan.length : 0 })
  } catch (err) {
    fail(res, 'image plan', err)
  }
})

// POST /clubs/:slug/image?key= — one drawn iPad image. Images no longer in the plan
// are removed, so each club holds only what it can still show.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])
router.post('/clubs/:slug/image', raw({ type: 'image/png', limit: '4mb' }), loadImageContext, async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.subarray(0, 4).equals(PNG_SIGNATURE)) {
      return res.status(400).json({ error: 'Expected a PNG image' })
    }
    const keys = req.plan.map(m => m.key)
    if (!keys.includes(req.query.key)) return res.status(409).json({ error: 'This memo changed. Refresh and save again.' })
    const md5 = memoIpad.md5(req.body)
    const { error } = await supabaseAdmin.from('memo_club_images').upsert({
      club_slug: req.params.slug,
      composition_key: req.query.key,
      image_base64: req.body.toString('base64'),
      md5,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'club_slug,composition_key' })
    if (error) throw error
    const { data: held, error: heldErr } = await supabaseAdmin
      .from('memo_club_images').select('composition_key').eq('club_slug', req.params.slug)
    if (heldErr) throw heldErr
    const stale = (held || []).map(r => r.composition_key).filter(k => !keys.includes(k))
    if (stale.length) {
      const { error: pruneErr } = await supabaseAdmin
        .from('memo_club_images').delete().eq('club_slug', req.params.slug).in('composition_key', stale)
      if (pruneErr) throw pruneErr
    }
    memoIpad.kick()
    res.json({ md5 })
  } catch (err) {
    fail(res, 'save image', err)
  }
})

// POST /clubs/:slug/ipad-retry — try again after a failure. Failures never retry
// by themselves, so a bad login can't be repeated until the account locks.
router.post('/clubs/:slug/ipad-retry', requireCompanyEditor, async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('memo_clubs')
      .update({ ipad_status: 'pending', ipad_failed_md5: null, ipad_error: null, updated_at: new Date().toISOString() })
      .eq('club_slug', req.params.slug)
    if (error) throw error
    memoIpad.kick()
    res.json({ ok: true })
  } catch (err) {
    fail(res, 'retry', err)
  }
})

module.exports = router
