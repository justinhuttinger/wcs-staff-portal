const { complete } = require('../anthropic')
const { inferLane } = require('../lane')

// Brief Me: produce a tight structured brief.
// Special case: if on a Campaign Lab task with status "Approved", this should
// promote the concept to a full Active Campaign. That promotion is stubbed
// here pending ClickUp space/folder IDs (Section 15 provisioning).
module.exports = async function briefMe({ task, comments }) {
  const lane = inferLane(task)
  const status = (task?.status?.status || task?.status || '').toString().toLowerCase()

  if (lane === 'campaign_lab' && /approved/.test(status)) {
    return promoteConcept({ task, comments })
  }

  const taskTitle = task?.name || '(untitled)'
  const description = task?.markdown_description || task?.description || task?.text_content || ''
  const listName = task?.list?.name || 'unknown'

  const system = `You are the WCS Marketing Mastermind. Read a raw request and produce a tight, structured brief. Tactical, not theoretical.

Output format (markdown, no preamble):

### Scope
1–2 sentences. What is this deliverable? What is it NOT?

### Audience
Who specifically — segment, location, life stage, awareness level.

### Channels
Bulleted list. Which channels carry this and why.

### Hook / Angle
The single sharpest angle. One sentence.

### Key messages
3–5 bullets. Things the audience must take away.

### CTA
One clear action.

### Success metric
How will we know it worked?

### Open questions
Anything you'd need from Justin/Paige before drafting. If none, write "None."

### Deliverables checklist
Concrete artifacts (e.g., "1 cold-traffic Meta ad set + 3 variants", "5-email nurture sequence", "in-gym A-frame copy").`

  const user = `Lane: ${lane} (list: ${listName})
Task title: ${taskTitle}

Raw description:
${description || '(none — infer from title)'}

Recent comments:
${(comments || []).slice(-5).map(c => `${c.user?.username || '?'}: ${c.comment_text}`).join('\n') || '(none)'}

Write the brief now.`

  const result = await complete({
    mode: 'brief_me',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2500,
  })

  return {
    commentText: `**Brief — Mastermind (${result.model})**\n\n${result.text.trim()}`,
    statusAfter: 'building',
    lane,
    usage: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  }
}

async function promoteConcept({ task }) {
  // Stub: promotion requires ClickUp Campaigns space + folder IDs from provisioning.
  // Section 15 of the implementation plan documents the provisioning script and
  // env vars (CLICKUP_SPACE_MARKETING, CLICKUP_FOLDER_CAMPAIGNS) needed.
  return {
    commentText: `**Promotion not yet implemented.**\n\nThis concept is approved and ready for full campaign build-out, but the promotion automation needs ClickUp space/folder IDs to know where to create the new "🟢 [Active]" folder. Set the following env vars and re-run:\n\n- \`CLICKUP_SPACE_MARKETING\` (the "WCS Marketing" space ID)\n- \`CLICKUP_FOLDER_CAMPAIGNS\` (the "Campaigns" folder ID)\n\nOnce those are set, this branch in \`briefMe.js\` becomes the real promotion.\n\nFor now, manually create the campaign folder and use \`Brief Me\` again from inside that folder.`,
    lane: 'campaign_lab',
    usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
  }
}
