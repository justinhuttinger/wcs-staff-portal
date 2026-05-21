const Anthropic = require('@anthropic-ai/sdk').default || require('@anthropic-ai/sdk').Anthropic || require('@anthropic-ai/sdk')

const apiKey = process.env.MASTERMIND_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY
const client = apiKey ? new Anthropic({ apiKey }) : null

// Default models per mode. Opus for strategic thinking, Sonnet for data-heavy work.
const DEFAULT_MODELS = {
  brief_me: 'claude-opus-4-7',
  strategize: 'claude-opus-4-7',
  analyze: 'claude-sonnet-4-6',
  draft: 'claude-sonnet-4-6',
  review: 'claude-opus-4-7',
  wrap_up: 'claude-opus-4-7',
  continue: 'claude-sonnet-4-6',
}

async function complete({ mode, system, messages, maxTokens = 4096, model }) {
  if (!client) throw new Error('Anthropic client not initialized (MASTERMIND_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY missing)')
  const chosen = model || DEFAULT_MODELS[mode] || 'claude-sonnet-4-6'
  const resp = await client.messages.create({
    model: chosen,
    max_tokens: maxTokens,
    system,
    messages,
  })
  const text = (resp.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
  return {
    text,
    model: chosen,
    inputTokens: resp.usage?.input_tokens || 0,
    outputTokens: resp.usage?.output_tokens || 0,
  }
}

module.exports = { complete, DEFAULT_MODELS }
