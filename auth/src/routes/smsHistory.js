const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const router = Router()
router.use(authenticate)
router.use(requireRole('director'))

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  if (!sid || !token) throw new Error('Twilio credentials not configured')
  return require('twilio')(sid, token)
}

// GET /sms-history/messages — fetch from Twilio API (live pull)
router.get('/messages', async (req, res) => {
  const { start_date, end_date, search, limit = 200 } = req.query

  try {
    const client = getTwilioClient()
    const params = {
      to: process.env.TWILIO_PHONE_NUMBER,
      limit: Math.min(parseInt(limit, 10) || 200, 1000),
    }

    if (start_date) params.dateSentAfter = new Date(start_date + 'T00:00:00Z')
    if (end_date) params.dateSentBefore = new Date(end_date + 'T23:59:59Z')

    const messages = await client.messages.list(params)

    // Filter to inbound only
    let filtered = messages.filter(m => m.direction === 'inbound')

    // Client-side body search (Twilio doesn't support server-side)
    if (search) {
      const term = search.toLowerCase()
      filtered = filtered.filter(m => m.body?.toLowerCase().includes(term))
    }

    const formatted = filtered.map(m => ({
      sid: m.sid,
      from: m.from,
      to: m.to,
      body: m.body,
      direction: m.direction,
      status: m.status,
      date_sent: m.dateSent,
      num_segments: m.numSegments,
    }))

    res.json({ messages: formatted, total: formatted.length })
  } catch (err) {
    console.error('[SMS History] Fetch error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// POST /sms-history/sync — pull from Twilio and upsert to Supabase
router.post('/sync', async (req, res) => {
  const { start_date, end_date } = req.body

  try {
    const client = getTwilioClient()
    const params = {
      to: process.env.TWILIO_PHONE_NUMBER,
      limit: 1000,
    }

    if (start_date) params.dateSentAfter = new Date(start_date + 'T00:00:00Z')
    if (end_date) params.dateSentBefore = new Date(end_date + 'T23:59:59Z')

    const messages = await client.messages.list(params)
    const inbound = messages.filter(m => m.direction === 'inbound')

    if (inbound.length === 0) {
      return res.json({ synced: 0, message: 'No inbound messages found' })
    }

    const rows = inbound.map(m => ({
      sid: m.sid,
      from_number: m.from,
      to_number: m.to,
      body: m.body,
      direction: m.direction,
      status: m.status,
      date_sent: m.dateSent,
      num_segments: m.numSegments,
      error_code: m.errorCode || null,
      error_message: m.errorMessage || null,
      synced_at: new Date().toISOString(),
    }))

    const { error, count } = await supabaseAdmin
      .from('sms_history')
      .upsert(rows, { onConflict: 'sid', count: 'exact' })

    if (error) {
      console.error('[SMS History] Sync error:', error.message)
      return res.status(500).json({ error: 'Failed to sync: ' + error.message })
    }

    res.json({ synced: count || rows.length, message: `${count || rows.length} messages synced` })
  } catch (err) {
    console.error('[SMS History] Sync error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// GET /sms-history/search — query persisted messages from Supabase (fast)
router.get('/search', async (req, res) => {
  const { start_date, end_date, search, page = 1, limit = 50 } = req.query
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 50))
  const offset = (pageNum - 1) * pageSize

  try {
    let query = supabaseAdmin
      .from('sms_history')
      .select('*', { count: 'exact' })
      .eq('direction', 'inbound')
      .order('date_sent', { ascending: false })
      .range(offset, offset + pageSize - 1)

    if (start_date) query = query.gte('date_sent', start_date + 'T00:00:00Z')
    if (end_date) query = query.lte('date_sent', end_date + 'T23:59:59Z')
    if (search) query = query.textSearch('body', search, { type: 'websearch' })

    const { data, count, error } = await query
    if (error) {
      console.error('[SMS History] Search error:', error.message)
      return res.status(500).json({ error: 'Search failed' })
    }

    res.json({ messages: data || [], total: count || 0, page: pageNum, limit: pageSize })
  } catch (err) {
    console.error('[SMS History] Search error:', err.message)
    res.status(500).json({ error: 'Search failed' })
  }
})

module.exports = router
