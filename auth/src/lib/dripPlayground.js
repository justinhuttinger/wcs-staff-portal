// auth/src/lib/dripPlayground.js
//
// A throwaway club for experimenting with the drip tools.
//
// It looks like any other location in the picker, but nothing here is a GHL
// custom value: the messages live in app_config and are never written to any
// sub-account. The ONLY thing that leaves the portal is the test webhook, which
// is the point - you can try copy, merge fields, media and branching against a
// real handset without touching a live club's drips.
//
// Media is real: files go to the same public bucket, so an MMS attachment
// behaves exactly as it would in production.

const PLAYGROUND_SLUG = 'playground'
const PLAYGROUND_NAME = 'Playground'

// Stored under this prefix in app_config, one row per message.
const PLAYGROUND_PREFIX = 'drip_playground.'

// Five messages, deliberately plain: the point is to exercise the tooling, not
// to be good copy. They start as "Test SMS N" and are yours to mangle.
const PLAYGROUND_MESSAGES = [1, 2, 3, 4, 5].map(n => ({
  // A synthetic id, stable across reloads, used where a GHL value id would be.
  id: `playground-test-sms-${n}`,
  name: `Test SMS ${n}`,
  fieldKey: `custom_values.test_sms_${n}`,
  defaultValue: `Test SMS ${n}`,
}))

function isPlayground(slug) {
  return String(slug || '').trim().toLowerCase() === PLAYGROUND_SLUG
}

function playgroundStorageKey(fieldKey) {
  return PLAYGROUND_PREFIX + String(fieldKey || '').replace(/[{}\s]/g, '')
}

/** The message a synthetic id refers to, or null. */
function messageById(id) {
  const wanted = String(id || '').trim()
  return PLAYGROUND_MESSAGES.find(m => m.id === wanted) || null
}

function messageByKey(fieldKey) {
  const wanted = String(fieldKey || '').replace(/[{}\s]/g, '')
  return PLAYGROUND_MESSAGES.find(m => m.fieldKey === wanted) || null
}

/**
 * Build the message list from whatever has been saved, falling back to the
 * starting text so a fresh playground is never empty.
 *
 * @param {object} saved  storage key -> value, as read from app_config
 */
function buildMessages(saved = {}) {
  return PLAYGROUND_MESSAGES.map(m => {
    const key = playgroundStorageKey(m.fieldKey)
    const stored = Object.prototype.hasOwnProperty.call(saved, key) ? saved[key] : undefined
    return {
      id: m.id,
      name: m.name,
      fieldKey: m.fieldKey,
      // An empty saved string is a real edit (the message was cleared), so only
      // an absent key falls back to the starting text.
      value: stored === undefined ? m.defaultValue : String(stored),
    }
  })
}

/** fieldKey -> value, for resolving {{custom_values.*}} inside playground copy. */
function customValuesMap(messages) {
  const out = {}
  for (const m of messages) out[m.fieldKey] = m.value
  return out
}

module.exports = {
  PLAYGROUND_SLUG,
  PLAYGROUND_NAME,
  PLAYGROUND_PREFIX,
  PLAYGROUND_MESSAGES,
  isPlayground,
  playgroundStorageKey,
  messageById,
  messageByKey,
  buildMessages,
  customValuesMap,
}
