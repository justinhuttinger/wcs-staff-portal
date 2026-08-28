import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isRetryable, backoffFor, MAX_ATTEMPTS, BACKOFF_MS } from './retryPolicy.js'

const withStatus = (status) => Object.assign(new Error('boom'), { httpStatus: status })

test('a fetch that rejected with no response is retried', () => {
  // DNS failure, connection reset, offline, or the instance dropping the
  // socket. This is the common case behind "click away and back and it loads".
  assert.equal(isRetryable(new Error('Failed to fetch')), true)
  assert.equal(isRetryable(withStatus(undefined)), true)
  assert.equal(isRetryable(withStatus(null)), true)
})

test('server errors are retried', () => {
  for (const s of [500, 502, 503, 504]) {
    assert.equal(isRetryable(withStatus(s)), true, `expected ${s} to retry`)
  }
})

test('rate limiting is retried, which is what the backoff is for', () => {
  assert.equal(isRetryable(withStatus(429)), true)
})

test('client errors are NOT retried', () => {
  // These fail identically every time; retrying only makes the failure take
  // three times as long to reach the user.
  for (const s of [400, 401, 403, 404, 409, 422]) {
    assert.equal(isRetryable(withStatus(s)), false, `expected ${s} not to retry`)
  }
})

test('an expired session is not retried', () => {
  // api.js stamps this 401 deliberately. Spinning three times still lands on
  // the login screen, just slower.
  const expired = Object.assign(new Error('Session expired — please sign in again'), { httpStatus: 401 })
  assert.equal(isRetryable(expired), false)
})

test('a deliberate cancellation is not retried', () => {
  // Navigating away aborts in flight requests; retrying would resurrect work
  // nobody is waiting for.
  const abort = Object.assign(new Error('Aborted'), { name: 'AbortError' })
  assert.equal(isRetryable(abort), false)
  // Even when it somehow carries a retryable-looking status.
  assert.equal(isRetryable(Object.assign(new Error('x'), { name: 'AbortError', httpStatus: 503 })), false)
})

test('a status field in the response body cannot hijack the policy', () => {
  // api.js copies the payload's own keys onto the error. A body of
  // { status: 500 } on a 400 must not make it retryable, which is why the
  // policy reads httpStatus.
  const err = Object.assign(new Error('bad request'), { httpStatus: 400, status: 500 })
  assert.equal(isRetryable(err), false)
})

test('null and undefined are not retryable', () => {
  assert.equal(isRetryable(null), false)
  assert.equal(isRetryable(undefined), false)
})

test('backoff grows and never runs off the end of the table', () => {
  assert.equal(backoffFor(1), BACKOFF_MS[0])
  assert.equal(backoffFor(2), BACKOFF_MS[1])
  assert.ok(backoffFor(2) > backoffFor(1))
  // Defensive: a caller asking beyond the table gets the longest wait, not
  // undefined, which setTimeout would treat as 0 and spin.
  assert.equal(backoffFor(99), BACKOFF_MS[BACKOFF_MS.length - 1])
})

test('the backoff table covers every retry the policy allows', () => {
  // MAX_ATTEMPTS of 3 means at most 2 waits. If someone raises the attempts
  // without extending the table, this fails rather than silently reusing the
  // last delay.
  assert.equal(BACKOFF_MS.length, MAX_ATTEMPTS - 1)
})
