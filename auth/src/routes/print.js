const { Router } = require('express')
const fs = require('fs')
const path = require('path')
const { supabaseAdmin } = require('../services/supabase')
const authenticate = require('../middleware/auth')
const { requireRole } = require('../middleware/role')
const { renderReceiptHtml } = require('../services/printing/receiptTemplate')

const router = Router()

// Logo inlined once at boot so the desktop needs no auth to fetch an asset.
let LOGO_DATA_URI = ''
try {
  const p = path.join(__dirname, '..', 'assets', 'logo.png')
  if (fs.existsSync(p)) LOGO_DATA_URI = 'data:image/png;base64,' + fs.readFileSync(p).toString('base64')
} catch {}

// --- Device (launcher) endpoints: shared-key auth, not user JWT --------------
function requireLauncherKey(req, res, next) {
  const key = process.env.LAUNCHER_KEY
  if (key && req.headers['x-launcher-key'] !== key) {
    return res.status(401).json({ error: 'Invalid launcher key' })
  }
  next()
}

// POST /print/poll — device check-in: register printers, apply acks, get jobs.
router.post('/poll', requireLauncherKey, async (req, res) => {
  try {
    const { install_id, hostname, location, printers, acks } = req.body || {}
    if (!install_id) return res.status(400).json({ error: 'install_id required' })
    const slug = String(location || '').toLowerCase()

    // Resolve location_id from slug (best-effort).
    let locationId = null
    const { data: loc } = await supabaseAdmin
      .from('locations').select('id').ilike('name', slug).maybeSingle()
    if (loc) locationId = loc.id

    // Upsert the device registry row (preserve admin-set selected_printer/enabled).
    await supabaseAdmin.from('print_devices').upsert({
      install_id,
      hostname: hostname || null,
      location_slug: slug || null,
      location_id: locationId,
      available_printers: Array.isArray(printers) ? printers : [],
      last_seen: new Date().toISOString(),
    }, { onConflict: 'install_id', ignoreDuplicates: false })

    // Apply acks for previously handed-out jobs.
    for (const ack of (Array.isArray(acks) ? acks : [])) {
      if (!ack || !ack.id) continue
      const ok = ack.status === 'printed'
      await supabaseAdmin.from('print_jobs').update({
        status: ok ? 'printed' : 'failed',
        printed_at: ok ? new Date().toISOString() : null,
        error: ok ? null : String(ack.error || 'print failed'),
      }).eq('id', ack.id).eq('install_id', install_id)
    }

    // Read current device config + hand out pending jobs.
    const { data: device } = await supabaseAdmin
      .from('print_devices').select('enabled, selected_printer').eq('install_id', install_id).maybeSingle()

    let jobs = []
    if (device && device.enabled && device.selected_printer) {
      const { data: pending } = await supabaseAdmin
        .from('print_jobs').select('id')
        .eq('install_id', install_id).eq('status', 'pending')
        .order('created_at', { ascending: true }).limit(3)
      const ids = (pending || []).map(j => j.id)
      if (ids.length) {
        await supabaseAdmin.from('print_jobs')
          .update({ status: 'claimed', claimed_at: new Date().toISOString() })
          .in('id', ids).eq('status', 'pending')
      }
      const base = process.env.PUBLIC_API_URL || ''
      jobs = ids.map(id => ({ id, receipt_url: `${base}/print/receipt/${id}` }))
    }

    res.json({
      enabled: !!(device && device.enabled),
      selected_printer: device ? device.selected_printer : null,
      jobs,
    })
  } catch (err) {
    console.error('[print] poll failed:', err.message)
    res.status(500).json({ error: 'poll failed' })
  }
})

// GET /print/receipt/:id — standalone HTML for the desktop to print.
router.get('/receipt/:id', async (req, res) => {
  try {
    const { data: job } = await supabaseAdmin
      .from('print_jobs').select('payload, status').eq('id', req.params.id).maybeSingle()
    if (!job || (job.status !== 'claimed' && job.status !== 'printed')) {
      return res.status(404).send('Not found')
    }
    res.set('Content-Type', 'text/html; charset=utf-8')
    res.send(renderReceiptHtml(job.payload, { logoDataUri: LOGO_DATA_URI }))
  } catch (err) {
    console.error('[print] receipt failed:', err.message)
    res.status(500).send('error')
  }
})

// --- Admin endpoints: user JWT + admin role -------------------------------
router.use(authenticate)

router.get('/devices', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('print_devices')
    .select('install_id, location_slug, hostname, available_printers, selected_printer, enabled, last_seen')
    .order('location_slug')
  if (error) return res.status(500).json({ error: 'Failed to list devices' })
  res.json({ devices: data || [] })
})

router.put('/devices/:install_id', requireRole('admin'), async (req, res) => {
  const updates = {}
  if (req.body.selected_printer !== undefined) updates.selected_printer = req.body.selected_printer
  if (req.body.enabled !== undefined) updates.enabled = !!req.body.enabled
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' })
  const { data, error } = await supabaseAdmin
    .from('print_devices').update(updates).eq('install_id', req.params.install_id).select().maybeSingle()
  if (error) return res.status(500).json({ error: 'Failed to update device' })
  res.json({ device: data })
})

router.post('/devices/:install_id/test', requireRole('admin'), async (req, res) => {
  const { data: device } = await supabaseAdmin
    .from('print_devices').select('install_id, location_slug, selected_printer, enabled')
    .eq('install_id', req.params.install_id).maybeSingle()
  if (!device) return res.status(404).json({ error: 'Device not found' })
  if (!device.enabled || !device.selected_printer) {
    return res.status(400).json({ error: 'Device not enabled or no printer selected' })
  }
  const testPayload = {
    type: 'till_close', location: device.location_slug || 'Test', date: new Date().toISOString().slice(0, 10),
    closedBy: 'Test Print', float: 100, cashSales: 0, cashRefunds: 0, dropsTotal: 0,
    expected: 100, counted: 100, overShort: 0, bagDrop: 0, drops: [],
  }
  const { data, error } = await supabaseAdmin.from('print_jobs').insert({
    location_slug: device.location_slug, install_id: device.install_id,
    type: 'test', payload: testPayload, status: 'pending',
  }).select().maybeSingle()
  if (error) return res.status(500).json({ error: 'Failed to enqueue test' })
  res.json({ jobId: data.id })
})

router.get('/automations', requireRole('admin'), async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('print_automations')
    .select('id, location_slug, job_name_match, print_type, enabled')
    .order('location_slug')
  if (error) return res.status(500).json({ error: 'Failed to list automations' })
  res.json({ automations: data || [] })
})

router.put('/automations/:location_slug', requireRole('admin'), async (req, res) => {
  const slug = String(req.params.location_slug).toLowerCase()
  const { data: loc } = await supabaseAdmin.from('locations').select('id').ilike('name', slug).maybeSingle()
  const row = {
    location_slug: slug,
    location_id: loc ? loc.id : null,
    print_type: 'till_close',
    enabled: req.body.enabled !== undefined ? !!req.body.enabled : false,
  }
  if (req.body.job_name_match !== undefined) row.job_name_match = req.body.job_name_match
  const { data, error } = await supabaseAdmin
    .from('print_automations').upsert(row, { onConflict: 'location_slug,print_type' }).select().maybeSingle()
  if (error) return res.status(500).json({ error: 'Failed to save automation' })
  res.json({ automation: data })
})

module.exports = router
