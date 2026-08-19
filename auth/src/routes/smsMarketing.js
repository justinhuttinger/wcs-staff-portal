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
// Reply rate per automated text, one row per template GLOBALLY across all
// seven clubs (not per club) — GHL exposes no workflow id on a message, so
// texts are clustered by a fingerprint of their body (see ghl-sync
// src/sms/templateKey.js) and named through sms_templates.label. Each row
// carries a by_club breakdown for the underlying per-gym numbers.
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
        group_key: r.group_key,
        template_keys: r.template_keys || [],
        clubs: r.clubs || [],
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
        by_club: r.by_club || {},
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

// PATCH /sms-marketing/templates/:key { label, template_keys? }
//
// Names a cluster. Template identity is global (one row per fingerprint
// across all clubs), so this renames by template_key alone — no
// location_slug. A copy edit can leave a group spanning several fingerprints
// (the edited body hashes to a new key alongside the old one), so an optional
// template_keys array lets the caller rename every fingerprint in the group
// at once; when omitted, only :key is renamed.
router.patch('/templates/:key', requireRole('admin'), async (req, res) => {
  const { label, template_keys } = req.body || {}

  const clean = typeof label === 'string' && label.trim() ? label.trim().slice(0, 120) : null

  const keys = Array.isArray(template_keys) && template_keys.length
    ? Array.from(new Set([req.params.key, ...template_keys.filter(k => typeof k === 'string')]))
    : [req.params.key]

  try {
    const { error } = await supabaseAdmin
      .from('sms_templates')
      .update({ label: clean })
      .in('template_key', keys)
    if (error) throw error
    res.json({ ok: true })
  } catch (err) {
    console.error('[SMS Marketing] label error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
