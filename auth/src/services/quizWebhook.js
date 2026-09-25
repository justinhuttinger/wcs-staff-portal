const { buildWebhookPayload } = require('./quizSchema')

// Quiz submission -> club's GHL inbound webhook. Every send updates the
// submission row (webhook_status/attempts/error); a 10-minute sweep retries
// failures. A failed webhook never affects the lead's submit.
const MAX_ATTEMPTS = 5
const TIMEOUT_MS = 10 * 1000
const PENDING_GRACE_MS = 2 * 60 * 1000
const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

// Lazy-require: services/supabase throws at import without env vars.
function db() {
  return require('./supabase').supabaseAdmin
}

async function postJson(url, payload, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    const text = await res.text().catch(() => '')
    return { ok: !!res.ok, status: res.status, text: String(text).slice(0, 500) }
  } catch (err) {
    const text = err && err.name === 'AbortError' ? `Timed out after ${Math.round(timeoutMs / 1000)}s` : String(err && err.message).slice(0, 300)
    return { ok: false, status: 0, text }
  } finally {
    clearTimeout(timer)
  }
}

function nextWebhookState(prevAttempts, result) {
  const attempts = (prevAttempts || 0) + 1
  if (result.ok) return { webhook_status: 'sent', webhook_attempts: attempts, webhook_error: null }
  const prefix = result.status ? `HTTP ${result.status}` : 'Network error'
  return {
    webhook_status: 'failed',
    webhook_attempts: attempts,
    webhook_error: `${prefix}: ${result.text || ''}`.trim().slice(0, 300),
  }
}

function isRetryDue(row, now = Date.now()) {
  if (row.webhook_status !== 'pending' && row.webhook_status !== 'failed') return false
  if ((row.webhook_attempts || 0) >= MAX_ATTEMPTS) return false
  const age = now - new Date(row.submitted_at).getTime()
  if (age > RETRY_WINDOW_MS) return false
  // A fresh 'pending' row is still being sent by the submit handler.
  if (row.webhook_status === 'pending' && age < PENDING_GRACE_MS) return false
  return true
}

async function deliverWebhook(submissionId) {
  const { data: sub } = await db().from('form_submissions').select('*').eq('id', submissionId).maybeSingle()
  if (!sub || !sub.location_id) return { skipped: true }
  const [{ data: form }, { data: club }, { data: loc }] = await Promise.all([
    db().from('forms').select('*').eq('id', sub.form_id).maybeSingle(),
    db().from('quiz_clubs').select('*').eq('form_id', sub.form_id).eq('location_id', sub.location_id).maybeSingle(),
    db().from('locations').select('name').eq('id', sub.location_id).maybeSingle(),
  ])
  if (!form) return { skipped: true }
  if (!club || !club.ghl_webhook_url) {
    // URL removed since submit: nothing to deliver to.
    await db().from('form_submissions').update({ webhook_status: 'none' }).eq('id', sub.id)
    return { skipped: true }
  }
  const payload = buildWebhookPayload({ form, clubName: loc?.name || '', submission: sub })
  const result = await postJson(club.ghl_webhook_url, payload)
  const state = nextWebhookState(sub.webhook_attempts, result)
  await db().from('form_submissions').update(state).eq('id', sub.id)
  if (!result.ok) console.error(`[quizWebhook] submission ${sub.id} failed: ${state.webhook_error}`)
  return { ...state, http_status: result.status }
}

async function retryWebhooks() {
  const since = new Date(Date.now() - RETRY_WINDOW_MS).toISOString()
  const { data, error } = await db().from('form_submissions')
    .select('id, webhook_status, webhook_attempts, submitted_at')
    .in('webhook_status', ['pending', 'failed'])
    .lt('webhook_attempts', MAX_ATTEMPTS)
    .gte('submitted_at', since)
    .order('submitted_at', { ascending: true })
    .limit(100)
  if (error) throw error
  let sent = 0
  let failed = 0
  for (const row of (data || []).filter(r => isRetryDue(r))) {
    try {
      const r = await deliverWebhook(row.id)
      if (r.webhook_status === 'sent') sent++
      else if (r.webhook_status === 'failed') failed++
    } catch (err) {
      failed++
      console.error('[quizWebhook] retry threw:', err.message)
    }
  }
  return { sent, failed }
}

function start() {
  if (process.env.QUIZ_WEBHOOKS_DISABLED === '1') return
  const sweep = async () => {
    try {
      const { sent, failed } = await retryWebhooks()
      if (sent || failed) console.log(`[quizWebhook] sweep: ${sent} sent, ${failed} failed`)
    } catch (err) {
      console.error('[quizWebhook] sweep failed:', err.message)
    }
  }
  setInterval(sweep, 10 * 60 * 1000).unref()
}

module.exports = { MAX_ATTEMPTS, postJson, nextWebhookState, isRetryDue, deliverWebhook, retryWebhooks, start }
