const test = require('node:test')
const assert = require('node:assert')
const { isRetryableStreamError, withStreamRetry } = require('./anthropic')

test('classifies transient stream drops as retryable', () => {
  assert.equal(isRetryableStreamError({ code: 'ERR_STREAM_PREMATURE_CLOSE' }), true)
  assert.equal(isRetryableStreamError({ code: 'ECONNRESET' }), true)
  assert.equal(isRetryableStreamError({ message: 'Premature close' }), true)
  assert.equal(isRetryableStreamError({ constructor: { name: 'APIConnectionError' } }), true)
})

test('classifies real API errors as non-retryable', () => {
  assert.equal(isRetryableStreamError({ status: 400, message: 'credit balance too low' }), false)
  assert.equal(isRetryableStreamError({ message: 'invalid_request_error' }), false)
})

test('withStreamRetry retries transient then succeeds', async () => {
  let calls = 0
  const result = await withStreamRetry(async () => {
    calls++
    if (calls < 2) { const e = new Error('Premature close'); e.code = 'ERR_STREAM_PREMATURE_CLOSE'; throw e }
    return 'ok'
  }, 4)
  assert.equal(result, 'ok')
  assert.equal(calls, 2)
})

test('withStreamRetry rethrows non-retryable immediately', async () => {
  let calls = 0
  await assert.rejects(() => withStreamRetry(async () => { calls++; throw new Error('credit balance too low') }, 4))
  assert.equal(calls, 1)
})
