// Gmail REST helpers for Follow-ups. Sends as the signed-in owner (their own
// Google token from staff_google_tokens), threads nudges onto the first email,
// reads a thread to spot a reply, and pulls recent Sent mail as voice samples.
// The pure helpers (MIME building, text extraction, reply detection) are
// exported for tests.

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me'

// ---------- pure helpers ----------

function base64url(input) {
  return Buffer.from(input, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function decodeBase64url(data) {
  return Buffer.from(String(data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

// RFC 2047 encoded-word for anything outside printable ASCII.
function encodeHeader(value) {
  const s = String(value || '').replace(/[\r\n]+/g, ' ')
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`
}

function formatAddress(name, email) {
  const cleanEmail = String(email || '').trim()
  const cleanName = String(name || '').replace(/["\r\n]/g, '').trim()
  if (!cleanName) return cleanEmail
  const encoded = encodeHeader(cleanName)
  return encoded === cleanName ? `"${cleanName}" <${cleanEmail}>` : `${encoded} <${cleanEmail}>`
}

// Builds a plain-text RFC 2822 message and returns it base64url-encoded, ready
// for messages.send. inReplyTo is the first email's Message-ID header; passing
// it (plus the Gmail threadId) keeps nudges in one conversation everywhere.
function buildRawMessage({ toName, toEmail, subject, body, inReplyTo, cc = [] }) {
  const ccList = (cc || []).map(e => String(e).replace(/[\r\n,<>"]/g, '').trim()).filter(Boolean)
  const headers = [
    `To: ${formatAddress(toName, toEmail)}`,
    ...(ccList.length ? [`Cc: ${ccList.join(', ')}`] : []),
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`)
    headers.push(`References: ${inReplyTo}`)
  }
  const encodedBody = Buffer.from(String(body || '').replace(/\r?\n/g, '\r\n'), 'utf8')
    .toString('base64').replace(/(.{76})/g, '$1\r\n')
  return base64url(headers.join('\r\n') + '\r\n\r\n' + encodedBody)
}

function replySubject(subject) {
  const s = String(subject || '').trim()
  return /^re:/i.test(s) ? s : `Re: ${s}`
}

function headerValue(headers, name) {
  const h = (headers || []).find(x => String(x.name).toLowerCase() === name.toLowerCase())
  return h ? h.value : ''
}

function emailFrom(fromHeader) {
  const m = String(fromHeader || '').match(/<([^>]+)>/)
  return (m ? m[1] : String(fromHeader || '')).trim().toLowerCase()
}

// First text/plain part in a Gmail payload tree; falls back to stripped HTML.
function extractPlainText(payload) {
  if (!payload) return ''
  const plain = []
  const html = []
  const walk = (part) => {
    if (!part) return
    if (part.mimeType === 'text/plain' && part.body?.data) plain.push(decodeBase64url(part.body.data))
    else if (part.mimeType === 'text/html' && part.body?.data) html.push(decodeBase64url(part.body.data))
    for (const p of part.parts || []) walk(p)
  }
  walk(payload)
  if (plain.length) return plain[0]
  if (html.length) {
    return html[0]
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div)>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
  }
  return ''
}

// Drops the quoted history under a reply so only what the sender wrote is left.
function stripQuoted(text) {
  let t = String(text || '').replace(/\r\n/g, '\n')
  const cuts = [
    /\nOn [\s\S]{0,300}?wrote:\s*\n/,
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\n_{5,}\s*\n/,
    /\nFrom: .+\n(Sent|Date): /,
  ]
  for (const re of cuts) {
    const m = t.match(re)
    if (m) t = t.slice(0, m.index)
  }
  return t.split('\n').filter(line => !line.startsWith('>')).join('\n')
    .replace(/\n{3,}/g, '\n\n').trim()
}

// Latest message in the thread that the owner did not send. Returns null when
// nobody but the owner has written in it.
function latestReply(threadMessages, ownerEmail) {
  const owner = String(ownerEmail || '').toLowerCase()
  let best = null
  for (const m of threadMessages || []) {
    const from = emailFrom(headerValue(m.payload?.headers, 'From'))
    if (!from || from === owner) continue
    const at = Number(m.internalDate || 0)
    if (!best || at > best.at) best = { at, snippet: m.snippet || '' }
  }
  return best
}

// ---------- API calls ----------

async function gmailFetch(accessToken, path, init = {}) {
  const res = await fetch(GMAIL + path, {
    ...init,
    headers: { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Gmail request failed (${res.status})`)
    err.status = res.status === 401 || res.status === 403 ? 412 : 502
    if (res.status === 401 || res.status === 403) err.notConnected = true
    throw err
  }
  return data
}

async function sendEmail(accessToken, { toName, toEmail, subject, body, threadId, inReplyTo, cc }) {
  const raw = buildRawMessage({ toName, toEmail, subject, body, inReplyTo, cc })
  const sent = await gmailFetch(accessToken, '/messages/send', {
    method: 'POST',
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  })
  // Gmail assigns the RFC Message-ID; read it back so later nudges can cite it.
  let messageIdHeader = ''
  try {
    const meta = await gmailFetch(accessToken, `/messages/${sent.id}?format=metadata&metadataHeaders=Message-ID`)
    messageIdHeader = headerValue(meta.payload?.headers, 'Message-ID')
  } catch { /* threading still works through threadId */ }
  return { id: sent.id, threadId: sent.threadId, messageIdHeader }
}

// Attachment parts of a full-format message. Inline = has a Content-ID or an
// inline disposition (usually a signature image). partId is stable across
// fetches; attachmentId is NOT (Gmail issues a new one each time), so it is
// only for downloading. Parts without a filename are message bodies.
function listAttachments(message) {
  const out = []
  const walk = part => {
    if (!part) return
    if (part.body?.attachmentId && part.filename) {
      const disp = headerValue(part.headers, 'Content-Disposition')
      out.push({
        attachmentId: part.body.attachmentId,
        partId: part.partId ?? null,
        filename: part.filename || 'attachment',
        mimeType: part.mimeType || 'application/octet-stream',
        size: Number(part.body.size || 0),
        inline: /^\s*inline/i.test(disp) || !!headerValue(part.headers, 'Content-ID'),
      })
    }
    for (const p of part.parts || []) walk(p)
  }
  walk(message?.payload)
  return out
}

// Inbox message ids received after a unix time (seconds), newest first, capped (ids only, so a big cap is cheap).
async function listInboxSince(accessToken, afterSeconds, { cap = 2000 } = {}) {
  const out = []
  let pageToken = ''
  do {
    const q = new URLSearchParams({ q: 'in:inbox after:' + Math.max(0, Math.floor(afterSeconds)), maxResults: '100' })
    if (pageToken) q.set('pageToken', pageToken)
    const data = await gmailFetch(accessToken, '/messages?' + q)
    out.push(...(data.messages || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken && out.length < cap)
  return out.slice(0, cap)
}

async function getMessageFull(accessToken, id) {
  return gmailFetch(accessToken, '/messages/' + encodeURIComponent(id) + '?format=full')
}

async function getThreadFull(accessToken, threadId) {
  const data = await gmailFetch(accessToken, `/threads/${encodeURIComponent(threadId)}?format=full`)
  return data.messages || []
}

async function getAttachment(accessToken, messageId, attachmentId) {
  const data = await gmailFetch(accessToken, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`)
  return Buffer.from(String(data.data || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

async function getThread(accessToken, threadId) {
  const data = await gmailFetch(accessToken,
    `/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Date`)
  return data.messages || []
}

// A handful of the owner's own recent emails, quotes stripped, as style
// samples for the drafter. Cached per owner for a few hours.
const SAMPLE_TTL_MS = 6 * 60 * 60 * 1000
const sampleCache = new Map()

async function recentSentSamples(accessToken, cacheKey, { want = 8 } = {}) {
  const hit = sampleCache.get(cacheKey)
  if (hit && hit.expires > Date.now()) return hit.samples
  const list = await gmailFetch(accessToken,
    '/messages?maxResults=30&q=' + encodeURIComponent('in:sent newer_than:180d -in:chats'))
  const ids = (list.messages || []).map(m => m.id)
  const full = await Promise.all(ids.map(id =>
    gmailFetch(accessToken, `/messages/${id}?format=full`).catch(() => null)))
  const samples = []
  for (const m of full) {
    if (!m) continue
    const text = stripQuoted(extractPlainText(m.payload))
    // Skip one-word acks and long documents; neither shows how he writes a note.
    if (text.length < 60 || text.length > 1500) continue
    samples.push(text)
    if (samples.length >= want) break
  }
  sampleCache.set(cacheKey, { samples, expires: Date.now() + SAMPLE_TTL_MS })
  return samples
}

module.exports = {
  buildRawMessage, encodeHeader, replySubject, extractPlainText, stripQuoted, latestReply,
  emailFrom, headerValue, decodeBase64url,
  sendEmail, getThread, getThreadFull, listInboxSince, getMessageFull, getAttachment, listAttachments, recentSentSamples,
}
