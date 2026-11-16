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

module.exports = { isAutomated, prefilter, cleanGuess, mergeAction, ownerRepliedAfter, recipientsToCc, addresses, extractPlainText, stripQuoted }
