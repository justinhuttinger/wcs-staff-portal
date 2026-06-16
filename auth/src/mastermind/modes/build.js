const { complete } = require('../anthropic')
const cu = require('../clickup')
const { inferLane, inferChannel } = require('../lane')

const NO_DASHES = `HARD RULE: never use em-dashes ("—") or en-dashes ("–") anywhere in the output. They are an AI tell. Use commas, periods, parentheses, colons, or restructure. Plain hyphens (-) inside compound words are fine.`

const WCS_VOICE = `WCS is a gym chain with 7 locations in Oregon: Clackamas, Eugene, Keizer, Medford, Milwaukie, Salem, and Springfield.

Voice: confident, friendly, premium not discount, direct. Avoid hype and desperation. Talk like a trainer who respects the reader, not a marketer trying to close.

Drafting rules:
- Lead with value to the reader, not "we" statements
- Concrete beats abstract: specific outcomes, real numbers, real timelines
- One clear CTA per deliverable
- No emojis unless the channel is organic social
- Never use "First class free" because Justin says it is overused`

// Build: "create the thing". Behavior varies by lane and task state.
// - Campaign Lab (approved concept): promote to full Active Campaign w/ subtasks
// - Other Labs (approved concept): promote into the relevant channel list
// - Channels (regular task): produce deliverable copy, populate fields + description
// - Performance: produce the report
module.exports = async function build({ task, comments }) {
  const lane = inferLane(task)
  const status = (task?.status?.status || task?.status || '').toString().toLowerCase()

  if (lane === 'campaign_lab' && /approved/.test(status)) {
    return promoteCampaign({ task })
  }
  if (lane === 'post_lab' && /approved/.test(status)) {
    return promotePost({ task })
  }
  if (lane === 'content_lab' && /approved/.test(status)) {
    return promoteContent({ task })
  }
  // Default: produce a deliverable for this single task
  return draftDeliverable({ task, comments, lane })
}

// ---------------------------------------------------------------------------
// Draft a single deliverable into fields + description
// ---------------------------------------------------------------------------

