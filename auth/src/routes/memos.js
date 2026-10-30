// Monthly club memo. Company editors ('memos:company-edit') write the month's
// company section and mark it ready; each club's managers then add notes and
// publish that club's memo. Everyone with the tile reads their club's live memo.
// See docs/superpowers/specs/2026-10-30-monthly-memo-design.md.
const { Router, raw } = require('express')
const memoIpad = require('../services/memoIpad/sync')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireTile } = require('../middleware/tile')
const { canSeeAllLocations, roleLevel, ROLE_HIERARCHY } = require('../middleware/role')
const { getVisibleTools } = require('../services/visibleTools')
const { CLUBS } = require('../config/clubs')
const {
  monthKey, pickLiveMemo, clubStatus, parseDates, canEditClub, canPublish,
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

// Who can send a club's iPad image: a company editor (Main edits redraw every
// club) or a manager of that club. The memo must already be published.
async function loadImageContext(req, res, next) {
  try {
    if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: 'Invalid memo id' })
    if (!(await canEditCompany(req.staff))) {
      if (!isManagerPlus(req.staff)) return res.status(403).json({ error: 'Not allowed' })
      if (!canEditClub(await clubScope(req.staff), req.params.slug)) return res.status(403).json({ error: 'That club is not one of yours' })
    }
    const { data: memo, error } = await supabaseAdmin
      .from('club_memos').select('id, status')
      .eq('edition_id', req.params.id).eq('club_slug', req.params.slug).maybeSingle()
    if (error) throw error
    if (!memo || memo.status !== 'published') return res.status(409).json({ error: 'This memo is not published' })
    req.memo = memo
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

// Only sent items change, so saving dates can't blank a club's items.
function itemFields(body) {
  return body?.items !== undefined ? { items: cleanItems(body.items) } : {}
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
      .select('id, status, items, starts_at, ends_at, memo_editions(month, items)')
      .eq('club_slug', club.slug)
      .eq('status', 'published')
    if (error) throw error
    const live = pickLiveMemo(data || [])
    res.json({
      clubs,
      club,
      memo: live && {
        month: live.memo_editions?.month,
        main_items: live.memo_editions?.items || [],
        club_items: live.items || [],
        starts_at: live.starts_at,
        ends_at: live.ends_at,
      },
    })
  } catch (err) {
    fail(res, 'live', err)
  }
})

// GET /manage — every month in the selector with its per-club status. A month
// nobody has written yet comes back with id null; it is created on first save.
// Only company editors see Main items before they're published to clubs.
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
    const liveByClub = {}
    for (const slug of slugs) {
      liveByClub[slug] = pickLiveMemo((rows || []).filter(r => r.club_slug === slug), now)?.id || null
    }
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
          items: company || e.status === 'ready' ? e.items || [] : [],
          club_memos: Object.fromEntries(slugs.map(slug => {
            const row = (rows || []).find(r => e.id && r.edition_id === e.id && r.club_slug === slug) || null
            return [slug, { ...(row || {}), state: clubStatus(row, liveByClub[slug], now) }]
          })),
        }
      }),
    })
  } catch (err) {
    fail(res, 'manage', err)
  }
})

// PUT /editions/:month { items?, ready? } — save the Main memo for a month,
// creating its row the first time. ready=true publishes it to the clubs. Live
// memos read Main directly, so edits after publishing show right away.
router.put('/editions/:month', requireCompanyEditor, async (req, res) => {
  try {
    const month = monthKey(req.params.month)
    if (!month) return res.status(400).json({ error: 'Invalid month' })
    const { data: current, error: readErr } = await supabaseAdmin
      .from('memo_editions').select('id, items, status').eq('month', month).maybeSingle()
    if (readErr) throw readErr

    const now = new Date().toISOString()
    const items = req.body?.items !== undefined ? cleanItems(req.body.items) : (current?.items || [])
    const row = { month, items, updated_by: req.staff.id, updated_at: now }

    // Whatever clubs can already see has to stay complete.
    const publishing = req.body?.ready === true || (current?.status === 'ready' && req.body?.ready !== false)
    if (publishing) {
      if (items.length === 0) return res.status(400).json({ error: 'Add at least one item first' })
      const invalid = itemsError(items)
      if (invalid) return res.status(400).json({ error: invalid })
    }
    if (req.body?.ready === true) {
      row.status = 'ready'
      row.ready_at = now
    } else if (req.body?.ready === false) {
      if (current) {
        const { count, error: countErr } = await supabaseAdmin
          .from('club_memos').select('id', { count: 'exact', head: true })
          .eq('edition_id', current.id).eq('status', 'published')
        if (countErr) throw countErr
        if (count > 0) return res.status(409).json({ error: 'Clubs have already published this month' })
      }
      row.status = 'draft'
      row.ready_at = null
    }
    if (!current) row.created_by = req.staff.id

    const { data, error } = await supabaseAdmin
      .from('memo_editions').upsert(row, { onConflict: 'month' }).select().single()
    if (error) throw error
    res.json({ edition: data })
  } catch (err) {
    fail(res, 'save main', err)
  }
})

// PUT /editions/:id/clubs/:slug { items? } — save without
// changing whether it's published.
router.put('/editions/:id/clubs/:slug', loadClubContext, async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .upsert({
        edition_id: req.edition.id,
        club_slug: req.params.slug,
        ...itemFields(req.body),
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

// POST /editions/:id/clubs/:slug/publish { items?, starts_at?, ends_at? }
// Publish, or change the dates of a published memo. No start = show now.
router.post('/editions/:id/clubs/:slug/publish', loadClubContext, async (req, res) => {
  try {
    const now = new Date()
    const dates = parseDates(req.body, now)
    if (dates.error) return res.status(400).json({ error: dates.error })
    const invalid = itemsError(itemFields(req.body).items)
    if (invalid) return res.status(400).json({ error: invalid })
    const { data, error } = await supabaseAdmin
      .from('club_memos')
      .upsert({
        edition_id: req.edition.id,
        club_slug: req.params.slug,
        ...itemFields(req.body),
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
    memoIpad.kick()
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
    memoIpad.kick()
    res.json({ memo: data })
  } catch (err) {
    fail(res, 'end', err)
  }
})

// POST /editions/:id/clubs/:slug/image — the iPad image, drawn in the browser.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47])
router.post('/editions/:id/clubs/:slug/image', raw({ type: 'image/png', limit: '4mb' }), loadImageContext, async (req, res) => {
  try {
    if (!Buffer.isBuffer(req.body) || !req.body.subarray(0, 4).equals(PNG_SIGNATURE)) {
      return res.status(400).json({ error: 'Expected a PNG image' })
    }
    const md5 = memoIpad.md5(req.body)
    const { error } = await supabaseAdmin.from('club_memo_images').upsert({
      club_memo_id: req.memo.id,
      image_base64: req.body.toString('base64'),
      md5,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'club_memo_id' })
    if (error) throw error
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
