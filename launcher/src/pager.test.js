const test = require('node:test')
const assert = require('node:assert/strict')
const { Pager, normalizeSettings } = require('./pager')
const { DP752Client } = require('./dp752-client')

function harness(settings, failing = []) {
  const paged = []
  const events = []
  let t = 1_000_000
  const pager = new Pager({
    getSettings: () => normalizeSettings({ enabled: true, base_url: 'https://base', ...settings }),
    client: { pageHandset: async (h) => { paged.push(h); return failing.includes(h) ? { handset: h, ok: false, error: 'x' } : { handset: h, ok: true } } },
    now: () => t,
    onEvent: (e) => events.push(e),
  })
  return { pager, paged, events, advance: (ms) => { t += ms } }
}

test('a single press pages the configured handsets', async () => {
  const h = harness({ handsets: [1, 2] })
  const ev = await h.pager.handleButton('single')
  assert.deepEqual(h.paged, [1, 2])
  assert.equal(ev.result, 'ok')
})

test('double press and hold do nothing', async () => {
  const h = harness({})
  assert.equal(await h.pager.handleButton('double'), null)
  assert.equal(await h.pager.handleButton('hold'), null)
  assert.deepEqual(h.paged, [])
})

test('mashing the button pages once and logs the rest as suppressed', async () => {
  const h = harness({ handsets: [1], cooldown_seconds: 60 })
  for (let i = 0; i < 10; i++) await h.pager.handleButton('single')
  assert.deepEqual(h.paged, [1])
  assert.equal(h.events.filter((e) => e.result === 'suppressed').length, 9)
  h.advance(61_000)
  await h.pager.handleButton('single')
  assert.deepEqual(h.paged, [1, 1])
})

test('one handset failing is partial; a total failure starts no cooldown', async () => {
  const partial = harness({ handsets: [1, 2] }, [2])
  assert.equal((await partial.pager.handleButton('single')).result, 'partial')

  const failed = harness({ handsets: [1, 2] }, [1, 2])
  assert.equal((await failed.pager.handleButton('single')).result, 'failed')
  assert.equal((await failed.pager.handleButton('single')).result, 'failed')
  assert.equal(failed.paged.length, 4)
})

test('a disabled pager ignores presses, and a test page skips the cooldown', async () => {
  const off = harness({ enabled: false })
  assert.equal(await off.pager.handleButton('single'), null)

  const h = harness({ handsets: [1] })
  await h.pager.handleButton('single')
  assert.equal((await h.pager.testPage([2])).result, 'ok')
  assert.deepEqual(h.paged, [1, 2])
})

test('settings are cleaned up', () => {
  const s = normalizeSettings({ handsets: ['2', 2, 9, 0, 1], cooldown_seconds: 'x', base_url: ' https://192.168.1.134/ ' })
  assert.deepEqual(s.handsets, [1, 2])
  assert.equal(s.cooldown_seconds, 60)
  assert.equal(s.base_url, 'https://192.168.1.134')
})

test('client logs in again once when the base rejects the session', async () => {
  const calls = []
  let valid = 'new'
  const client = new DP752Client(() => ({ baseUrl: 'https://base', username: 'admin', password: 'pw' }), {
    request: async function (p, body) {
      calls.push(p)
      if (p === '/cgi-bin/dologin') return { status: 200, json: { response: 'success', body: { sid: valid } } }
      return body.includes('sid=' + valid)
        ? { status: 200, json: { response: 'success', body: 'true' } }
        : { status: 200, json: { response: 'error', body: 'false' } }
    },
  })
  client.sid = 'stale'
  const r = await client.pageHandset(1)
  assert.equal(r.ok, true)
  assert.deepEqual(calls, ['/cgi-bin/dect', '/cgi-bin/dologin', '/cgi-bin/dect'])
})
