const { complete } = require('../anthropic')
const { inferLane } = require('../lane')

// Analyze: pull data and write a report.
// MVP scope: detect what kind of report from the task title/description and
// dispatch to the appropriate adapter. Currently only Meta ROAS adapter is
// wired; other adapters return a stub explaining what's needed.
module.exports = async function analyze({ task, comments }) {
  const lane = inferLane(task)
  const desc = (task?.markdown_description || task?.description || task?.text_content || '').toLowerCase()
  const title = (task?.name || '').toLowerCase()
  const text = `${title}\n${desc}`

  if (/meta|fb roas|fb-roas|facebook ad|roas review/.test(text)) {
    return analyzeMetaRoas({ task, lane })
  }

  if (/monthly marketing report|monthly report/.test(text)) {
    return analyzeMonthlyStub({ task, lane })
  }

  if (/flyer audit/.test(text)) {
    return analyzeFlyerStub({ task, lane })
  }

  if (/email.*queue|what.*queued|email.*scheduled/.test(text)) {
    return analyzeEmailQueueStub({ task, lane })
  }

  // Fallback: general analysis on whatever context the task provides
  return analyzeGeneric({ task, comments, lane })
}

async function analyzeGeneric({ task, comments, lane }) {
  const system = `You are the WCS Marketing Mastermind. Write a concise data-light analysis based only on what the task says. If the request would need data you don't have, say so explicitly and recommend what data the user should attach.

Output:
1. **What I read** — 1 sentence on what the task is asking.
2. **What I can say from context** — honest analysis from what's provided.
3. **What I'd need to go deeper** — specific data sources.`

  const user = `Task: ${task?.name}
Lane: ${lane}
Description: ${task?.markdown_description || task?.description || '(none)'}
Comments: ${(comments || []).slice(-3).map(c => c.comment_text).join('\n') || '(none)'}

Analyze now.`

  const r = await complete({ mode: 'analyze', system, messages: [{ role: 'user', content: user }], maxTokens: 2000 })
  return {
    commentText: `**Analysis — Mastermind (${r.model})**\n\n${r.text.trim()}`,
    statusAfter: 'analyzing',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

async function analyzeMetaRoas({ task, lane }) {
  // Best-effort hand-off to the existing FB ROAS helper. If it doesn't export
  // a callable shape, fall through to a stub explaining what to do.
  let data
  try {
    const fbRoas = require('../../routes/fbRoas')
    if (typeof fbRoas.getRoasData === 'function') {
      data = await fbRoas.getRoasData({ days: 7 })
    } else if (typeof fbRoas.fetchRoasData === 'function') {
      data = await fbRoas.fetchRoasData({ days: 7 })
    } else {
      return {
        commentText: `**Analyze — Meta ROAS adapter not yet wired.**\n\nThe \`auth/src/routes/fbRoas.js\` module currently exports only an Express router, not a callable helper. To enable automated Meta ROAS analysis:\n\n1. Refactor \`fbRoas.js\` to expose a \`getRoasData({ days })\` function alongside the router\n2. Update this handler (\`auth/src/mastermind/modes/analyze.js\`) to call it\n\nFor MVP, this analysis must be manual.`,
        statusAfter: 'analyzing',
        lane,
        usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
      }
    }
  } catch (e) {
    return {
      commentText: `**Analyze failed — could not load fbRoas helper:** ${e.message}`,
      statusAfter: 'analyzing',
      lane,
      usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
    }
  }

  const system = `You are the WCS Marketing Mastermind. Read Meta ad performance data and write a concise weekly review.

Output:
1. **Headline read** — 1–2 sentences. What matters most this week?
2. **What's working** — 3 bullets max with numbers.
3. **What's bleeding** — 3 bullets max with numbers.
4. **Recommended actions** — 2–4 concrete budget shifts or experiments.

Be specific. Numbers beat adjectives. No hedging.`

  // Trim the data payload to ~12K chars to stay under reasonable token limits
  const dataStr = JSON.stringify(data, null, 2).slice(0, 12000)
  const user = `Task: ${task?.name}\n\nMeta ROAS data (last 7 days):\n\`\`\`json\n${dataStr}\n\`\`\`\n\nWrite the review now.`

  const r = await complete({
    mode: 'analyze',
    system,
    messages: [{ role: 'user', content: user }],
    maxTokens: 2500,
  })

  return {
    commentText: `**Weekly Meta ROAS Review — Mastermind (${r.model})**\n\n${r.text.trim()}`,
    statusAfter: 'drafted',
    lane,
    usage: { model: r.model, inputTokens: r.inputTokens, outputTokens: r.outputTokens },
  }
}

function stubMsg(label, neededData) {
  return `**Analyze — ${label} adapter not yet wired.**\n\nThis recurring task is expected to pull ${neededData}. Adapter implementation is part of the post-MVP work. For now, attach the relevant data to this task as a comment and re-trigger \`Mastermind = Analyze\` — I'll write the report from whatever data you paste in.`
}

async function analyzeMonthlyStub({ lane }) {
  return {
    commentText: stubMsg('Monthly Marketing Report', 'GBP + GA4 + FB ROAS + 12-month trends'),
    statusAfter: 'analyzing',
    lane,
    usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
  }
}
async function analyzeFlyerStub({ lane }) {
  return {
    commentText: stubMsg('Flyer Audit', 'Flyers & Print list rows filtered to Pull By < today AND status != Expired'),
    statusAfter: 'analyzing',
    lane,
    usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
  }
}
async function analyzeEmailQueueStub({ lane }) {
  return {
    commentText: stubMsg('Email Queue Check', 'this week\'s scheduled Email & SMS broadcasts'),
    statusAfter: 'analyzing',
    lane,
    usage: { model: 'none', inputTokens: 0, outputTokens: 0 },
  }
}
