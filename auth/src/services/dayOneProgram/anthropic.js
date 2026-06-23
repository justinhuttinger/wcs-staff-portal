'use strict'

const Anthropic = require('@anthropic-ai/sdk').default
  || require('@anthropic-ai/sdk').Anthropic
  || require('@anthropic-ai/sdk')

// Sonnet for anything requiring judgment (exercise selection, program prose).
// Haiku only for mechanical formatting work (terminology glossary).
const MODEL = 'claude-sonnet-4-6'
const MODEL_FAST = 'claude-haiku-4-5-20251001'

const apiKey = process.env.ANTHROPIC_API_KEY
const client = apiKey
  ? new Anthropic({ apiKey, maxRetries: 4, timeout: 10 * 60 * 1000 })
  : null

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// True when an error is a transient mid-stream connection drop worth retrying.
function isRetryableStreamError(err) {
  const code = err?.code || err?.cause?.code
  if (code === 'ERR_STREAM_PREMATURE_CLOSE' || code === 'ECONNRESET'
      || code === 'ETIMEDOUT' || code === 'EPIPE') {
    return true
  }
  if (err?.constructor?.name === 'APIConnectionError'
      || err?.constructor?.name === 'APIConnectionTimeoutError') {
    return true
  }
  const msg = `${err?.message || ''} ${err?.cause?.message || ''}`.toLowerCase()
  return msg.includes('premature close') || msg.includes('socket hang up')
    || msg.includes('connection error')
}

// Run a streaming call, retrying transient mid-stream drops with exp backoff.
async function withStreamRetry(fn, maxAttempts = 4) {
  let lastErr
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt >= maxAttempts || !isRetryableStreamError(err)) throw err
      const delayMs = Math.min(1000 * 2 ** (attempt - 1), 8000)
      console.warn(`[DayOne] Stream dropped (${err?.code || err?.message}); retry ${attempt + 1}/${maxAttempts} in ${delayMs}ms`)
      await sleep(delayMs)
    }
  }
  throw lastErr
}

// Stream a single completion, returning its text. Throws on truncation.
// `model` defaults to Sonnet; pass MODEL_FAST for mechanical work.
async function generateText({ prompt, maxTokens = 4000, model = MODEL }) {
  if (!client) throw new Error('Anthropic client not initialized (ANTHROPIC_API_KEY missing)')
  const message = await withStreamRetry(() =>
    client.messages.stream({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }).finalMessage()
  )
  if (message.stop_reason === 'max_tokens') {
    throw new Error(`Day One AI call hit max_tokens (truncated). Increase max_tokens.`)
  }
  return message.content[0].text
}

module.exports = { MODEL, MODEL_FAST, isRetryableStreamError, withStreamRetry, generateText }
