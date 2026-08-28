// What is worth trying again, and how long to wait.
//
// Reports were intermittently failing to load, and clicking away and back fixed
// them — the signature of a transient failure rather than a broken report. The
// auth service runs on Render, so a request landing on a cold or restarting
// instance returns 502/503 or drops the connection outright. The user was doing
// the retrying by hand.
//
// WHAT IS *NOT* RETRIED MATTERS AS MUCH AS WHAT IS. A 400 or a 403 fails
// identically every time, so retrying it only makes the failure take three
// times as long to appear, and a 401 after a failed refresh means the session
// is gone — spinning three times still lands on the login screen, just slower.
//
// Kept in its own module, free of React, so the policy can be tested directly.

export const MAX_ATTEMPTS = 3

// The first retry is quick because a cold start is usually ready within a
// second. The second waits longer rather than hammering an instance that is
// still coming up.
export const BACKOFF_MS = [400, 1400]

/**
 * A transport fault that might succeed on another attempt.
 *
 * Reads httpStatus, which api.js sets from the real response code. It is named
 * httpStatus rather than status because api.js copies the response body's own
 * fields onto the error, and a payload with a `status` field would otherwise
 * decide our retry policy.
 */
export function isRetryable(err) {
  if (!err) return false
  // An aborted request was cancelled on purpose — usually the user navigating
  // away. Retrying it would resurrect work nobody is waiting for.
  if (err.name === 'AbortError') return false

  const status = err.httpStatus
  // No status at all means fetch itself rejected: DNS, connection reset,
  // offline, or the instance dropping the socket mid-request.
  if (status === undefined || status === null) return true
  if (status === 429) return true
  return status >= 500 && status < 600
}

/** Milliseconds to wait before attempt N+1 (1-indexed attempt). */
export function backoffFor(attempt) {
  return BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]
}
