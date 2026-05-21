// USD per 1M tokens. Update when Anthropic changes pricing.
// Verify against https://www.anthropic.com/pricing before assuming.
const PRICING = {
  'claude-opus-4-7':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':  { input:  3.00, output: 15.00 },
  'claude-haiku-4-5':   { input:  1.00, output:  5.00 },
}

function computeUsd({ model, inputTokens = 0, outputTokens = 0 }) {
  const p = PRICING[model]
  if (!p) return 0
  return (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output
}

module.exports = { computeUsd, PRICING }
