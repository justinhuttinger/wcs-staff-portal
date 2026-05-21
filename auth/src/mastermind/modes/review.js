const { complete } = require('../anthropic')
const { inferLane } = require('../lane')

// Review mode: critique an existing draft on the task.
// "Draft to review" is taken from the most recent non-Mastermind comment, or
// the task description if no relevant comment exists.
module.exports = async function review({ task, comments }) {
  const lane = inferLane(task)
  const descDraft = task?.markdown_description || task?.description || task?.text_content || ''

  // Find the most recent comment that isn't a Mastermind output. Mastermind
  // outputs start with "**Draft", "**Brief", "**Strategic", "**Analysis",
  // "**Weekly Meta ROAS Review", "**Review", "**Post-mortem".
  const recent = (comments || []).slice().reverse()
  const lastUserComment = recent.find(c => {
    const t = c.comment_text || ''
    return !/^\*\*(Draft|Brief|Strategic|Analysis|Weekly Meta|Review|Post-mortem|Concept generation)/i.test(t)
  })
  const draftText = lastUserComment?.comment_text || descDraft

  if (!draftText.trim()) {
    return {
      commentText: `**Review — nothing to review.**\n\nNo draft found in the task description or recent comments. Paste the draft into a comment and re-trigger \`Mastermind = Review\`.`,
      lane,
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }

  const system = `You are the WCS Marketing Mastermind. Critique the draft like a senior creative director who respects the writer.

Output:
**Overall:** 1–2 sentences. Is it ready? Close? Way off?

**Strengths:** 2–3 bullets. Be specific — quote the line.

**Issues:** Numbered list. For each, quote the offending line and propose a rewrite.

**Suggested rewrites** (if more than minor tweaks):
\`\`\`
the revised version
\`\`\`

**Risk flags:** anything that could cause legal / brand / member backlash. Often "None" — say so.

Be honest. Sycophancy doesn't help.`

  const user = `Task: ${task?.name}\n\nDraft to review:\n${draftText}\n\nReview now.`

  const r = await complete({
    mode: 'review',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2500,
  })

  return {
    commentText: `**Review — Mastermind (${r.model})**\n\n${r.text.trim()}`,
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
