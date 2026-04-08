const { Router } = require('express')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')

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
    const { data: recentLogs } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10)

    // Last successful sync per type
    const { data: lastFull } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('completed_at, duration_ms')
      .eq('sync_type', 'full')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()

    const { data: lastDelta } = await supabaseAdmin
      .from('ghl_sync_log')
      .select('completed_at, duration_ms')
      .eq('sync_type', 'delta')
      .not('completed_at', 'is', null)
      .order('completed_at', { ascending: false })
      .limit(1)
      .single()

    // Contacts per location
    const { data: contactsByLoc } = await supabaseAdmin
      .rpc('exec_sql', { query: `
        SELECT l.name, COUNT(c.id) as count
        FROM ghl_contacts_v2 c
        JOIN ghl_locations l ON l.id = c.location_id
        GROUP BY l.name ORDER BY l.name
      `}).catch(() => ({ data: null }))

    // Fallback if RPC not available
    let locationBreakdown = null
    if (!contactsByLoc) {
      const { data: locs } = await supabaseAdmin.from('ghl_locations').select('id, name')
      if (locs) {
        locationBreakdown = []
        for (const loc of locs) {
          const { count } = await supabaseAdmin.from('ghl_contacts_v2').select('*', { count: 'exact', head: true }).eq('location_id', loc.id)
          locationBreakdown.push({ name: loc.name, contacts: count || 0 })
        }
      }
    }

    // Check for errors in recent logs
    const recentErrors = (recentLogs || []).filter(l => l.errors && l.errors.length > 0)

    res.json({
      status: recentErrors.length === 0 ? 'healthy' : 'has_errors',
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
      by_location: contactsByLoc || locationBreakdown || [],
      recent_logs: recentLogs || [],
      recent_errors: recentErrors.length,
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
