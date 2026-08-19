const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireRole, requireReportAccess } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(authenticate)
// Same gate as Meta Ads and Email Marketing: corporate+, or a custom role
// holding the marketing-engagement report grant.
router.use(requireReportAccess('corporate', ['marketing-engagement']))

const VALID_KINDS = ['automated', 'staff', 'all']

const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)

// GET /sms-marketing/templates?location_slug=&start_date=&end_date=&kind=
//
// Reply rate per automated text. GHL exposes no workflow id on a message, so
// texts are clustered by a fingerprint of their body (see ghl-sync
// src/sms/templateKey.js) and named through sms_templates.label.
//
// The date range filters the SEND date. A reply landing after end_date still
// counts: the attribution window, not the report range, decides what is a reply.
router.get('/templates', async (req, res) => {
  const { location_slug, start_date, end_date } = req.query
  const kind = VALID_KINDS.includes(req.query.kind) ? req.query.kind : 'automated'

  try {
    const { data, error } = await supabaseAdmin.rpc('sms_engagement_by_template', {
      p_location: location_slug || null,
      p_start: start_date ? start_date + 'T00:00:00.000Z' : null,
      p_end: end_date ? end_date + 'T23:59:59.999Z' : null,
      p_kind: kind,
    })
    if (error) throw error

    const templates = (data || []).map(r => {
      const sends = Number(r.sends) || 0
      const replies = Number(r.replies) || 0
      const optOuts = Number(r.opt_outs) || 0
      return {
        location: r.location,
        template_key: r.template_key,
        label: r.label || null,
        sample_body: r.sample_body || '',
        sends,
        delivered: Number(r.delivered) || 0,
        failed: Number(r.failed) || 0,
        replies,
        reply_rate: pct(replies, sends),
        opt_outs: optOuts,
        opt_out_rate: pct(optOuts, sends),
        median_reply_minutes: r.median_reply_minutes == null ? null : Number(r.median_reply_minutes),
      }
    })

    const t = templates.reduce((a, c) => {
      a.templates += 1
      a.sends += c.sends; a.delivered += c.delivered; a.failed += c.failed
      a.replies += c.replies; a.opt_outs += c.opt_outs
      return a
    }, { templates: 0, sends: 0, delivered: 0, failed: 0, replies: 0, opt_outs: 0 })

    res.json({
      templates,
      totals: { ...t, reply_rate: pct(t.replies, t.sends), opt_out_rate: pct(t.opt_outs, t.sends) },
    })
  } catch (err) {
    console.error('[SMS Marketing] templates error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// PATCH /sms-marketing/templates/:key { location_slug, label }
//
// Names a cluster. Labels are per location because the same text can run at
// more than one gym. A copy edit produces a new fingerprint, so reusing the
// same label is how an edited template stays grouped in the report.
router.patch('/templates/:key', requireRole('admin'), async (req, res) => {
  const { location_slug, label } = req.body || {}
  if (!location_slug) return res.status(400).json({ error: 'location_slug is required' })

  const clean = typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null

  try {
    const { error } = await supabaseAdmin
      .from('sms_templates')
      .update({ label: clean })
      .eq('location', location_slug)
      .eq('template_key', req.params.key)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[SMS Marketing] label error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
