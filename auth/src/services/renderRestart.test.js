const test = require('node:test')
const assert = require('node:assert/strict')

const { restartClubServices, canRestart } = require('./renderRestart')

function withEnv(env, fn) {
  const saved = { ...process.env }
  Object.assign(process.env, env)
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k]
  return Promise.resolve(fn()).finally(() => { process.env = saved })
}

test('does nothing without a key and targets', () => withEnv(
  { RENDER_API_KEY: undefined, RENDER_CLUB_RESTART_SERVICES: undefined },
  async () => {
    assert.equal(canRestart(), false)
    let called = false
    const r = await restartClubServices({ fetchImpl: async () => { called = true } })
    assert.equal(called, false)
    assert.match(r.skipped, /not set/)
  },
))

test('restarts every target, itself last, and reports failures', () => withEnv(
  { RENDER_API_KEY: 'rnd_x', RENDER_CLUB_RESTART_SERVICES: 'srv-self, srv-sync', RENDER_SERVICE_ID: 'srv-self' },
  async () => {
    const calls = []
    const r = await restartClubServices({
      fetchImpl: async (url, init) => {
        calls.push([url, init.method, init.headers.Authorization])
        return { ok: !url.includes('srv-sync') , status: 500 }
      },
    })
    assert.deepEqual(calls.map(c => c[0]), [
      'https://api.render.com/v1/services/srv-sync/restart',
      'https://api.render.com/v1/services/srv-self/restart',
    ])
    assert.ok(calls.every(c => c[1] === 'POST' && c[2] === 'Bearer rnd_x'))
    assert.deepEqual(r.restarted, ['srv-self'])
    assert.equal(r.failed[0].id, 'srv-sync')
  },
))
