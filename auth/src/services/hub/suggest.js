// Hub Suggestions: incoming email (and, later, texts) that ask the owner for
// something become suggested tasks he adds with one click. This file holds the
// pure rules (what is skipped before Claude, how Claude's guesses are cleaned,
// one open suggestion per thread) plus runSuggestions, which the 10-minute job
// calls with real Gmail, database and Claude injected. Tested in
// tests/hubSuggest.test.js.
const { headerValue, emailFrom, extractPlainText, stripQuoted } = require('../followUps/gmail')

// ---------- pure rules ----------

const AUTO_FROM = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|bounces?)\b/i

function isAutomated(headers) {
  if (headerValue(headers, 'List-Unsubscribe') || headerValue(headers, 'List-Id')) return true
  if (/^(bulk|list|junk)$/i.test(headerValue(headers, 'Precedence').trim())) return true
  const auto = headerValue(headers, 'Auto-Submitted').trim()
  if (auto && !/^no$/i.test(auto)) return true
  const from = emailFrom(headerValue(headers, 'From'))
  return AUTO_FROM.test(from.split('@')[0] || '')
}

// Why a message never reaches Claude, or null to classify it.
function prefilter(msg, { ownerEmail, trackedThreads, muted }) {
  const from = emailFrom(headerValue(msg.headers, 'From'))
  if (!from || from === String(ownerEmail || '').toLowerCase()) return 'own'
  if (trackedThreads.has(msg.threadId)) return 'tracked'
  if (muted.has(from)) return 'muted'
  if (isAutomated(msg.headers)) return 'automated'
  return null
}

const clip = (s, n) => String(s || '').trim().slice(0, n)

function realDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

// Claude's guess, limited to known clubs/categories and sane lengths.
function cleanGuess(raw, { clubSlugs, categories }) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const slugs = new Set(clubSlugs)
  const cat = typeof r.category === 'string'
    ? categories.find(c => c.name.toLowerCase() === r.category.trim().toLowerCase())
    : null
  return {
    request: r.request === true,
    summary: clip(r.summary, 300),
    title: clip(r.title, 120),
    description: clip(r.description, 2000),
    due_date: realDate(r.due_date),
    clubs: [...new Set((Array.isArray(r.clubs) ? r.clubs : []).map(String).filter(c => slugs.has(c)))],
    category_id: cat ? cat.id : null,
  }
}

// One open suggestion per thread: later mail updates it; otherwise a request
// opens one and anything else is kept as "skipped".
function mergeAction(openForThread, isRequest) {
  if (openForThread) return 'update'
  return isRequest ? 'create' : 'skip'
}

function ownerRepliedAfter(threadMessages, ownerEmail, sinceMs) {
  const owner = String(ownerEmail || '').toLowerCase()
  return (threadMessages || []).some(m =>
    emailFrom(headerValue(m.payload?.headers, 'From')) === owner && Number(m.internalDate || 0) > sinceMs)
}

// Address list -> lowercased emails (commas inside quotes don't split).
function addresses(value) {
  const out = []
  let cur = ''
  let quoted = false
  for (const ch of String(value || '')) {
    if (ch === '"') quoted = !quoted
    if (ch === ',' && !quoted) { out.push(cur); cur = '' } else cur += ch
  }
  out.push(cur)
  return out.map(a => emailFrom(a)).filter(e => /^[^\s@]+@[^\s@]+$/.test(e))
}

// Everyone else on the ask, for reply-all (minus the owner and the sender).
function recipientsToCc(headers, { ownerEmail, senderEmail }) {
  const skip = new Set([String(ownerEmail || '').toLowerCase(), String(senderEmail || '').toLowerCase()])
  const all = [...addresses(headerValue(headers, 'To')), ...addresses(headerValue(headers, 'Cc'))]
  return [...new Set(all)].filter(e => !skip.has(e)).slice(0, 20)
}

// "Alex Kim <alex@x>" -> "Alex Kim"; a bare address -> its local part.
function fromName(fromHeader) {
  const v = String(fromHeader || '')
  const m = v.match(/^\s*"?([^"<]*?)"?\s*</)
  if (m && m[1].trim()) return m[1].trim().slice(0, 120)
  return emailFrom(v).split('@')[0] || 'Someone'
}

