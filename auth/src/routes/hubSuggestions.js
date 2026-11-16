// Hub > Suggested: asks that came in by email (and, later, text) waiting for
// the owner to add them as tasks or dismiss them. Recently skipped holds what
// Claude decided was not a request, so he can rescue a mistake. Owner-only.
const { Router } = require('express')
const { ownerOnly } = require('../lib/ownerGate')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(ownerOnly)

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LIST_COLS = 'id, source, status, gmail_thread_id, from_name, from_email, cc_emails, subject, snippet, summary, guess, received_at, last_message_at, you_replied, seen, created_at'
const SKIPPED_DAYS = 14

function must({ data, error }) {
  if (error) throw error
  return data
}

function fail(res, e) {
  res.status(e.status && e.status >= 400 && e.status < 600 ? e.status : 500).json({ error: e.message })
}

function httpError(status, message) { const e = new Error(message); e.status = status; return e }

async function loadSuggestion(req) {
  if (!UUID_RE.test(String(req.params.id))) throw httpError(404, 'Not found')
  const row = must(await supabaseAdmin.from('hub_suggestions').select('*')
    .eq('id', req.params.id).eq('owner_staff_id', req.staff.id).maybeSingle())
  if (!row) throw httpError(404, 'Not found')
  return row
}

router.get('/suggestions', async (req, res) => {
  try {
    const owner = req.staff.id
    const since = new Date(Date.now() - SKIPPED_DAYS * 86400000).toISOString()
    const [open, skipped] = await Promise.all([
      supabaseAdmin.from('hub_suggestions').select(LIST_COLS).eq('owner_staff_id', owner).eq('status', 'open')
        .order('received_at', { ascending: true }).limit(200).then(must),
      supabaseAdmin.from('hub_suggestions').select(LIST_COLS).eq('owner_staff_id', owner).eq('status', 'skipped')
        .gte('received_at', since).order('received_at', { ascending: false }).limit(50).then(must),
    ])
    res.json({ open, skipped })
  } catch (e) { fail(res, e) }
})

router.post('/suggestions/:id/dismiss', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    if (s.status !== 'open') throw httpError(400, 'Already handled')
    must(await supabaseAdmin.from('hub_suggestions').update({ status: 'dismissed', updated_at: new Date().toISOString() }).eq('id', s.id))
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

// "This is a request": a skipped item becomes an open suggestion.
router.post('/suggestions/:id/restore', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    if (s.status !== 'skipped') throw httpError(400, 'Only skipped items can be restored')
    const { data, error } = await supabaseAdmin.from('hub_suggestions')
      .update({ status: 'open', seen: true, summary: s.summary || s.subject, updated_at: new Date().toISOString() })
      .eq('id', s.id).select(LIST_COLS).single()
    if (error) {
      if (error.code === '23505') throw httpError(409, 'That conversation is already suggested')
      throw error
    }
    res.json({ suggestion: data })
  } catch (e) { fail(res, e) }
})

// Never suggest mail from this sender again; clears their open suggestions.
router.post('/suggestions/:id/mute', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    if (s.source !== 'email' || !s.from_email) throw httpError(400, 'Only email senders can be muted')
    must(await supabaseAdmin.from('hub_muted_senders')
      .upsert({ owner_staff_id: req.staff.id, email: s.from_email }, { onConflict: 'owner_staff_id,email', ignoreDuplicates: true }))
    must(await supabaseAdmin.from('hub_suggestions').update({ status: 'dismissed', updated_at: new Date().toISOString() })
      .eq('owner_staff_id', req.staff.id).eq('from_email', s.from_email).eq('status', 'open'))
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

// Opened from the New feed: clears it there (it stays in Suggested).
router.post('/suggestions/:id/seen', async (req, res) => {
  try {
    const s = await loadSuggestion(req)
    must(await supabaseAdmin.from('hub_suggestions').update({ seen: true }).eq('id', s.id))
    res.json({ ok: true })
  } catch (e) { fail(res, e) }
})

module.exports = router
module.exports.loadSuggestion = loadSuggestion
module.exports.LIST_COLS = LIST_COLS
