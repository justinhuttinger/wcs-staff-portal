const { complete } = require('../anthropic')
const cu = require('../clickup')
const { inferLane } = require('../lane')

const DEFAULT_CONCEPTS_PER_REQUEST = 3

// Strategize: two flavors.
// - General: write a strategic memo.
// - Lab (Campaign Lab / Post Lab / Broadcast Lab): generate N concept subtasks.
module.exports = async function strategize({ task, comments }) {
  const lane = inferLane(task)
  const isLab = lane === 'campaign_lab' || lane === 'post_lab' || lane === 'broadcast_lab'

  if (isLab) {
    return strategizeLab({ task, lane })
  }
  return strategizeGeneral({ task, comments, lane })
}

async function strategizeGeneral({ task, comments, lane }) {
  const system = `You are the WCS Marketing Mastermind. Produce sharp strategic memos: positioning, channel mix, opportunity cost, alternatives. You are willing to recommend NOT doing the thing if that's the right call.

Output:
1. **The ask, as I understand it** — 1–2 sentences.
2. **My take** — should we, shouldn't we, or "yes but" — and why.
3. **Risks / what would have to be true.**
4. **Alternatives** — 2–3 different angles worth considering.
5. **Recommendation** — concrete next step.

Tight. No padding.`

  const user = `Task: ${task?.name}
Lane: ${lane}
List: ${task?.list?.name || ''}
Description: ${task?.markdown_description || task?.description || task?.text_content || '(none)'}
Recent comments: ${(comments || []).slice(-3).map(c => c.comment_text).join('\n') || '(none)'}

Give me your strategic take.`

  const r = await complete({
    mode: 'strategize',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2000,
  })

  return {
    commentText: `**Strategic take — Mastermind (${r.model})**\n\n${r.text.trim()}`,
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

async function strategizeLab({ task, lane }) {
  const labKind = lane === 'campaign_lab' ? 'campaign'
    : lane === 'post_lab' ? 'social post'
    : 'email broadcast'

  const system = `You are the WCS Marketing Mastermind. The user asked for ${labKind} ideas. Generate exactly ${DEFAULT_CONCEPTS_PER_REQUEST} distinct concepts.

Each concept must be substantively different (not three flavors of the same idea). After your intro, return EXACTLY ONE JSON code block at the end:

\`\`\`json
{
  "intro": "1–2 sentence read of the brief + market context",
  "concepts": [
    {
      "name": "short punchy concept name (≤60 chars)",
      "hook": "the angle / what makes this work",
      "audience": "who specifically",
      "channels": "channel mix as a string",
      "expected_outcome": "honest read on what this would deliver",
      "score": 4
    }
  ]
}
\`\`\`

\`score\` is your 1–5 confidence rating. Be honest — not all 5s.`

  const user = `Lane: ${lane}
Parent task: ${task?.name}
Brief from user:
${task?.markdown_description || task?.description || '(none — infer from title)'}

Generate ${DEFAULT_CONCEPTS_PER_REQUEST} concepts now.`

  const r = await complete({
    mode: 'strategize',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3000,
  })

  // Parse the JSON block
  let parsed
  try {
    const match = r.text.match(/```json\s*([\s\S]+?)```/)
    if (!match) throw new Error('no JSON block found')
    parsed = JSON.parse(match[1])
  } catch (e) {
    return {
      commentText: `**Concept generation produced unparseable output.** Raw response:\n\n${r.text}\n\n(Error: ${e.message})`,
      lane,
      usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
    }
  }

  // Create subtasks (one per concept)
  const listId = task?.list?.id
  const concepts = Array.isArray(parsed.concepts) ? parsed.concepts : []
  let createdCount = 0
  for (const c of concepts) {
    try {
      await cu.createSubtask(task.id, listId, {
        name: c.name || '(untitled concept)',
        description: `**Hook:** ${c.hook || '(none)'}\n\n**Audience:** ${c.audience || '(unspecified)'}\n\n**Channels:** ${c.channels || '(unspecified)'}\n\n**Expected outcome:** ${c.expected_outcome || '(unspecified)'}\n\n**Mastermind confidence:** ${c.score ?? '?'}/5`,
      })
      createdCount++
    } catch (e) {
      console.error('[mastermind] strategize subtask creation failed:', e.message)
    }
  }

  return {
    commentText: `**${createdCount} concepts generated — Mastermind (${r.model})**\n\n${parsed.intro || ''}\n\nReview the subtasks below. Mark the one you want with status \`Approved\` and set \`Mastermind = Brief Me\` on it to promote to a full campaign.`,
    statusAfter: 'ideas posted',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
