const { complete } = require('../anthropic')
const cu = require('../clickup')
const { inferLane } = require('../lane')

const DEFAULT_CONCEPTS_PER_REQUEST = 3
const NO_DASHES = `HARD RULE: never use em-dashes ("—") or en-dashes ("–") anywhere in the output. They are an AI tell. Use commas, periods, parentheses, colons, or restructure. Plain hyphens (-) inside compound words are fine.`

// Strategize: "think for me". Behavior varies by lane.
// - Labs: generate 3 concept subtasks
// - Channels (regular task): structured brief in the description
// - Strategy: strategic memo in description
// - Performance: data-light analysis in description
// - Inbox: triage recommendation in description
module.exports = async function strategize({ task, comments }) {
  const lane = inferLane(task)

  if (lane === 'campaign_lab' || lane === 'post_lab' || lane === 'content_lab') {
    return labConceptGeneration({ task, lane })
  }
  if (lane === 'performance') {
    return performanceAnalysis({ task, comments, lane })
  }
  if (lane === 'inbox') {
    return inboxTriage({ task, comments, lane })
  }
  return structuredBrief({ task, comments, lane })
}

async function labConceptGeneration({ task, lane }) {
  const labKind = lane === 'campaign_lab' ? 'campaign'
    : lane === 'post_lab' ? 'social post'
    : 'content piece (email broadcast, SMS, app blast, SEO post, or blog)'

  const system = `You are the WCS (West Coast Strength) Marketing Mastermind. WCS is a gym chain with 7 locations in Oregon: Clackamas, Eugene, Keizer, Medford, Milwaukie, Salem, and Springfield. The user asked for ${labKind} ideas. Generate exactly ${DEFAULT_CONCEPTS_PER_REQUEST} distinct concepts.

${NO_DASHES}

Each concept must be substantively different. After a 1 to 2 sentence intro, return EXACTLY ONE JSON code block at the end:

\`\`\`json
{
  "intro": "1 or 2 sentence read of the brief plus context",
  "concepts": [
    {
      "name": "short punchy concept name (60 chars max)",
      "hook": "the angle, what makes this work",
      "audience": "who specifically",
      "channels": "channel mix as a string",
      "expected_outcome": "honest read on what this would deliver",
      "score": 4
    }
  ]
}
\`\`\`

\`score\` is your 1 to 5 confidence rating. Be honest, not all 5s.`

  const user = `Lane: ${lane}
Parent task: ${task?.name}
Brief from user:
${task?.markdown_description || task?.description || '(none, infer from title)'}

Generate ${DEFAULT_CONCEPTS_PER_REQUEST} concepts now.`

  const r = await complete({
    mode: 'strategize',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3000,
  })

  let parsed
  try {
    const match = r.text.match(/```json\s*([\s\S]+?)```/)
    if (!match) throw new Error('no JSON block')
    parsed = JSON.parse(match[1])
  } catch (e) {
    return {
      commentText: `**Concept generation produced unparseable output.** Raw response below.\n\n${r.text}`,
      lane,
      usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
    }
  }

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
      console.error('[mastermind] concept subtask creation failed:', e.message)
    }
  }

  return {
    commentText: `✅ **${createdCount} concepts generated.** ${parsed.intro || ''}\n\nReview the subtasks. Mark the one you want as **Approved**, then set **Mastermind = Build** to spin up the full work.`,
    statusAfter: 'ideas posted',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

async function structuredBrief({ task, comments, lane }) {
  const taskTitle = task?.name || '(untitled)'
  const description = task?.markdown_description || task?.description || task?.text_content || ''
  const listName = task?.list?.name || 'unknown'
  const recentComments = (comments || [])
    .slice(-5)
    .map(c => `${c.user?.username || '?'}: ${c.comment_text || ''}`)
    .join('\n')

  const system = `You are the WCS Marketing Mastermind. WCS is a gym chain with 7 Oregon locations: Clackamas, Eugene, Keizer, Medford, Milwaukie, Salem, Springfield.

Your job: take a raw request and produce a tight, structured brief. Tactical, not theoretical. The brief will REPLACE the task description, so write directly in markdown.

${NO_DASHES}

Output format (markdown, no preamble, no surrounding code fence):

### Scope
1 or 2 sentences. What is this deliverable? What is it NOT?

### Audience
Who specifically: segment, location, life stage, awareness level.

### Channels
Bulleted list. Which channels carry this and why.

### Hook / Angle
The single sharpest angle. One sentence.

### Key messages
3 to 5 bullets. Things the audience must take away.

### CTA
One clear action.

### Success metric
How will we know it worked?

### Open questions
Anything you'd need before drafting. If none, write "None."

### Deliverables checklist
Concrete artifacts.`

  const user = `Lane: ${lane} (list: ${listName})
Task title: ${taskTitle}

Raw description:
${description || '(none, infer from title)'}

Recent comments:
${recentComments || '(none)'}

Write the brief now.`

  const r = await complete({
    mode: 'strategize',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2500,
  })

  return {
    descriptionUpdate: r.text.trim(),
    commentText: `✅ Brief written to the task description. Set **Mastermind = Build** when ready to produce the deliverable, or comment **@mastermind** to iterate.`,
    statusAfter: 'building',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

async function performanceAnalysis({ task, comments, lane }) {
  const system = `You are the WCS Marketing Mastermind. Write a concise analysis based on what the task says. If the task references data you don't have, say so and recommend what to attach.

${NO_DASHES}

Output (markdown, no preamble, will replace the task description):

### Headline read
1 or 2 sentences.

### What's working
3 bullets max with numbers if available.

### What's bleeding
3 bullets max with numbers if available.

### Recommended actions
2 to 4 concrete budget shifts, experiments, or follow-ups.

### What I'd need to go deeper
Specific data sources or attachments.`

  const user = `Task: ${task?.name}
Lane: ${lane}
Description: ${task?.markdown_description || task?.description || '(none)'}
Comments: ${(comments || []).slice(-3).map(c => c.comment_text).join('\n') || '(none)'}

Write the analysis now.`

  const r = await complete({
    mode: 'strategize',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2500,
  })

  return {
    descriptionUpdate: r.text.trim(),
    commentText: `✅ Analysis written to the description. Comment **@mastermind** to drill in further.`,
    statusAfter: 'analyzing',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

async function inboxTriage({ task, comments, lane }) {
  const system = `You are the WCS Marketing Mastermind. The user dropped a raw idea into the Inbox. Triage it: where should this go and why?

${NO_DASHES}

Output (markdown, no preamble, will replace the task description):

### What I read
1 sentence on what the user is asking for.

### Recommended lane
One of:
- Campaigns / Campaign Lab (campaign concept worth concept-generating)
- Social Media / Post Lab (organic post idea)
- Channels / Content Lab (email, SMS, app blast, SEO, or flyer concept)
- Channels / [specific channel] (single-piece deliverable in an active channel)
- Strategy (long-form reference work)
- Archive (not worth pursuing now)

Explain in 1 sentence why.

### Suggested next step
Either "Move this task to [lane] and set Mastermind = Strategize" or "Move to [lane] and set Mastermind = Build" or "Archive."`

  const user = `Inbox task: ${task?.name}
Description: ${task?.markdown_description || task?.description || '(empty)'}
Comments: ${(comments || []).slice(-3).map(c => c.comment_text).join('\n') || '(none)'}

Triage now.`

  const r = await complete({
    mode: 'strategize',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 1500,
  })

  return {
    descriptionUpdate: r.text.trim(),
    commentText: `✅ Triage written to the task description. Move the task and re-trigger Mastermind there.`,
    statusAfter: 'triaged',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}