async function draftDeliverable({ task, comments, lane }) {
  const channel = inferChannel(task) || laneToChannel(lane)
  const channelHint = channelFormatHint(channel)
  const taskTitle = task?.name || '(untitled)'
  const description = task?.markdown_description || task?.description || task?.text_content || ''
  const recentComments = (comments || [])
    .slice(-5)
    .map(c => `${c.user?.username || '?'}: ${c.comment_text || ''}`)
    .join('\n')

  const system = `You are the WCS Marketing Mastermind. ${WCS_VOICE}

${NO_DASHES}

You are producing the ACTUAL deliverable for: **${channel || 'a marketing task'}**.

${channelHint}

Output BOTH:
1. A markdown block that will REPLACE the task's description (long-form body of the deliverable).
2. ONE JSON code block at the very end with structured fields.

Markdown format (no preamble, no surrounding code fence):

## ${channel || 'Deliverable'}

[the full long-form copy, formatted naturally for the channel]

Then end with:

\`\`\`json
{
  "fields": {
    "Subject Line": "...",
    "Preheader": "...",
    "CTA Text": "...",
    "Notification Title": "...",
    "Notification Body": "...",
    "Caption": "...",
    "Hashtags": "..."
  }
}
\`\`\`

Only include fields RELEVANT to this channel. Omit irrelevant fields entirely. Field values are short text only (under 200 chars each). The long-form copy lives in the markdown body above, NOT in JSON fields.`

  const user = `Task: ${taskTitle}
Lane: ${lane}
Channel: ${channel || '(infer from task title and description)'}

Brief (from description):
${description || '(none provided, infer from title)'}

Recent comments:
${recentComments || '(none)'}

Produce the deliverable now.`

  const r = await complete({
    mode: 'build',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 3500,
  })

  // Parse JSON for field updates
  let fieldUpdates = {}
  let descriptionText = r.text.trim()
  try {
    const match = r.text.match(/```json\s*([\s\S]+?)```\s*$/m)
    if (match) {
      const parsed = JSON.parse(match[1])
      if (parsed.fields && typeof parsed.fields === 'object') {
        fieldUpdates = parsed.fields
      }
      // Strip the JSON block from the description so it doesn't pollute the task
      descriptionText = r.text.slice(0, match.index).trim()
    }
  } catch {
    // No JSON or unparseable; description gets the full text
  }

  return {
    fieldUpdates,
    descriptionUpdate: descriptionText,
    commentText: `✅ Build complete. Deliverable copy is in the task description; key pieces (Subject Line, Caption, etc.) are in the custom fields. Comment **@mastermind** to iterate.`,
    statusAfter: 'review',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

function laneToChannel(lane) {
  if (lane?.startsWith('channel.')) return lane.split('.')[1]
  if (lane === 'social_calendar') return 'social'
  if (lane === 'campaign') return 'multi'
  return null
}

function channelFormatHint(channel) {
  const c = (channel || '').toLowerCase()
  if (/email/.test(c)) return `Format: Email broadcast. Include subject line (under 60 chars), preheader (under 100 chars), body in plain text with short paragraphs, and a clear CTA button label.`
  if (/sms/.test(c)) return `Format: SMS. Body under 160 characters total. Include one CTA link placeholder like {link}.`
  if (/push|app blast|appblast/.test(c)) return `Format: Push notification. Title under 40 chars, body under 140 chars, plus a deep-link target description.`
  if (/social|instagram|tiktok|facebook|content cal/.test(c)) return `Format: Organic social caption. Hook line, 2 to 4 body lines, one CTA, plus a hashtag set (12 to 20 hashtags max). Emojis are OK here only.`
  if (/blog|seo/.test(c)) return `Format: Blog post or SEO landing copy. H1, lede paragraph, sections with H2s, internal links if useful, and a CTA block at the end.`
  if (/flyer|print/.test(c)) return `Format: Flyer copy plus design brief. Headline (under 8 words), subhead (under 12 words), body (under 40 words), CTA. Include a 1 to 3 line note on the visual/photo direction.`
  if (/meta|fb ad|ad/.test(c)) return `Format: Paid Meta ad. Headline (40 chars max), primary text (125 chars max for top performance), description line, and CTA button choice.`
  if (/promo/.test(c)) return `Format: In-gym promotion. Promo name, offer one-liner, terms (3 to 5 bullet points), CTA, and a 1 to 2 line note on how staff should pitch it on the floor.`
  return `Format: match the deliverable type implied by the task title and description.`
}

// ---------------------------------------------------------------------------
// Campaign Lab → full Active Campaign promotion
// ---------------------------------------------------------------------------

async function promoteCampaign({ task }) {
  const campaignsFolderId = process.env.CLICKUP_FOLDER_CAMPAIGNS
  if (!campaignsFolderId) {
    return {
      commentText: `**Build cannot promote without \`CLICKUP_FOLDER_CAMPAIGNS\` env var.** Run the provisioning script or set the env manually.`,
      lane: 'campaign_lab',
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }

  const conceptDesc = task?.markdown_description || task?.description || task?.text_content || ''
  const conceptName = task?.name || 'Untitled Concept'
  let originalBrief = ''
  if (task?.parent) {
    try {
      const parentLab = await cu.getTask(task.parent)
      originalBrief = parentLab?.markdown_description || parentLab?.description || parentLab?.text_content || ''
    } catch { /* fine */ }
  }

  const system = `You are the WCS Marketing Mastermind. An approved campaign concept needs to be expanded into a full campaign plan. Be concrete and execution-ready.

${WCS_VOICE}

${NO_DASHES}

Output BOTH (1) a human-readable plan in markdown AND (2) a JSON block at the end with structured deliverables.

Markdown plan format:

### Campaign: <name>

**Campaign Type:** Acquisition | Retention | Upsell | Operational

**Window:** ~6 weeks (or whatever the concept implies)

### Strategic plan
3 to 5 paragraphs. Audience, positioning, channel mix rationale, sequencing.

### Success metrics
3 to 5 measurable KPIs.

### Risks / what to watch
2 to 3 honest risks.

End your message with ONE JSON code block:

\`\`\`json
{
  "campaign_name": "...",
  "campaign_type": "Acquisition | Retention | Upsell | Operational",
  "deliverables": [
    { "channel": "Meta Ads", "title": "Cold-traffic ad set + 3 variants", "description": "What it is, target audience, hook" }
  ]
}
\`\`\`

Deliverables must use these exact channel names: "Meta Ads", "Social", "SEO", "Email", "App Blast", "Flyer", "Promo". Don't include channels not in the concept's mix. Cap at 8 deliverables.`

  const user = `Approved concept:

**Title:** ${conceptName}

${conceptDesc}

Original brief:
${originalBrief || '(none)'}

Generate the full campaign plan now.`

  const result = await complete({
    mode: 'build',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 4000,
  })

  const planText = result.text.trim()
  let parsed = { campaign_name: conceptName, campaign_type: 'Acquisition', deliverables: [] }
  try {
    const match = planText.match(/```json\s*([\s\S]+?)```/)
    if (match) {
      const j = JSON.parse(match[1])
      parsed = {
        campaign_name: (j.campaign_name || conceptName).slice(0, 200),
        campaign_type: j.campaign_type || 'Acquisition',
        deliverables: Array.isArray(j.deliverables) ? j.deliverables.slice(0, 8) : [],
      }
    }
  } catch { /* defaults */ }

  // Strip JSON from the plan that goes into the parent task's description
  const cleanedPlan = planText.replace(/```json\s*[\s\S]+?```/, '').trim()
  const listName = `🟢 ${parsed.campaign_name}`

  // Create the new active-campaign list
  let newList
  try {
    newList = await cu.createList(campaignsFolderId, {
      name: listName,
      statuses: [
        { status: 'Briefing', color: '#87909e', orderindex: 0, type: 'open' },
        { status: 'Building', color: '#f9d900', orderindex: 1, type: 'custom' },
        { status: 'Live', color: '#02bcd4', orderindex: 2, type: 'custom' },
        { status: 'Review', color: '#bf55ec', orderindex: 3, type: 'custom' },
        { status: 'Closed', color: '#000000', orderindex: 4, type: 'closed' },
      ],
    })
  } catch (e) {
    return {
      commentText: `**Could not create campaign list:** ${e.message}`,
      lane: 'campaign_lab',
      usage: { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    }
  }

  // Create parent campaign task with the plan in its description
  const parentTask = await cu.createTask(newList.id, {
    name: parsed.campaign_name,
    description: `_Promoted from Campaign Lab concept [${task.id}]_\n\n${cleanedPlan}`,
  })

  // Create deliverable subtasks and mirror each into its channel list
  let createdCount = 0
  let mirroredCount = 0
  for (const d of parsed.deliverables) {
    let subtask
    try {
      subtask = await cu.createSubtask(parentTask.id, newList.id, {
        name: `${d.channel ? `[${d.channel}] ` : ''}${d.title || 'Deliverable'}`,
        description: d.description || '',
      })
      createdCount++
    } catch (e) {
      console.error('[mastermind] subtask create failed:', e.message)
      continue
    }
    const channelListId = channelListIdFor(d.channel)
    if (channelListId && subtask?.id) {
      try {
        await cu.addTaskToList(channelListId, subtask.id)
        mirroredCount++
      } catch (e) {
        console.error(`[mastermind] mirror to ${d.channel} failed:`, e.message)
      }
    }
  }

  try { await cu.updateTaskStatus(task.id, 'promoted') } catch {}

  const mirrorNote = mirroredCount > 0
    ? ` ${mirroredCount} of ${createdCount} also mirrored into their channel lists.`
    : ''

  return {
    commentText: `✅ **Campaign promoted to active.** Created list **${listName}** with parent task and ${createdCount} deliverable subtask${createdCount === 1 ? '' : 's'}.${mirrorNote}\n\nGo to the new list and set **Mastermind = Build** on each deliverable to produce the actual copy.`,
    statusAfter: 'promoted',
    lane: 'campaign_lab',
    usage: { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
  }
}

// ---------------------------------------------------------------------------
// Post Lab → Content Calendar promotion
// ---------------------------------------------------------------------------

async function promotePost({ task }) {
  const calendarListId = process.env.CLICKUP_LIST_CONTENT_CALENDAR
  if (!calendarListId) {
    return {
      commentText: `**Build cannot promote without \`CLICKUP_LIST_CONTENT_CALENDAR\` env var.**`,
      lane: 'post_lab',
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }
  try {
    await cu.moveTaskToList(task.id, calendarListId)
  } catch (e) {
    return {
      commentText: `**Could not move task to Content Calendar:** ${e.message}`,
      lane: 'post_lab',
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }
  // Then run draftDeliverable on the same task (now in Content Calendar context)
  // We need a fresh task fetch to pick up the new list context
  let movedTask
  try { movedTask = await cu.getTask(task.id) } catch { movedTask = task }
  return draftDeliverable({ task: movedTask, comments: [], lane: 'social_calendar' })
}

// ---------------------------------------------------------------------------
// Content Lab → relevant channel list promotion
// ---------------------------------------------------------------------------

async function promoteContent({ task }) {
  const channelTarget = readChannelTarget(task)
  const targetListId = channelTargetToListId(channelTarget)
  if (!targetListId) {
    return {
      commentText: `**Build cannot promote: the "Channel Target" field is unset or has an unrecognized value.** Set it to Email, SMS, App Blast, SEO, Blog, or Flyer first.`,
      lane: 'content_lab',
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }
  try {
    await cu.moveTaskToList(task.id, targetListId)
  } catch (e) {
    return {
      commentText: `**Could not move task to ${channelTarget} list:** ${e.message}`,
      lane: 'content_lab',
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }
  let movedTask
  try { movedTask = await cu.getTask(task.id) } catch { movedTask = task }
  // Use the channel name as the inferred lane for draftDeliverable
  return draftDeliverable({ task: movedTask, comments: [], lane: 'channel.' + (channelTarget || 'unknown').toLowerCase() })
}

function readChannelTarget(task) {
  const fields = task?.custom_fields || []
  const f = fields.find(x => x?.name === 'Channel Target')
  if (!f) return null
  // Dropdown value is the option ID; resolve to name
  const options = f.type_config?.options || []
  const opt = options.find(o => o?.id === f.value)
  return opt?.name || null
}

function channelTargetToListId(target) {
  if (!target) return null
  const t = String(target).toLowerCase()
  if (/email|sms/.test(t)) return process.env.CLICKUP_LIST_EMAIL
  if (/app blast|push/.test(t)) return process.env.CLICKUP_LIST_APPBLASTS
  if (/seo|blog/.test(t)) return process.env.CLICKUP_LIST_SEO
  if (/flyer|print/.test(t)) return process.env.CLICKUP_LIST_FLYERS
  return null
}

function channelListIdFor(channel) {
  if (!channel) return null
  const c = String(channel).toLowerCase()
  if (/meta|fb|facebook ad/.test(c)) return process.env.CLICKUP_LIST_META_ADS || null
  if (/social|instagram|tiktok|content cal/.test(c)) return process.env.CLICKUP_LIST_CONTENT_CALENDAR || null
  if (/seo|blog/.test(c)) return process.env.CLICKUP_LIST_SEO || null
  if (/email|sms|broadcast/.test(c)) return process.env.CLICKUP_LIST_EMAIL || null
  if (/app blast|push|app/.test(c)) return process.env.CLICKUP_LIST_APPBLASTS || null
  if (/flyer|print/.test(c)) return process.env.CLICKUP_LIST_FLYERS || null
  if (/promo|in-gym|in gym/.test(c)) return process.env.CLICKUP_LIST_PROMOTIONS || null
  return null
}
