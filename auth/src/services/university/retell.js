// WCS University — Retell client.
//
// API-initiated outbound call model (spec §2): Retell dials the trainee and
// the agent opens already in character, personalized via dynamic variables.
//
// ⚠️ FIELD-NAME DRIFT (spec §4.2 / §10.5): Retell's create-call endpoint path,
// auth header, and the dynamic-variables key have changed across versions.
// This implements the documented v2 shape (POST /v2/create-phone-call,
// `retell_llm_dynamic_variables`). Verify against current Retell docs before
// relying on it in production. Override the path with RETELL_CREATE_CALL_PATH
// if it has moved, without a code change.

const BASE_URL = process.env.RETELL_BASE_URL || 'https://api.retellai.com'
const CREATE_CALL_PATH = process.env.RETELL_CREATE_CALL_PATH || '/v2/create-phone-call'

// Create an outbound phone call. Returns { call_id, raw } on success.
async function createPhoneCall({ fromNumber, toNumber, agentId, dynamicVariables }) {
  const apiKey = process.env.RETELL_API_KEY
  if (!apiKey) throw new Error('RETELL_API_KEY is not set')
  if (!fromNumber) throw new Error('RETELL_FROM_NUMBER is not set')
  if (!toNumber) throw new Error('Missing trainee phone (to_number)')

  const body = {
    from_number: fromNumber,
    to_number: toNumber,
    // override_agent_id lets one base agent play any scenario; null is allowed
    // when the from_number is already bound to the desired agent in Retell.
    ...(agentId ? { override_agent_id: agentId } : {}),
    retell_llm_dynamic_variables: dynamicVariables || {},
  }

  const res = await fetch(`${BASE_URL}${CREATE_CALL_PATH}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Retell create-call error ${res.status}: ${text}`)
  }

  const data = await res.json()
  return { call_id: data.call_id || data.callId || null, raw: data }
}

// Lightweight shared-secret check for the post-call webhook. Retell can be
// configured to send a custom header; we also accept ?secret= for convenience.
// If RETELL_WEBHOOK_SECRET is unset, allow (matches the portal's other webhook
// verifiers' backward-compat behavior) — set it in production.
function verifyWebhookSecret(req) {
  const secret = process.env.RETELL_WEBHOOK_SECRET
  if (!secret) return true
  const provided =
    req.headers['x-retell-secret'] ||
    req.headers['x-webhook-secret'] ||
    req.query.secret
  return provided === secret
}

module.exports = { createPhoneCall, verifyWebhookSecret }