// ---------- the 10-minute run ----------

const OVERLAP_MS = 2 * 60 * 1000
const BATCH = 15
// Messages fetched per run; a bigger backlog is worked oldest first over several runs.
const MAX_PER_RUN = 150
const REPLY_CHECKS = 50

// Reads inbox mail since the cursor, skips what can't be a request, asks
// Claude about the rest and keeps one open suggestion per thread. Every
// processed message is recorded, so overlapping runs never repeat one.
async function runSuggestions({ owner, getToken, db, gmail, classify, now = Date.now() }) {
  const result = { scanned: 0, suggested: 0, updated: 0, skipped: 0, errors: [] }
  const nowIso = new Date(now).toISOString()
  const cursor = await db.getCursor(owner.id)
  // First run: start from now, never read old mail.
  if (!cursor) { await db.setCursor(owner.id, nowIso); return result }

  let token, ownerEmail
  try {
    const t = await getToken(owner.id)
    token = t.accessToken
    ownerEmail = String(t.email || owner.email || '').toLowerCase()
  } catch (e) {
    if (e.notConnected) { result.errors.push('gmail_not_connected'); return result }
    throw e
  }

  const listed = await gmail.listInboxSince(token, Math.floor((Date.parse(cursor) - OVERLAP_MS) / 1000))
  const already = await db.seenIds(owner.id, listed.map(m => m.id))
  // Gmail lists newest first: work the backlog oldest first, a slice per run.
  const unseen = listed.filter(m => !already.has(m.id)).reverse()
  const fresh = unseen.slice(0, MAX_PER_RUN)
  // Keep the cursor where it is while anything in this window is left over.
  let holdOld = unseen.length > fresh.length
  const [tracked, muted, ctx] = await Promise.all([db.trackedThreads(owner.id), db.muted(owner.id), db.context(owner.id)])

  const messages = []
  for (const m of fresh) {
    try { const full = await gmail.getMessageFull(token, m.id); if (full) messages.push(full) } catch (e) {
      if (e.notConnected) throw e
      result.errors.push(`fetch ${m.id}: ${e.message}`)
      holdOld = true
    }
  }
  messages.sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0))
  result.scanned = messages.length

  const done = []
  const candidates = []
  for (const m of messages) {
    const reason = prefilter({ id: m.id, threadId: m.threadId, headers: m.payload?.headers }, { ownerEmail, trackedThreads: tracked, muted })
    if (reason) done.push(m.id)
    else candidates.push(m)
  }

  let holdCursor = null
  // Whatever was handled is recorded even if a database write fails mid-run.
  try {
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH)
    let guesses
    try {
      guesses = await classify(batch.map(m => ({
        key: m.id,
        from: headerValue(m.payload?.headers, 'From'),
        subject: headerValue(m.payload?.headers, 'Subject'),
        text: stripQuoted(extractPlainText(m.payload)).slice(0, 2500) || m.snippet || '',
      })), ctx)
    } catch (e) {
      result.errors.push(`classify: ${e.message}`)
      // Leave them unseen and keep the cursor before them, so the next run retries.
      const first = Number(batch[0].internalDate || 0)
      if (holdCursor == null || first < holdCursor) holdCursor = first
      continue
    }
    for (const m of batch) {
      const headers = m.payload?.headers
      const guess = cleanGuess(guesses.get(m.id), ctx)
      const fromHeader = headerValue(headers, 'From')
      const at = new Date(Number(m.internalDate || now)).toISOString()
      const open = await db.openForThread(owner.id, m.threadId)
      const action = mergeAction(open, guess.request)
      if (action === 'update') {
        const patch = {
          message_ids: [...new Set([...(open.message_ids || []), m.id])],
          snippet: clip(m.snippet, 500), last_message_at: at, updated_at: nowIso,
        }
        if (guess.request) Object.assign(patch, { summary: guess.summary || open.summary, seen: false })
        await db.updateSuggestion(open.id, patch)
        result.updated++
      } else {
        await db.insertSuggestion({
          owner_staff_id: owner.id, source: 'email', status: action === 'create' ? 'open' : 'skipped',
          gmail_thread_id: m.threadId, message_ids: [m.id],
          from_name: fromName(fromHeader), from_email: emailFrom(fromHeader),
          cc_emails: recipientsToCc(headers, { ownerEmail, senderEmail: emailFrom(fromHeader) }),
          subject: clip(headerValue(headers, 'Subject'), 250), snippet: clip(m.snippet, 500), summary: guess.summary,
          guess: { title: guess.title, description: guess.description, due_date: guess.due_date, clubs: guess.clubs, category_id: guess.category_id },
          received_at: at, last_message_at: at,
        })
        if (action === 'create') result.suggested++
        else result.skipped++
      }
      done.push(m.id)
    }
  }
  } finally {
    if (done.length) await db.markSeen(owner.id, done)
  }

  // "You replied": the owner answered in the thread after the ask.
  const open = (await db.openEmailSuggestions(owner.id)).filter(s => !s.you_replied && s.gmail_thread_id).slice(0, REPLY_CHECKS)
  for (const s of open) {
    try {
      const msgs = await gmail.getThread(token, s.gmail_thread_id)
      if (ownerRepliedAfter(msgs, ownerEmail, Date.parse(s.received_at))) await db.updateSuggestion(s.id, { you_replied: true })
    } catch (e) {
      if (e.notConnected) throw e
      result.errors.push(`thread ${s.id}: ${e.message}`)
    }
  }

  if (holdOld) return result
  await db.setCursor(owner.id, holdCursor != null ? new Date(Math.min(now, holdCursor - 1000)).toISOString() : nowIso)
  return result
}

