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

  // Diagnostic: every event we receive lands in mastermind_errors with a
  // 'diag' kind so we can verify reachability + see payload shape from
  // ClickUp. Cheap, bounded by webhook volume, easy to query.
  try {
    await supabaseAdmin.from('mastermind_errors').insert({
      error_kind: 'diag',
      message: `received ${evt || 'unknown event'} task=${taskId || 'none'}`,
      payload: event,
    })
  } catch { /* don't fail handling on diag insert */ }

  if (!taskId) return

  if (evt === 'taskUpdated') {
    const histories = Array.isArray(event.history_items) ? event.history_items : []
    let enqueuedAny = false
    for (const h of histories) {
      // ClickUp uses several shapes for custom-field history entries. Check
      // a few candidate paths to find the field name.
      const fieldName =
        h?.custom_field?.name ||
        h?.field?.name ||
        h?.data?.custom_field?.name ||
        ''
      if (fieldName !== MASTERMIND_FIELD_NAME) continue

      // ClickUp dropdown custom-field changes send the option's UUID in `after`,
      // not the human-readable label. The full options list is embedded in
      // h.custom_field.type_config.options — look up by id to get the name.
      const afterValue = h?.after ?? h?.data?.after ?? h?.value
      const customFieldDef = h?.custom_field || h?.data?.custom_field
      const mode = resolveMode(afterValue, customFieldDef)
      if (!mode) continue

      await enqueue({
        task_id: taskId,
        list_id: event.list_id || h?.list_id || '',
        mode,
        requested_by: h?.user?.id ? String(h.user.id) : null,
        payload: event,
      })
      enqueuedAny = true
    }
    if (!enqueuedAny) {
      try {
        await supabaseAdmin.from('mastermind_errors').insert({
          error_kind: 'no_match',
          message: `taskUpdated for ${taskId} had ${histories.length} history_items but no Mastermind field change resolved to a known mode`,
          payload: event,
        })
      } catch { /* ignore */ }
    }
    return
  }

  if (evt === 'taskCommentPosted') {
    // ClickUp puts the comment text inside history_items[].comment.text_content,
    // NOT at the top-level payload.comment.comment_text. Walk history_items to
    // find a 'comment' entry and pull text from either text_content (plain)
    // or the rich-text op array.
    const histories = Array.isArray(event.history_items) ? event.history_items : []
    let commentText = ''
    let commentUserId = null
    for (const h of histories) {
      const c = h?.comment
      if (!c) continue
      if (typeof c.text_content === 'string' && c.text_content.length > 0) {
        commentText = c.text_content
      } else if (Array.isArray(c.comment)) {
        commentText = c.comment.map(op => op?.text || '').join('')
      }
      if (h?.user?.id) commentUserId = String(h.user.id)
      if (commentText) break
    }
    // Last-resort fallback to the older payload shape
    if (!commentText) {
      commentText = event?.comment?.comment_text || event?.comment_text || ''
    }

    if (!/@mastermind\b/i.test(commentText)) return

    await enqueue({
      task_id: taskId,
      list_id: event.list_id || '',
      mode: 'continue',
      requested_by: commentUserId,
      payload: event,
    })
  }
}

function resolveMode(rawValue, customFieldDef) {
  if (!rawValue) return null
  let label
  if (typeof rawValue === 'string') {
    // ClickUp dropdown custom-field webhooks send the OPTION UUID, not the
    // display label. Resolve via the embedded type_config.options list.
    const options = customFieldDef?.type_config?.options
    if (Array.isArray(options)) {
      const opt = options.find(o => o?.id === rawValue)
      if (opt) label = opt.name || opt.value
    }
    if (!label) label = rawValue  // fall back to using value directly
  }
  else if (rawValue.label) label = rawValue.label
  else if (Array.isArray(rawValue) && rawValue[0]?.label) label = rawValue[0].label
  else if (rawValue.value && typeof rawValue.value === 'string') label = rawValue.value
  else return null
  return MODE_MAP[String(label).toLowerCase().trim()] || null
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
