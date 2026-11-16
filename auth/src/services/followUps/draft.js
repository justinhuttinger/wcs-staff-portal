// Writes Follow-up emails in the owner's own voice with Claude. The style comes
// from a few of his recent Sent emails (see gmail.recentSentSamples). Every
// draft is shown to him to edit before anything is sent; nothing here sends.

const Anthropic = require('@anthropic-ai/sdk').default
  || require('@anthropic-ai/sdk').Anthropic
  || require('@anthropic-ai/sdk')

const MODEL = 'claude-opus-5-5'
const apiKey = process.env.ANTHROPIC_API_KEY
const client = apiKey ? new Anthropic({ apiKey, maxRetries: 2, timeout: 120 * 1000 }) : null

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    subject: { type: 'string', description: 'Email subject line. Short, plain, no emoji.' },
    body: { type: 'string', description: 'Plain-text email body including greeting and sign-off.' },
  },
  required: ['subject', 'body'],
  additionalProperties: false,
}

function daysBetween(a, b) {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
}

function buildSystem({ ownerName, samples }) {
  const sampleBlock = samples.length
    ? samples.map((s, i) => `<sample ${i + 1}>\n${s}\n</sample ${i + 1}>`).join('\n\n')
    : '(No samples available. Write in a direct, friendly, plain-spoken style.)'
  return `You write short work emails on behalf of ${ownerName}, who runs West Coast Strength, a group of gyms. The emails go out from his own Gmail account, so they must read exactly like he wrote them himself.

Below are emails he has actually sent. Study them for his voice: how long his emails usually are, how he opens and signs off, his word choice, punctuation, capitalization, and how formal or casual he is. Match that voice closely. Do not copy sentences from them.

${sampleBlock}

Rules:
- Plain text only. No markdown, no bullet symbols unless his samples use them, no emoji unless his samples use them.
- Never use em dashes or en dashes. Use commas, periods, or "and" instead.
- Only state facts given to you in the request. Do not invent deadlines, consequences, meetings, or promises.
- Keep it short. A request email is usually 2 to 5 sentences; a follow-up nudge is usually 1 to 3 sentences.
- Address the recipient by first name.`
}

function buildPrompt({ kind, project, history, today }) {
  const lines = [
    `Today is ${today}.`,
    `Recipient: ${project.recipient_name} <${project.recipient_email}>`,
    `What is needed from them: ${project.title}`,
  ]
  if (project.details) lines.push(`More context: ${project.details}`)
  if (project.due_date) lines.push(`Due date: ${project.due_date}`)
  if (project.instructions) lines.push(`Extra instructions for this draft: ${project.instructions}`)

  if (kind === 'initial') {
    lines.push('', 'Write the first email asking them to take this on. Include the due date if there is one. Write a clear, specific subject line.')
    return lines.join('\n')
  }

  const lastSent = history.length ? history[history.length - 1].sent_at : null
  const nudgeNumber = history.filter(h => h.kind === 'nudge').length + 1
  lines.push('', 'Emails already sent in this thread, oldest first:')
  for (const h of history) {
    lines.push(`--- ${h.kind} sent ${String(h.sent_at).slice(0, 10)} ---`, h.body)
  }
  lines.push('---', '')
  if (lastSent) lines.push(`It has been ${daysBetween(lastSent, today)} days since the last email and they have not replied.`)
  if (project.due_date) {
    const d = daysBetween(today, project.due_date)
    lines.push(d < 0 ? `It is ${-d} days past due.` : d === 0 ? 'It is due today.' : `It is due in ${d} days.`)
  }
  lines.push(
    `This is follow-up number ${nudgeNumber}. Write a short nudge that goes as a reply in the same thread.`,
    'Word it differently from every email above: different opening, different phrasing. Do not repeat the full request; a brief reference is enough.',
    nudgeNumber >= 3
      ? 'Be a little more direct than earlier nudges and ask for a quick status or an ETA, while staying friendly. Never guilt-trip.'
      : 'Keep it light and friendly.',
    'The subject field is ignored for nudges; return the original subject.',
  )
  return lines.join('\n')
}

async function draftEmail({ kind, project, history = [], ownerName, samples = [] }) {
  if (!client) {
    const err = new Error('ANTHROPIC_API_KEY is not set on the API')
    err.status = 500
    throw err
  }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' })
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
    system: buildSystem({ ownerName, samples }),
    messages: [{ role: 'user', content: buildPrompt({ kind, project, history, today }) }],
  })
  if (response.stop_reason === 'refusal') {
    const err = new Error('Claude declined to write this one. Try rewording the request.')
    err.status = 422
    throw err
  }
  const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('')
  let parsed
  try { parsed = JSON.parse(text) } catch {
    const err = new Error('Draft came back malformed, try again')
    err.status = 502
    throw err
  }
  // Belt and braces for the no-dash rule.
  const clean = s => String(s || '').replace(/\s*[—–]\s*/g, ', ').trim()
  return { subject: clean(parsed.subject), body: clean(parsed.body) }
}

module.exports = { draftEmail, buildPrompt, buildSystem }
