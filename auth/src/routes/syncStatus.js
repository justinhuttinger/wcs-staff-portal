const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

const GHL_SYNC_URL = process.env.GHL_SYNC_URL

const router = Router()
router.use(authenticate)
router.use(requireRole('lead'))

// GET /sync-status — overview of GHL sync health
router.get('/', async (req, res) => {
  try {
    // Record counts
    const [contacts, opps, pipelines, locations] = await Promise.all([
      supabaseAdmin.from('ghl_contacts_v2').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('ghl_opportunities_v2').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('ghl_pipelines').select('*', { count: 'exact', head: true }),
      supabaseAdmin.from('ghl_locations').select('*', { count: 'exact', head: true }),
    ])

    // Last sync logs
    const { data: recentLogs, error: logsError } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10)
    if (logsError) console.error('Sync logs query failed:', logsError.message)

    // Last successful sync per type
    const { data: lastFull, error: fullError } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('completed_at, duration_ms')
      .eq('sync_type', 'full')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()
    if (fullError && fullError.code !== 'PGRST116') console.error('Last full sync query failed:', fullError.message)

    const { data: lastDelta, error: deltaError } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('completed_at, duration_ms')
      .eq('sync_type', 'delta')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()
    if (deltaError && deltaError.code !== 'PGRST116') console.error('Last delta sync query failed:', deltaError.message)

    // Contacts per location
    let contactsByLoc = null
    try {
      const { data: locs } = await supabaseAdmin.from('ghl_locations').select('id, name')
      if (locs) {
        contactsByLoc = []
        for (const loc of locs) {
          const { count } = await supabaseAdmin.from('ghl_contacts_v2').select('*', { count: 'exact', head: true }).eq('location_id', loc.id)
          contactsByLoc.push({ name: loc.name, contacts: count || 0 })
        }
      }
    } catch (e) {
      console.error('Location breakdown failed:', e.message)
    }

    // Check for errors in recent logs
    const recentErrors = (recentLogs || []).filter(l => l.errors && l.errors.length > 0)

    // Check if ABC sync is currently running
    let abcSyncRunning = false
    if (GHL_SYNC_URL) {
      try {
        const healthRes = await fetch(`${GHL_SYNC_URL}/health`, { signal: AbortSignal.timeout(3000) })
        const health = await healthRes.json()
        abcSyncRunning = health.syncRunning || false
      } catch { /* ignore — sync service may be down */ }
    }

    res.json({
      status: recentErrors.length === 0 ? 'healthy' : 'has_errors',
      abc_sync_running: abcSyncRunning,
      record_counts: {
        contacts: contacts.count || 0,
        opportunities: opps.count || 0,
        pipelines: pipelines.count || 0,
        locations: locations.count || 0,
      },
      last_full_sync: lastFull?.completed_at || null,
      last_full_duration_ms: lastFull?.duration_ms || null,
      last_delta_sync: lastDelta?.completed_at || null,
      last_delta_duration_ms: lastDelta?.duration_ms || null,
      by_location: contactsByLoc || [],
      recent_logs: recentLogs || [],
      recent_errors: recentErrors.length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
