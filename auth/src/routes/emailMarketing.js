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
    let q = supabaseAdmin
      .from('email_stats_daily')
      .select('location, source_id, name, subject, snapshot_date, sent, accepted, delivered, opened, clicked, unsubscribed, complained, permanent_fail, temporary_fail, rejected, failed, replied')
      .eq('source', 'workflow-campaigns')
      .order('snapshot_date', { ascending: true })

    if (location_slug) q = q.eq('location', location_slug)
    if (end_date) q = q.lte('snapshot_date', end_date)

    // No lower bound here on purpose: the baseline snapshot has to predate
    // start_date, so it can live arbitrarily far back. email_stats_daily grows
    // by one row per workflow campaign per location per day, which reaches
    // PostgREST's ~1000-row response cap within about a week. Ascending order
    // means an unpaged query would silently truncate to the OLDEST rows, so
    // `latest` would collapse to a week-one snapshot, every diff would read
    // as zero, and the table would render empty. Page explicitly until a
    // short page comes back (see auth/src/routes/checkinsReport.js).
    const data = []
    let from = 0
    for (;;) {
      const { data: page, error } = await q.range(from, from + 999)
      if (error) throw error
      if (!page || !page.length) break
      data.push(...page)
      if (page.length < 1000) break
      from += 1000
    }

    // Per campaign: the last snapshot at or before end_date is the "latest";
    // the last one strictly before start_date is the baseline. Rows arrive in
    // ascending date order, so a single pass keeps the newest of each.
    const byCampaign = new Map()
    let baselineDate = null
    for (const row of data || []) {
      const k = `${row.location}|${row.source_id}`
      const entry = byCampaign.get(k) || { latest: null, baseline: null, meta: row }
      entry.latest = row
      if (start_date && row.snapshot_date < start_date) {
        entry.baseline = row
        if (!baselineDate || row.snapshot_date > baselineDate) baselineDate = row.snapshot_date
      }
      entry.meta = row
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
