const { complete } = require('../anthropic')
const { inferLane } = require('../lane')

const NO_DASHES = `HARD RULE: never use em-dashes ("—") or en-dashes ("–") anywhere in the output. They are an AI tell. Use commas, periods, parentheses, colons, or restructure. Plain hyphens (-) inside compound words are fine.`

// Continue: @mastermind mention in a comment. Reads the task's current state
// (description + fields + recent comments) and applies the requested iteration
// directly to the description/fields. Posts only a short ack in comments.
module.exports = async function cont({ task, comments }) {
  const lane = inferLane(task)
  const currentDescription = task?.markdown_description || task?.description || task?.text_content || ''
  const customFields = (task?.custom_fields || [])
    .filter(f => f?.value != null && f?.value !== '' && f?.name !== 'Mastermind' && f?.name !== 'Mastermind Paused')
    .map(f => `- ${f.name}: ${formatFieldValue(f)}`)
    .join('\n')

  const history = (comments || []).map(c => {
    const username = c.user?.username || c.user?.name || ''
    const text = c.comment_text || ''
    const isAssistant = /^✅|^\*\*(Draft|Brief|Strategic|Analysis|Concept|Promotion|Mastermind:|Campaign)/i.test(text)
      || /mastermind/i.test(username)
    return { role: isAssistant ? 'assistant' : 'user', content: text }
  }).filter(m => m.content.length > 0)
  const triggerComment = history.length > 0 ? history[history.length - 1].content : ''

  const system = `You are the WCS Marketing Mastermind continuing a conversation in a ClickUp task. The user mentioned you with @mastermind in a comment. They want you to iterate on the existing deliverable.

${NO_DASHES}

The task's current state lives in:
- The task description (long-form deliverable copy in markdown)
- Custom fields (short structured data like Subject Line, Caption, Hashtags)

Your job: interpret the user's feedback and produce an UPDATED version of the deliverable. Apply the change to whichever surface needs it (description, field values, or both).

Output BOTH (1) a markdown body that REPLACES the task description AND (2) a JSON block at the end:

[the updated description, full content, not just the diff]

\`\`\`json
{
  "fields": {
    "Subject Line": "...",
    "Caption": "..."
  },
  "summary": "1 sentence on what you changed"
}
\`\`\`

Only include fields in JSON that you actually changed. The "summary" field becomes your reply in the comment thread. Keep summary under 200 chars.

If the request is unclear, set "summary" to a clarifying question and omit the description/fields updates entirely.`

  const user = `Task: ${task?.name || ''}
Lane: ${lane}

CURRENT description:
${currentDescription || '(empty)'}

CURRENT custom field values:
${customFields || '(none populated)'}

Conversation history (most recent last):
${history.slice(-8).map(m => `${m.role === 'user' ? 'User' : 'Mastermind'}: ${m.content}`).join('\n----\n')}

Latest message to respond to:
${triggerComment}

Apply the iteration now.`

  const r = await complete({
    mode: 'continue',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3500,
  })

  let fieldUpdates = {}
  let summary = ''
  let descriptionText = r.text.trim()
  try {
    const match = r.text.match(/```json\s*([\s\S]+?)```\s*$/m)
    if (match) {
      const parsed = JSON.parse(match[1])
      if (parsed.fields && typeof parsed.fields === 'object') fieldUpdates = parsed.fields
      if (typeof parsed.summary === 'string') summary = parsed.summary
      descriptionText = r.text.slice(0, match.index).trim()
    }
  } catch { /* fall through */ }

  // If Mastermind responded only with a clarifying question (no meaningful description body),
  // skip the description/fields update.
  const hasUpdates = descriptionText && descriptionText.length > 50
  return {
    fieldUpdates: hasUpdates ? fieldUpdates : {},
    descriptionUpdate: hasUpdates ? descriptionText : null,
    commentText: summary || (hasUpdates ? `✅ Updated.` : r.text.trim()),
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

function formatFieldValue(f) {
  const v = f.value
  if (v == null) return ''
  if (f.type === 'drop_down' && f.type_config?.options) {
    const opt = f.type_config.options.find(o => o?.id === v)
    if (opt) return opt.name
  }
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v).slice(0, 200)
}
