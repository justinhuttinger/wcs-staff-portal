// Gmail connection state for the Hub. The stored token can look fine while
// Google has revoked it; the API then answers 412 and the connect card must
// come back. Pure; tested in gmailState.test.mjs.

export function isGmailDisconnected(err) {
  return !!err && err.httpStatus === 412
}

export function markGmailLost(status) {
  return { ...(status || {}), ready: false }
}
