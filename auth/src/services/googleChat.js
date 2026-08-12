// Google Chat DM send path for the ticket bridge.
//
// The ONLY Chat capability in the portal: when a staff member assigns a ticket
// or @mentions someone in a ticket's comment thread, the target receives a
// Google Chat DM that genuinely comes FROM the actor.
//
// Impersonation model — per-user OAuth, not domain-wide delegation:
//   The message is sent with the ACTOR's own Google OAuth access token
//   (staff_google_tokens, the same store used for Sheets/Docs/Calendar). Because
//   it's literally the actor's token, the DM shows up as sent by them with no
//   bot label — exactly "impersonate whoever is @ing / assigning." No service
//   account or Workspace admin delegation is involved.
//
// The actor must have connected Google Chat (granted the chat scopes) via the
// /google-chat connect flow. If they haven't, sendTicketDm throws a typed error
// and the caller records it and moves on — a Chat failure never blocks the
// ticket write.
//
// Requires (Google Cloud, one-time): enable the Google Chat API on the OAuth
// project, and add the chat scopes below to the OAuth consent screen.

const { getStaffGoogleAccessToken } = require('./googleUserToken')
const { getSystemToken } = require('./systemGoogleToken')

const CHAT_BASE = 'https://chat.googleapis.com/v1'

// Scopes the actor's token must carry. chat.spaces covers find-or-create of the
// DM space; chat.messages covers sending. Kept in sync with the connect flow.
const CHAT_SCOPES = [
  'https://www.googleapis.com/auth/chat.spaces',
  'https://www.googleapis.com/auth/chat.messages',
]

function chatError(message, tag) {
  const err = new Error(message)
  if (tag) err[tag] = true
  return err
}

async function chatJson(url, accessToken, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { _raw: text } }
  return { res, body }
}

// A Chat user resource. Chat accepts the Workspace email as an alias for the
// user id, so we never need a separate People/Directory lookup.
function userResource(email) {
  return `users/${String(email).trim()}`
}

// Find the existing 1:1 DM space between the actor (token owner) and target, or
// null if none exists yet.
async function findDirectMessage(accessToken, targetEmail) {
  const url = `${CHAT_BASE}/spaces:findDirectMessage?name=${encodeURIComponent(userResource(targetEmail))}`
  const { res, body } = await chatJson(url, accessToken, { method: 'GET' })
  if (res.status === 404) return null
  if (res.status === 401) throw chatError('Google Chat authorization expired — reconnect Google Chat.', 'notConnected')
  if (res.status === 403) {
    const msg = body?.error?.message || ''
    if (/scope|permission|insufficient/i.test(msg)) throw chatError('Missing Google Chat permission — reconnect Google Chat to grant it.', 'insufficientScope')
    // 403 can also mean the target isn't reachable / not a Chat user.
    throw chatError(msg || 'Cannot open a Chat with this person.', 'targetUnreachable')
  }
  if (!res.ok) throw chatError(body?.error?.message || `Chat findDirectMessage ${res.status}`)
  return body?.name || null
}

// Create the 1:1 DM space with the target. Returns the space resource name.
async function setupDirectMessage(accessToken, targetEmail) {
  const url = `${CHAT_BASE}/spaces:setup`
  const { res, body } = await chatJson(url, accessToken, {
    method: 'POST',
    body: JSON.stringify({
      space: { spaceType: 'DIRECT_MESSAGE' },
      memberships: [{ member: { name: userResource(targetEmail), type: 'HUMAN' } }],
    }),
  })
  if (res.status === 401) throw chatError('Google Chat authorization expired — reconnect Google Chat.', 'notConnected')
  if (res.status === 403) throw chatError(body?.error?.message || 'Not allowed to start a Chat with this person.', 'targetUnreachable')
  if (res.status === 404) throw chatError('That person was not found in Google Chat.', 'targetUnreachable')
  if (!res.ok) throw chatError(body?.error?.message || `Chat spaces.setup ${res.status}`)
  return body?.name || null
}

async function resolveDmSpace(accessToken, targetEmail) {
  const existing = await findDirectMessage(accessToken, targetEmail)
  if (existing) return existing
  return setupDirectMessage(accessToken, targetEmail)
}

// Send a plain-text message into a space as the token owner.
async function createMessage(accessToken, spaceName, text) {
  const url = `${CHAT_BASE}/${spaceName}/messages`
  const { res, body } = await chatJson(url, accessToken, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
  if (res.status === 401) throw chatError('Google Chat authorization expired — reconnect Google Chat.', 'notConnected')
  if (res.status === 403) throw chatError(body?.error?.message || 'Not allowed to send this Chat message.', 'insufficientScope')
  if (!res.ok) throw chatError(body?.error?.message || `Chat messages.create ${res.status}`)
  return body?.name || null
}

// Public entry point. Sends `text` as a DM from the actor to the target email.
// Returns { ok: true, messageName, spaceName }. Throws a typed error on failure
// ( .notConnected | .insufficientScope | .targetUnreachable | generic ).
async function sendTicketDm({ actorStaffId, targetEmail, text }) {
  if (!actorStaffId) throw chatError('actorStaffId required')

  let accessToken
  try {
    const tok = await getStaffGoogleAccessToken(actorStaffId)
    accessToken = tok.accessToken
  } catch (err) {
    // notConnected is set by googleUserToken when the actor hasn't linked Google.
    if (err.notConnected) throw chatError('Connect Google Chat to notify people from your own account.', 'notConnected')
    throw err
  }

  return sendWithToken(accessToken, targetEmail, text)
}

// Same send, but from the portal's own account (noreply@) rather than a person.
// Used for ticket-creation notices, which have no human sender.
async function sendTicketDmAsSystem({ targetEmail, text }) {
  let accessToken
  try {
    const tok = await getSystemToken()
    accessToken = tok.accessToken
  } catch (err) {
    if (err.notConnected) {
      throw chatError('The portal notification account has not been connected to Google Chat.', 'notConnected')
    }
    throw err
  }

  return sendWithToken(accessToken, targetEmail, text)
}

// Shared tail of both send paths: find or open the DM, post the text.
async function sendWithToken(accessToken, targetEmail, text) {
  if (!targetEmail) throw chatError('No Google email for the recipient.', 'targetUnreachable')
  const spaceName = await resolveDmSpace(accessToken, targetEmail)
  if (!spaceName) throw chatError('Could not open a Chat with this person.', 'targetUnreachable')
  const messageName = await createMessage(accessToken, spaceName, text)
  return { ok: true, messageName, spaceName }
}

module.exports = {
  CHAT_SCOPES,
  sendTicketDm,
  sendTicketDmAsSystem,
  // exported for tests / reuse
  userResource,
  resolveDmSpace,
}