// The person attached to a task added from an email suggestion: the sender,
// on the asking thread, with everyone else on the ask for reply-all. Their
// last reply is the ask itself, so the next check doesn't flag it as new.
function askerPersonFields(suggestion, threadMessages, ownerEmail) {
  const owner = String(ownerEmail || '').toLowerCase()
  const msgs = [...(threadMessages || [])].sort((a, b) => Number(a.internalDate || 0) - Number(b.internalDate || 0))
  const theirs = msgs.filter(m => emailFrom(headerValue(m.payload?.headers, 'From')) !== owner)
  const lastTheirs = theirs[theirs.length - 1]
  const latest = msgs[msgs.length - 1]
  const firstSubject = msgs.length ? headerValue(msgs[0].payload?.headers, 'Subject') : ''
  return {
    name: suggestion.from_name || suggestion.from_email,
    email: suggestion.from_email,
    cc_emails: suggestion.cc_emails || [],
    gmail_thread_id: suggestion.gmail_thread_id,
    subject: clip(firstSubject || suggestion.subject || '(no subject)', 250),
    first_message_id_header: latest ? headerValue(latest.payload?.headers, 'Message-ID') || null : null,
    state: 'replied',
    reply_seen: true,
    last_reply_at: lastTheirs ? new Date(Number(lastTheirs.internalDate || 0)).toISOString() : null,
    last_reply_snippet: lastTheirs ? clip(lastTheirs.snippet, 500) : null,
  }
}

// ---------- texts (iPhone Shortcut) ----------

const TEXT_MERGE_MS = 30 * 60 * 1000

function hashKey(key) {
  return require('crypto').createHash('sha256').update(String(key)).digest('hex')
}

function cleanTextInput(body) {
  const b = body && typeof body === 'object' ? body : {}
  const text = String(b.text || '').trim().slice(0, 2000)
  if (!text) return { error: 'Text is required' }
  return {
    name: String(b.name || '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Someone',
    phone: String(b.phone || '').replace(/[^0-9+]/g, '').slice(0, 20),
    text,
  }
}

// Several texts in a row from the same number become one suggestion.
function textMergeTarget(openTextRows, phone, nowMs) {
  if (!phone) return null
  return (openTextRows || []).find(r => r.guess?.phone === phone
    && nowMs - Date.parse(r.last_message_at || r.received_at) <= TEXT_MERGE_MS) || null
}

module.exports = { isAutomated, prefilter, cleanGuess, mergeAction, ownerRepliedAfter, recipientsToCc, addresses, fromName, runSuggestions, askerPersonFields, hashKey, cleanTextInput, textMergeTarget }
