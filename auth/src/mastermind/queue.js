const { supabaseAdmin } = require('../services/supabase')

// Claim up to `limit` pending rows. Marks them 'working' atomically by
// updating only rows that are still 'pending'. Returns claimed rows.
async function claimPending(limit = 3) {
  const { data: candidates } = await supabaseAdmin
    .from('mastermind_queue')
    .select('id')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(limit)

  if (!candidates || candidates.length === 0) return []

  const ids = candidates.map(r => r.id)
  const { data: claimed } = await supabaseAdmin
    .from('mastermind_queue')
    .update({ status: 'working', started_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'pending')
    .select('*')

  return claimed || []
}

async function markDone(id, { output_comment_id, output_doc_id, input_tokens, output_tokens, model, cost_usd, lane }) {
  await supabaseAdmin
    .from('mastermind_queue')
    .update({
      status: 'done',
      completed_at: new Date().toISOString(),
      output_comment_id: output_comment_id || null,
      output_doc_id: output_doc_id || null,
      input_tokens: input_tokens ?? null,
      output_tokens: output_tokens ?? null,
      model: model || null,
      cost_usd: cost_usd ?? null,
      lane: lane || null,
    })
    .eq('id', id)
}

async function markFailed(id, errorMsg, { retries = 0 } = {}) {
  await supabaseAdmin
    .from('mastermind_queue')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error: String(errorMsg).slice(0, 1000),
      retries,
    })
    .eq('id', id)
}

async function incrementRetry(id, errorMsg) {
  const { data } = await supabaseAdmin
    .from('mastermind_queue')
    .select('retries')
    .eq('id', id)
    .single()
  const next = (data?.retries || 0) + 1
  await supabaseAdmin
    .from('mastermind_queue')
    .update({
      retries: next,
      error: String(errorMsg).slice(0, 1000),
      status: 'pending',
      started_at: null,
    })
    .eq('id', id)
  return next
}

async function dailyCostUsd() {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { data } = await supabaseAdmin
    .from('mastermind_queue')
    .select('cost_usd')
    .gte('completed_at', since.toISOString())
    .eq('status', 'done')
  return (data || []).reduce((sum, r) => sum + Number(r.cost_usd || 0), 0)
}

module.exports = { claimPending, markDone, markFailed, incrementRetry, dailyCostUsd }
