// Parsing and diffing for ticket comment @mentions.
//
// A mention is stored inline in the comment body as a stable token:
//
//     @[Display Name](user:0b3f…-uuid)
//
// The uuid is the source of truth — a person's display name can change without
// rewriting history, and rendering always resolves the current name from the
// uuid. This module never trusts the display text inside the token for
// identity; only the uuid matters.

// A uuid inside a mention token. Case-insensitive, hyphenated 8-4-4-4-12.
const UUID_RE = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
// @[label](user:uuid). The label may contain anything except an unescaped ']'.
const MENTION_RE = new RegExp(`@\\[([^\\]]*)\\]\\(user:(${UUID_RE})\\)`, 'g')

// Extract the unique set of mentioned staff uuids from a body, in first-seen
// order. Duplicate mentions of the same person collapse to one.
function parseMentionIds(body) {
  const text = String(body == null ? '' : body)
  const seen = new Set()
  const ids = []
  let m
  MENTION_RE.lastIndex = 0
  while ((m = MENTION_RE.exec(text)) !== null) {
    const id = m[2].toLowerCase()
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

// The set of people who should be *notified* for a body, given who the actor
// is: everyone mentioned, minus the actor (a self-mention never notifies).
function notifiableMentionIds(body, actorId) {
  const actor = actorId ? String(actorId).toLowerCase() : null
  return parseMentionIds(body).filter(id => id !== actor)
}

// Diff a freshly-saved body against the ids already recorded for this comment,
// so editing a comment only ever pings *newly* added people. Returns the ids
// present now that weren't present before.
function newMentionIds(body, actorId, alreadyNotifiedIds = []) {
  const already = new Set((alreadyNotifiedIds || []).map(x => String(x).toLowerCase()))
  return notifiableMentionIds(body, actorId).filter(id => !already.has(id))
}

// Strip mention tokens down to plain readable text ("@Display Name"), e.g. for
// a Chat DM excerpt or a search index. Never used for identity.
function toPlainText(body) {
  return String(body == null ? '' : body).replace(MENTION_RE, (_, label) => `@${label}`.trim())
}

module.exports = {
  MENTION_RE,
  parseMentionIds,
  notifiableMentionIds,
  newMentionIds,
  toPlainText,
}
