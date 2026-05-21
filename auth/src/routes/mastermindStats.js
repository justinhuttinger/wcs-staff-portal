const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(authenticate)
router.use(requireRole('admin'))

// GET /admin/mastermind/stats?days=30
// Returns aggregated cost + invocation stats over the requested window.
router.get('/stats', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365)
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)

  const { data: rows, error } = await supabaseAdmin
    .from('mastermind_queue')
    .select('mode, lane, status, cost_usd, input_tokens, output_tokens, model, requested_at, completed_at, task_id')
    .gte('requested_at', since.toISOString())
    .order('requested_at', { ascending: false })

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  const all = rows || []
  const done = all.filter(r => r.status === 'done')
  const failed = all.filter(r => r.status === 'failed')
  const pending = all.filter(r => r.status === 'pending' || r.status === 'working')

  const totalCost = done.reduce((s, r) => s + Number(r.cost_usd || 0), 0)

  const byMode = {}
  const byLane = {}
  const byModel = {}
  for (const r of done) {
    const cost = Number(r.cost_usd || 0)
    if (r.mode) byMode[r.mode] = (byMode[r.mode] || 0) + cost
    if (r.lane) byLane[r.lane] = (byLane[r.lane] || 0) + cost
    if (r.model) byModel[r.model] = (byModel[r.model] || 0) + cost
  }

  const topTasks = [...done]
    .sort((a, b) => Number(b.cost_usd || 0) - Number(a.cost_usd || 0))
    .slice(0, 10)
    .map(r => ({
      task_id: r.task_id,
      mode: r.mode,
      cost_usd: Number(r.cost_usd || 0),
      model: r.model,
      completed_at: r.completed_at,
    }))

  // Today's spend (for daily-cap visibility)
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const todayCost = done
    .filter(r => r.completed_at && new Date(r.completed_at) >= todayStart)
    .reduce((s, r) => s + Number(r.cost_usd || 0), 0)

  res.json({
    period_days: days,
    today_cost_usd: todayCost,
    daily_cap_usd: Number(process.env.MASTERMIND_DAILY_CAP_USD || 25),
    total_cost_usd: totalCost,
    total_invocations: all.length,
    invocations_done: done.length,
    invocations_failed: failed.length,
    invocations_pending: pending.length,
    by_mode: byMode,
    by_lane: byLane,
    by_model: byModel,
    top_tasks: topTasks,
    enabled: process.env.MASTERMIND_ENABLED === 'true',
  })
})

// GET /admin/mastermind/queue?limit=50&status=
// Returns recent queue rows for debugging.
router.get('/queue', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
  const status = req.query.status

  let q = supabaseAdmin
    .from('mastermind_queue')
    .select('*')
    .order('requested_at', { ascending: false })
    .limit(limit)

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return res.status(500).json({ error: error.message })
  res.json({ rows: data || [] })
})

// GET /admin/mastermind/errors?limit=50
router.get('/errors', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200)
  const { data, error } = await supabaseAdmin
    .from('mastermind_errors')
    .select('*')
    .order('error_at', { ascending: false })
    .limit(limit)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ rows: data || [] })
})

module.exports = router
