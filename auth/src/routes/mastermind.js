const { Router } = require('express')
const crypto = require('crypto')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()

const MASTERMIND_ENABLED = process.env.MASTERMIND_ENABLED === 'true'
const CLICKUP_WEBHOOK_SECRET = process.env.CLICKUP_WEBHOOK_SECRET || ''

const MASTERMIND_FIELD_NAME = 'Mastermind'

const MODE_MAP = {
  'brief me': 'brief_me',
  'strategize': 'strategize',
  'analyze': 'analyze',
  'draft': 'draft',
  'review': 'review',
  'wrap up': 'wrap_up',
}

function verifySignature(rawBody, signature, secret) {
  if (!secret) return false
  const hmac = crypto.createHmac('sha256', secret)
  hmac.update(rawBody)
  const expected = hmac.digest('hex')
  const sigStr = String(signature || '')
  if (sigStr.length !== expected.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(sigStr, 'hex'))
  } catch {
    return false
  }
}

router.post('/mastermind', async (req, res) => {
  res.status(200).json({ received: true })

  if (!MASTERMIND_ENABLED) return

  try {
    const rawBody = req.rawBody || JSON.stringify(req.body)
    const signature = req.headers['x-signature']
    if (!verifySignature(rawBody, signature, CLICKUP_WEBHOOK_SECRET)) {
      await supabaseAdmin.from('mastermind_errors').insert({
        error_kind: 'sig_mismatch',
        message: 'X-Signature did not match HMAC of body',
        payload: req.body,
      })
      return
    }

    await handleEvent(req.body)
  } catch (e) {
    try {
      await supabaseAdmin.from('mastermind_errors').insert({
        error_kind: 'parse_error',
        message: e?.message || String(e),
        payload: req.body,
      })
    } catch {}
  }
})

async function handleEvent(event) {
  const evt = event?.event
  const taskId = event?.task_id
  if (!taskId) return

  if (evt === 'taskUpdated') {
    const histories = Array.isArray(event.history_items) ? event.history_items : []
    for (const h of histories) {
      const fieldName = h?.custom_field?.name || ''
      if (fieldName !== MASTERMIND_FIELD_NAME) continue

      const mode = resolveMode(h?.after)
      if (!mode) continue

      await enqueue({
        task_id: taskId,
        list_id: event.list_id || h?.list_id || '',
        mode,
        requested_by: h?.user?.id ? String(h.user.id) : null,
        payload: event,
      })
    }
    return
  }

  if (evt === 'taskCommentPosted') {
    const text = event?.comment?.comment_text || event?.comment_text || ''
    if (!/@mastermind\b/i.test(text)) return

    await enqueue({
      task_id: taskId,
      list_id: event.list_id || '',
      mode: 'continue',
      requested_by: event?.comment?.user?.id ? String(event.comment.user.id) : null,
      payload: event,
    })
  }
}

function resolveMode(rawValue) {
  if (!rawValue) return null
  let label
  if (typeof rawValue === 'string') label = rawValue
  else if (rawValue.label) label = rawValue.label
  else if (Array.isArray(rawValue) && rawValue[0]?.label) label = rawValue[0].label
  else if (rawValue.value && typeof rawValue.value === 'string') label = rawValue.value
  else return null
  return MODE_MAP[label.toLowerCase().trim()] || null
}

const DEBOUNCE_MS = 30_000

async function enqueue(row) {
  const since = new Date(Date.now() - DEBOUNCE_MS).toISOString()
  const { data: recent } = await supabaseAdmin
    .from('mastermind_queue')
    .select('id')
    .eq('task_id', row.task_id)
    .eq('mode', row.mode)
    .gte('requested_at', since)
    .in('status', ['pending', 'working'])
    .limit(1)

  if (recent && recent.length > 0) return

  await supabaseAdmin.from('mastermind_queue').insert(row)
}

module.exports = router
module.exports._internal = { verifySignature, resolveMode, MODE_MAP }
