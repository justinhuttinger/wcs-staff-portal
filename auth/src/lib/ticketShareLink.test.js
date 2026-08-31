const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const {
  SHARE_TOKEN_BYTES, isShareToken, dispositionMode, contentDisposition, apiOrigin, buildShareUrl,
} = require('./ticketShareLink')

// A share token is the only thing standing between a private ticket file and
// the open internet, so these rules get tested directly.

test('a freshly minted token passes its own shape check', () => {
  const token = crypto.randomBytes(SHARE_TOKEN_BYTES).toString('hex')
  assert.equal(token.length, 64)
  assert.equal(isShareToken(token), true)
})

test('rejects anything that is not a 64-char lowercase hex token', () => {
  const bad = [
    '', null, undefined, 42, {},
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),                       // uppercase hex is not what we mint
    'g'.repeat(64),                       // not hex at all
    '../../etc/passwd',
    'a'.repeat(63) + '/',                 // path traversal via the token slot
  ]
  for (const t of bad) assert.equal(isShareToken(t), false, JSON.stringify(t))
})

test('renders pdfs and images in the tab, downloads everything else', () => {
  for (const t of ['application/pdf', 'image/png', 'image/jpeg', 'text/plain']) {
    assert.equal(dispositionMode(t), 'inline', t)
  }
  // Charset parameters and casing must not defeat the lookup.
  assert.equal(dispositionMode('TEXT/PLAIN; charset=utf-8'), 'inline')
})

test('never renders a type that could run script on our origin', () => {
  for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/javascript', '', null]) {
    assert.equal(dispositionMode(t), 'attachment', String(t))
  }
})

test('a filename cannot break out of the Content-Disposition header', () => {
  const evil = 'a"; filename="evil.exe\r\nX-Injected: 1'
  const header = contentDisposition('attachment', evil)
  assert.ok(!header.includes('\r'), 'CR survived')
  assert.ok(!header.includes('\n'), 'LF survived')
  // Exactly one quoted filename plus one filename* — no smuggled second one.
  assert.equal(header.match(/filename="/g).length, 1)
})

test('a unicode filename keeps an ascii fallback and an exact filename*', () => {
  const header = contentDisposition('attachment', 'Rocío résumé.docx')
  assert.match(header, /filename="Roc_o r_sum_\.docx"/)
  assert.ok(header.includes("filename*=UTF-8''" + encodeURIComponent('Rocío résumé.docx')))
})

test('falls back to the request host, and lets an explicit base url win', () => {
  assert.equal(
    apiOrigin({ configured: '', protocol: 'https', host: 'wcs-auth-api.onrender.com' }),
    'https://wcs-auth-api.onrender.com')
  assert.equal(
    apiOrigin({ configured: 'https://api.westcoaststrength.com/', protocol: 'http', host: 'localhost:3001' }),
    'https://api.westcoaststrength.com',
    'a configured base url must win and lose its trailing slash')
})

test('an unshared file has no link at all', () => {
  assert.equal(buildShareUrl('https://x.test', null), null)
  assert.equal(buildShareUrl('https://x.test', undefined), null)
  assert.equal(buildShareUrl('https://x.test', 'abc'), 'https://x.test/public/ticket-file/abc')
})
