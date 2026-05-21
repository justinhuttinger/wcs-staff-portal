const { complete } = require('../anthropic')
const { inferLane } = require('../lane')

// Continue: respond to an @mastermind mention in a comment thread.
// Builds conversation history from prior comments so we don't lose context.
module.exports = async function cont({ task, comments }) {
  const lane = inferLane(task)

  // Build conversation history. Assistant = Mastermind, User = anyone else.
  const history = (comments || []).map(c => {
    const username = c.user?.username || c.user?.name || ''
    const text = c.comment_text || ''
    // Heuristic: any comment whose text looks like Mastermind output is "assistant".
    const isAssistant = /^\*\*(Draft|Brief|Strategic|Analysis|Weekly Meta|Review|Post-mortem|Concept generation|Promotion|Mastermind:)/i.test(text)
      || /mastermind/i.test(username)
    return {
      role: isAssistant ? 'assistant' : 'user',
      content: text,
    }
  }).filter(m => m.content.length > 0)

  // Latest message = the @mention that triggered us
  const triggerComment = history.length > 0 ? history[history.length - 1].content : ''

  const system = `You are the WCS Marketing Mastermind continuing a conversation in a ClickUp task. The user just replied to you. Respond directly — no preamble, no headers unless they help. Stay concise. If they're asking for a revision, deliver the revision in a fenced code block.`

  const userMsg = `Task: ${task?.name || ''}
Task description: ${task?.markdown_description || task?.description || ''}

Conversation so far (most recent last):
${history.slice(-10).map(m => `${m.role === 'user' ? 'User' : 'You'}: ${m.content}`).join('\n----\n')}

Latest message to respond to:
${triggerComment}

Respond now.`

  const r = await complete({
    mode: 'continue',
    system,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 2000,
  })

  return {
    commentText: r.text.trim(),
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
