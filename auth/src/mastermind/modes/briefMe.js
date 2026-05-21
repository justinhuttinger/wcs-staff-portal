const { complete } = require('../anthropic')
const cu = require('../clickup')
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

HARD RULE: never use em-dashes ("—") or en-dashes ("–") anywhere in the output. They are an AI tell. Use commas, periods, parentheses, colons, or restructure the sentence. Plain hyphens (-) inside compound words are fine.

Output format (markdown, no preamble):

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
Anything you'd need from Justin/Paige before drafting. If none, write "None."

### Deliverables checklist
Concrete artifacts (e.g., "1 cold-traffic Meta ad set + 3 variants", "5-email nurture sequence", "in-gym A-frame copy").`

  const user = `Lane: ${lane} (list: ${listName})
Task title: ${taskTitle}

Raw description:
${description || '(none, infer from title)'}

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
    commentText: `**Brief: Mastermind (${result.model})**\n\n${result.text.trim()}`,
    statusAfter: 'building',
    lane,
    usage: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  }
}

// Promote an Approved concept subtask into a full Active Campaign.
// Creates: new list under Campaigns folder, parent campaign task with the
// full plan, deliverable subtasks per channel, and a ClickUp Doc holding
// the full plan.
async function promoteConcept({ task }) {
  const campaignsFolderId = process.env.CLICKUP_FOLDER_CAMPAIGNS
  if (!campaignsFolderId) {
    return {
      commentText: `**Promotion needs \`CLICKUP_FOLDER_CAMPAIGNS\` env var.**\n\nThe Campaigns folder ID wasn't captured during provisioning. Run \`auth/scripts/provision-mastermind-space.js\` (which outputs all needed env vars) or grab the Campaigns folder ID manually from ClickUp and add it to the Render auth-service env.`,
      lane: 'campaign_lab',
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }

  // 1. Read the concept description (set by strategize Lab mode)
  const conceptDesc = task?.markdown_description || task?.description || task?.text_content || ''
  const conceptName = task?.name || 'Untitled Concept'

  // 2. Pull original brief from parent Lab task (if linked)
  let originalBrief = ''
  if (task?.parent) {
    try {
      const parentLab = await cu.getTask(task.parent)
      originalBrief = parentLab?.markdown_description || parentLab?.description || parentLab?.text_content || ''
    } catch {
      // If we can't fetch parent, proceed with just concept description
    }
  }

  // 3. Ask Claude to expand the concept into a full campaign plan
  const system = `You are the WCS Marketing Mastermind. An approved campaign concept needs to be expanded into a full campaign plan. Be concrete and execution-ready.

HARD RULE: never use em-dashes ("—") or en-dashes ("–") anywhere in the output, including inside the JSON fields. They are an AI tell. Use commas, periods, parentheses, colons, or restructure. Plain hyphens (-) inside compound words are fine.

Output BOTH (1) a human-readable plan in markdown AND (2) a JSON block at the end with structured deliverables.

Markdown plan format:

### Campaign: <name>

**Campaign Type:** Acquisition | Retention | Upsell | Operational

**Window:** ~6 weeks (or whatever the concept implies)

### Strategic plan
3-5 paragraphs. Audience, positioning, channel mix rationale, sequencing.

### Success metrics
3-5 measurable KPIs.

### Risks / what to watch
2-3 honest risks.

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

Deliverables should map to channels Justin actually runs. Use these exact channel names so the task gets mirrored into the right channel list:
- "Meta Ads"
- "Social" (Instagram / TikTok / Facebook organic: single channel name "Social")
- "SEO" (blog posts, location pages)
- "Email" (broadcasts, nurture sequences, SMS)
- "App Blast" (in-app push notifications to members)
- "Flyer" (printed in-gym signage)
- "Promo" (in-gym promotions, member offers)

Don't include channels not in the concept's channel mix. Cap at 8 deliverables.`

  const user = `Approved concept:

**Title:** ${conceptName}

${conceptDesc}

Original brief (from Campaign Lab parent task):
${originalBrief || '(none)'}

Generate the full campaign plan now.`

  const result = await complete({
    mode: 'brief_me',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 4000,
  })

  const planText = result.text.trim()

  // 4. Parse the JSON block for deliverables
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
  } catch (e) {
    // Fall through with defaults; user can manually add deliverables
  }

  const listName = `🟢 ${parsed.campaign_name}`

  // 5. Create new list under the Campaigns folder
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
      commentText: `**Could not create campaign list:** ${e.message}\n\nLeaving concept as-is in Campaign Lab. Try again after checking the Campaigns folder still exists.`,
      lane: 'campaign_lab',
      usage: { model: result.model, inputTokens: result.inputTokens, outputTokens: result.outputTokens },
    }
  }

  // 6. Create the parent campaign task
  const parentTask = await cu.createTask(newList.id, {
    name: parsed.campaign_name,
    description: `_Promoted from Campaign Lab concept [${task.id}]_\n\n${planText}`,
  })

  // 7. Create deliverable subtasks; each also mirrored into its channel list
  //    via ClickUp's "Tasks in Multiple Lists" (requires Business+ ClickApp).
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
      console.error('[mastermind] promotion: subtask create failed:', e.message)
      continue
    }

    const channelListId = channelListIdFor(d.channel)
    if (channelListId && subtask?.id) {
      try {
        await cu.addTaskToList(channelListId, subtask.id)
        mirroredCount++
      } catch (e) {
        console.error(`[mastermind] promotion: mirror to ${d.channel} list failed:`, e.message)
      }
    }
  }

  // 8. Try to create a ClickUp Doc with the full plan
  let docUrl = ''
  const wsId = process.env.CLICKUP_WORKSPACE_ID
  if (wsId) {
    try {
      const doc = await cu.createDoc(wsId, parentTask.id, {
        name: `Plan: ${parsed.campaign_name}`,
        content: planText,
      })
      docUrl = doc?.url || ''
    } catch (e) {
      console.error('[mastermind] promotion: doc create failed:', e.message)
    }
  }

  // 9. Best-effort: mark the concept itself as Promoted (status name depends on
  // the Campaign Lab status set; provisioning script names it "Promoted")
  try {
    await cu.updateTaskStatus(task.id, 'promoted')
  } catch {
    // ignore: status names vary by ClickUp plan/config
  }

  const linkLine = docUrl ? `📄 Full plan doc: ${docUrl}\n\n` : ''
  const mirrorLine = mirroredCount > 0
    ? `${mirroredCount} of ${createdCount} also mirrored into their channel lists (Meta Ads / Social / SEO / Email / App Blasts / Flyers / Promotions).\n\n`
    : ''

  return {
    commentText: `**Concept promoted to active campaign: Mastermind (${result.model})**\n\n${linkLine}Created list **${listName}** with the parent campaign task and ${createdCount} deliverable subtask${createdCount === 1 ? '' : 's'}.\n\n${mirrorLine}Go to the new list and set \`Mastermind = Draft\` on each deliverable to produce the actual copy.`,
    statusAfter: 'promoted',
    lane: 'campaign_lab',
    usage: {
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  }
}

// Map a deliverable's `channel` string to the env var holding the target list ID.
// Used to mirror the deliverable into its channel list via Tasks in Multiple Lists.
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
