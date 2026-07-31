/**
 * /class-seeding — house accounts enrolled into empty Group X classes (admin).
 *
 * See services/classSeeding.js for why this exists. Everything here is admin
 * gated, and every enrolment is written to class_seed_log so it can be reviewed
 * and undone.
 */
const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const { CLUBS, isKnownClubNumber } = require('../lib/groupXClubs')
const seeding = require('../services/classSeeding')

const router = Router()
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
router.use(authenticate)
router.use(requireRole('admin'))

function fail(res, err, where) {
  console.error(`[classSeeding] ${where} failed:`, err.message)
  res.status(500).json({ error: err.message })
}

// Everything the admin screen needs in one call.
router.get('/config', async (req, res) => {
  try {
    const { accounts, settings } = await seeding.loadConfig()
    const { data: allAccounts, error } = await supabaseAdmin
      .from('class_seed_accounts').select('*').order('display_name')
    if (error) throw new Error(error.message)
    res.json({
      clubs: CLUBS,
      accounts: allAccounts || [],
      active_account_count: accounts.length,
      settings: settings || [],
    })
  } catch (err) { fail(res, err, 'GET /config') }
})

router.post('/accounts', async (req, res) => {
  const b = req.body || {}
  const memberId = String(b.member_id || '').trim()
  const displayName = String(b.display_name || '').trim()
  if (!memberId) return res.status(400).json({ error: 'member_id is required' })
  if (!displayName) return res.status(400).json({ error: 'give the account a name so it is recognisable later' })
  try {
    const { error } = await supabaseAdmin.from('class_seed_accounts').upsert({
      member_id: memberId,
      display_name: displayName,
      active: b.active !== false,
      created_by: req.user?.email || 'unknown',
    }, { onConflict: 'member_id' })
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'POST /accounts') }
})

router.delete('/accounts/:memberId', async (req, res) => {
  try {
    const { error } = await supabaseAdmin
      .from('class_seed_accounts').delete().eq('member_id', req.params.memberId)
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'DELETE /accounts') }
})

router.put('/settings', async (req, res) => {
  const b = req.body || {}
  if (!isKnownClubNumber(b.club_number)) {
    return res.status(400).json({ error: 'valid club_number is required' })
  }
  const min = parseInt(b.min_count, 10)
  const max = parseInt(b.max_count, 10)
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
    return res.status(400).json({ error: 'min and max must be whole numbers, and max must not be below min' })
  }
  if (max > 25) return res.status(400).json({ error: 'max is capped at 25' })

  try {
    const { error } = await supabaseAdmin.from('class_seed_settings').upsert({
      club_number: String(b.club_number),
      enabled: !!b.enabled,
      min_count: min,
      max_count: max,
      updated_by: req.user?.email || 'unknown',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'club_number' })
    if (error) throw new Error(error.message)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'PUT /settings') }
})

// POST /class-seeding/run?dry=1 — run now. dry=1 reports what it WOULD do and
// writes nothing to ABC, which is the safe way to check a config change.
router.post('/run', async (req, res) => {
  try {
    res.json({ results: await seeding.runAll({ dryRun: req.query.dry === '1' }) })
  } catch (err) { fail(res, err, 'POST /run') }
})

router.get('/log', async (req, res) => {
  const clubNumber = req.query.club_number
  try {
    let q = supabaseAdmin
      .from('class_seed_log').select('*').order('created_at', { ascending: false }).limit(200)
    if (clubNumber && isKnownClubNumber(clubNumber)) q = q.eq('club_number', String(clubNumber))
    const { data, error } = await q
    if (error) throw new Error(error.message)
    res.json({ log: data || [] })
  } catch (err) { fail(res, err, 'GET /log') }
})

// DELETE /class-seeding/log/:id — undo one enrolment: removes the account from
// the class in ABC and drops the log row.
router.delete('/log/:id', async (req, res) => {
  try {
    const { data: row, error: selErr } = await supabaseAdmin
      .from('class_seed_log').select('*').eq('id', req.params.id).single()
    if (selErr || !row) return res.status(404).json({ error: 'log entry not found' })

    const r = await seeding.unenrollMember(row.club_number, row.abc_event_id, row.member_id)
    if (!r.ok) return res.status(502).json({ error: r.error })

    await supabaseAdmin.from('class_seed_log').delete().eq('id', row.id)
    res.json({ ok: true })
  } catch (err) { fail(res, err, 'DELETE /log') }
})

module.exports = router
