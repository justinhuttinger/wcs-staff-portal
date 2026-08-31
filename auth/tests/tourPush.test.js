const test = require('node:test')
const assert = require('node:assert/strict')

const wpPath = require.resolve('web-push')
const supaPath = require.resolve('../src/services/supabase')
const modPath = require.resolve('../src/lib/tourPush')

// Rebuild the module under a given environment: the VAPID check runs at import.
function load({ pub, priv, subs = [], send = async () => {} }) {
  const logs = []
  const deleted = []

  require.cache[wpPath] = {
    id: wpPath, filename: wpPath, loaded: true,
    exports: { setVapidDetails() {}, sendNotification: send },
  }
  require.cache[supaPath] = {
    id: supaPath, filename: supaPath, loaded: true,
    exports: {
      supabaseAdmin: {
        from: table => ({
          select: () => ({
            eq: () => (table === 'tour_push_subscriptions'
              ? Promise.resolve({ data: subs, error: null })
              : { maybeSingle: async () => ({ data: { public_token: 'tok' } }) }),
          }),
          delete: () => ({ in: (_c, ids) => { deleted.push(...ids); return Promise.resolve({}) } }),
        }),
      },
    },
  }

  const prevPub = process.env.VAPID_PUBLIC_KEY
  const prevPriv = process.env.VAPID_PRIVATE_KEY
  if (pub) process.env.VAPID_PUBLIC_KEY = pub; else delete process.env.VAPID_PUBLIC_KEY
  if (priv) process.env.VAPID_PRIVATE_KEY = priv; else delete process.env.VAPID_PRIVATE_KEY

  const realErr = console.error, realWarn = console.warn, realLog = console.log
  console.error = console.warn = console.log = (...a) => logs.push(a.join(' '))

  delete require.cache[modPath]
  const mod = require(modPath)

  const restore = () => {
    console.error = realErr; console.warn = realWarn; console.log = realLog
    if (prevPub === undefined) delete process.env.VAPID_PUBLIC_KEY
    else process.env.VAPID_PUBLIC_KEY = prevPub
    if (prevPriv === undefined) delete process.env.VAPID_PRIVATE_KEY
    else process.env.VAPID_PRIVATE_KEY = prevPriv
  }
  return { mod, logs, deleted, restore }
}

const SUB = { id: 's1', endpoint: 'https://web.push.apple.com/x', p256dh: 'p', auth: 'a' }

test('half a key pair is reported as disabled, by name', async () => {
  // The public key ALONE lets an iPad subscribe and show alerts as on, so this
  // is the shape that hides: staff are told it works and nothing can send.
  const { logs, restore } = load({ pub: 'pub-only', priv: null })
  restore()
  const line = logs.join('\n')
  assert.match(line, /DISABLED/)
  assert.match(line, /VAPID_PRIVATE_KEY/)
  assert.doesNotMatch(line, /VAPID_PUBLIC_KEY/, 'must name only what is missing')
})

test('pushConfigured is false when a key is missing', async () => {
  const { mod, restore } = load({ pub: 'pub-only', priv: null })
  assert.equal(mod.pushConfigured(), false)
  restore()
})

test('an unconfigured send says so instead of returning silently', async () => {
  const { mod, logs, restore } = load({ pub: 'pub-only', priv: null, subs: [SUB] })
  await mod.sendTourArrival('loc-1', { id: 'i1', contact_name: 'Dana' })
  restore()
  assert.ok(logs.some(l => /skipped: VAPID not configured/.test(l)), logs.join('\n'))
})

test('a successful send is logged too, so silence means nothing ran', async () => {
  const { mod, logs, restore } = load({ pub: 'p', priv: 'k', subs: [SUB] })
  await mod.sendTourArrival('loc-1', { id: 'i1', contact_name: 'Dana' })
  restore()
  assert.ok(logs.some(l => /sent 1\/1/.test(l)), logs.join('\n'))
})

test('no subscribed device is stated, not assumed', async () => {
  const { mod, logs, restore } = load({ pub: 'p', priv: 'k', subs: [] })
  await mod.sendTourArrival('loc-1', { id: 'i1' })
  restore()
  assert.ok(logs.some(l => /no devices subscribed/.test(l)), logs.join('\n'))
})

test('an expired subscription is pruned and counted', async () => {
  const err = new Error('gone'); err.statusCode = 410
  const { mod, logs, deleted, restore } = load({
    pub: 'p', priv: 'k', subs: [SUB], send: async () => { throw err },
  })
  await mod.sendTourArrival('loc-1', { id: 'i1' })
  restore()
  assert.deepEqual(deleted, ['s1'])
  assert.ok(logs.some(l => /sent 0\/1.*pruned 1/.test(l)), logs.join('\n'))
})

test('a real send failure is logged and the subscription kept', async () => {
  const err = new Error('boom'); err.statusCode = 500
  const { mod, deleted, logs, restore } = load({
    pub: 'p', priv: 'k', subs: [SUB], send: async () => { throw err },
  })
  await mod.sendTourArrival('loc-1', { id: 'i1' })
  restore()
  // A 500 from Apple is not evidence the device is gone.
  assert.deepEqual(deleted, [])
  assert.ok(logs.some(l => /send failed/.test(l)), logs.join('\n'))
})
