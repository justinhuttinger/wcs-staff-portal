// Pure period math for workflow email stats.
//
// GHL's workflow-campaign stats endpoint returns LIFETIME cumulative counters
// with no date dimension, so "opens in July" is only obtainable by snapshotting
// the counters daily and subtracting. This module is that subtraction, kept
// free of I/O so it can be tested directly.

const COUNTER_FIELDS = [
  'sent', 'accepted', 'delivered', 'opened', 'clicked', 'unsubscribed',
  'complained', 'permanent_fail', 'temporary_fail', 'rejected', 'failed', 'replied',
]

const num = v => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// latest - baseline, clamped at 0. A null baseline means we have no snapshot
// from before the range, so the only honest answer is the lifetime total —
// flagged with is_lifetime so the UI can say so rather than imply a period.
function diffSnapshots(latest, baseline) {
  if (!latest) return null
  const out = { is_lifetime: !baseline }
  for (const f of COUNTER_FIELDS) {
    const d = num(latest[f]) - (baseline ? num(baseline[f]) : 0)
    // GHL occasionally restates a counter downward, resulting in a negative
    // delta. Clamp to zero since negative periods are not real readings.
    out[f] = d > 0 ? d : 0
  }
  return out
}

const pct = (n, d) => (d > 0 ? +((n / d) * 100).toFixed(2) : 0)

// Rates are recomputed from the diffed counters rather than carried over from
// GHL's precomputed lifetime rates, which are meaningless for a period.
// Denominator matches GHL's own math: delivered for engagement, sent for bounce.
function computeRates(c) {
  const delivered = num(c.delivered)
  const sent = num(c.sent)
  const bounced = num(c.permanent_fail) + num(c.temporary_fail)
  return {
    open_rate: pct(num(c.opened), delivered),
    click_rate: pct(num(c.clicked), delivered),
    reply_rate: pct(num(c.replied), delivered),
    unsubscribe_rate: pct(num(c.unsubscribed), delivered),
    bounce_rate: pct(bounced, sent),
  }
}

module.exports = { COUNTER_FIELDS, diffSnapshots, computeRates }
