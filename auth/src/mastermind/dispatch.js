const queue = require('./queue')
const cu = require('./clickup')
const { computeUsd } = require('./cost')
const { getHandler } = require('./modes')

const DAILY_COST_CAP_USD = Number(process.env.MASTERMIND_DAILY_CAP_USD || 25)
const PER_TASK_COST_CAP_USD = Number(process.env.MASTERMIND_TASK_CAP_USD || 2)
const MASTERMIND_FIELD_ID = process.env.CLICKUP_MASTERMIND_FIELD_ID || ''
const CLICKUP_WORKSPACE_ID = process.env.CLICKUP_WORKSPACE_ID || ''
const MAX_RETRIES = 5

async function dispatchOne(row) {
  const handler = getHandler(row.mode)
  if (!handler) {
    await queue.markFailed(row.id, `no handler for mode '${row.mode}'`)
    return
  }

  // Daily cap
  const dailyUsd = await queue.dailyCostUsd()
  if (dailyUsd >= DAILY_COST_CAP_USD) {
    await queue.markFailed(row.id, `daily cap reached ($${dailyUsd.toFixed(2)} >= $${DAILY_COST_CAP_USD})`)
    return
  }

  // Fetch task context
  let task, comments
  try {
    task = await cu.getTask(row.task_id)
    comments = await cu.getTaskComments(row.task_id)
  } catch (e) {
    const retries = await queue.incrementRetry(row.id, `ClickUp fetch failed: ${e.message}`)
    if (retries >= MAX_RETRIES) {
      await queue.markFailed(row.id, `gave up after ${retries} retries`)
    }
    return
  }

  // Pause check
  if (isPaused(task)) {
    await queue.markFailed(row.id, 'task is paused (Mastermind Paused = true)')
    return
  }

  // Run handler
  let result
  try {
    result = await handler({ task, comments, row })
  } catch (e) {
    const retries = await queue.incrementRetry(row.id, `handler error: ${e.message}`)
    if (retries >= MAX_RETRIES) {
      await queue.markFailed(row.id, `gave up after ${retries} retries`)
    }
    return
  }

  // Compute cost
  const cost = computeUsd(result.usage || {})
  if (cost > PER_TASK_COST_CAP_USD) {
    result.commentText = `⚠️ Per-task cost cap exceeded ($${cost.toFixed(2)} > $${PER_TASK_COST_CAP_USD}). Proceeding once; tune \`MASTERMIND_TASK_CAP_USD\` env if expected.\n\n` + result.commentText
  }

  // Post outputs
  let commentId = null
  let docId = null
  try {
    // Create Doc first if requested (so we can link it from the comment)
    if (result.docName && result.docContent && CLICKUP_WORKSPACE_ID) {
      try {
        const doc = await cu.createDoc(CLICKUP_WORKSPACE_ID, row.task_id, {
          name: result.docName,
          content: result.docContent,
        })
        docId = doc?.id || null
        if (docId) {
          const url = doc?.url || `(doc id: ${docId})`
          result.commentText = `${result.commentText}\n\n📄 Full doc: ${url}`
        }
      } catch (e) {
        result.commentText = `${result.commentText}\n\n⚠️ Could not create ClickUp Doc: ${e.message} — full content below:\n\n${result.docContent}`
      }
    }

    commentId = await cu.postComment(row.task_id, result.commentText)

    if (result.statusAfter) {
      try { await cu.updateTaskStatus(row.task_id, result.statusAfter) }
      catch (e) { /* status name may not match list — best effort, swallow */ }
    }

    if (MASTERMIND_FIELD_ID) {
      try { await cu.clearCustomField(row.task_id, MASTERMIND_FIELD_ID) }
      catch { /* swallow — field reset is polish, not critical */ }
    }
  } catch (e) {
    await queue.markFailed(row.id, `output post failed: ${e.message}`)
    return
  }

  await queue.markDone(row.id, {
    output_comment_id: commentId,
    output_doc_id: docId,
    input_tokens: result.usage?.inputTokens || 0,
    output_tokens: result.usage?.outputTokens || 0,
    model: result.usage?.model || null,
    cost_usd: cost,
    lane: result.lane || null,
  })
}

function isPaused(task) {
  const fields = task?.custom_fields || []
  const f = fields.find(x => x?.name === 'Mastermind Paused')
  if (!f) return false
  return Boolean(f.value)
}

async function tick() {
  if (process.env.MASTERMIND_ENABLED !== 'true') return
  const rows = await queue.claimPending(3)
  for (const row of rows) {
    try {
      await dispatchOne(row)
    } catch (e) {
      console.error('[mastermind] dispatch error', e)
      try { await queue.markFailed(row.id, e.message) } catch {}
    }
  }
}

module.exports = { tick, dispatchOne }
