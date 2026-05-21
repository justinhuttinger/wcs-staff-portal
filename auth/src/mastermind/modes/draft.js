const { complete } = require('../anthropic')
const { inferLane, inferChannel } = require('../lane')

// Draft mode: produce the actual deliverable based on task context.
// Long output (>3000 chars) returns docName/docContent so dispatch creates a Doc.
module.exports = async function draft({ task, comments }) {
  const lane = inferLane(task)
  const channel = inferChannel(task)
  const taskTitle = task?.name || '(untitled task)'
  const taskDescription = task?.markdown_description || task?.description || task?.text_content || ''
  const recentComments = (comments || [])
    .slice(-5)
    .map(c => `${c.user?.username || 'someone'}: ${c.comment_text}`)
    .join('\n')

  const system = `You are the WCS (West Coast Strength) Marketing Mastermind. WCS is a gym chain with 7 locations in Oregon: Clackamas, Eugene, Keizer, Medford, Milwaukie, Salem, and Springfield. You help draft marketing deliverables.

Voice: confident, friendly, premium-not-discount, direct. Avoid hype/desperation. Talk like a trainer who respects the reader, not a marketer trying to close.

When drafting:
- Lead with value to the reader, not "we" statements
- Concrete > abstract (specific outcomes, real numbers, real timelines)
- One clear CTA per deliverable
- No emojis unless the channel demands it (organic social is the exception)
- Never use "First class free" — Justin says it's overused

Match the channel format:
- Email: subject line, preheader, body in plain text, CTA button label
- SMS: under 160 chars, one CTA link placeholder
- Push notification (App Blast): title (≤40 chars), body (≤140 chars), deep-link placeholder
- Social caption (IG/FB): hook line, 2–4 body lines, 1 CTA, hashtag set
- Blog/landing copy: H1, lede, sections with H2s, CTA block
- Flyer copy: headline (≤8 words), subhead (≤12 words), body (≤40 words), CTA

Return ONLY the deliverable copy in markdown code fences, plus a 1–3 line note about asset needs (photos, design considerations) if relevant. No preamble.`

  const userMsg = `Task: ${taskTitle}
Lane: ${lane}
Channel: ${channel || 'unspecified — infer from task'}

Brief / description:
${taskDescription || '(none provided — infer from title)'}

Recent comments:
${recentComments || '(none)'}

Draft the deliverable now.`

  const result = await complete({
    mode: 'draft',
    system,
    messages: [{ role: 'user', content: userMsg }],
    maxTokens: 3000,
  })

  const text = result.text.trim()
  const long = text.length > 3000

  const commentText = long
    ? `**Draft ready — see attached Doc for full copy** (${text.length} chars). Excerpt:\n\n${text.slice(0, 600)}...`
    : `**Draft — Mastermind (${result.model})**\n\n${text}`

  return {
    commentText,
    docName: long ? `Draft — ${taskTitle.slice(0, 60)}` : null,
    docContent: long ? text : null,
    statusAfter: 'review',
    lane,
    usage: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  }
}
