const { Router } = require('express')
const authenticate = require('../middleware/auth')
const { requireReportAccess } = require('../middleware/role')
const { supabaseAdmin } = require('../services/supabase')

const router = Router()
router.use(authenticate)
// Corporate+ (incl. the legacy marketing tier) normally; a custom-role member
// granted the 'email-marketing' report gets in too — same gate as Meta Ads.
router.use(requireReportAccess('corporate', ['email-marketing']))

// email_stats holds one row per send (synced from GHL by ghl-sync). GHL
// precomputes the per-send rates, so we return them as-is. Bounces aren't a
// single GHL field — they're permanent_fail + temporary_fail.
function shapeRow(r) {
  const bounced = (r.permanent_fail || 0) + (r.temporary_fail || 0)
  return {
    location: r.location,
    source: r.source,
    source_id: r.source_id,
    name: r.name,
    subject: r.subject,
    status: r.status,
    completed_at: r.completed_at,
    sent: r.sent || 0,
    delivered: r.delivered || 0,
    opened: r.opened || 0,
    clicked: r.clicked || 0,
    replied: r.replied || 0,
    unsubscribed: r.unsubscribed || 0,
    complained: r.complained || 0,
    bounced,
    open_rate: r.open_rate,
    click_rate: r.click_rate,
    reply_rate: r.reply_rate,
    unsubscribe_rate: r.unsubscribe_rate,
    bounce_rate: r.bounce_rate,
  }
}

// GET /email-marketing/campaigns?location_slug=&start_date=&end_date=
// Each send + its stats, plus rolled-up totals. Sends are filtered by
// completed_at within the range; sends with no completed date (e.g. workflow
// aggregates) are excluded when a range is applied.
router.get('/campaigns', async (req, res) => {
  const { location_slug, start_date, end_date } = req.query
  try {
    let q = supabaseAdmin
      .from('email_stats')
      .select('location, source, source_id, name, subject, status, completed_at, sent, delivered, opened, clicked, replied, unsubscribed, complained, permanent_fail, temporary_fail, open_rate, click_rate, reply_rate, unsubscribe_rate, bounce_rate')
      .order('completed_at', { ascending: false, nullsFirst: false })
      // One-time sends only. Workflow rows are evergreen automations with a
      // null completed_at, so the date filter below would silently drop them —
      // they get their own endpoint with real period math instead.
      .in('source', ['bulk-actions', 'email-campaigns'])

    if (location_slug) q = q.eq('location', location_slug)
    if (start_date) q = q.gte('completed_at', start_date)
    if (end_date) q = q.lte('completed_at', end_date + 'T23:59:59.999Z')

    const { data, error } = await q
    if (error) throw error

    const campaigns = (data || []).map(shapeRow)

    // Aggregate totals. GHL's per-send rate denominator is delivered (verified:
    // 21 opened / 27 delivered = 77.78% openRate), so roll open/click/reply/
    // unsubscribe over delivered; bounce rate is over sent.
    const t = campaigns.reduce((a, c) => {
      a.sends += 1
      a.sent += c.sent; a.delivered += c.delivered; a.opened += c.opened
      a.clicked += c.clicked; a.replied += c.replied
      a.unsubscribed += c.unsubscribed; a.bounced += c.bounced
      return a
    }, { sends: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, unsubscribed: 0, bounced: 0 })

    const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)
    const totals = {
      ...t,
      open_rate: pct(t.opened, t.delivered),
      click_rate: pct(t.clicked, t.delivered),
      reply_rate: pct(t.replied, t.delivered),
      unsubscribe_rate: pct(t.unsubscribed, t.delivered),
      bounce_rate: pct(t.bounced, t.sent),
    }

    res.json({ campaigns, totals })
  } catch (err) {
    console.error('[Email Marketing] campaigns error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

const { diffSnapshots, computeRates } = require('./emailAutomationMath')

// GET /email-marketing/automations?location_slug=&start_date=&end_date=
//
// Workflow email performance over a real date range. GHL only exposes LIFETIME
// counters per workflow, so the period figure is the difference between the
// last snapshot in the range and the last snapshot before it. When no snapshot
// predates the range (we started snapshotting after start_date), the row is
// returned as a lifetime total flagged is_lifetime rather than a made-up
// period number.
router.get('/automations', async (req, res) => {
  const { location_slug, start_date, end_date } = req.query
  try {
    // email_automation_period() (auth/migrations/112_email_automation_period.sql)
    // does the "latest at/before end_date" + "baseline strictly before
    // start_date" selection in SQL via DISTINCT ON, returning at most two rows
    // per campaign instead of the whole table. Replaces the old paged full-table
    // scan that grew ~294 rows/day forever and was accumulating tens of MB per
    // request.
    const { data, error } = await supabaseAdmin.rpc('email_automation_period', {
      p_start: start_date || null,
      p_end: end_date || null,
      p_location: location_slug || null,
    })
    if (error) throw error

    // Per campaign: at most one "latest" row (is_baseline = false) and one
    // "baseline" row (is_baseline = true) come back from the function.
    const byCampaign = new Map()
    let baselineDate = null
    for (const row of data || []) {
      const k = `${row.location}|${row.source_id}`
      const entry = byCampaign.get(k) || { latest: null, baseline: null, meta: null }
      if (row.is_baseline) {
        entry.baseline = row
        if (!baselineDate || row.snapshot_date > baselineDate) baselineDate = row.snapshot_date
      } else {
        entry.latest = row
      }
      // Prefer the latest row's name/subject (mirrors the old ascending-scan
      // behavior, where the most recent row processed last always won); fall
      // back to whatever row we have if latest hasn't been seen yet.
      if (!row.is_baseline || !entry.meta) entry.meta = row
      byCampaign.set(k, entry)
    }

    const automations = []
    for (const [, { latest, baseline, meta }] of byCampaign) {
      const counters = diffSnapshots(latest, baseline)
      if (!counters) continue
      if (!counters.sent) continue // omit automations with no sends in range
      automations.push({
        location: meta.location,
        source_id: meta.source_id,
        name: meta.name,
        subject: meta.subject,
        sent: counters.sent,
        delivered: counters.delivered,
        opened: counters.opened,
        clicked: counters.clicked,
        replied: counters.replied,
        unsubscribed: counters.unsubscribed,
        bounced: counters.permanent_fail + counters.temporary_fail,
        is_lifetime: counters.is_lifetime,
        ...computeRates(counters),
      })
    }
    automations.sort((a, b) => b.sent - a.sent)

    const t = automations.reduce((a, c) => {
      a.automations += 1
      a.sent += c.sent; a.delivered += c.delivered; a.opened += c.opened
      a.clicked += c.clicked; a.replied += c.replied
      a.unsubscribed += c.unsubscribed; a.bounced += c.bounced
      return a
    }, { automations: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, replied: 0, unsubscribed: 0, bounced: 0 })

    res.json({
      automations,
      totals: { ...t, ...computeRates({ ...t, permanent_fail: t.bounced, temporary_fail: 0 }) },
      baseline_date: baselineDate,
    })
  } catch (err) {
    console.error('[Email Marketing] automations error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

module.exports = router
