const test = require('node:test')
const assert = require('node:assert/strict')
const w = require('./quizWebhook')

test('postJson: 2xx ok, sends JSON', async () => {
  let seen
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true, status: 200, text: async () => 'ok' } }
  const r = await w.postJson('https://h', { a: 1 }, fetchImpl)
  assert.deepEqual(r, { ok: true, status: 200, text: 'ok' })
  assert.equal(seen.init.method, 'POST')
  assert.equal(seen.init.headers['Content-Type'], 'application/json')
  assert.equal(seen.init.body, '{"a":1}')
})

test('postJson: 5xx is not ok and keeps the body', async () => {
  const r = await w.postJson('https://h', {}, async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }))
  assert.deepEqual(r, { ok: false, status: 502, text: 'bad gateway' })
})

test('postJson: timeout becomes a failure, not a hang', async () => {
  const hang = (url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; reject(e) })
  })
  const r = await w.postJson('https://h', {}, hang, 20)
  assert.equal(r.ok, false)
  assert.equal(r.status, 0)
  assert.match(r.text, /Timed out/)
})

test('nextWebhookState counts attempts and records errors', () => {
  assert.deepEqual(w.nextWebhookState(0, { ok: true, status: 200 }),
    { webhook_status: 'sent', webhook_attempts: 1, webhook_error: null })
  const f = w.nextWebhookState(2, { ok: false, status: 500, text: 'boom' })
  assert.equal(f.webhook_status, 'failed')
  assert.equal(f.webhook_attempts, 3)
  assert.equal(f.webhook_error, 'HTTP 500: boom')
  assert.equal(w.nextWebhookState(0, { ok: false, status: 0, text: 'Timed out after 10s' }).webhook_error, 'Network error: Timed out after 10s')
})

test('isRetryDue: grace for pending, cap, window, status', () => {
  const now = Date.parse('2026-09-25T12:00:00Z')
  const at = mins => new Date(now - mins * 60000).toISOString()
  assert.equal(w.isRetryDue({ webhook_status: 'pending', webhook_attempts: 0, submitted_at: at(1) }, now), false)
  assert.equal(w.isRetryDue({ webhook_status: 'pending', webhook_attempts: 0, submitted_at: at(3) }, now), true)
  assert.equal(w.isRetryDue({ webhook_status: 'failed', webhook_attempts: 4, submitted_at: at(1) }, now), true)
  assert.equal(w.isRetryDue({ webhook_status: 'failed', webhook_attempts: 5, submitted_at: at(30) }, now), false)
  assert.equal(w.isRetryDue({ webhook_status: 'failed', webhook_attempts: 1, submitted_at: at(8 * 24 * 60) }, now), false)
  assert.equal(w.isRetryDue({ webhook_status: 'sent', webhook_attempts: 1, submitted_at: at(30) }, now), false)
})
