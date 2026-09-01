// auth/src/lib/smsPreview.js
//
// Renders a drip message the way a member would receive it, for the test send.
//
// The tester is a staff member, not a prospect, so letting GHL resolve the
// merge fields would show THEIR name and an empty referrer - a preview that
// looks nothing like the real thing, and that hides exactly the gap worth
// catching. So the tokens are substituted here instead, before the message
// leaves the portal.
//
// Anything that cannot be resolved is deliberately left in place and reported,
// rather than blanked: a message that silently loses a name reads fine in a
// preview and is broken in production.

// {{ token }} with optional inner spaces. Captures the token path.
const TOKEN = /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g

// custom_values can reference other custom values. Two passes is plenty for the
// nesting anyone actually writes, and the cap makes a cycle terminate instead
// of hanging the request.
const MAX_PASSES = 3

function normalizeKey(key) {
  return String(key || '').replace(/[{}\s]/g, '')
}

/**
 * Substitute merge fields.
 *
 * @param {string} text
 * @param {object} ctx
 * @param {object} ctx.customValues  fieldKey ("custom_values.x") -> value
 * @param {object} ctx.values        full token path ("contact.first_name") -> value
 * @param {object} ctx.contact       bare field name ("first_name") -> value
 * @param {object} ctx.location      bare field name ("name") -> value
 * @returns {{text: string, unresolved: string[]}} unresolved is de-duped, in
 *          first-seen order, and holds the bare token paths.
 */
function resolveTokens(text, ctx = {}) {
  const customValues = ctx.customValues || {}
  const values = ctx.values || {}
  const contact = ctx.contact || {}
  const location = ctx.location || {}

  // Normalize the custom-value map once so "{{ custom_values.x }}" and
  // "custom_values.x" both hit.
  const cvs = {}
  for (const [k, v] of Object.entries(customValues)) cvs[normalizeKey(k)] = v == null ? '' : String(v)

  const unresolved = []
  const seen = new Set()
  // Fields the caller deliberately planted as empty. GHL renders an empty
  // contact field as blank, not as a literal token, so clearing a field in the
  // test panel has to blank it here too - otherwise "what does this look like
  // when the member has no referrer" is untestable. They are still reported,
  // because a blank in the middle of a sentence is usually a bug.
  const blanked = []

  function lookup(path) {
    // A planted value wins over the structured objects, so the test panel can
    // fill any token the copy happens to use without this file knowing it.
    if (Object.prototype.hasOwnProperty.call(values, path)) {
      const v = values[path]
      if (v == null || v === '') {
        if (!blanked.includes(path)) blanked.push(path)
        return ''
      }
      return String(v)
    }
    if (path.startsWith('custom_values.')) {
      return Object.prototype.hasOwnProperty.call(cvs, path) ? cvs[path] : undefined
    }
    if (path.startsWith('contact.')) {
      const f = path.slice('contact.'.length)
      const v = contact[f]
      return v == null || v === '' ? undefined : String(v)
    }
    if (path.startsWith('location.')) {
      const f = path.slice('location.'.length)
      const v = location[f]
      return v == null || v === '' ? undefined : String(v)
    }
    return undefined
  }

  let out = String(text == null ? '' : text)
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let replaced = false
    out = out.replace(TOKEN, (whole, path) => {
      const v = lookup(path)
      if (v === undefined) return whole
      replaced = true
      return v
    })
    if (!replaced) break
  }

  // Whatever is still a token after the passes could not be resolved.
  for (const m of out.matchAll(TOKEN)) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      unresolved.push(m[1])
    }
  }
  // A deliberately blanked field has no token left to find, so add it here.
  for (const path of blanked) {
    if (!seen.has(path)) {
      seen.add(path)
      unresolved.push(path)
    }
  }

  return { text: out, unresolved }
}

// GSM-7 characters that occupy two septets.
const GSM7_EXTENDED = '^{}\\[~]|€'

/**
 * Segment count for the rendered text. A single character outside GSM-7 forces
 * the whole message to UCS-2, which more than halves the per-segment budget -
 * the reason a stray zero-width space doubles the bill.
 */
function smsSegments(text) {
  const chars = [...String(text == null ? '' : text)]
  if (!chars.length) return { chars: 0, segments: 0, encoding: 'GSM-7' }
  const unicode = chars.some(c => c.codePointAt(0) > 127 && !GSM7_EXTENDED.includes(c))
  const len = unicode
    ? chars.length
    : chars.reduce((n, c) => n + (GSM7_EXTENDED.includes(c) ? 2 : 1), 0)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  return {
    chars: len,
    segments: len <= single ? 1 : Math.ceil(len / multi),
    encoding: unicode ? 'UCS-2' : 'GSM-7',
  }
}

// Characters that are invisible but force UCS-2. Worth naming in a preview
// because they are impossible to spot by eye and they cost real money.
const HIDDEN = /[​‌‍﻿ ]/g

function findHiddenCharacters(text) {
  const out = []
  for (const m of String(text == null ? '' : text).matchAll(HIDDEN)) {
    out.push({ index: m.index, codePoint: 'U+' + m[0].codePointAt(0).toString(16).toUpperCase().padStart(4, '0') })
  }
  return out
}

/**
 * Digits-only E.164-ish normalization for a US number. Returns null when the
 * input cannot be a phone number, so the caller can reject rather than POST
 * rubbish at the webhook.
 */
function normalizePhone(input) {
  const raw = String(input == null ? '' : input).trim()
  if (!raw) return null
  if (/[A-Za-z]/.test(raw)) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return '+1' + digits
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits
  // Already international, and long enough to be real.
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return '+' + digits
  return null
}

/**
 * Every contact./location. token the copy actually uses, including tokens that
 * only appear inside a referenced custom value. This is what lets the test
 * panel offer an input per merge field instead of a fixed list.
 *
 * @returns {string[]} full token paths, de-duped, first-seen order.
 */
function extractMergeFields(text, customValues = {}) {
  // Resolving with no planted values leaves exactly the fields that need one.
  return resolveTokens(text, { customValues }).unresolved
    .filter(p => p.startsWith('contact.') || p.startsWith('location.'))
}

// A readable label for a token path, for the panel's field list.
function labelForField(path) {
  const bare = path.replace(/^(contact|location)\./, '')
  return bare.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

module.exports = {
  resolveTokens, smsSegments, findHiddenCharacters, normalizePhone,
  extractMergeFields, labelForField,
}
