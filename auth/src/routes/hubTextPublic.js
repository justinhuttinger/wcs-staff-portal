// Public endpoint for the owner's iPhone Shortcut: when a text arrives from a
// staff contact he picked on the phone, the Shortcut posts it here with his
// private key (X-Hub-Key). Claude decides if it is a request; requests become
// suggestions in the Hub, everything else goes to Recently skipped. Texts from
// the same number within 30 minutes join one suggestion. The response never
// echoes the classification.
const crypto = require('crypto')
const { Router } = require('express')
const rateLimit = require('express-rate-limit')
const { supabaseAdmin } = require('../services/supabase')
const { hashKey, cleanTextInput, textMergeTarget, cleanGuess, mergeAction, keyedLock, isTapback } = require('../services/hub/suggest')
const { classify } = require('../services/hub/checkJob')
const dl = require('../services/hub/deliverables')

const router = Router()
router.use(rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false }))

const KEY_RE = /^[A-Za-z0-9_-]{20,80}$/
// A burst of texts from one sender is handled one at a time, so the second
// text sees (and joins) the suggestion the first one opened.
const senderLock = keyedLock()

function must({ data, error }) {
  if (error) throw error
  return data
}

async function saveText(owner, input) {
  const ctx = {
    clubSlugs: Object.keys(await dl.clubNames()),
    categories: must(await supabaseAdmin.from('hub_categories').select('id, name').eq('owner_staff_id', owner)),
  }
  let raw
  try {
    raw = (await classify([{ key: 't', from: `${input.name} (text message)`, subject: 'Text message', text: input.text }], ctx)).get('t')
  } catch (e) {
    console.warn('[HubText] classify failed, keeping as suggestion:', e.message)
  }
  // No answer from Claude: keep it as a suggestion so nothing is lost
  // (a text, unlike an email, can't be read again later).
  if (!raw) raw = { request: true, summary: input.text, title: '', description: '' }
  const guess = cleanGuess(raw, ctx)
  const now = Date.now()
  const nowIso = new Date(now).toISOString()
  const msgId = `text:${crypto.randomUUID()}`
  const guessFields = { title: guess.title, description: guess.description, due_date: guess.due_date, clubs: guess.clubs, category_id: guess.category_id, phone: input.phone }

  const openText = must(await supabaseAdmin.from('hub_suggestions').select('id, guess, snippet, summary, message_ids, received_at, last_message_at')
    .eq('owner_staff_id', owner).eq('status', 'open').eq('source', 'text')
    .gte('last_message_at', new Date(now - 60 * 60 * 1000).toISOString()))
  const target = textMergeTarget(openText, input.phone, now)
  const action = mergeAction(target, guess.request)
  if (action === 'update') {
    const patch = {
      message_ids: [...(target.message_ids || []), msgId],
      snippet: `${target.snippet || ''}\n${input.text}`.trim().slice(-500),
      last_message_at: nowIso, updated_at: nowIso,
    }
    if (guess.request) {
      Object.assign(patch, { summary: guess.summary || target.summary, seen: false })
      // "hey, quick question" then the real ask: the ask fills the task.
      if (!target.guess?.title && guess.title) patch.guess = guessFields
    }
    must(await supabaseAdmin.from('hub_suggestions').update(patch).eq('id', target.id))
  } else {
    must(await supabaseAdmin.from('hub_suggestions').insert({
      owner_staff_id: owner, source: 'text', status: action === 'create' ? 'open' : 'skipped',
      message_ids: [msgId], from_name: input.name, snippet: input.text.slice(0, 500),
      subject: 'Text message', summary: guess.summary || input.text.slice(0, 300),
      guess: guessFields, received_at: nowIso, last_message_at: nowIso,
    }))
  }
}

router.post('/', async (req, res) => {
  try {
    const key = String(req.get('X-Hub-Key') || '').trim()
    if (!KEY_RE.test(key)) return res.status(401).json({ error: 'Unauthorized' })
    const settings = must(await supabaseAdmin.from('hub_settings').select('owner_staff_id')
      .eq('text_key_hash', hashKey(key)).maybeSingle())
    if (!settings) return res.status(401).json({ error: 'Unauthorized' })
    const input = cleanTextInput(req.body)
    if (input.error) return res.status(400).json({ error: input.error })
    // Reactions ("Loved “…”") are never asks.
    if (isTapback(input.text)) return res.json({ ok: true })

    const owner = settings.owner_staff_id
    await senderLock(`${owner}:${input.phone || input.name}`, () => saveText(owner, input))
    res.json({ ok: true })
  } catch (e) {
    console.error('[HubText]', e.message)
    res.status(500).json({ error: 'Could not save' })
  }
})

module.exports = router
