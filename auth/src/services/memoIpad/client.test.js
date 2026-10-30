const test = require('node:test')
const assert = require('node:assert')
const { createClient, isConfigured } = require('./client')

const env = {
  MEMO_IPAD_LOGIN_URL: 'https://svc.test/start',
  MEMO_IPAD_WALLPAPER_URL: 'https://svc.test/wall/',
  MEMO_IPAD_USER: 'someone@test',
  MEMO_IPAD_PASSWORD: 'top-secret',
}

function reply(status, { location, cookies = [], body = '' } = {}) {
  const headers = new Headers()
  if (location) headers.set('location', location)
  for (const c of cookies) headers.append('set-cookie', c)
  return new Response(status === 302 ? null : body, { status, headers })
}

// Scripted responses by "METHOD url"; records each call.
function fakeFetch(routes) {
  const calls = []
  const impl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers, body: init.body })
    const route = routes[`${init.method || 'GET'} ${url}`]
    if (!route) throw new Error('unexpected call ' + url)
    return route()
  }
  return { impl, calls }
}

const happyLogin = {
  'GET https://svc.test/start': () => reply(302, { location: 'https://auth.test/u/login/identifier?state=one', cookies: ['SESSION=early; Path=/; Domain=.svc.test'] }),
  'GET https://auth.test/u/login/identifier?state=one': () => reply(200),
  'POST https://auth.test/u/login/identifier?state=one': () => reply(302, { location: 'https://auth.test/u/login/password?state=two', cookies: ['login=a; Path=/'] }),
  'GET https://auth.test/u/login/password?state=two': () => reply(200),
  'POST https://auth.test/u/login/password?state=two': () => reply(302, { location: 'https://svc.test/done', cookies: ['SESSION=final; Path=/; Domain=.svc.test'] }),
  'GET https://svc.test/done': () => reply(200),
}

test('signIn walks the whole flow and sends the state from each step', async () => {
  const { impl, calls } = fakeFetch(happyLogin)
  await createClient({ env, fetchImpl: impl }).signIn()
  const posts = calls.filter(c => c.method === 'POST')
  assert.match(posts[0].body, /state=one/)
  assert.match(posts[0].body, /username=someone%40test/)
  assert.match(posts[1].body, /state=two/)
  assert.match(posts[1].body, /password=top-secret/)
})

test('cookies from sign-in are sent on later calls, with the newest value', async () => {
  const { impl, calls } = fakeFetch({ ...happyLogin, 'GET https://svc.test/wall/b1': () => reply(200, { body: '{"home":"h","lock":"l"}' }) })
  const client = createClient({ env, fetchImpl: impl })
  await client.signIn()
  assert.deepStrictEqual(await client.readWallpaper('b1'), { home: 'h', lock: 'l' })
  assert.match(calls.at(-1).headers.cookie, /SESSION=final/)
})

test('a rejected password fails clearly and leaks nothing', async () => {
  const { impl } = fakeFetch({
    ...happyLogin,
    'POST https://auth.test/u/login/password?state=two': () => reply(400, { body: 'wrong' }),
  })
  await assert.rejects(createClient({ env, fetchImpl: impl }).signIn(), (err) => {
    assert.match(err.message, /Sign-in failed/)
    assert.ok(!err.message.includes('top-secret'))
    assert.ok(!err.message.includes('someone@test'))
    return true
  })
})

test('an extra login step, such as a two-step code, stops the run', async () => {
  const { impl } = fakeFetch({
    ...happyLogin,
    'POST https://auth.test/u/login/password?state=two': () => reply(302, { location: 'https://auth.test/u/mfa-otp?state=x' }),
    'GET https://auth.test/u/mfa-otp?state=x': () => reply(200),
  })
  await createClient({ env, fetchImpl: impl }).signIn().then(
    () => assert.fail('should not have signed in'),
    (err) => assert.match(err.message, /Sign-in failed/),
  )
})

test('a refused upload is an error, not silent success', async () => {
  const { impl, calls } = fakeFetch({ 'POST https://svc.test/wall/b1/lock': () => reply(415) })
  await assert.rejects(createClient({ env, fetchImpl: impl }).setLockImage('b1', Buffer.from('x')), /Uploading the image failed \(415\)/)
  assert.ok(calls[0].body instanceof FormData)
  assert.ok(calls[0].body.get('image'), 'the service only accepts the field named image')
  assert.strictEqual(calls[0].body.get('file'), null)
})

test('isConfigured needs every setting', () => {
  assert.strictEqual(isConfigured(env), true)
  assert.strictEqual(isConfigured({ ...env, MEMO_IPAD_PASSWORD: '' }), false)
})
