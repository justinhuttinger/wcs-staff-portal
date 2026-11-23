const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('crypto')
const { verifyChatToken, bearer } = require('../src/services/projects/chatVerify')

const AUD = 'https://api.example.com/projects-chat/events'
const SA = 'service-123@gcp-sa-gsuiteaddons.iam.gserviceaccount.com'
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
const getKeys = async () => [jwk]
const NOW = Date.UTC(2026, 10, 23, 20, 0, 0)

function sign(payload, { kid = 'k1', alg = 'RS256', key = privateKey } = {}) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = enc({ alg, kid, typ: 'JWT' })
  const body = enc(payload)
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url')
  return `${head}.${body}.${sig}`
}
const good = (o = {}) => ({
  iss: 'https://accounts.google.com', aud: AUD, email: SA, email_verified: true,
  iat: NOW / 1000 - 10, exp: NOW / 1000 + 3600, ...o,
})
const check = (token, o = {}) => verifyChatToken(token, { audience: AUD, serviceAccountEmail: SA, getKeys, now: NOW, ...o })

test('a correctly signed token from the add-on service account passes', async () => {
  const r = await check(sign(good()))
  assert.equal(r.ok, true)
  assert.equal(r.payload.email, SA)
})

test('rejects wrong audience, issuer, service account, expiry and unverified email', async () => {
  assert.equal((await check(sign(good({ aud: AUD + '/' })))).reason, 'bad audience')
  assert.equal((await check(sign(good({ iss: 'https://evil.example' })))).reason, 'bad issuer')
  assert.equal((await check(sign(good({ email: 'someone@gmail.com' })))).reason, 'wrong service account')
  assert.equal((await check(sign(good({ exp: NOW / 1000 - 120 })))).reason, 'expired')
  assert.equal((await check(sign(good({ email_verified: false })))).reason, 'email not verified')
})

test('rejects a forged signature, an unknown key and a non-RS256 token', async () => {
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
  assert.equal((await check(sign(good(), { key: other }))).reason, 'bad signature')
  assert.equal((await check(sign(good(), { kid: 'nope' }))).reason, 'unknown key')
  assert.equal((await check(sign(good(), { alg: 'HS256' }))).reason, 'unexpected alg')
  assert.equal((await check('not.a.jwt.at.all')).reason, 'malformed token')
})

test('refuses everything when the service account is not configured', async () => {
  assert.equal((await check(sign(good()), { serviceAccountEmail: '' })).reason, 'not configured')
})

test('bearer pulls the token from the Authorization header', () => {
  assert.equal(bearer({ headers: { authorization: 'Bearer abc.def.ghi' } }), 'abc.def.ghi')
  assert.equal(bearer({ headers: {} }), null)
})
