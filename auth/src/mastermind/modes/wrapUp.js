const { complete } = require('../anthropic')
const cu = require('../clickup')
const { inferLane } = require('../lane')

// Wrap Up: post-mortem + auto-create follow-up subtasks for action items.
module.exports = async function wrapUp({ task, comments }) {
  const lane = inferLane(task)

  const system = `You are the WCS Marketing Mastermind. Write a post-mortem for completed marketing work.

Output ONE markdown comment ending with a JSON code block of action items:

### What was the goal
1 sentence.

### What happened
3–5 bullets. Numbers if available.

### What worked
2–3 bullets, specific.

### What didn't
2–3 bullets, specific. Honest.

### What to keep / kill / try next
- **Keep:** 1–3 things to systematize.
- **Kill:** 1–3 things to stop doing.
- **Try next:** 1–3 experiments.

\`\`\`json
{
  "action_items": [
    { "title": "...", "description": "...", "owner_hint": "Justin or Paige or unassigned" }
  ]
}
\`\`\`

Each action_item becomes a subtask. Cap at 5. Quality > quantity.`

  const commentsHistory = (comments || [])
    .map(c => `${c.user?.username || '?'}: ${c.comment_text}`)
    .join('\n----\n')

  const user = `Task: ${task?.name}
List: ${task?.list?.name || ''}
Description: ${task?.markdown_description || task?.description || ''}

Comments history:
${commentsHistory || '(none)'}

Write the post-mortem now.`

  const r = await complete({
    mode: 'wrap_up',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3500,
  })

  // Extract action items JSON
  let actionItems = []
  try {
    const match = r.text.match(/```json\s*([\s\S]+?)```/)
    if (match) {
      const parsed = JSON.parse(match[1])
      actionItems = Array.isArray(parsed.action_items) ? parsed.action_items.slice(0, 5) : []
    }
  } catch {
    // No JSON block or unparseable — proceed with 0 action items
  }

  // Create subtasks (cap at 5)
  let createdCount = 0
  for (const item of actionItems) {
    try {
      await cu.createSubtask(task.id, task?.list?.id, {
        name: (item.title || '(action item)').slice(0, 200),
        description: `${item.description || ''}\n\n_Suggested owner: ${item.owner_hint || 'unassigned'}_\n_(Auto-created from Wrap Up post-mortem)_`,
      })
      createdCount++
    } catch (e) {
      console.error('[mastermind] wrap-up subtask creation failed:', e.message)
    }
  }

  return {
    commentText: `**Post-mortem — Mastermind (${r.model})**\n\n${r.text.trim()}\n\n_${createdCount} action item${createdCount === 1 ? '' : 's'} created as subtasks._`,
    statusAfter: 'closed',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
