const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('path')

const clientPath = require.resolve('../src/services/ghlClient')

function withGhl(handler, run) {
  const calls = []
  require.cache[clientPath] = {
    id: clientPath, filename: clientPath, loaded: true,
    exports: {
      ghlFetch: async (p, key, opts) => {
        calls.push({ path: p, params: opts && opts.params })
        return handler(p, opts)
      },
    },
  }
  delete require.cache[require.resolve('../src/lib/resolveGhlContact')]
  const { resolveGhlContactId } = require('../src/lib/resolveGhlContact')
  return run(resolveGhlContactId, calls)
}

const LOC = { locationId: 'loc1', apiKey: 'key1' }

test('finds the contact by email', async () => {
  await withGhl(
    () => ({ contact: { id: 'c_email' } }),
    async (resolve, calls) => {
      assert.equal(await resolve({ ...LOC, email: 'a@b.com', phone: '+15035551234' }), 'c_email')
      // Email is tried first and is enough; no phone call is made.
      assert.equal(calls.length, 1)
      assert.equal(calls[0].params.email, 'a@b.com')
    }
  )
})

test('falls back to the phone when no email matches', async () => {
  await withGhl(
    (p, opts) => (opts.params.number ? { contact: { id: 'c_phone' } } : { contact: null }),
    async (resolve, calls) => {
      assert.equal(await resolve({ ...LOC, email: 'a@b.com', phone: '+15035551234' }), 'c_phone')
      assert.equal(calls.length, 2)
      assert.equal(calls[1].params.number, '+15035551234')
    }
  )
})

test('null when neither matches, rather than a bogus id', async () => {
  await withGhl(
    () => ({ contact: null }),
    async resolve => {
      assert.equal(await resolve({ ...LOC, email: 'a@b.com', phone: '+15035551234' }), null)
    }
  )
})

test('a GHL failure never throws into the tour save', async () => {
  await withGhl(
    () => { throw new Error('GHL API error 500') },
    async resolve => {
      assert.equal(await resolve({ ...LOC, email: 'a@b.com', phone: '+1503' }), null)
    }
  )
})

test('skips a blank email or phone instead of querying for empty', async () => {
  await withGhl(
    () => ({ contact: null }),
    async (resolve, calls) => {
      await resolve({ ...LOC, email: '', phone: '  ' })
      assert.equal(calls.length, 0)
    }
  )
})

test('no location config means no lookup at all', async () => {
  await withGhl(
    () => ({ contact: { id: 'nope' } }),
    async (resolve, calls) => {
      assert.equal(await resolve({ locationId: null, apiKey: null, email: 'a@b.com' }), null)
      assert.equal(calls.length, 0)
    }
  )
})
