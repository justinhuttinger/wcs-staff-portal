const test = require('node:test')
const assert = require('node:assert/strict')
const {
  buildRawMessage, encodeHeader, replySubject, extractPlainText, stripQuoted, latestReply, decodeBase64url,
} = require('../src/services/followUps/gmail')

const b64url = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const OWNER = 'owner@example.org'

test('buildRawMessage: headers, utf-8 body, and threading headers', () => {
  const raw = buildRawMessage({
    toName: 'Sam Lee', toEmail: 'sam@example.com', subject: 'Q4 schedule',
    body: 'Hi Sam,\nCan you send it? Thanks ✓', inReplyTo: '<abc@mail.gmail.com>',
  })
  const mime = decodeBase64url(raw)
  assert.match(mime, /^To: "Sam Lee" <sam@example.com>\r\n/)
  assert.match(mime, /\r\nSubject: Q4 schedule\r\n/)
  assert.match(mime, /\r\nIn-Reply-To: <abc@mail.gmail.com>\r\nReferences: <abc@mail.gmail.com>\r\n/)
  const body = mime.split('\r\n\r\n')[1].replace(/\r\n/g, '')
  assert.equal(Buffer.from(body, 'base64').toString('utf8'), 'Hi Sam,\r\nCan you send it? Thanks ✓')
})

test('buildRawMessage: no threading headers on a first email; header injection stripped', () => {
  const mime = decodeBase64url(buildRawMessage({ toName: 'A', toEmail: 'a@b.co', subject: 'x\r\nBcc: evil@x.co', body: 'hi' }))
  assert.doesNotMatch(mime, /In-Reply-To/)
  assert.doesNotMatch(mime, /\r\nBcc:/)
})

test('encodeHeader: ascii passes through, non-ascii becomes an encoded word', () => {
  assert.equal(encodeHeader('Hello'), 'Hello')
  assert.equal(encodeHeader('Café'), `=?UTF-8?B?${Buffer.from('Café').toString('base64')}?=`)
})

test('replySubject: adds Re: once', () => {
  assert.equal(replySubject('Budget'), 'Re: Budget')
  assert.equal(replySubject('RE: Budget'), 'RE: Budget')
})

test('extractPlainText: prefers text/plain inside multipart, falls back to html', () => {
  const payload = { mimeType: 'multipart/alternative', parts: [
    { mimeType: 'text/html', body: { data: b64url('<p>Hi<br>there</p>') } },
    { mimeType: 'text/plain', body: { data: b64url('Hi there') } },
  ] }
  assert.equal(extractPlainText(payload), 'Hi there')
  const htmlOnly = { mimeType: 'text/html', body: { data: b64url('<div>Yo &amp; hi</div>') } }
  assert.equal(extractPlainText(htmlOnly).trim(), 'Yo & hi')
})

test('stripQuoted: removes gmail quote block and > lines', () => {
  const t = 'Sounds good, will do.\n\nAlex\n\nOn Mon, Nov 10, 2026 at 9:00 AM Sam Lee <sam@example.com>\nwrote:\n> old stuff\n> more'
  assert.equal(stripQuoted(t), 'Sounds good, will do.\n\nAlex')
})

test('latestReply: ignores the owner and returns the newest other message', () => {
  const msg = (from, at, snippet) => ({ internalDate: String(at), snippet, payload: { headers: [{ name: 'From', value: from }] } })
  const thread = [
    msg(`Owner <${OWNER}>`, 1000, 'ask'),
    msg('Sam Lee <Sam@Example.com>', 2000, 'first'),
    msg(OWNER, 3000, 'nudge'),
    msg('Sam Lee <sam@example.com>', 4000, 'second'),
  ]
  assert.deepEqual(latestReply(thread, OWNER.toUpperCase()), { at: 4000, snippet: 'second' })
  assert.equal(latestReply(thread.filter(m => m.snippet === 'ask'), OWNER), null)
})
